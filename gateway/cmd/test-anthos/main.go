package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"strings"
)

const gatewayBaseURL = "http://localhost:8080"

var anthosRoutes = map[string]string{
	"bank-identity":  gatewayBaseURL + "/mcp/bank-identity",
	"bank-payments":  gatewayBaseURL + "/mcp/bank-payments",
	"bank-financial": gatewayBaseURL + "/mcp/bank-financial",
	"bank-risk":      gatewayBaseURL + "/mcp/bank-risk",
}

func main() {
	fmt.Println("==========================================================================")
	fmt.Println("    VERIFYING GATEWAY WITH LIVE BANK OF ANTHOS MCP SERVERS (4 ENDPOINTS)")
	fmt.Println("==========================================================================")

	// Step 1: Discover Tools across all 4 Bank MCP Server endpoints via Gateway
	for name, url := range anthosRoutes {
		fmt.Printf("\n--- [1] Native Tool Discovery via Gateway for route: %s ---\n", name)
		sessionID := handshake(url, "pay-agent-01", "payments")

		listBody, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": map[string]any{}})
		req, _ := http.NewRequest("POST", url, bytes.NewReader(listBody))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		if sessionID != "" {
			req.Header.Set("Mcp-Session-Id", sessionID)
		}
		req.Header.Set("X-Agent-ID", "pay-agent-01")
		req.Header.Set("X-Agent-Kind", "payments")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			log.Fatalf("failed tool list: %v", err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		fmt.Printf("   Gateway Proxied Tool List Response:\n   %s\n", truncate(string(body), 200))
	}

	// Step 2: Test End-to-End Governance Interception & Execution

	// Test A: Authorized Login on Bank Identity
	fmt.Println("\n--- [Test A] Authorized Call on bank-identity (login) ---")
	resA := callTool(anthosRoutes["bank-identity"], "pay-agent-01", "payments", "login", map[string]any{
		"username": "user1",
		"password": "password1",
	})
	fmt.Printf("   Response: %s\n", resA)

	// Test B: Authorized Account Details on Bank Payments
	fmt.Println("\n--- [Test B] Authorized Call on bank-payments (get_account_details) ---")
	resB := callTool(anthosRoutes["bank-payments"], "pay-agent-01", "payments", "get_account_details", map[string]any{
		"bearer_token": "dummy_token",
		"account_id":   "1234567890",
	})
	fmt.Printf("   Response: %s\n", resB)

	// Test C: Denied Call on Bank Risk by Conversational Agent (OPA Policy Block)
	fmt.Println("\n--- [Test C] Denied Call on bank-risk by Conversational Agent (OPA Block) ---")
	resC := callTool(anthosRoutes["bank-risk"], "conv-agent-01", "conversational", "evaluate_transaction_risk", map[string]any{
		"bearer_token": "dummy_token",
		"account_id":   "1234567890",
		"amount_cents": 5000,
		"recipient_id": "9876543210",
		"is_external":  false,
	})
	fmt.Printf("   Response: %s\n", resC)

	// Test D: Denied Call on Bank Payments ($6,000 = 600,000 cents exceeds $5,000 spend cap)
	fmt.Println("\n--- [Test D] Denied Call on bank-payments (Spend Cap Exceeded $6,000 > $5,000) ---")
	resD := callTool(anthosRoutes["bank-payments"], "pay-agent-01", "payments", "transfer_money", map[string]any{
		"bearer_token": "dummy_token",
		"account_id":   "1234567890",
		"amount_cents": 600000, // $6,000
		"recipient_id": "9876543210",
		"is_external":  false,
	})
	fmt.Printf("   Response: %s\n", resD)

	fmt.Println("\n==========================================================================")
	fmt.Println("    BANK OF ANTHOS LIVE VERIFICATION COMPLETE!")
	fmt.Println("==========================================================================")
}

func handshake(url, agentID, agentKind string) string {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	initBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "anthos-test-client", "version": "1.0"},
		},
	})

	req, _ := http.NewRequest("POST", url, bytes.NewReader(initBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("X-Agent-ID", agentID)
	req.Header.Set("X-Agent-Kind", agentKind)

	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("handshake failed: %v", err)
	}
	sessionID := resp.Header.Get("Mcp-Session-Id")
	resp.Body.Close()

	notifBody, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"})
	notifReq, _ := http.NewRequest("POST", url, bytes.NewReader(notifBody))
	notifReq.Header.Set("Content-Type", "application/json")
	notifReq.Header.Set("Accept", "application/json, text/event-stream")
	if sessionID != "" {
		notifReq.Header.Set("Mcp-Session-Id", sessionID)
	}
	notifReq.Header.Set("X-Agent-ID", agentID)
	notifReq.Header.Set("X-Agent-Kind", agentKind)
	if nResp, err := client.Do(notifReq); err == nil {
		nResp.Body.Close()
	}

	return sessionID
}

func callTool(url, agentID, agentKind, toolName string, args map[string]any) string {
	sessionID := handshake(url, agentID, agentKind)

	callBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      99,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      toolName,
			"arguments": args,
		},
	})

	req, _ := http.NewRequest("POST", url, bytes.NewReader(callBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if sessionID != "" {
		req.Header.Set("Mcp-Session-Id", sessionID)
	}
	req.Header.Set("X-Agent-ID", agentID)
	req.Header.Set("X-Agent-Kind", agentKind)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatalf("tool call failed: %v", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	return strings.TrimSpace(string(bodyBytes))
}

func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max] + "..."
	}
	return s
}
