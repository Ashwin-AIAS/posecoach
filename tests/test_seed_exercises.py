"""P24 exercise-catalog seed tests — local fixture, no network, SQLite in-memory.

Exercises the idempotent upsert in ``scripts/seed_exercises.py`` against a small
in-line catalog that mirrors the free-exercise-db record shape, so the seed logic
(slugging, image-URL prefixing, CV flagging, re-run safety) is verified without
hitting the CDN.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise
from scripts.seed_exercises import (
    IMAGE_URL_PREFIX,
    build_exercise_fields,
    slugify,
    upsert_exercises,
)

# Mirror of free-exercise-db records: one CV-supported lift, two ordinary rows.
SAMPLE_CATALOG: list[dict[str, Any]] = [
    {
        "id": "Barbell_Squat",
        "name": "Barbell Squat",
        "category": "strength",
        "equipment": "barbell",
        "primaryMuscles": ["quadriceps"],
        "secondaryMuscles": ["glutes", "hamstrings"],
        "instructions": ["Set up under the bar.", "Squat to depth, then stand."],
        "images": ["Barbell_Squat/0.jpg", "Barbell_Squat/1.jpg"],
    },
    {
        "id": "3_4_Sit-Up",
        "name": "3/4 Sit-Up",
        "category": "strength",
        "equipment": "body only",
        "primaryMuscles": ["abdominals"],
        "secondaryMuscles": [],
        "instructions": ["Lie down.", "Sit up three-quarters of the way."],
        "images": ["3_4_Sit-Up/0.jpg"],
    },
    {
        "id": "Cable_Deadlifts",
        "name": "Cable Deadlifts",
        "category": "strength",
        "equipment": "cable",
        "primaryMuscles": ["glutes"],
        "secondaryMuscles": ["hamstrings", "lower back"],
        "instructions": ["Hinge at the hips."],
        "images": [],
    },
]


def test_slugify_normalizes_id_to_kebab_case() -> None:
    assert slugify("Barbell_Bench_Press_-_Medium_Grip") == "barbell-bench-press-medium-grip"
    assert slugify("3_4_Sit-Up") == "3-4-sit-up"


def test_build_exercise_fields_prefixes_images_and_flags_cv() -> None:
    fields = build_exercise_fields(SAMPLE_CATALOG[0])
    assert fields["slug"] == "barbell-squat"
    assert fields["primary_muscles"] == ["quadriceps"]
    assert fields["image_urls"] == [
        f"{IMAGE_URL_PREFIX}Barbell_Squat/0.jpg",
        f"{IMAGE_URL_PREFIX}Barbell_Squat/1.jpg",
    ]
    # CV-supported lift carries its curated YouTube id.
    assert fields["is_cv_supported"] is True
    assert fields["youtube_id"] == "CWl0apMgshk"
    # An ordinary catalog row is not flagged and has no curated video.
    plain = build_exercise_fields(SAMPLE_CATALOG[1])
    assert plain["is_cv_supported"] is False
    assert plain["youtube_id"] is None
    assert "id" not in plain  # PK left to the DB default


async def test_seed_inserts_rows_and_flags_known_cv_slug(test_db: AsyncSession) -> None:
    summary = await upsert_exercises(test_db, SAMPLE_CATALOG)

    assert summary.total == 3
    assert summary.inserted == 3
    assert summary.updated == 0
    assert summary.cv_flagged == 1

    squat = (
        await test_db.execute(select(Exercise).where(Exercise.slug == "barbell-squat"))
    ).scalar_one()
    assert squat.is_cv_supported is True
    assert squat.youtube_id == "CWl0apMgshk"
    assert squat.image_urls[0].startswith(IMAGE_URL_PREFIX)


async def test_seed_is_idempotent_on_rerun(test_db: AsyncSession) -> None:
    await upsert_exercises(test_db, SAMPLE_CATALOG)
    second = await upsert_exercises(test_db, SAMPLE_CATALOG)

    # Re-running refreshes in place — no duplicates, every row matched by slug.
    assert second.inserted == 0
    assert second.updated == 3

    row_count = (
        await test_db.execute(select(func.count()).select_from(Exercise))
    ).scalar_one()
    assert row_count == 3
