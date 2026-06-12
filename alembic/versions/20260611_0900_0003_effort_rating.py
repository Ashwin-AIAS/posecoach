"""effort_rating

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-11 09:00:00.000000

Adds ``workout_sessions.effort_rating`` for P16 adaptive coach — the user's
1-tap post-set effort self-report (1 = too easy, 3 = just right, 5 = too hard).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("workout_sessions", sa.Column("effort_rating", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("workout_sessions", "effort_rating")
