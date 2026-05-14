import os
from typing import Any

import redis.asyncio as redis


async def create_redis_client() -> redis.Redis:
    """Create and verify a Redis connection on startup."""
    client: redis.Redis = redis.from_url(
        os.environ["REDIS_URL"],
        encoding="utf-8",
        decode_responses=True,
    )
    await client.ping()
    return client


def get_cache(app_state: Any) -> redis.Redis:
    """FastAPI dependency — returns the shared Redis client from app state."""
    return app_state.redis
