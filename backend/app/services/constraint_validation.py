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
VALID_CONSTRAINT_KEYS = {"rate_limit", "time_window", "cumulative_spend_cap", "money_params"}


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

            # 3. Typoed / non-existent money params.
            if key == "money_params":
                if not isinstance(val, list) or not all(isinstance(x, str) for x in val):
                    errors.append(f"money_params for tool '{tool_name}' must be a list of field names")
                    continue
                if not val:
                    errors.append(f"money_params for tool '{tool_name}' must not be empty")
                    continue
                for field in val:
                    # Only assert existence when the tool exposes a schema; some
                    # tools have no declared input schema and cannot be checked.
                    if param_names and field not in param_names:
                        errors.append(
                            f"money field '{field}' declared for tool '{tool_name}' "
                            f"does not exist in its input schema (typo?)"
                        )

            # Light shape checks so an obviously malformed cap can't slip in.
            if key == "cumulative_spend_cap":
                if not isinstance(val, dict) or "max_daily_cents" not in val:
                    errors.append(
                        f"cumulative_spend_cap for tool '{tool_name}' must be an object "
                        f"with a numeric 'max_daily_cents'"
                    )
                elif not isinstance(val["max_daily_cents"], (int, float)):
                    errors.append(
                        f"cumulative_spend_cap.max_daily_cents for tool '{tool_name}' must be numeric"
                    )

            if key == "rate_limit":
                if not isinstance(val, dict) or "max_calls" not in val:
                    errors.append(
                        f"rate_limit for tool '{tool_name}' must be an object with 'max_calls'"
                    )

    return errors
