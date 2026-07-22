package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
)

func main() {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	baseURL := "http://localhost:8080/mcp"

	fmt.Println("=== Connecting to AGP Gateway (Pattern 3: Transparent MCP Reverse Proxy) ===")

	// Step 1: Initialize MCP Session (Proxied transparently to Bank MCP)
	initReqBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"clientInfo": map[string]any{
				"name":    "test-agent",
				"version": "1.0.0",
			},
		},
	})

	req, _ := http.NewRequest("POST", baseURL, bytes.NewReader(initReqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("X-Agent-ID", "pay-agent-01")
	req.Header.Set("X-Agent-Kind", "payments")

	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("failed to initialize MCP session: %v", err)
	}
	sessionID := resp.Header.Get("Mcp-Session-Id")
	bodyBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	fmt.Printf("1. Init Handshake (Proxied from Bank MCP): Status %d\n", resp.StatusCode)
	fmt.Printf("   Response: %s\n\n", string(bodyBytes))

	// Complete MCP Handshake
	initNotifBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "notifications/initialized",
	})
	notifReq, _ := http.NewRequest("POST", baseURL, bytes.NewReader(initNotifBody))
	notifReq.Header.Set("Content-Type", "application/json")
	notifReq.Header.Set("Accept", "application/json, text/event-stream")
	if sessionID != "" {
		notifReq.Header.Set("Mcp-Session-Id", sessionID)
	}
	notifReq.Header.Set("X-Agent-ID", "pay-agent-01")
	notifReq.Header.Set("X-Agent-Kind", "payments")
	if notifResp, err := client.Do(notifReq); err == nil {
		notifResp.Body.Close()
	}

	// Step 2: Discover Bank's Native MCP Tools (tools/list proxied to Bank MCP)
	fmt.Println("2. Discovering Bank's Native MCP Tools (tools/list)...")
	listReqBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/list",
		"params":  map[string]any{},
	})
	listReq, _ := http.NewRequest("POST", baseURL, bytes.NewReader(listReqBody))
	listReq.Header.Set("Content-Type", "application/json")
	listReq.Header.Set("Accept", "application/json, text/event-stream")
	if sessionID != "" {
		listReq.Header.Set("Mcp-Session-Id", sessionID)
	}
	listReq.Header.Set("X-Agent-ID", "pay-agent-01")
	listReq.Header.Set("X-Agent-Kind", "payments")
	if listResp, err := client.Do(listReq); err == nil {
		listBytes, _ := io.ReadAll(listResp.Body)
		listResp.Body.Close()
		fmt.Printf("   Bank MCP Tools Discovered: %s\n\n", string(listBytes))
	}

	// Helper for tool calls
	callTool := func(testName, toolName string, args map[string]any) {
		fmt.Printf("--- %s ---\n", testName)
		callBody, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0",
			"id":      3,
			"method":  "tools/call",
			"params": map[string]any{
				"name":      toolName,
				"arguments": args,
			},
		})

		req, _ := http.NewRequest("POST", baseURL, bytes.NewReader(callBody))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		if sessionID != "" {
			req.Header.Set("Mcp-Session-Id", sessionID)
		}
		req.Header.Set("X-Agent-ID", "pay-agent-01")
		req.Header.Set("X-Agent-Kind", "payments")

		resp, err := client.Do(req)
		if err != nil {
			log.Fatalf("failed to call tool: %v", err)
		}
		defer resp.Body.Close()

		respBytes, _ := io.ReadAll(resp.Body)
		fmt.Printf("Response: %s\n\n", string(respBytes))
	}

	// Test A: Authorized Call to Bank's native tool `payment.initiate` ($250.00)
	callTool("Test A: Authorized Call to Bank MCP `payment.initiate` ($250.00)", "payment.initiate", map[string]any{
		"recipient": "vendor-account-99",
		"amount":    250.00,
	})

	// Test B: Denied Call to Bank's native tool `trading.execute` (Unauthorized action for payment agent)
	callTool("Test B: Denied Call to Bank MCP `trading.execute` (Forbidden action)", "trading.execute", map[string]any{
		"symbol": "AAPL",
		"amount": 100.00,
		"action": "buy",
	})

	// Test C: Denied Call to `payment.initiate` ($6,000.00 > $5,000.00 cap)
	callTool("Test C: Denied Call ($6,000.00 exceeds $5,000.00 cap)", "payment.initiate", map[string]any{
		"recipient": "vendor-account-99",
		"amount":    6000.00,
	})
}
