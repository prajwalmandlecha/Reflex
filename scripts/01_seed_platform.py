#!/usr/bin/env python3
"""
01_seed_platform.py -- Reflex Platform Seeding & Governance Setup Script

This script provisions the Reflex AI Governance Platform:
1. Registers 3 Bank MCP Servers (Identity, Payments, Financial).
2. Creates logically separated Agent Classes with tool whitelists & spend caps.
3. Provisions Agent Instances and mints Gateway JWT tokens.
4. Registers and activates Visual & Rego governance policies.
"""

import json
import os
import urllib.request
import urllib.error

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

def req(path: str, method: str = "GET", data: dict = None):
    url = f"{BACKEND_URL}{path}"
    headers = {"Content-Type": "application/json"}
    body = json.dumps(data).encode('utf-8') if data else None
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as resp:
            content = resp.read().decode('utf-8')
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        print(f"[-] HTTP Error {e.code} on {method} {path}: {err_body}")
        raise

def main():
    print("=" * 80)
    print("REFLEX PLATFORM PROVISIONING & GOVERNANCE SEEDING")
    print("=" * 80)

    # --------------------------------------------------------------------------
    # STEP 1: Register 3 Bank MCP Servers
    # --------------------------------------------------------------------------
    print("\n1. Registering Downstream Bank MCP Servers...")
    mcp_servers = [
        {
            "id": "bank-identity",
            "name": "Bank of Anthos - Identity and User Auth Service",
            "source_type": "native_mcp",
            "mcp_url": "http://20.2.83.126:31100/mcp"
        },
        {
            "id": "bank-payments",
            "name": "Bank of Anthos - Payments and Transfers Service",
            "source_type": "native_mcp",
            "mcp_url": "http://20.2.83.126:31200/mcp"
        },
        {
            "id": "bank-financial",
            "name": "Bank of Anthos - Financial Insights Service",
            "source_type": "native_mcp",
            "mcp_url": "http://20.2.83.126:31300/mcp"
        }
    ]

    for server in mcp_servers:
        res = req("/api/v1/connections", method="POST", data=server)
        tool_cnt = res.get("tool_count", len(res.get("tools", [])))
        print(f"   [+] Registered MCP Server: '{server['id']}' ({server['name']}) -> {tool_cnt} tools discovered.")

    # --------------------------------------------------------------------------
    # STEP 2: Register Logically Separated Agent Classes
    # --------------------------------------------------------------------------
    print("\n2. Provisioning Logically Separated Agent Classes...")
    agent_classes = [
        {
            "id": "conversational_bot",
            "name": "Conversational Read-Only Assistant",
            "description": "Read-only chat assistant - queries balance and transactions; cannot transfer money.",
            "default_allowed_tools": ["login", "get_balance", "get_transaction_history", "get_spending_summary"],
            "default_constraints": {
                "get_balance": {"rate_limit": {"max_calls": 60, "window_seconds": 3600}}
            },
            "default_caps": {
                "hourly": {"amount_cents": 0, "count": 200},
                "daily": {"amount_cents": 0, "count": 1000}
            },
            "status": "active"
        },
        {
            "id": "payment_concierge_bot",
            "name": "Payment & Deposit Concierge Bot",
            "description": "Payment bot authorized to process deposits and wire transfers with spend caps.",
            "default_allowed_tools": ["login", "get_balance", "deposit_funds", "transfer_money", "get_transaction_history"],
            "default_constraints": {
                "deposit_funds": {"rate_limit": {"max_calls": 30, "window_seconds": 3600}},
                "transfer_money": {
                    "money_params": ["amount_cents"],
                    "cumulative_spend_cap": {"max_daily_cents": 500000}
                }
            },
            "default_caps": {
                "hourly": {"amount_cents": 500000, "count": 50},
                "daily": {"amount_cents": 5000000, "count": 500},
                "per_transaction": {"max_amount_cents": 120000}
            },
            "status": "active"
        },
        {
            "id": "financial_advisor_bot",
            "name": "Financial Insights Advisor",
            "description": "Financial management bot authorized for budgets and insights.",
            "default_allowed_tools": ["login", "get_balance", "get_spending_summary", "get_budgets", "create_budget"],
            "default_constraints": {},
            "default_caps": {
                "hourly": {"amount_cents": 0, "count": 100},
                "daily": {"amount_cents": 0, "count": 500}
            },
            "status": "active"
        }
    ]

    for cls in agent_classes:
        res = req("/api/v1/classes", method="POST", data=cls)
        print(f"   [+] Created Agent Class: '{res['id']}' ({res['name']})")

    # --------------------------------------------------------------------------
    # STEP 3: Register Agent Instances & Mint JWT Tokens
    # --------------------------------------------------------------------------
    print("\n3. Registering Agent Instances & Minting Gateway JWT Tokens...")
    agent_instances = [
        {"id": "conversational_bot-inst-01", "class_id": "conversational_bot", "status": "active"},
        {"id": "deposit_concierge_bot-inst-01", "class_id": "payment_concierge_bot", "status": "active"},
        {"id": "financial_advisor_bot-inst-01", "class_id": "financial_advisor_bot", "status": "active"}
    ]

    minted_tokens = {}
    for inst in agent_instances:
        res = req("/api/v1/agents", method="POST", data=inst)
        token = res.get("jwt_token", "")
        minted_tokens[inst["id"]] = token
        print(f"   [+] Registered Agent Instance: '{inst['id']}' (Class: '{inst['class_id']}')")
        print(f"       JWT Token: {token[:35]}...")

    # Save minted tokens locally
    tokens_filepath = os.path.join(os.path.dirname(__file__), "agent_tokens.json")
    with open(tokens_filepath, "w") as f:
        json.dump(minted_tokens, f, indent=2)
    print(f"\n   [OK] Saved Agent JWT tokens to '{tokens_filepath}'")

    # --------------------------------------------------------------------------
    # STEP 4: Register & Activate Visual Governance Policy (Bounds Policy)
    # --------------------------------------------------------------------------
    print("\n4. Configuring Governance Policies (Visual and Rego)...")
    visual_rules = [
        {
            "action": "deposit_funds",
            "effect": "deny",
            "conditions": [
                {
                    "field": "amount_cents",
                    "operator": "lt",
                    "value": 100000
                },
                {
                    "field": "amount_cents",
                    "operator": "gt",
                    "value": 120000
                }
            ]
        }
    ]

    compiled = req("/api/v1/policies/compile-visual", method="POST", data={"rules": visual_rules, "target_id": "deposit_concierge_bot-inst-01", "scope": "instance"})
    rego_source = compiled.get("rego_source", "")

    policy_payload = {
        "name": "deposit_bounds_policy",
        "scope": "instance",
        "target_id": "deposit_concierge_bot-inst-01",
        "type": "visual",
        "visual_rules": visual_rules,
        "rego_source": rego_source,
        "status": "active"
    }

    pol_res = req("/api/v1/policies", method="POST", data=policy_payload)
    print(f"   [+] Configured Policy: ID {pol_res['id']} ('{pol_res['name']}') for instance 'deposit_concierge_bot-inst-01'")
    print(f"       Rules: DENY deposit_funds if amount < $1000 (100000 cents) OR amount > $1200 (120000 cents)")

    # Policy 2: Deny transfer_money on Conversational Bot
    visual_rules_conv = [
        {
            "action": "transfer_money",
            "effect": "deny",
            "conditions": []
        }
    ]
    compiled_conv = req("/api/v1/policies/compile-visual", method="POST", data={"rules": visual_rules_conv, "target_id": "conversational_bot-inst-01", "scope": "instance"})
    policy_payload_conv = {
        "name": "conversational_transfer_policy",
        "scope": "instance",
        "target_id": "conversational_bot-inst-01",
        "type": "visual",
        "visual_rules": visual_rules_conv,
        "rego_source": compiled_conv.get("rego_source", ""),
        "status": "active"
    }
    pol_res_conv = req("/api/v1/policies", method="POST", data=policy_payload_conv)
    print(f"   [+] Configured Policy: ID {pol_res_conv['id']} ('{pol_res_conv['name']}') for instance 'conversational_bot-inst-01'")
    print(f"       Rules: DENY transfer_money for conversational_bot-inst-01")

    print("\n" + "=" * 80)
    print("REFLEX PLATFORM PROVISIONING COMPLETE -- ALL SERVICES READY FOR GOVERNANCE AGENT SUITE")
    print("=" * 80)

if __name__ == "__main__":
    main()
