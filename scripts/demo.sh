#!/usr/bin/env bash
# ============================================================
# Reflex — Governance End-to-End Demo Script
# ============================================================
set -euo pipefail

GW="http://localhost:8080"      # Go gateway (MCP proxy)
API="http://localhost:8000"     # FastAPI backend
AGENT="pay-agent-01"            # seeded payments agent
BOLD="\033[1m"; GREEN="\033[32m"; RED="\033[31m"; YELLOW="\033[33m"; RESET="\033[0m"

step() { echo -e "\n${BOLD}${YELLOW}━━━ $1 ━━━${RESET}\n"; }
ok()   { echo -e "${GREEN}$1${RESET}"; }
deny() { echo -e "${RED}$1${RESET}"; }

# Obtain MCP Session ID via initialize call
get_session() {
  local agent_id="${1:-$AGENT}"
  local agent_kind="${2:-payments}"
  curl -s -i -X POST "$GW/mcp/bank-payments" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "X-Agent-ID: $agent_id" -H "X-Agent-Kind: $agent_kind" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1.0"}}}' \
    | grep -i "mcp-session-id:" | tr -d '\r' | awk '{print $2}' || true
}

# Cleanly parse JSON or SSE 'data: ' prefix for jq
parse_json() {
  local resp="$1"
  if echo "$resp" | grep -q "data: "; then
    echo "$resp" | grep "data: " | sed 's/^data: //' | jq .
  else
    echo "$resp" | jq .
  fi
}

mcp_call() { # tool_name, params_json, agent_id, agent_kind, sess_id
  local agent_id="${3:-$AGENT}"
  local agent_kind="${4:-payments}"
  local sess_id="${5:-}"
  
  if [ -z "$sess_id" ]; then
    sess_id=$(get_session "$agent_id" "$agent_kind")
  fi

  local res
  res=$(curl -s -X POST "$GW/mcp/bank-payments" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Mcp-Session-Id: $sess_id" \
    -H "X-Agent-ID: $agent_id" -H "X-Agent-Kind: $agent_kind" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}")
  parse_json "$res"
}

PAY_ARGS_ALLOW='{"amount": 50.00, "amount_cents": 5000, "account_id": "acc-101", "recipient_account": "9876543210", "recipient_routing_num": "123456789", "is_external": false, "bearer_token": "demo-jwt"}'
PAY_ARGS_DENY='{"amount": 5000.00, "amount_cents": 500000, "account_id": "acc-101", "recipient_account": "9876543210", "recipient_routing_num": "123456789", "is_external": false, "bearer_token": "demo-jwt"}'
PAY_ARGS_CONV='{"amount": 10.00, "amount_cents": 1000, "account_id": "acc-101", "recipient_account": "9876543210", "recipient_routing_num": "123456789", "is_external": false, "bearer_token": "demo-jwt"}'

step "0. Fleet status — everything healthy"
curl -s "$API/api/v1/fleet/status" | jq .

step "1. ALLOWED call — pay-agent-01 transfers \$50 (within caps)"
SESS_PAY=$(get_session "pay-agent-01" "payments")
mcp_call "transfer_money" "$PAY_ARGS_ALLOW" "pay-agent-01" "payments" "$SESS_PAY"
ok "→ Expected: ALLOWED, logged to audit ledger"

step "2. DENIED by policy — transfer \$5,000 exceeds per-transaction cap (\$1,000)"
mcp_call "transfer_money" "$PAY_ARGS_DENY" "pay-agent-01" "payments" "$SESS_PAY"
deny "→ Expected: DENIED at spend/policy stage"

step "3. DENIED by permissions — conversational agent tries to move money"
SESS_CONV=$(get_session "conv-agent-01" "conversational")
mcp_call "transfer_money" "$PAY_ARGS_CONV" "conv-agent-01" "conversational" "$SESS_CONV"
deny "→ Expected: DENIED — tool not in agent's whitelist"

step "4. Tool discovery filtering — conversational agent only sees read-only tools"
res=$(curl -s -X POST "$GW/mcp/bank-payments" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESS_CONV" \
  -H "X-Agent-ID: conv-agent-01" -H "X-Agent-Kind: conversational" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
parse_json "$res" | jq '.result.tools[].name'
ok "→ transfer_money should NOT appear in the list"

step "5. KILLSWITCH — revoke pay-agent-01, then retry the same \$50 transfer"
curl -s -X POST "$API/api/v1/agents/$AGENT/revoke" | jq .
mcp_call "transfer_money" "$PAY_ARGS_ALLOW" "pay-agent-01" "payments" "$SESS_PAY"
deny "→ Expected: DENIED at killswitch stage (<1ms)"

step "6. Revive the agent"
curl -s -X DELETE "$API/api/v1/agents/$AGENT/revoke" | jq .
ok "→ Agent revived"

step "7. FLEET EMERGENCY STOP — halt everything, then try any call"
curl -s -X POST "$API/api/v1/fleet/halt" -H "Content-Type: application/json" \
  -d '{"reason":"Demo: suspicious activity detected"}' | jq .
mcp_call "get_balance" '{"account_id": "acc-101", "bearer_token": "demo-jwt"}' "pay-agent-01" "payments" "$SESS_PAY"
deny "→ Expected: DENIED — entire fleet halted"

step "8. Resume fleet"
curl -s -X DELETE "$API/api/v1/fleet/halt" | jq .
ok "→ Fleet resumed"

step "9. Audit trail — last 5 decisions (allowed AND denied)"
curl -s "$API/api/v1/audit?limit=5" | jq '.[] | {agent_id, action, decision, deny_stage, reason, governance_overhead_ms}'

step "10. Verify tamper-evident audit chain (SHA-256 hash chain)"
curl -s "$API/api/v1/audit/verify" | jq .
ok "→ Expected: valid=true — proves the log hasn't been altered"

echo -e "\n${BOLD}${GREEN}Demo complete.${RESET} Dashboard: http://localhost:3000  Metrics: http://localhost:9090/metrics\n"
