"""0006 workout logger

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-26 12:00:00.000000

Adds the P24 workout-logger schema — six new tables only. Purely additive: it
``create_table``s ``exercises``, ``workout_logs``, ``logged_exercises``,
``logged_sets``, ``routines`` and ``routine_exercises`` and touches no existing
table or column. ``logged_sets`` carries optional CV-link columns
(``form_score``, ``source_session_id`` → ``workout_sessions`` with SET NULL)
that are wired up in P26.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Shared catalog (not per-user).
    op.create_table(
        "exercises",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("equipment", sa.String(), nullable=True),
        sa.Column("primary_muscles", sa.JSON(), nullable=True),
        sa.Column("secondary_muscles", sa.JSON(), nullable=True),
        sa.Column("instructions", sa.JSON(), nullable=True),
        sa.Column("image_urls", sa.JSON(), nullable=True),
        sa.Column("youtube_id", sa.String(), nullable=True),
        sa.Column("is_cv_supported", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exercises_slug", "exercises", ["slug"], unique=True)

    # Per-user workout logs.
    op.create_table(
        "workout_logs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workout_logs_user_id", "workout_logs", ["user_id"])

    # Per-user routine templates.
    op.create_table(
        "routines",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_routines_user_id", "routines", ["user_id"])

    op.create_table(
        "logged_exercises",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workout_log_id", sa.String(), nullable=False),
        sa.Column("exercise_id", sa.String(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["workout_log_id"], ["workout_logs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exercise_id"], ["exercises.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_logged_exercises_workout_log_id", "logged_exercises", ["workout_log_id"]
    )

    op.create_table(
        "logged_sets",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("logged_exercise_id", sa.String(), nullable=False),
        sa.Column("set_number", sa.Integer(), nullable=False),
        sa.Column("weight_kg", sa.Float(), nullable=False),
        sa.Column("reps", sa.Integer(), nullable=False),
        sa.Column("rpe", sa.Float(), nullable=True),
        sa.Column("is_warmup", sa.Boolean(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("form_score", sa.Float(), nullable=True),
        sa.Column("source_session_id", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(
            ["logged_exercise_id"], ["logged_exercises.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["source_session_id"], ["workout_sessions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_logged_sets_logged_exercise_id", "logged_sets", ["logged_exercise_id"]
    )
    op.create_index(
        "ix_logged_sets_source_session_id", "logged_sets", ["source_session_id"]
    )

    op.create_table(
        "routine_exercises",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("routine_id", sa.String(), nullable=False),
        sa.Column("exercise_id", sa.String(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["routine_id"], ["routines.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exercise_id"], ["exercises.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_routine_exercises_routine_id", "routine_exercises", ["routine_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_routine_exercises_routine_id", table_name="routine_exercises")
    op.drop_table("routine_exercises")
    op.drop_index("ix_logged_sets_source_session_id", table_name="logged_sets")
    op.drop_index("ix_logged_sets_logged_exercise_id", table_name="logged_sets")
    op.drop_table("logged_sets")
    op.drop_index("ix_logged_exercises_workout_log_id", table_name="logged_exercises")
    op.drop_table("logged_exercises")
    op.drop_index("ix_routines_user_id", table_name="routines")
    op.drop_table("routines")
    op.drop_index("ix_workout_logs_user_id", table_name="workout_logs")
    op.drop_table("workout_logs")
    op.drop_index("ix_exercises_slug", table_name="exercises")
    op.drop_table("exercises")
