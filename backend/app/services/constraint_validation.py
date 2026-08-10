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
VALID_CONSTRAINT_KEYS = {"rate_limit", "time_window", "params"}

# Per-parameter rule keys the gateway reads (see ParamRule in checker.go).
VALID_PARAM_KEYS = {"max", "daily_cents", "hourly_cents"}


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

    return errors
