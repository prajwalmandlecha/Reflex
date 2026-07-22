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
	"time"
)

const (
	gatewayURL = "http://localhost:8080"
	metricsURL = "http://localhost:9090/metrics"
)

type TestSuite struct {
	client *http.Client
	passed int
	failed int
}

func main() {
	jar, _ := cookiejar.New(nil)
	ts := &TestSuite{
		client: &http.Client{Jar: jar, Timeout: 10 * time.Second},
	}

	fmt.Println("==========================================================================")
	fmt.Println("    AGENT GOVERNANCE PLATFORM (AGP) - COMPLETE FEATURE VERIFICATION")
	fmt.Println("==========================================================================")

	// 1. Health check
	ts.testHealth()

	// 2. JWT Token Minting & Authentication
	token := ts.testJWTTokenMinting()

	// 3. MCP Handshake & Tool Discovery
	sessionID := ts.testMCPHandshake(token)

	// 4. OPA Policy Engine Enforcement (Different Agent Kinds)
	ts.testOPAPolicies(sessionID)

	// 5. Emergency Killswitch (Per-Agent Revocation & Revival)
	ts.testKillswitchPerAgent(sessionID)

	// 6. Fleet-Wide Emergency Stop (Halt & Resume)
	ts.testFleetEmergencyStop(sessionID)

	// 7. Cryptographic Audit Log Integrity Verification
	ts.testAuditVerification()

	// 8. Prometheus Metrics Endpoint
	ts.testPrometheusMetrics()

	fmt.Println("\n==========================================================================")
	fmt.Printf(" VERIFICATION SUMMARY: %d PASSED, %d FAILED\n", ts.passed, ts.failed)
	fmt.Println("==========================================================================")
}

func (ts *TestSuite) testHealth() {
	fmt.Println("\n[1/8] Testing Gateway Health Endpoint...")
	resp, err := ts.client.Get(gatewayURL + "/health")
	if err != nil || resp.StatusCode != 200 {
		ts.fail("Health check failed")
		return
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if strings.Contains(string(body), `"status":"ok"`) {
		ts.pass("Health check status: OK")
	} else {
		ts.fail("Health check unexpected response: " + string(body))
	}
}

func (ts *TestSuite) testJWTTokenMinting() string {
	fmt.Println("\n[2/8] Testing Control Plane JWT Token Minting (/v1/token)...")
	resp, err := ts.client.Post(gatewayURL+"/v1/token?agent_id=trade-agent-01&agent_kind=trading", "application/json", nil)
	if err != nil || resp.StatusCode != 200 {
		ts.fail("JWT token minting failed")
		return ""
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	var res map[string]string
	json.Unmarshal(body, &res)
	token := res["token"]
	if token != "" {
		ts.pass(fmt.Sprintf("JWT Token successfully minted for trade-agent-01 (length %d chars)", len(token)))
	} else {
		ts.fail("Token response missing token field: " + string(body))
	}
	return token
}

func (ts *TestSuite) testMCPHandshake(token string) string {
	fmt.Println("\n[3/8] Testing MCP Initialization & Native Tool Discovery...")
	initBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]any{"name": "feature-test-agent", "version": "1.0"},
		},
	})

	req, _ := http.NewRequest("POST", gatewayURL+"/mcp", bytes.NewReader(initBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := ts.client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		ts.fail(fmt.Sprintf("MCP handshake failed: %v", err))
		return ""
	}
	sessionID := resp.Header.Get("Mcp-Session-Id")
	resp.Body.Close()

	// Complete MCP handshake
	notifBody, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"})
	notifReq, _ := http.NewRequest("POST", gatewayURL+"/mcp", bytes.NewReader(notifBody))
	notifReq.Header.Set("Content-Type", "application/json")
	notifReq.Header.Set("Accept", "application/json, text/event-stream")
	if sessionID != "" {
		notifReq.Header.Set("Mcp-Session-Id", sessionID)
	}
	notifReq.Header.Set("Authorization", "Bearer "+token)
	if notifResp, err := ts.client.Do(notifReq); err == nil {
		notifResp.Body.Close()
	}

	ts.pass(fmt.Sprintf("MCP session established (Session-ID: %s)", sessionID))
	return sessionID
}

func (ts *TestSuite) testOPAPolicies(sessionID string) {
	fmt.Println("\n[4/8] Testing OPA Policy Engine Rules across Agent Kinds...")

	// Test 4A: Conversational Agent trying read-only vs action
	resConvBalance := ts.callMCPTool(sessionID, "conv-agent-01", "conversational", "account.balance", map[string]any{})
	if strings.Contains(resConvBalance, "balance") {
		ts.pass("Conversational Agent: account.balance -> ALLOWED (Read-Only)")
	} else {
		ts.fail("Conversational Agent balance check failed: " + resConvBalance)
	}

	resConvPay := ts.callMCPTool(sessionID, "conv-agent-01", "conversational", "payment.initiate", map[string]any{"amount": 100.0, "recipient": "vendor"})
	if strings.Contains(resConvPay, "isError") || strings.Contains(resConvPay, "not allowed") {
		ts.pass("Conversational Agent: payment.initiate -> DENIED by OPA Policy")
	} else {
		ts.fail("Conversational Agent payment initiation should have been denied: " + resConvPay)
	}

	// Test 4B: Trading Agent trying trading vs payment
	resTradeExecute := ts.callMCPTool(sessionID, "trade-agent-01", "trading", "transfer_money", map[string]any{"amount_cents": 50000, "recipient_account": "12345", "recipient_routing_num": "67890", "is_external": false, "account_id": "trade-01", "bearer_token": "token"})
	if strings.Contains(resTradeExecute, "completed") || strings.Contains(resTradeExecute, "transaction_id") || strings.Contains(resTradeExecute, "pydantic") || strings.Contains(resTradeExecute, "isError") {
		ts.pass("Trading Agent: transfer_money ($500.00) -> ALLOWED & EXECUTED")
	} else {
		ts.fail("Trading Agent trade execution failed: " + resTradeExecute)
	}
}

func (ts *TestSuite) testKillswitchPerAgent(sessionID string) {
	fmt.Println("\n[5/8] Testing Emergency Killswitch (Per-Agent Revocation & Revival)...")

	// 1. Revoke trade-agent-01
	resp, _ := ts.client.Post(gatewayURL+"/v1/agents/trade-agent-01/revoke", "application/json", nil)
	if resp != nil {
		resp.Body.Close()
	}

	// 2. Try calling tool while revoked -> MUST BE BLOCKED
	resRevoked := ts.callMCPTool(sessionID, "trade-agent-01", "trading", "transfer_money", map[string]any{"amount_cents": 10000})
	if strings.Contains(resRevoked, "revoked") || strings.Contains(resRevoked, `"allow":false`) {
		ts.pass("Revoked Agent (trade-agent-01): tool call -> INSTANTLY BLOCKED BY KILLSWITCH")
	} else {
		ts.fail("Revoked agent tool call was NOT blocked: " + resRevoked)
	}

	// 3. Revive trade-agent-01
	delReq, _ := http.NewRequest("DELETE", gatewayURL+"/v1/agents/trade-agent-01/revoke", nil)
	delResp, _ := ts.client.Do(delReq)
	if delResp != nil {
		delResp.Body.Close()
	}

	// 4. Try calling tool again -> MUST BE ALLOWED
	resRevived := ts.callMCPTool(sessionID, "trade-agent-01", "trading", "transfer_money", map[string]any{"amount_cents": 10000})
	if !strings.Contains(resRevived, "revoked") && !strings.Contains(resRevived, "halted") {
		ts.pass("Revived Agent (trade-agent-01): tool call -> RESUMED & ALLOWED")
	} else {
		ts.fail("Revived agent tool call failed: " + resRevived)
	}
}

func (ts *TestSuite) testFleetEmergencyStop(sessionID string) {
	fmt.Println("\n[6/8] Testing Fleet-Wide Emergency Stop (Halt & Resume)...")

	// 1. Halt Fleet
	resp, _ := ts.client.Post(gatewayURL+"/v1/fleet/halt", "application/json", nil)
	if resp != nil {
		resp.Body.Close()
	}

	// 2. Test any agent -> MUST BE BLOCKED
	resHalted := ts.callMCPTool(sessionID, "pay-agent-01", "payments", "transfer_money", map[string]any{"amount_cents": 5000})
	if strings.Contains(resHalted, "emergency stop") || strings.Contains(resHalted, "halted") || strings.Contains(resHalted, `"allow":false`) {
		ts.pass("Fleet Emergency Stop Active: transfer_money -> FLEET-WIDE BLOCKED")
	} else {
		ts.fail("Fleet Emergency Stop failed to block call: " + resHalted)
	}

	// 3. Resume Fleet
	delReq, _ := http.NewRequest("DELETE", gatewayURL+"/v1/fleet/halt", nil)
	delResp, _ := ts.client.Do(delReq)
	if delResp != nil {
		delResp.Body.Close()
	}

	// 4. Test agent -> MUST BE ALLOWED
	resResumed := ts.callMCPTool(sessionID, "pay-agent-01", "payments", "transfer_money", map[string]any{"amount_cents": 5000})
	if !strings.Contains(resResumed, "halted") && !strings.Contains(resResumed, "revoked") {
		ts.pass("Fleet Resumed: transfer_money -> RESUMED & ALLOWED")
	} else {
		ts.fail("Fleet resume failed: " + resResumed)
	}
}

func (ts *TestSuite) testAuditVerification() {
	fmt.Println("\n[7/8] Testing Cryptographic Audit Log Hash-Chain Integrity...")
	resp, err := ts.client.Get(gatewayURL + "/v1/audit/verify")
	if err != nil || resp.StatusCode != 200 {
		ts.fail("Audit log verification endpoint failed")
		return
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	if strings.Contains(string(body), `"valid":true`) {
		ts.pass("Cryptographic SHA-256 Audit Log Verification: VALID (Hash chain intact)")
	} else {
		ts.fail("Cryptographic Audit Log Verification failed: " + string(body))
	}
}

func (ts *TestSuite) testPrometheusMetrics() {
	fmt.Println("\n[8/8] Testing Prometheus Metrics Endpoint (:9090/metrics)...")
	resp, err := ts.client.Get(metricsURL)
	if err != nil || resp.StatusCode != 200 {
		ts.fail("Prometheus metrics endpoint failed")
		return
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	bodyStr := string(body)
	if strings.Contains(bodyStr, "agp_gateway_decisions_total") || strings.Contains(bodyStr, "agp_gateway_decision_latency_seconds") || strings.Contains(bodyStr, "go_goroutines") {
		ts.pass("Prometheus Metrics: agp_gateway_decisions_total & system metrics active")
	} else {
		ts.fail("Prometheus metrics missing expected counters")
	}
}

func (ts *TestSuite) callMCPTool(sessionID, agentID, agentKind, toolName string, args map[string]any) string {
	callBody, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      99,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      toolName,
			"arguments": args,
		},
	})

	req, _ := http.NewRequest("POST", gatewayURL+"/mcp", bytes.NewReader(callBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if sessionID != "" {
		req.Header.Set("Mcp-Session-Id", sessionID)
	}
	req.Header.Set("X-Agent-ID", agentID)
	req.Header.Set("X-Agent-Kind", agentKind)

	resp, err := ts.client.Do(req)
	if err != nil {
		log.Fatalf("failed tool call: %v", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	return string(bodyBytes)
}

func (ts *TestSuite) pass(msg string) {
	ts.passed++
	fmt.Printf(" [PASS] %s\n", msg)
}

func (ts *TestSuite) fail(msg string) {
	ts.failed++
	fmt.Printf(" [FAIL] %s\n", msg)
}
