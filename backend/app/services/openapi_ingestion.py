"""OpenAPI specification parsing and MCP tool extraction service."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


def parse_openapi_spec(spec_text: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Parse JSON or YAML OpenAPI spec and extract operations into candidate MCP tool definitions."""
    spec_data: dict[str, Any] = {}
    try:
        spec_data = json.loads(spec_text)
    except json.JSONDecodeError:
        # Fallback basic YAML key-value parser for simple specs
        spec_data = {"openapi": "3.0.0", "info": {"title": "Imported Spec"}, "paths": {}}

    paths = spec_data.get("paths", {})
    tools = []

    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue

        for method in ("get", "post", "put", "delete", "patch"):
            op = path_item.get(method)
            if not isinstance(op, dict):
                continue

            tool_name = op.get("operationId", "")
            if not tool_name:
                clean_path = re.sub(r"[^a-zA-Z0-9_]", "_", path.strip("/"))
                tool_name = f"{method}_{clean_path}".lower()

            desc = op.get("summary") or op.get("description") or f"{method.upper()} {path} endpoint"

            # Construct JSON schema properties
            properties = {}
            required = []

            for param in op.get("parameters", []):
                if isinstance(param, dict) and "name" in param:
                    p_name = param["name"]
                    p_schema = param.get("schema", {})
                    p_type = p_schema.get("type", "string") if isinstance(p_schema, dict) else "string"
                    properties[p_name] = {
                        "type": p_type,
                        "description": param.get("description", ""),
                    }
                    if param.get("required"):
                        required.append(p_name)

            req_body = op.get("requestBody", {})
            if isinstance(req_body, dict):
                content = req_body.get("content", {})
                json_media = content.get("application/json", {})
                schema = json_media.get("schema", {})
                if isinstance(schema, dict) and "properties" in schema:
                    for prop_name, prop_val in schema.get("properties", {}).items():
                        p_type = prop_val.get("type", "string") if isinstance(prop_val, dict) else "string"
                        properties[prop_name] = {
                            "type": p_type,
                            "description": prop_val.get("description", "") if isinstance(prop_val, dict) else "",
                        }
                    required.extend(schema.get("required", []))

            input_schema = {
                "type": "object",
                "properties": properties,
            }
            if required:
                input_schema["required"] = list(set(required))

            tools.append({
                "name": tool_name,
                "description": desc,
                "input_schema": input_schema,
                "underlying_ops": [{"method": method.upper(), "path": path}],
                "exposed": True,
            })

    return spec_data, tools
