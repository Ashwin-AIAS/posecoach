import os
from collections.abc import Awaitable
from typing import Any, cast

import redis.asyncio as redis


async def create_redis_client() -> redis.Redis:
    """Create and verify a Redis connection on startup."""
    # redis-py 5.x ships py.typed but annotates ``from_url`` with untyped
    # ``**kwargs``, so mypy --strict flags the call as untyped. The return is a
    # ``Redis`` — annotate it explicitly and silence the one no-untyped-call.
    client: redis.Redis = redis.from_url(  # type: ignore[no-untyped-call]
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
