"""prep_cycles

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-16 17:00:00.000000

Adds the P17 contest-prep model: a ``prep_cycles`` table (a named run-up to a
show date) plus ``workout_sessions.prep_id`` so posing rehearsals group under a
prep. The column is nullable (ungrouped sessions stay null) and clears to null
if its prep is deleted.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "prep_cycles",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("show_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_prep_cycles_user_id", "prep_cycles", ["user_id"])
    with op.batch_alter_table("workout_sessions") as batch_op:
        batch_op.add_column(sa.Column("prep_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_workout_sessions_prep_id", "prep_cycles", ["prep_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_index("ix_workout_sessions_prep_id", ["prep_id"])


def downgrade() -> None:
    with op.batch_alter_table("workout_sessions") as batch_op:
        batch_op.drop_index("ix_workout_sessions_prep_id")
        batch_op.drop_constraint("fk_workout_sessions_prep_id", type_="foreignkey")
        batch_op.drop_column("prep_id")
    op.drop_index("ix_prep_cycles_user_id", table_name="prep_cycles")
    op.drop_table("prep_cycles")
