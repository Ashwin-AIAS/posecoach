"""initial_schema

Revision ID: 0001
Revises:
Create Date: 2026-05-07 17:00:00.000000

Creates the initial schema with `users` and `workout_sessions` tables.
Mirrors the SQLAlchemy models in app/models.py — keep them in sync.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "workout_sessions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("exercise", sa.String(), nullable=False),
        sa.Column("rep_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_form_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("keypoints_data", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_workout_sessions_user_id", "workout_sessions", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_workout_sessions_user_id", table_name="workout_sessions")
    op.drop_table("workout_sessions")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
