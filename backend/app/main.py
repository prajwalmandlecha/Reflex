"""Main FastAPI application entrypoint."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_pool, init_pool
from app.event_processor import init_event_processor, stop_event_processor
from app.redis_client import close_redis, init_redis
from app.routes import (
    agent_classes, agent_instances, audit, bank_connections,
    dashboard, fleet, internal, metrics, policies, tokens, tools, websockets,
)
from app.services.config_propagation import (
    cache_active_policies, cache_bank_connections, cache_tool_routing,
    cache_bank_connections_list,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("agp-backend")

# Fail closed: refuse to start with the built-in dev JWT secret outside of
# explicit dev mode — matches the gateway's check (gateway/cmd/gateway/main.go).
if settings.jwt_secret == "dev-secret-2026" and settings.agp_env != "dev":
    logger.error(
        "Refusing to start: JWT_SECRET is the built-in dev default. "
        "Set JWT_SECRET in .env (and JWT_ISSUER) or set AGP_ENV=dev to proceed."
    )
    raise SystemExit(1)



@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AGP Control-Plane Backend...")
    # Initialize DB & Redis connections
    await init_pool()
    redis = await init_redis()

    # Pre-populate Redis cache on startup
    try:
        await cache_active_policies()
        await cache_bank_connections()
        await cache_bank_connections_list()
        await cache_tool_routing()
        logger.info("Pre-populated Redis cache with active policies, connections, and tool routing")
    except Exception as e:
        logger.warning("Failed to pre-populate Redis cache on startup: %s", e)

    # Start event processor (subscribes to Redis gateway:events → WebSockets)
    await init_event_processor(redis)

    yield

    logger.info("Shutting down AGP Control-Plane Backend...")
    await stop_event_processor()
    await close_redis()
    await close_pool()


app = FastAPI(
    title="AGP Governance Control-Plane API",
    description="Backend API for Agent Governance Platform — managing policies, agents, bank connections, and telemetry.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware
origins = settings.cors_origins.split(",") if settings.cors_origins != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health Check
@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "service": "agp-backend"}

# Register Routers
app.include_router(agent_classes.router)
app.include_router(agent_instances.router)
app.include_router(bank_connections.router)
app.include_router(tools.router)
app.include_router(policies.router)
app.include_router(audit.router)
app.include_router(fleet.router)
app.include_router(tokens.router)
app.include_router(metrics.router)
app.include_router(dashboard.router)
app.include_router(internal.router)
app.include_router(websockets.router)
