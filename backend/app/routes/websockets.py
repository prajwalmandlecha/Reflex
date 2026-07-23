"""WebSocket endpoints (/ws/activity, /ws/metrics, /ws/alerts, /ws/fleet)."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.ws_manager import ws_manager

router = APIRouter(prefix="/ws", tags=["WebSockets"])


@router.websocket("/activity")
async def websocket_activity(ws: WebSocket):
    await ws_manager.connect("activity", ws)
    try:
        while True:
            await ws.receive_text()  # Keep-alive
    except WebSocketDisconnect:
        await ws_manager.disconnect("activity", ws)


@router.websocket("/metrics")
async def websocket_metrics(ws: WebSocket):
    await ws_manager.connect("metrics", ws)
    try:
        while True:
            await ws.receive_text()  # Keep-alive
    except WebSocketDisconnect:
        await ws_manager.disconnect("metrics", ws)


@router.websocket("/alerts")
async def websocket_alerts(ws: WebSocket):
    await ws_manager.connect("alerts", ws)
    try:
        while True:
            await ws.receive_text()  # Keep-alive
    except WebSocketDisconnect:
        await ws_manager.disconnect("alerts", ws)


@router.websocket("/fleet")
async def websocket_fleet(ws: WebSocket):
    await ws_manager.connect("fleet", ws)
    try:
        while True:
            await ws.receive_text()  # Keep-alive
    except WebSocketDisconnect:
        await ws_manager.disconnect("fleet", ws)
