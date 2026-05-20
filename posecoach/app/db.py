import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


_db_url = os.environ["POSTGRES_URL"]
_is_sqlite = _db_url.startswith("sqlite")

engine = create_async_engine(
    _db_url,
    # pool_size/max_overflow not supported by SQLite (used in tests)
    **({} if _is_sqlite else {"pool_size": 10, "max_overflow": 20}),
    pool_pre_ping=not _is_sqlite,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency — injects an async DB session into route handlers."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
