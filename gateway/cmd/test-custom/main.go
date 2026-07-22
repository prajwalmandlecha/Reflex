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

const gatewayURL = "http://localhost:8080/mcp/bank-payments"

func main() {
	fmt.Println("==========================================================================")
	fmt.Println("    TESTING AGENT PROFILES & GRANULAR TOOL RESTRICTIONS")
	fmt.Println("==========================================================================")

	// Test 1: custom-agent-alpha (Profile custom_alpha: allowed tools ["login", "get_balance", "transfer_money"])
	fmt.Println("\n--- [Test 1] custom-agent-alpha calls get_balance (Allowed in profile) ---")
	res1 := callTool("custom-agent-alpha", "custom", "get_balance", map[string]any{})
	fmt.Printf("   Response: %s\n", res1)

	fmt.Println("\n--- [Test 2] custom-agent-alpha calls evaluate_transaction_risk (Blocked by Profile Whitelist) ---")
	res2 := callTool("custom-agent-alpha", "custom", "evaluate_transaction_risk", map[string]any{"amount_cents": 1000})
	fmt.Printf("   Response: %s\n", res2)

	// Test 3: Dynamic tools/list filtering
	fmt.Println("\n--- [Test 3] custom-agent-alpha requests tools/list (Dynamic Schema Filtering) ---")
	toolsList := requestToolsList("custom-agent-alpha", "custom")
	fmt.Printf("   Filtered Tool List Response: %s\n", toolsList)

	fmt.Println("\n==========================================================================")
	fmt.Println("    AGENT PROFILES VERIFICATION COMPLETE!")
	fmt.Println("==========================================================================")
}

func handshake(agentID, agentKind string) string {
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	initBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "custom-test-client", "version": "1.0"},
		},
	})

	req, _ := http.NewRequest("POST", gatewayURL, bytes.NewReader(initBody))
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
	notifReq, _ := http.NewRequest("POST", gatewayURL, bytes.NewReader(notifBody))
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

func requestToolsList(agentID, agentKind string) string {
	sessionID := handshake(agentID, agentKind)

	listBody, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": map[string]any{}})
	req, _ := http.NewRequest("POST", gatewayURL, bytes.NewReader(listBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if sessionID != "" {
		req.Header.Set("Mcp-Session-Id", sessionID)
	}
	req.Header.Set("X-Agent-ID", agentID)
	req.Header.Set("X-Agent-Kind", agentKind)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatalf("tools/list failed: %v", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	return strings.TrimSpace(string(bodyBytes))
}

func callTool(agentID, agentKind, toolName string, args map[string]any) string {
	sessionID := handshake(agentID, agentKind)

	callBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      99,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      toolName,
			"arguments": args,
		},
	})

	req, _ := http.NewRequest("POST", gatewayURL, bytes.NewReader(callBody))
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
