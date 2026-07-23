"""Async Redis client and pub/sub helpers."""

import redis.asyncio as aioredis
from app.config import settings

redis_client: aioredis.Redis | None = None


async def init_redis() -> aioredis.Redis:
    global redis_client
    redis_client = aioredis.from_url(
        settings.redis_url,
        decode_responses=True,
    )
    await redis_client.ping()
    return redis_client


async def close_redis():
    global redis_client
    if redis_client:
        await redis_client.close()
        redis_client = None


def get_redis() -> aioredis.Redis:
    assert redis_client is not None, "Redis client not initialized"
    return redis_client
