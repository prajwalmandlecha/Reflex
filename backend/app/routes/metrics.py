"""Metrics snapshot routes (/api/v1/metrics/snapshot)."""

from fastapi import APIRouter
from app.event_processor import event_processor

router = APIRouter(prefix="/api/v1/metrics", tags=["Metrics"])


@router.get("/snapshot")
async def get_metrics_snapshot():
    if not event_processor:
        return {"total_requests": 0, "status": "event_processor_offline"}
    return event_processor.metrics_buffer.snapshot()
