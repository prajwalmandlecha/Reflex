// Package main provides a Native Bank MCP Server.
// It exposes rich, domain-specific banking tools over MCP (Streamable HTTP).
// In production, this service lives inside the bank's secure network ('backend').
// It is ONLY reachable through the AGP Gateway reverse proxy.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// Initialize Bank MCP Server
	bankServer := mcp.NewServer(
		&mcp.Implementation{
			Name:    "amex-bank-mcp",
			Version: "v2.0.0",
		},
		&mcp.ServerOptions{},
	)

	// Tool 1: payment.initiate
	type paymentArgs struct {
		Recipient string  `json:"recipient"`
		Amount    float64 `json:"amount"`
		Currency  string  `json:"currency,omitempty"`
	}
	mcp.AddTool(bankServer, &mcp.Tool{
		Name:        "payment.initiate",
		Description: "Initiate a wire transfer or vendor payment from an American Express corporate account.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args paymentArgs) (*mcp.CallToolResult, any, error) {
		txnID := fmt.Sprintf("TXN-%06d", rand.Intn(999999))
		logger.Info("bank MCP: executing payment.initiate", "txn_id", txnID, "amount", args.Amount, "recipient", args.Recipient)

		resJSON, _ := json.Marshal(map[string]any{
			"status":    "completed",
			"txn_id":    txnID,
			"amount":    args.Amount,
			"recipient": args.Recipient,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: string(resJSON)}},
		}, nil, nil
	})

	// Tool 2: account.balance
	type balanceArgs struct {
		AccountID string `json:"account_id,omitempty"`
	}
	mcp.AddTool(bankServer, &mcp.Tool{
		Name:        "account.balance",
		Description: "Query real-time balance for an American Express account.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args balanceArgs) (*mcp.CallToolResult, any, error) {
		logger.Info("bank MCP: executing account.balance")

		resJSON, _ := json.Marshal(map[string]any{
			"account":  "AMEX-XXXX-4521",
			"balance":  52340.75,
			"currency": "USD",
		})
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: string(resJSON)}},
		}, nil, nil
	})

	// Tool 3: trading.execute
	type tradeArgs struct {
		Symbol string  `json:"symbol"`
		Amount float64 `json:"amount"`
		Action string  `json:"action"` // "buy" or "sell"
	}
	mcp.AddTool(bankServer, &mcp.Tool{
		Name:        "trading.execute",
		Description: "Execute a stock or security trade order.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, args tradeArgs) (*mcp.CallToolResult, any, error) {
		orderID := fmt.Sprintf("ORD-%06d", rand.Intn(999999))
		logger.Info("bank MCP: executing trading.execute", "order_id", orderID, "symbol", args.Symbol)

		resJSON, _ := json.Marshal(map[string]any{
			"status":    "filled",
			"order_id":  orderID,
			"symbol":    args.Symbol,
			"action":    args.Action,
			"amount":    args.Amount,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: string(resJSON)}},
		}, nil, nil
	})

	// Expose Bank MCP Server over Streamable HTTP
	httpHandler := mcp.NewStreamableHTTPHandler(
		func(r *http.Request) *mcp.Server {
			return bankServer
		},
		&mcp.StreamableHTTPOptions{},
	)

	mux := http.NewServeMux()
	mux.Handle("/mcp", httpHandler)
	mux.Handle("/mcp/", httpHandler)

	logger.Info("native Bank MCP server listening", "port", "9000")
	if err := http.ListenAndServe(":9000", mux); err != nil {
		logger.Error("bank MCP server failed", "error", err)
		os.Exit(1)
	}
}
