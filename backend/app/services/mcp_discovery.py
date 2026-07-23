"""Service for performing MCP tools/list discovery against native MCP server endpoints."""

import json
import logging
import urllib.request

logger = logging.getLogger(__name__)


def fetch_mcp_tools(mcp_url: str) -> list[dict]:
    """Perform MCP JSON-RPC initialize and tools/list request to discover tools and input schemas."""
    if not mcp_url:
        return []

    try:
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
        req = urllib.request.Request(
            mcp_url,
            data=json.dumps(init_payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
        )
        session_id = ""
        with urllib.request.urlopen(req, timeout=5) as resp:
            session_id = resp.headers.get("Mcp-Session-Id", "")

        # 2. Send tools/list
        list_payload = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        }
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if session_id:
            headers["Mcp-Session-Id"] = session_id

        req2 = urllib.request.Request(mcp_url, data=json.dumps(list_payload).encode(), headers=headers)
        with urllib.request.urlopen(req2, timeout=5) as resp:
            raw_body = resp.read().decode()
            # Handle potential SSE formatting (event: message\ndata: {...})
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
