"""Seed the ``exercises`` catalog from free-exercise-db (P24).

free-exercise-db (https://github.com/yuhonas/free-exercise-db) is a public-domain
catalog of ~870 exercises with static images served from the jsDelivr CDN over the
repo (zero hosting). This script downloads that JSON and upserts it into the
``exercises`` table **idempotently** — it is safe to re-run; existing rows are
refreshed in place (matched by ``slug``) rather than duplicated.

Catalog rows whose movement is covered by the live CV form-scorer are flagged
``is_cv_supported=True`` and carry over the hand-curated, oEmbed-verified
``youtube_id`` from ``frontend/src/lib/exercises.ts`` (see ``CV_EXERCISE_MAP``).
The remaining rows get no ``youtube_id`` here; a constructed search link is added
on the frontend (P25) and curated later.

Run (from the repo root, with ``POSTGRES_URL`` set and migration 0006 applied)::

    python -m scripts.seed_exercises
"""
from __future__ import annotations

import asyncio
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import AsyncSessionLocal
from app.models import Exercise

logger = structlog.get_logger(__name__)

# Source catalog (pinned to the repo's default branch via jsDelivr).
FREE_EXERCISE_DB_URL = (
    "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json"
)
# Each image path in the dataset is relative to this CDN directory.
IMAGE_URL_PREFIX = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/"

# free-exercise-db ``id`` → (CV exercise key, curated 11-char YouTube id).
# The CV key mirrors the ``Exercise`` union in ``frontend/src/types.ts``; the
# YouTube ids are copied verbatim from ``frontend/src/lib/exercises.ts`` (each
# oEmbed-verified). ``diamond_pushup`` has no faithful free-exercise-db match, so
# it is intentionally absent and curated later.
CV_EXERCISE_MAP: dict[str, tuple[str, str]] = {
    "Barbell_Squat": ("squat", "CWl0apMgshk"),
    "Barbell_Deadlift": ("deadlift", "wYREQkVtvEc"),
    "Barbell_Curl": ("curl", "ykJmrZ5v0Oo"),
    "Barbell_Bench_Press_-_Medium_Grip": ("bench", "rT7DgCr-3pg"),
    "Standing_Military_Press": ("ohp", "F3QY5vMz_6I"),
    "Dumbbell_Rear_Lunge": ("lunge", "RZKXLMxPF_I"),
    "Plank": ("plank", "gSDNblPRh1U"),
    "Pushups": ("pushup", "IODxDxX7oi4"),
    "Hammer_Curls": ("hammer_curl", "BRVDS6HVR9Q"),
    "Side_Lateral_Raise": ("lateral_raise", "3VcKaXpzqRo"),
    "Bent_Over_Barbell_Row": ("barbell_row", "rqTOAM8WoeM"),
    "Dumbbell_Shoulder_Press": ("db_shoulder_press", "fuQpuu--bMI"),
    "Drag_Curl": ("drag_curl", "LMdNTHH6G8I"),
    "One-Arm_Dumbbell_Row": ("one_arm_row", "pYcpY20QaE8"),
    "Barbell_Shrug": ("shrug", "xDt6qbKgLkY"),
    "Front_Dumbbell_Raise": ("front_raise", "CH9JzDStL3U"),
    "Standing_Dumbbell_Triceps_Extension": ("overhead_triceps", "fYqswDVbJDg"),
}

_SLUG_NON_ALNUM = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class SeedSummary:
    """Outcome of a seed run — used for the end-of-run log line and in tests."""

    total: int
    inserted: int
    updated: int
    cv_flagged: int


def slugify(value: str) -> str:
    """Return a stable kebab-case slug (lowercase, non-alphanumerics → ``-``)."""
    return _SLUG_NON_ALNUM.sub("-", value.lower()).strip("-")


def build_exercise_fields(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Map one free-exercise-db record to ``Exercise`` column values.

    Args:
        raw: A single object from the free-exercise-db ``exercises.json`` list.

    Returns:
        A kwargs dict for ``Exercise(**fields)`` (or attribute updates on an
        existing row). The primary key ``id`` is omitted so the DB default
        generates it on insert and existing rows keep theirs on refresh.
    """
    source_id = str(raw.get("id") or raw["name"])
    cv_link = CV_EXERCISE_MAP.get(source_id)
    images = raw.get("images") or []
    return {
        "slug": slugify(source_id),
        "name": str(raw["name"]),
        "category": raw.get("category"),
        "equipment": raw.get("equipment"),
        "primary_muscles": list(raw.get("primaryMuscles") or []),
        "secondary_muscles": list(raw.get("secondaryMuscles") or []),
        "instructions": list(raw.get("instructions") or []),
        "image_urls": [f"{IMAGE_URL_PREFIX}{path}" for path in images],
        "youtube_id": cv_link[1] if cv_link is not None else None,
        "is_cv_supported": cv_link is not None,
    }


async def upsert_exercises(
    session: AsyncSession, raw_exercises: Sequence[Mapping[str, Any]]
) -> SeedSummary:
    """Idempotently upsert catalog rows, matching on ``slug``.

    A second run over the same data inserts nothing and refreshes every existing
    row in place, so the table row count stays equal to the number of distinct
    slugs. Commits once at the end.

    Args:
        session: Async DB session (catalog table must already exist).
        raw_exercises: Parsed free-exercise-db records.

    Returns:
        A :class:`SeedSummary` with insert/update/cv-flag counts.
    """
    inserted = 0
    updated = 0
    cv_flagged = 0

    for raw in raw_exercises:
        fields = build_exercise_fields(raw)
        if fields["is_cv_supported"]:
            cv_flagged += 1

        existing = (
            await session.execute(select(Exercise).where(Exercise.slug == fields["slug"]))
        ).scalar_one_or_none()

        if existing is None:
            session.add(Exercise(**fields))
            inserted += 1
        else:
            for key, value in fields.items():
                if key != "slug":  # slug is the stable match key — never rewrite it
                    setattr(existing, key, value)
            updated += 1

    await session.commit()
    return SeedSummary(
        total=inserted + updated, inserted=inserted, updated=updated, cv_flagged=cv_flagged
    )


async def fetch_catalog(url: str = FREE_EXERCISE_DB_URL) -> list[dict[str, Any]]:
    """Download and parse the free-exercise-db catalog JSON."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        data: list[dict[str, Any]] = response.json()
    return data


async def main() -> None:
    """Fetch the catalog and seed it into the database."""
    raw_exercises = await fetch_catalog()
    logger.info("seed_exercises_fetched", count=len(raw_exercises))
    async with AsyncSessionLocal() as session:
        summary = await upsert_exercises(session, raw_exercises)
    logger.info("seed_exercises_complete", **asdict(summary))


if __name__ == "__main__":
    asyncio.run(main())
