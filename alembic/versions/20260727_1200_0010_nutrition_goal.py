"""0010 nutrition goal

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-27 12:00:00.000000

Adds the P34.2 calorie-budget schema — one new table only. Purely additive: it
``create_table``s ``nutrition_goals`` (one row per user holding the daily
energy/macro targets the diary counts down from) and touches no existing table
or column.

Numbered 0010, not the 0009 the prompt drafted: 0009 was already taken by the
P33 password-reset migration on ``main``.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "nutrition_goals",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("kcal_target", sa.Integer(), nullable=False),
        sa.Column("protein_target_g", sa.Float(), nullable=True),
        sa.Column("carbs_target_g", sa.Float(), nullable=True),
        sa.Column("fat_target_g", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        # One budget per user — the PUT upsert depends on this.
        sa.UniqueConstraint("user_id", name="uq_nutrition_goals_user_id"),
    )
    op.create_index("ix_nutrition_goals_user_id", "nutrition_goals", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_nutrition_goals_user_id", table_name="nutrition_goals")
    op.drop_table("nutrition_goals")
