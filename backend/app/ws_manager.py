"""WebSocket connection manager — broadcasts events to connected clients."""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WSManager:
    """Manages WebSocket connections grouped by channel (activity, metrics, alerts, fleet)."""

    def __init__(self):
        # channel_name → set of connected WebSocket instances
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, channel: str, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections[channel].add(ws)
        logger.info("WS connected: channel=%s total=%d", channel, len(self._connections[channel]))

    async def disconnect(self, channel: str, ws: WebSocket):
        async with self._lock:
            self._connections[channel].discard(ws)
        logger.info("WS disconnected: channel=%s total=%d", channel, len(self._connections[channel]))

    async def broadcast(self, channel: str, data: dict[str, Any]):
        """Send data to all clients on a channel. Silently removes dead connections."""
        async with self._lock:
            clients = list(self._connections[channel])

        dead: list[WebSocket] = []
        payload = json.dumps(data)

        for ws in clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections[channel].discard(ws)

    def client_count(self, channel: str) -> int:
        return len(self._connections[channel])


ws_manager = WSManager()
