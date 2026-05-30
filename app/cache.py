import os
from collections.abc import Awaitable
from typing import Any, cast

import redis.asyncio as redis


async def create_redis_client() -> redis.Redis:
    """Create and verify a Redis connection on startup."""
    client: redis.Redis = redis.from_url(
        os.environ["REDIS_URL"],
        encoding="utf-8",
        decode_responses=True,
    )
    # redis-py types ping() as Awaitable[bool] | bool; the async client always
    # returns the Awaitable variant — cast to silence the misc-type error.
    pong = cast("Awaitable[bool]", client.ping())
    await pong
    return client


def get_cache(app_state: Any) -> redis.Redis:
    """FastAPI dependency — returns the shared Redis client from app state."""
    return cast(redis.Redis, app_state.redis)
