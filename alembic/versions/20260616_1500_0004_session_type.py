"""session_type

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-16 15:00:00.000000

Adds ``workout_sessions.session_type`` for P16 posing mode — distinguishes
rep-based exercise sessions ("exercise", the default) from held-pose posing
sessions ("posing"). Existing rows backfill to "exercise" via server_default.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "workout_sessions",
        sa.Column("session_type", sa.String(), nullable=False, server_default="exercise"),
    )


def downgrade() -> None:
    op.drop_column("workout_sessions", "session_type")
