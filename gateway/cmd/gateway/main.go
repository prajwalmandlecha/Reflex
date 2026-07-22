// Package main is the entrypoint for the AGP gateway.
//
// It wires all components together and starts the MCP server and metrics endpoint.
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/agp/gateway/internal/audit"
	"github.com/agp/gateway/internal/authn"
	"github.com/agp/gateway/internal/authz"
	"github.com/agp/gateway/internal/config"
	"github.com/agp/gateway/internal/killswitch"
	"github.com/agp/gateway/internal/proxy"
	"github.com/agp/gateway/internal/spend"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))
	slog.SetDefault(logger)

	cfg := config.Load()
	logger.Info("starting AGP gateway",
		"mcp_port", cfg.MCPPort,
		"metrics_port", cfg.MetricsPort,
		"redis_addr", cfg.RedisAddr,
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- Redis ---
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	logger.Info("connected to Redis", "addr", cfg.RedisAddr)

	// --- Postgres ---
	pool, err := pgxpool.New(ctx, cfg.PostgresDSN)
	if err != nil {
		logger.Error("failed to create Postgres pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		logger.Error("failed to ping Postgres", "error", err)
		os.Exit(1)
	}
	logger.Info("connected to Postgres")

	// --- Components ---
	jwtMgr := authn.NewJWTManager(cfg.JWTSecret, cfg.JWTIssuer, cfg.JWTDefaultTTL)
	ks := killswitch.NewSwitch(rdb)

	policyEngine, err := authz.NewEngine(ctx, rdb, pool, logger, cfg.PolicyPollInterval)
	if err != nil {
		logger.Error("failed to initialize policy engine", "error", err)
		os.Exit(1)
	}

	spendLimiter := spend.NewLimiter(rdb)

	auditor, err := audit.NewLogger(ctx, pool, logger, cfg.AuditBatchSize, cfg.AuditFlushInterval)
	if err != nil {
		logger.Error("failed to initialize audit logger", "error", err)
		os.Exit(1)
	}

	// --- Pattern 3: Transparent MCP Reverse Proxy & Security Interceptor (Multi-Server Support) ---
	mcpInterceptor := proxy.NewMCPProxy(cfg.MCPTargets, ks, policyEngine, spendLimiter, auditor, jwtMgr, logger)
	logger.Info("MCP Security Interceptor Proxy initialized", "targets", cfg.MCPTargets)

	// --- Chi router ---
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.Recoverer)

	// Health — no auth
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// MCP Transparent Reverse Proxy (governs all MCP tools/call traffic)
	r.Mount("/mcp", mcpInterceptor)

	// Control-plane routes — grouped under /v1
	r.Route("/v1", func(r chi.Router) {
		// Token mint — demo convenience, no operator auth needed
		r.Post("/token", func(w http.ResponseWriter, r *http.Request) {
			agentID := r.URL.Query().Get("agent_id")
			agentKind := r.URL.Query().Get("agent_kind")
			if agentID == "" {
				http.Error(w, `{"error":"agent_id required"}`, http.StatusBadRequest)
				return
			}
			token, err := jwtMgr.Mint(agentID, agentKind, 1)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"token": token})
		})
		// Agent revocation
		r.Post("/agents/{agentID}/revoke", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "agentID")
			if err := ks.KillAgent(r.Context(), id); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			logger.Info("agent revoked", "agent_id", id)
			writeJSON(w, http.StatusOK, map[string]string{"revoked": id})
		})

		r.Delete("/agents/{agentID}/revoke", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "agentID")
			if err := ks.ReviveAgent(r.Context(), id); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			logger.Info("agent revived", "agent_id", id)
			writeJSON(w, http.StatusOK, map[string]string{"revived": id})
		})

		// Fleet emergency stop
		r.Post("/fleet/halt", func(w http.ResponseWriter, r *http.Request) {
			if err := ks.HaltFleet(r.Context()); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			logger.Warn("FLEET HALTED by operator")
			writeJSON(w, http.StatusOK, map[string]string{"fleet": "halted"})
		})

		r.Delete("/fleet/halt", func(w http.ResponseWriter, r *http.Request) {
			if err := ks.ResumeFleet(r.Context()); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			logger.Info("fleet resumed by operator")
			writeJSON(w, http.StatusOK, map[string]string{"fleet": "resumed"})
		})

		// Audit integrity check
		r.Get("/audit/verify", func(w http.ResponseWriter, r *http.Request) {
			result, err := audit.Verify(r.Context(), pool)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeJSON(w, http.StatusOK, result)
		})
	})

	// --- HTTP servers ---
	mcpHTTP := &http.Server{
		Addr:    ":" + cfg.MCPPort,
		Handler: r,
	}

	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", promhttp.Handler())
	metricsHTTP := &http.Server{
		Addr:    ":" + cfg.MetricsPort,
		Handler: metricsMux,
	}

	// --- Start ---
	errCh := make(chan error, 2)

	go func() {
		logger.Info("MCP + control-plane server listening", "port", cfg.MCPPort)
		errCh <- mcpHTTP.ListenAndServe()
	}()

	go func() {
		logger.Info("metrics server listening", "port", cfg.MetricsPort)
		errCh <- metricsHTTP.ListenAndServe()
	}()

	// --- Graceful shutdown ---
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		logger.Info("received signal, shutting down", "signal", sig)
	case err := <-errCh:
		logger.Error("server error", "error", err)
	}

	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	mcpHTTP.Shutdown(shutdownCtx)
	metricsHTTP.Shutdown(shutdownCtx)
	auditor.Close(shutdownCtx)
	rdb.Close()

	logger.Info("gateway shut down cleanly")
}

// writeJSON is a small helper to keep handlers clean.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
