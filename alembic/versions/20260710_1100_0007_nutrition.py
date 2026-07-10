"""0007 nutrition

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-10 11:00:00.000000

Adds the P27 calorie-tracker schema — two new tables only. Purely additive: it
``create_table``s ``food_items`` (Open Food Facts cache + per-user manual
entries) and ``food_log_entries`` (the daily diary, macros snapshotted at log
time) and touches no existing table or column.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Shared OFF cache rows (created_by NULL) + per-user manual foods.
    op.create_table(
        "food_items",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("barcode", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("brand", sa.String(), nullable=True),
        sa.Column("serving_size_g", sa.Float(), nullable=True),
        sa.Column("serving_label", sa.String(), nullable=True),
        sa.Column("kcal_100g", sa.Float(), nullable=False),
        sa.Column("protein_100g", sa.Float(), nullable=False),
        sa.Column("carbs_100g", sa.Float(), nullable=False),
        sa.Column("fat_100g", sa.Float(), nullable=False),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_food_items_barcode", "food_items", ["barcode"], unique=True)
    op.create_index("ix_food_items_created_by", "food_items", ["created_by"])

    # Per-user diary; macro columns are log-time snapshots.
    op.create_table(
        "food_log_entries",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("food_item_id", sa.String(), nullable=False),
        sa.Column("logged_date", sa.Date(), nullable=False),
        sa.Column("meal", sa.String(), nullable=False),
        sa.Column("amount_g", sa.Float(), nullable=False),
        sa.Column("kcal", sa.Float(), nullable=False),
        sa.Column("protein_g", sa.Float(), nullable=False),
        sa.Column("carbs_g", sa.Float(), nullable=False),
        sa.Column("fat_g", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["food_item_id"], ["food_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_food_log_entries_user_id", "food_log_entries", ["user_id"])
    op.create_index("ix_food_log_entries_food_item_id", "food_log_entries", ["food_item_id"])
    op.create_index("ix_food_log_entries_logged_date", "food_log_entries", ["logged_date"])


def downgrade() -> None:
    op.drop_index("ix_food_log_entries_logged_date", table_name="food_log_entries")
    op.drop_index("ix_food_log_entries_food_item_id", table_name="food_log_entries")
    op.drop_index("ix_food_log_entries_user_id", table_name="food_log_entries")
    op.drop_table("food_log_entries")
    op.drop_index("ix_food_items_created_by", table_name="food_items")
    op.drop_index("ix_food_items_barcode", table_name="food_items")
    op.drop_table("food_items")
