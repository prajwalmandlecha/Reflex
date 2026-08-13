// Package main is the entrypoint for the AGP gateway.
//
// It wires all hot-path components together and starts the MCP server and metrics endpoint.
package main

import (
	"context"
	"encoding/json"
	"fmt"
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
	"github.com/agp/gateway/internal/configcache"
	"github.com/agp/gateway/internal/constraints"
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

	// Fail closed on the built-in dev JWT secret outside of explicit dev mode.
	// A governance proxy that starts with a known shared secret is silently
	// mintable by anyone — refuse to boot unless the operator opts into dev.
	if cfg.JWTSecret == "dev-secret-2026" && os.Getenv("AGP_ENV") != "dev" {
		logger.Error("refusing to start: JWT secret is the built-in dev default; set JWT_SECRET (and JWT_ISSUER) or AGP_ENV=dev to proceed")
		os.Exit(1)
	}

	logger.Info("starting AGP gateway",
		"mcp_port", cfg.MCPPort,
		"metrics_port", cfg.MetricsPort,
		"redis_addr", cfg.RedisAddr,
		"backend_url", cfg.BackendURL,
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

	// --- Hot-Path Components ---
	jwtMgr := authn.NewJWTManager(cfg.JWTSecret, cfg.JWTIssuer, 1*time.Hour)
	ks := killswitch.NewSwitch(rdb)

	policyEngine, err := authz.NewEngine(ctx, rdb, pool, logger, cfg.PolicyPollInterval)
	if err != nil {
		logger.Error("failed to initialize policy engine", "error", err)
		os.Exit(1)
	}

	spendLimiter := spend.NewLimiter(rdb)
	constraintChecker := constraints.NewChecker()
	cfgCache := configcache.New(ctx, rdb, cfg.BackendURL, logger)

	auditor, err := audit.NewLogger(ctx, pool, logger, cfg.AuditBatchSize, cfg.AuditFlushInterval)
	if err != nil {
		logger.Error("failed to initialize audit logger", "error", err)
		os.Exit(1)
	}

	// --- MCP Security Interceptor & Proxy ---
	// MCP targets are user-managed data (bank connections registered via the UI),
	// not infrastructure config. The proxy starts with an empty target map and
	// populates it from Redis via LoadNativeTargets() below.
	mcpInterceptor := proxy.NewMCPProxy(
		map[string]string{},
		ks,
		policyEngine,
		spendLimiter,
		constraintChecker,
		cfgCache,
		auditor,
		jwtMgr,
		rdb,
		logger,
	)
	logger.Info("MCP Security Interceptor Proxy initialized")

	// Load OpenAPI virtual targets, tool routing, and native-MCP targets from the
	// bank-connection cache, and keep them hot-reloaded on config changes (G7).
	mcpInterceptor.LoadOpenAPISpecs(ctx)
	mcpInterceptor.LoadToolRouting(ctx)
	mcpInterceptor.LoadPromptRouting(ctx)
	mcpInterceptor.LoadResourceRouting(ctx)
	mcpInterceptor.LoadNativeTargets(ctx)
	mcpInterceptor.LoadConnectionAuth(ctx)
	go mcpInterceptor.SubscribeConnectionUpdates(ctx)

	// --- Chi Router ---
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.Recoverer)

	// Health check (no auth)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"agp-gateway"}`))
	})

	// Audit chain integrity verification — recomputes every entry_hash and
	// checks linkage. Operator-facing; the backend exposes its own /api/v1/audit/verify.
	r.Get("/v1/audit/verify", func(w http.ResponseWriter, r *http.Request) {
		res, err := audit.Verify(r.Context(), pool)
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprintf(w, `{"valid":false,"error":%q}`, err.Error())
			return
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(res)
	})

	// MCP Transparent Reverse Proxy — single /mcp endpoint for all agents.
	// Gateway routes to the correct downstream based on tool name.
	r.Mount("/mcp", mcpInterceptor)

	// --- HTTP Servers ---
	// Hardened against Slowloris / resource exhaustion: explicit read/write/
	// idle timeouts and a header size cap. The MCP server tolerates longer
	// writes for downstream streaming; the metrics server is tight.
	mcpHTTP := &http.Server{
		Addr:           ":" + cfg.MCPPort,
		Handler:        r,
		ReadTimeout:    15 * time.Second,
		WriteTimeout:   60 * time.Second,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 1 << 20, // 1 MiB
	}

	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", promhttp.Handler())
	metricsHTTP := &http.Server{
		Addr:           ":" + cfg.MetricsPort,
		Handler:        metricsMux,
		ReadTimeout:    5 * time.Second,
		WriteTimeout:   10 * time.Second,
		IdleTimeout:    30 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}

	// --- Start ---
	errCh := make(chan error, 2)

	go func() {
		logger.Info("MCP gateway server listening", "port", cfg.MCPPort)
		errCh <- mcpHTTP.ListenAndServe()
	}()

	go func() {
		logger.Info("metrics server listening", "port", cfg.MetricsPort)
		errCh <- metricsHTTP.ListenAndServe()
	}()

	// --- Graceful Shutdown ---
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
