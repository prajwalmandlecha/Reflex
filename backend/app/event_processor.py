"""Event processor: subscribes to Redis gateway:events and pushes to WebSocket clients."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import Counter, deque
from statistics import mean, quantiles
from typing import Any

import redis.asyncio as aioredis

from app.ws_manager import ws_manager

logger = logging.getLogger(__name__)


def _percentile(data: list[float], pct: int) -> float:
    if not data:
        return 0.0
    s = sorted(data)
    k = (len(s) - 1) * pct / 100
    f = int(k)
    c = f + 1 if f + 1 < len(s) else f
    return s[f] + (k - f) * (s[c] - s[f])


class MetricsBuffer:
    """Rolling window buffer that aggregates governance latency stats."""

    def __init__(self, window_seconds: int = 300, max_events: int = 10000):
        self.window = window_seconds
        self.events: deque[dict[str, Any]] = deque(maxlen=max_events)

    def add(self, event: dict[str, Any]):
        event.setdefault("_received_at", time.time())
        self.events.append(event)

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        cutoff = now - self.window
        recent = [e for e in self.events if e.get("_received_at", 0) > cutoff]

        if not recent:
            return {
                "window_seconds": self.window,
                "total_requests": 0,
                "allow_count": 0,
                "deny_count": 0,
                "deny_by_stage": {},
                "latency_percentiles": {},
                "requests_per_second": 0,
                "timestamp": now,
            }

        stage_keys = [
            "total_ms", "killswitch_ms", "constraint_ms",
            "policy_ms", "spend_ms", "downstream_ms", "governance_overhead_ms",
        ]

        latencies: dict[str, list[float]] = {k: [] for k in stage_keys}
        for e in recent:
            lat = e.get("latency", {})
            for k in stage_keys:
                v = lat.get(k)
                if v is not None:
                    latencies[k].append(v)

        deny_stages = Counter(
            e.get("deny_stage", "unknown")
            for e in recent if e.get("decision") == "deny"
        )

        percentiles = {}
        for stage, vals in latencies.items():
            if vals:
                percentiles[stage] = {
                    "p50": _percentile(vals, 50),
                    "p95": _percentile(vals, 95),
                    "p99": _percentile(vals, 99),
                    "avg": mean(vals),
                    "max": max(vals),
                    "min": min(vals),
                }
            else:
                percentiles[stage] = {"p50": 0, "p95": 0, "p99": 0, "avg": 0, "max": 0, "min": 0}

        elapsed = min(self.window, now - recent[0].get("_received_at", now)) if recent else self.window

        return {
            "window_seconds": self.window,
            "total_requests": len(recent),
            "allow_count": sum(1 for e in recent if e.get("decision") == "allow"),
            "deny_count": sum(1 for e in recent if e.get("decision") == "deny"),
            "deny_by_stage": dict(deny_stages),
            "latency_percentiles": percentiles,
            "requests_per_second": len(recent) / max(elapsed, 1),
            "timestamp": now,
        }


class EventProcessor:
    """Subscribes to Redis pub/sub 'gateway:events' and fans out to WebSocket channels."""

    def __init__(self, redis: aioredis.Redis):
        self.redis = redis
        self.metrics_buffer = MetricsBuffer()
        self._running = False

    async def start(self):
        self._running = True
        asyncio.create_task(self._subscribe_loop())
        asyncio.create_task(self._metrics_push_loop())
        logger.info("EventProcessor started")

    async def stop(self):
        self._running = False

    async def _subscribe_loop(self):
        pubsub = self.redis.pubsub()
        await pubsub.subscribe("gateway:events")

        try:
            async for message in pubsub.listen():
                if not self._running:
                    break
                if message["type"] != "message":
                    continue

                try:
                    event = json.loads(message["data"])
                except (json.JSONDecodeError, TypeError):
                    continue

                # 1. Broadcast to activity stream
                await ws_manager.broadcast("activity", event)

                # 2. Accumulate metrics
                self.metrics_buffer.add(event)

                # 3. Critical alerts
                if self._is_critical(event):
                    await ws_manager.broadcast("alerts", event)

                # 4. Fleet status changes
                event_type = event.get("type", "")
                if event_type in (
                    "kill_agent", "kill_class", "halt_fleet",
                    "revive_agent", "revive_class", "resume_fleet",
                    "session_start", "session_end",
                ):
                    await ws_manager.broadcast("fleet", event)

        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe("gateway:events")
            await pubsub.close()

    async def _metrics_push_loop(self):
        """Push aggregated metrics snapshot to /ws/metrics clients every 2 seconds."""
        while self._running:
            await asyncio.sleep(2)
            snapshot = self.metrics_buffer.snapshot()
            await ws_manager.broadcast("metrics", snapshot)

    @staticmethod
    def _is_critical(event: dict) -> bool:
        if event.get("decision") == "deny" and event.get("deny_stage") in ("killswitch", "spend"):
            return True
        if event.get("type") in ("halt_fleet", "kill_agent", "kill_class"):
            return True
        return False


event_processor: EventProcessor | None = None


async def init_event_processor(redis: aioredis.Redis):
    global event_processor
    event_processor = EventProcessor(redis)
    await event_processor.start()


async def stop_event_processor():
    global event_processor
    if event_processor:
        await event_processor.stop()
        event_processor = None
