"""0008 custom exercises

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-12 12:00:00.000000

Adds P29 custom-exercise support to the existing shared ``exercises`` table —
two new nullable/defaulted columns only, no existing row touched:
``owner_user_id`` (null = shared seeded catalog, set = one user's own
addition) and ``is_custom``. ``owner_user_id`` -> ``users.id`` is SET NULL on
delete so a deleted account's custom rows become ordinary orphaned catalog
entries rather than requiring cascade-order coordination with
``logged_exercises``.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # batch_alter_table: SQLite can't ALTER-add a constraint in place (only
    # Postgres can); batch mode does a copy-and-move on SQLite and a plain
    # ALTER on Postgres, so the same migration works on both.
    with op.batch_alter_table("exercises") as batch_op:
        batch_op.add_column(sa.Column("owner_user_id", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("is_custom", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.create_index("ix_exercises_owner_user_id", ["owner_user_id"])
        batch_op.create_foreign_key(
            "fk_exercises_owner_user_id_users",
            "users",
            ["owner_user_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("exercises") as batch_op:
        batch_op.drop_constraint("fk_exercises_owner_user_id_users", type_="foreignkey")
        batch_op.drop_index("ix_exercises_owner_user_id")
        batch_op.drop_column("is_custom")
        batch_op.drop_column("owner_user_id")
