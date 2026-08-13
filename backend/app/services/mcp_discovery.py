"""Service for performing MCP discovery against native MCP server endpoints.

Discovers tools (tools/list), resources (resources/list) and prompts
(prompts/list) so the Control Center can show everything a bank exposes.
"""

import json
import logging
import httpx

logger = logging.getLogger(__name__)


async def _mcp_request(client: httpx.AsyncClient, mcp_url: str, headers: dict, method: str, req_id: int) -> dict | None:
    """Send a single MCP JSON-RPC request and parse the (possibly SSE) response.

    Returns the decoded JSON body on success, or None on transport/parse failure.
    Handles both plain JSON and SSE (`data:` line) responses."""
    payload = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": {}}
    resp = await client.post(mcp_url, json=payload, headers=headers)
    resp.raise_for_status()
    raw_body = resp.text
    if "data:" in raw_body:
        for line in raw_body.split("\n"):
            if line.startswith("data:"):
                raw_body = line[5:].strip()
                break
    return json.loads(raw_body)


async def fetch_mcp_tools(mcp_url: str, timeout: float = 2.0) -> list[dict] | None:
    """Perform MCP JSON-RPC initialize and tools/list request to discover tools and input schemas.

    Returns the discovered tool list on success (possibly empty), or None when the
    server is unreachable / the probe fails — callers use this to derive a real
    connection status instead of asserting 'connected'.

    Async: uses httpx.AsyncClient so it never blocks the event loop (G8)."""
    if not mcp_url:
        return None

    try:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }

        async with httpx.AsyncClient(timeout=timeout) as client:
            # 1. Send initialize (stateless protocol 2025-06-18; session optional)
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "agp-backend-discovery", "version": "1.0"},
                },
            }
            resp1 = await client.post(mcp_url, json=init_payload, headers=headers)
            resp1.raise_for_status()

            # Stateless servers may not return a session; only forward it if present.
            session_id = resp1.headers.get("Mcp-Session-Id", "")
            if session_id:
                headers["Mcp-Session-Id"] = session_id

            # 2. Send tools/list
            data = await _mcp_request(client, mcp_url, headers, "tools/list", 2)
            if data is None:
                return None
            tools = data.get("result", {}).get("tools", [])
            res = []
            for t in tools:
                res.append({
                    "name": t.get("name", ""),
                    "description": t.get("description", ""),
                    "input_schema": t.get("inputSchema", {}),
                    "exposed": True,
                })
            return res
    except Exception as e:
        logger.warning("MCP discovery failed for URL %s: %r", mcp_url, e)
        return None


async def fetch_mcp_resources(mcp_url: str, timeout: float = 2.0) -> list[dict] | None:
    """Discover MCP resources (resources/list) from a native MCP server.

    Returns a list of {"uri", "name", "description", "mime_type", "exposed"} dicts,
    or None when the server is unreachable / the probe fails."""
    if not mcp_url:
        return None

    try:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }

        async with httpx.AsyncClient(timeout=timeout) as client:
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "agp-backend-discovery", "version": "1.0"},
                },
            }
            resp1 = await client.post(mcp_url, json=init_payload, headers=headers)
            resp1.raise_for_status()

            session_id = resp1.headers.get("Mcp-Session-Id", "")
            if session_id:
                headers["Mcp-Session-Id"] = session_id

            data = await _mcp_request(client, mcp_url, headers, "resources/list", 2)
            if data is None:
                return None
            resources = data.get("result", {}).get("resources", [])
            res = []
            for r in resources:
                res.append({
                    "uri": r.get("uri", ""),
                    "name": r.get("name", ""),
                    "description": r.get("description", ""),
                    "mime_type": r.get("mimeType", ""),
                    "exposed": True,
                })
            return res
    except Exception as e:
        logger.warning("MCP resources discovery failed for URL %s: %r", mcp_url, e)
        return None


async def fetch_mcp_prompts(mcp_url: str, timeout: float = 2.0) -> list[dict] | None:
    """Discover MCP prompts (prompts/list) from a native MCP server.

    Returns a list of {"name", "description", "arguments", "exposed"} dicts,
    or None when the server is unreachable / the probe fails."""
    if not mcp_url:
        return None

    try:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }

        async with httpx.AsyncClient(timeout=timeout) as client:
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "agp-backend-discovery", "version": "1.0"},
                },
            }
            resp1 = await client.post(mcp_url, json=init_payload, headers=headers)
            resp1.raise_for_status()

            session_id = resp1.headers.get("Mcp-Session-Id", "")
            if session_id:
                headers["Mcp-Session-Id"] = session_id

            data = await _mcp_request(client, mcp_url, headers, "prompts/list", 2)
            if data is None:
                return None
            prompts = data.get("result", {}).get("prompts", [])
            res = []
            for p in prompts:
                res.append({
                    "name": p.get("name", ""),
                    "description": p.get("description", ""),
                    "arguments": p.get("arguments", []),
                    "exposed": True,
                })
            return res
    except Exception as e:
        logger.warning("MCP prompts discovery failed for URL %s: %r", mcp_url, e)
        return None
