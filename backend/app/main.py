import asyncio
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Any
import redis.asyncio as redis
from pydantic import BaseModel

app = FastAPI(title="Guardian AI Governance Backend")

# Keep the server open for the hackathon (No Auth)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Redis client placeholder
redis_client = None

@app.on_event("startup")
async def startup_event():
    global redis_client
    # Connect to Redis (assuming local or docker network)
    redis_client = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
    try:
        await redis_client.ping()
        print("Connected to Redis fast-path cache")
    except Exception as e:
        print(f"Warning: Could not connect to Redis: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.close()

# Models & Schemas
class AgentBase(BaseModel):
    name: str
    class_name: str
    status: str
    cap: int

# API Routes
@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/agents")
async def get_agents():
    # TODO: Fetch from PostgreSQL
    # Returning mock data for initial scaffolding
    return [
        {"id": "agent-xyz1", "name": "Support Bot", "class": "Customer Service", "status": "active", "spend": 120, "cap": 500}
    ]

@app.post("/api/emergency/fleet-stop")
async def fleet_stop():
    """Trigger the fleet-wide emergency stop via Redis fast-path"""
    if redis_client:
        await redis_client.set("global:fleet_stop", "true")
        # Publish to alert the Go gateway instantly
        await redis_client.publish("policy_updates", "fleet_stop_activated")
        return {"status": "success", "message": "Fleet emergency stop activated"}
    raise HTTPException(status_code=500, detail="Redis connection failed")

@app.post("/api/agents/{agent_id}/revoke")
async def revoke_agent(agent_id: str):
    """Revoke a specific agent via Redis fast-path"""
    if redis_client:
        await redis_client.set(f"agent:revoked:{agent_id}", "true")
        await redis_client.publish("policy_updates", f"agent_revoked:{agent_id}")
        return {"status": "success", "message": f"Agent {agent_id} revoked"}
    raise HTTPException(status_code=500, detail="Redis connection failed")
