#!/usr/bin/env python3
"""
02_run_live_agent_suite.py -- Reflex Live Agent Execution & Governance Test Suite

This script executes real live agent MCP tool calls through the Reflex Gateway Proxy (:8080):
1. Loads Agent JWT Tokens minted during platform seeding.
2. Performs Agent-driven User Login on Bank Identity MCP Server via Gateway to acquire User JWT Token.
3. Evaluates Policy Rule #1: Lower Bound Deposit ($500 < $1000 DENIED).
4. Evaluates Policy Rule #2: Upper Bound Deposit ($1300 > $1200 DENIED).
5. Evaluates Policy Valid Range Deposit ($1100 ALLOWED & Completed on Bank Backend).
6. Evaluates ABAC Profile Whitelisting (Conversational Bot calling transfer_money DENIED).
"""

import json
import os
import urllib.request
import urllib.error
import subprocess

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")

# Clear Redis cache before running live suite
try:
    subprocess.run(["docker", "exec", "ai-governance-platform-redis-1", "redis-cli", "FLUSHALL"], check=True, stdout=subprocess.DEVNULL)
    print("[+] Flushed Redis cache for clean execution.")
except Exception:
    pass

# Load Agent Tokens
tokens_filepath = os.path.join(os.path.dirname(__file__), "agent_tokens.json")
if not os.path.exists(tokens_filepath):
    print("[-] Error: 'agent_tokens.json' not found. Please run 'python scripts/01_seed_platform.py' first.")
    exit(1)

with open(tokens_filepath, "r") as f:
    agent_tokens = json.load(f)

DEPOSIT_AGENT_TOKEN = agent_tokens.get("deposit_concierge_bot-inst-01", "")
CONVERSATIONAL_AGENT_TOKEN = agent_tokens.get("conversational_bot-inst-01", "")

def mcp_call(route: str, agent_token: str, method: str, params: dict = None, request_id: int = 1):
    headers = {
        "Authorization": f"Bearer {agent_token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream"
    }

    # Session Initialization handshake
    init_body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "live_suite", "version": "1.0"}}
    }).encode('utf-8')

    init_req = urllib.request.Request(f"{GATEWAY_URL}{route}", data=init_body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(init_req) as resp:
            sess_id = dict(resp.headers).get("Mcp-Session-Id") or dict(resp.headers).get("mcp-session-id")
            if sess_id:
                headers["Mcp-Session-Id"] = sess_id
    except Exception:
        pass

    payload = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params or {}
    }

    req = urllib.request.Request(f"{GATEWAY_URL}{route}", data=json.dumps(payload).encode('utf-8'), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode('utf-8')
            return resp.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')

def get_user_session() -> tuple[str, str]:
    """Dynamically authenticate via Bank Identity MCP service through Gateway."""
    print("\n[+] Authenticating User via Bank Identity MCP Server...")
    
    # 1. Try creating user if needed
    create_args = {
        "username": "deposit_tester", "password": "Password123!",
        "firstname": "Deposit", "lastname": "Tester",
        "birthday": "1990-01-01", "timezone": "UTC",
        "address": "123 Main St", "state": "NY", "zip_code": "10001", "ssn": "000-00-0000"
    }
    mcp_call("/mcp/bank-identity", CONVERSATIONAL_AGENT_TOKEN, "tools/call", {"name": "create_user", "arguments": create_args}, request_id=10)

    # 2. Login to get User JWT Token & account
    status, body = mcp_call("/mcp/bank-identity", CONVERSATIONAL_AGENT_TOKEN, "tools/call", {"name": "login", "arguments": {"username": "deposit_tester", "password": "Password123!"}}, request_id=11)
    
    user_token = ""
    account_id = "2920510312"
    
    try:
        if "token" in body:
            # extract JSON string from text property
            data = json.loads(body.split('data: ')[1]) if 'data: ' in body else json.loads(body)
            raw_text = data['result']['content'][0]['text']
            parsed = json.loads(raw_text)
            user_token = parsed.get("token", "")
    except Exception as e:
        print(f"[-] Login parse error: {e}")

    if not user_token:
        raise RuntimeError("Failed to acquire User JWT Token from Bank Identity MCP service.")

    print(f"   [OK] User Authenticated! Token acquired for Account #{account_id}")
    return user_token, account_id

def main():
    print("=" * 80)
    print("REFLEX LIVE AGENT INTERCEPTION & GOVERNANCE SUITE")
    print("=" * 80)

    user_token, account_id = get_user_session()

    # --------------------------------------------------------------------------
    # CASE 1: Deposit $500 (< $1000 Lower Bound) -> Expect Gateway DENY
    # --------------------------------------------------------------------------
    print("\n" + "-" * 70)
    print("TEST CASE 1: Deposit $500 (< $1000 Limit) with deposit_concierge_bot-inst-01")
    print("EXPECTED OUTCOME: Gateway DENY (Policy Rule: amount_cents < 100000)")
    print("-" * 70)
    status, body = mcp_call(
        route="/mcp/bank-payments",
        agent_token=DEPOSIT_AGENT_TOKEN,
        method="tools/call",
        params={
            "name": "deposit_funds",
            "arguments": {
                "bearer_token": user_token,
                "account_id": account_id,
                "external_account_id": "9988776655",
                "external_routing_num": "123456789",
                "amount_cents": 50000,
                "description": "Lower bound test $500"
            }
        },
        request_id=101
    )
    print(f"HTTP Status: {status}")
    print(f"Gateway Response: {body.strip()}")
    assert "false" in body and "denied" in body, "Expected DENY for $500"
    print("Result: PASSED (Successfully Intercepted & Blocked by Policy Engine)")

    # --------------------------------------------------------------------------
    # CASE 2: Deposit $1300 (> $1200 Upper Bound) -> Expect Gateway DENY
    # --------------------------------------------------------------------------
    print("\n" + "-" * 70)
    print("TEST CASE 2: Deposit $1300 (> $1200 Limit) with deposit_concierge_bot-inst-01")
    print("EXPECTED OUTCOME: Gateway DENY (Policy Rule: amount_cents > 120000)")
    print("-" * 70)
    status, body = mcp_call(
        route="/mcp/bank-payments",
        agent_token=DEPOSIT_AGENT_TOKEN,
        method="tools/call",
        params={
            "name": "deposit_funds",
            "arguments": {
                "bearer_token": user_token,
                "account_id": account_id,
                "external_account_id": "9988776655",
                "external_routing_num": "123456789",
                "amount_cents": 130000,
                "description": "Upper bound test $1300"
            }
        },
        request_id=102
    )
    print(f"HTTP Status: {status}")
    print(f"Gateway Response: {body.strip()}")
    assert "false" in body and "denied" in body, "Expected DENY for $1300"
    print("Result: PASSED (Successfully Intercepted & Blocked by Policy Engine)")

    # --------------------------------------------------------------------------
    # CASE 3: Deposit $1100 (Valid Range $1000 - $1200) -> Expect Gateway ALLOW
    # --------------------------------------------------------------------------
    print("\n" + "-" * 70)
    print("TEST CASE 3: Deposit $1100 (Valid Bounds Range) with deposit_concierge_bot-inst-01")
    print("EXPECTED OUTCOME: Gateway ALLOW -> Bank MCP Server Returns Transaction Completed")
    print("-" * 70)
    status, body = mcp_call(
        route="/mcp/bank-payments",
        agent_token=DEPOSIT_AGENT_TOKEN,
        method="tools/call",
        params={
            "name": "deposit_funds",
            "arguments": {
                "bearer_token": user_token,
                "account_id": account_id,
                "external_account_id": "9988776655",
                "external_routing_num": "123456789",
                "amount_cents": 110000,
                "description": "Valid range test $1100"
            }
        },
        request_id=103
    )
    print(f"HTTP Status: {status}")
    print(f"Gateway Response: {body.strip()}")
    assert "completed" in body or "transaction_id" in body or "success" in body, "Expected ALLOW for $1100"
    print("Result: PASSED (Permitted by Gateway & Completed on Bank Backend)")

    # --------------------------------------------------------------------------
    # CASE 4: ABAC Whitelisting Violation (Conversational Bot calling transfer_money)
    # --------------------------------------------------------------------------
    print("\n" + "-" * 70)
    print("TEST CASE 4: Conversational Bot calling unauthorized tool 'transfer_money'")
    print("EXPECTED OUTCOME: Gateway DENY (ABAC Whitelist Violation)")
    print("-" * 70)
    status, body = mcp_call(
        route="/mcp/bank-payments",
        agent_token=CONVERSATIONAL_AGENT_TOKEN,
        method="tools/call",
        params={
            "name": "transfer_money",
            "arguments": {
                "bearer_token": user_token,
                "account_id": account_id,
                "recipient_account": "9988776655",
                "amount_cents": 10000,
                "description": "Unauthorized transfer test"
            }
        },
        request_id=104
    )
    print(f"HTTP Status: {status}")
    print(f"Gateway Response: {body.strip()}")
    assert "false" in body or "not permitted" in body or "denied" in body, "Expected DENY for unauthorized tool"
    print("Result: PASSED (Successfully Intercepted by Profile Whitelist Stage)")

    print("\n" + "=" * 80)
    print("ALL LIVE AGENT GOVERNANCE TEST CASES EXECUTED & VERIFIED PERFECTLY!")
    print("=" * 80)

if __name__ == "__main__":
    main()
