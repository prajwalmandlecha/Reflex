"""Validation for agent-class default_constraints against the live tool registry.

Silent-off governance is indefensible: a constraint block that references a
tool that does not exist, a constraint key the gateway never reads, or a
money field the tool does not accept looks configured in the UI but enforces
nothing. This module rejects those cases at write time (POST/PUT /classes) so
misconfigurations fail loudly instead of quietly disabling protection.
"""

from __future__ import annotations

import json
from typing import Any

from app.database import get_pool

# Constraint keys the gateway actually enforces (see gateway
# internal/constraints/checker.go). Anything else is dead config and must be
# rejected rather than silently ignored.
VALID_CONSTRAINT_KEYS = {"rate_limit", "time_window", "params", "shared_caps", "shared_rate_limits"}

# Per-parameter rule keys the gateway reads (see ParamRule in checker.go).
VALID_PARAM_KEYS = {"max", "daily_cents", "hourly_cents", "monthly_cents"}

# Shared-cap scopes and windows the gateway reads (see SharedCap in checker.go).
VALID_SHARED_SCOPES = {"class", "fleet"}
VALID_SHARED_WINDOWS = {"daily", "hourly", "monthly"}


async def _load_tool_schemas() -> dict[str, dict]:
    """Return {tool_name: input_schema} for every registered tool."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT name, input_schema FROM tools")
    schemas: dict[str, dict] = {}
    for r in rows:
        raw = r["input_schema"]
        schema = json.loads(raw) if isinstance(raw, str) else (raw or {})
        schemas[r["name"]] = schema if isinstance(schema, dict) else {}
    return schemas


def _param_names(schema: dict) -> set[str]:
    props = schema.get("properties") if isinstance(schema, dict) else None
    if not isinstance(props, dict):
        return set()
    return set(props.keys())


async def validate_fleet_caps(caps: Any) -> list[str]:
    """Validate a global fleet-caps payload: {tool_name: [{param, window, limit_cents}]}.

    Returns a list of human-readable errors (empty list == valid). Mirrors the
    shared_caps validation in validate_class_config but without a scope field —
    fleet caps are always scope "fleet" and live in the global fleet_caps table.
    """
    errors: list[str] = []
    if caps in (None, {}):
        return errors
    if not isinstance(caps, dict):
        return ["fleet caps must be a JSON object mapping tool name -> cap list"]

    schemas = await _load_tool_schemas()
    known_tools = set(schemas.keys())

    for tool_name, entries in caps.items():
        if tool_name not in known_tools:
            errors.append(f"unknown tool '{tool_name}' in fleet caps (not a registered MCP tool)")
            continue
        if not isinstance(entries, list) or not entries:
            errors.append(f"fleet caps for tool '{tool_name}' must be a non-empty array")
            continue

        param_names = _param_names(schemas[tool_name])
        for sc in entries:
            if not isinstance(sc, dict):
                errors.append(f"each fleet cap for tool '{tool_name}' must be an object")
                continue
            param = sc.get("param")
            window = sc.get("window")
            limit = sc.get("limit_cents")
            if window not in VALID_SHARED_WINDOWS:
                errors.append(
                    f"fleet cap window '{window}' for tool '{tool_name}' invalid "
                    f"(valid windows: {', '.join(sorted(VALID_SHARED_WINDOWS))})"
                )
            if param_names and param not in param_names:
                errors.append(
                    f"fleet cap parameter '{param}' for tool '{tool_name}' "
                    f"does not exist in its input schema (typo?)"
                )
            if not isinstance(limit, (int, float)) or limit <= 0:
                errors.append(
                    f"fleet cap limit_cents for tool '{tool_name}' must be a positive number"
                )

    return errors


async def validate_fleet_rate_limits(rate_limits: Any) -> list[str]:
    """Validate a global fleet rate-limits payload: {tool_name: [{max_calls, window_seconds}]}.

    Returns a list of human-readable errors (empty list == valid). Fleet rate
    limits are always scope "fleet" and live in the global fleet_caps table.
    """
    errors: list[str] = []
    if rate_limits in (None, {}):
        return errors
    if not isinstance(rate_limits, dict):
        return ["fleet rate limits must be a JSON object mapping tool name -> rate limit list"]

    schemas = await _load_tool_schemas()
    known_tools = set(schemas.keys())

    for tool_name, entries in rate_limits.items():
        if tool_name not in known_tools:
            errors.append(f"unknown tool '{tool_name}' in fleet rate limits (not a registered MCP tool)")
            continue
        if not isinstance(entries, list) or not entries:
            errors.append(f"fleet rate limits for tool '{tool_name}' must be a non-empty array")
            continue
        for rl in entries:
            if not isinstance(rl, dict):
                errors.append(f"each fleet rate limit for tool '{tool_name}' must be an object")
                continue
            max_calls = rl.get("max_calls")
            window_seconds = rl.get("window_seconds")
            if not isinstance(max_calls, (int, float)) or max_calls <= 0:
                errors.append(
                    f"fleet rate limit max_calls for tool '{tool_name}' must be a positive number"
                )
            if not isinstance(window_seconds, (int, float)) or window_seconds <= 0:
                errors.append(
                    f"fleet rate limit window_seconds for tool '{tool_name}' must be a positive number"
                )

    return errors


async def validate_class_config(
    default_allowed_tools: list[str] | None,
    default_constraints: Any,
) -> list[str]:
    """Return a list of human-readable validation errors (empty list == valid)."""
    errors: list[str] = []
    if default_constraints in (None, {}):
        return errors
    if not isinstance(default_constraints, dict):
        return ["default_constraints must be a JSON object mapping tool name -> constraint rules"]

    schemas = await _load_tool_schemas()
    known_tools = set(schemas.keys())

    for tool_name, rule in default_constraints.items():
        # 1. Unknown tool name — not a registered MCP tool.
        if tool_name not in known_tools:
            errors.append(f"unknown tool '{tool_name}' in constraints (not a registered MCP tool)")
            continue
        if not isinstance(rule, dict):
            errors.append(f"constraints for tool '{tool_name}' must be a JSON object")
            continue

        param_names = _param_names(schemas[tool_name])

        for key, val in rule.items():
            # 2. Unknown constraint key — dead config the gateway never reads.
            if key not in VALID_CONSTRAINT_KEYS:
                errors.append(
                    f"unknown constraint key '{key}' for tool '{tool_name}' "
                    f"(valid keys: {', '.join(sorted(VALID_CONSTRAINT_KEYS))})"
                )
                continue

            # 3. Per-parameter caps: {param: {max?, daily_cents?, hourly_cents?}}.
            if key == "params":
                if not isinstance(val, dict) or not val:
                    errors.append(
                        f"params for tool '{tool_name}' must be a non-empty object "
                        f"mapping parameter name -> rule"
                    )
                    continue
                for pname, prule in val.items():
                    # Only assert existence when the tool exposes a schema; some
                    # tools have no declared input schema and cannot be checked.
                    if param_names and pname not in param_names:
                        errors.append(
                            f"parameter '{pname}' declared for tool '{tool_name}' "
                            f"does not exist in its input schema (typo?)"
                        )
                    if not isinstance(prule, dict):
                        errors.append(
                            f"rule for parameter '{pname}' on tool '{tool_name}' "
                            f"must be an object"
                        )
                        continue
                    for pkey, pval in prule.items():
                        if pkey not in VALID_PARAM_KEYS:
                            errors.append(
                                f"unknown parameter rule key '{pkey}' for parameter "
                                f"'{pname}' on tool '{tool_name}' "
                                f"(valid keys: {', '.join(sorted(VALID_PARAM_KEYS))})"
                            )
                        elif not isinstance(pval, (int, float)):
                            errors.append(
                                f"parameter rule '{pkey}' for parameter '{pname}' on "
                                f"tool '{tool_name}' must be numeric"
                            )

            if key == "rate_limit":
                if not isinstance(val, dict) or "max_calls" not in val:
                    errors.append(
                        f"rate_limit for tool '{tool_name}' must be an object with 'max_calls'"
                    )

            # 3b. Shared (class/fleet-scoped) rate limits. Fleet-scoped rate
            #     limits are a global setting (fleet_caps table) and must NOT be
            #     written through a class payload — they'd be silently dropped by
            #     fleet rate-limit injection in config_propagation. Reject them.
            if key == "shared_rate_limits":
                if not isinstance(val, list) or not val:
                    errors.append(
                        f"shared_rate_limits for tool '{tool_name}' must be a non-empty array"
                    )
                    continue
                for srl in val:
                    if not isinstance(srl, dict):
                        errors.append(
                            f"each shared_rate_limits entry for tool '{tool_name}' must be an object"
                        )
                        continue
                    scope = srl.get("scope")
                    max_calls = srl.get("max_calls")
                    window_seconds = srl.get("window_seconds")
                    if scope == "fleet":
                        errors.append(
                            f"fleet-scoped rate limits for tool '{tool_name}' must be set in "
                            f"Fleet Caps (global), not in a class's constraints"
                        )
                    elif scope not in VALID_SHARED_SCOPES:
                        errors.append(
                            f"shared_rate_limits scope '{scope}' for tool '{tool_name}' invalid "
                            f"(valid scopes: {', '.join(sorted(VALID_SHARED_SCOPES))})"
                        )
                    if not isinstance(max_calls, (int, float)) or max_calls <= 0:
                        errors.append(
                            f"shared_rate_limits max_calls for tool '{tool_name}' must be a positive number"
                        )
                    if not isinstance(window_seconds, (int, float)) or window_seconds <= 0:
                        errors.append(
                            f"shared_rate_limits window_seconds for tool '{tool_name}' must be a positive number"
                        )

            # 4. Shared (class-scoped) parameter caps. Fleet-scoped caps are a
            #    global setting (fleet_caps table) and must NOT be written through
            #    a class payload — they'd be silently dropped by fleet-cap
            #    injection in config_propagation. Reject them here.
            if key == "shared_caps":
                if not isinstance(val, list) or not val:
                    errors.append(
                        f"shared_caps for tool '{tool_name}' must be a non-empty array"
                    )
                    continue
                for sc in val:
                    if not isinstance(sc, dict):
                        errors.append(
                            f"each shared_caps entry for tool '{tool_name}' must be an object"
                        )
                        continue
                    scope = sc.get("scope")
                    param = sc.get("param")
                    window = sc.get("window")
                    limit = sc.get("limit_cents")
                    if scope == "fleet":
                        errors.append(
                            f"fleet-scoped caps for tool '{tool_name}' must be set in "
                            f"Fleet Caps (global), not in a class's constraints"
                        )
                    elif scope not in VALID_SHARED_SCOPES:
                        errors.append(
                            f"shared_caps scope '{scope}' for tool '{tool_name}' invalid "
                            f"(valid scopes: {', '.join(sorted(VALID_SHARED_SCOPES))})"
                        )
                    if window not in VALID_SHARED_WINDOWS:
                        errors.append(
                            f"shared_caps window '{window}' for tool '{tool_name}' invalid "
                            f"(valid windows: {', '.join(sorted(VALID_SHARED_WINDOWS))})"
                        )
                    if param_names and param not in param_names:
                        errors.append(
                            f"shared_caps parameter '{param}' for tool '{tool_name}' "
                            f"does not exist in its input schema (typo?)"
                        )
                    if not isinstance(limit, (int, float)) or limit <= 0:
                        errors.append(
                            f"shared_caps limit_cents for tool '{tool_name}' must be a positive number"
                        )

    return errors
