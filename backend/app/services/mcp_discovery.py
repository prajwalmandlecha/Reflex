"""Service for performing MCP tools/list discovery against native MCP server endpoints."""

import json
import logging
import httpx

logger = logging.getLogger(__name__)


async def fetch_mcp_tools(mcp_url: str) -> list[dict]:
    """Perform MCP JSON-RPC initialize and tools/list request to discover tools and input schemas.

    Async: uses httpx.AsyncClient so it never blocks the event loop (G8)."""
    if not mcp_url:
        return []

    try:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            # 1. Send initialize
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "agp-backend-discovery", "version": "1.0"},
                },
            }
            resp1 = await client.post(mcp_url, json=init_payload, headers=headers)
            resp1.raise_for_status()

            session_id = resp1.headers.get("Mcp-Session-Id", "")

            # 2. Send tools/list
            list_payload = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            }
            if session_id:
                headers["Mcp-Session-Id"] = session_id

            resp2 = await client.post(mcp_url, json=list_payload, headers=headers)
            resp2.raise_for_status()
            
            raw_body = resp2.text
            if "data:" in raw_body:
                for line in raw_body.split("\n"):
                    if line.startswith("data:"):
                        raw_body = line[5:].strip()
                        break
            data = json.loads(raw_body)
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
        logger.warning("MCP discovery failed for URL %s: %s", mcp_url, e)
        return []
