import asyncio
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as redis

from app.database import engine, get_db
from app.models import Base, AgentInstance, AgentClass, AuditLog

app = FastAPI(title="Guardian AI Governance Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_client = None

@app.on_event("startup")
async def startup_event():
    global redis_client
    # Connect Redis
    redis_client = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
    try:
        await redis_client.ping()
        print("Connected to Redis fast-path cache")
    except Exception as e:
        print(f"Warning: Could not connect to Redis: {e}")
        
    # Init DB tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.close()
    await engine.dispose()

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/agents")
async def get_agents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AgentInstance))
    agents = result.scalars().all()
    # Formatting to match frontend expectations
    return [
        {
            "id": a.id,
            "name": a.name,
            "class": a.class_id,
            "status": a.status,
            "spend": a.spend_today,
            "cap": a.cap_override or 500, # Fallback
            "actions": a.actions_count,
            "lastSeen": a.last_seen.strftime("%H:%M:%S") if a.last_seen else "Unknown",
            "capPercent": (a.spend_today / (a.cap_override or 500)) * 100 if (a.cap_override or 500) > 0 else 0,
            "permissions": []
        }
        for a in agents
    ]

@app.post("/api/emergency/fleet-stop")
async def fleet_stop():
    if redis_client:
        await redis_client.set("global:fleet_stop", "true")
        await redis_client.publish("policy_updates", "fleet_stop_activated")
        return {"status": "success", "message": "Fleet emergency stop activated"}
    raise HTTPException(status_code=500, detail="Redis connection failed")

@app.post("/api/agents/{agent_id}/revoke")
async def revoke_agent(agent_id: str):
    if redis_client:
        await redis_client.set(f"agent:revoked:{agent_id}", "true")
        await redis_client.publish("policy_updates", f"agent_revoked:{agent_id}")
        return {"status": "success", "message": f"Agent {agent_id} revoked"}
    raise HTTPException(status_code=500, detail="Redis connection failed")
