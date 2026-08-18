"""Create the M1 order-intake schema.

Revision ID: 0001_m1_order_intake
Revises:
Create Date: 2026-08-16

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_m1_order_intake"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sales_representatives",
        sa.Column("id", sa.String(length=100), primary_key=True),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_table(
        "retailers",
        sa.Column("id", sa.String(length=100), primary_key=True),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_table(
        "products",
        sa.Column("sku", sa.String(length=100), primary_key=True),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_table(
        "sales_retailer_assignments",
        sa.Column(
            "sales_rep_id",
            sa.String(length=100),
            sa.ForeignKey("sales_representatives.id"),
            primary_key=True,
        ),
        sa.Column(
            "retailer_id",
            sa.String(length=100),
            sa.ForeignKey("retailers.id"),
            primary_key=True,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_table(
        "orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("client_order_id", sa.String(length=100), nullable=False),
        sa.Column(
            "sales_rep_id",
            sa.String(length=100),
            sa.ForeignKey("sales_representatives.id"),
            nullable=False,
        ),
        sa.Column(
            "retailer_id",
            sa.String(length=100),
            sa.ForeignKey("retailers.id"),
            nullable=False,
        ),
        sa.Column("order_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("order_timezone_offset_minutes", sa.Integer(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("declared_total_amount_vnd", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint(
            "sales_rep_id", "client_order_id", name="uq_orders_sales_rep_client_order"
        ),
        sa.CheckConstraint(
            "declared_total_amount_vnd > 0", name="ck_orders_declared_total_positive"
        ),
        sa.CheckConstraint(
            "order_timezone_offset_minutes BETWEEN -840 AND 840",
            name="ck_orders_timezone_offset_range",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING_FRAUD_CHECK', 'APPROVED', 'REVIEW_REQUIRED', 'REJECTED')",
            name="ck_orders_status",
        ),
    )
    op.create_index("ix_orders_sales_created_at", "orders", ["sales_rep_id", "created_at"])
    op.create_index(
        "ix_orders_sales_status_created_at", "orders", ["sales_rep_id", "status", "created_at"]
    )
    op.create_index("ix_orders_retailer_created_at", "orders", ["retailer_id", "created_at"])

    op.create_table(
        "order_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("product_sku", sa.String(length=100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("order_id", "product_sku", name="uq_order_items_order_product"),
        sa.CheckConstraint("quantity > 0", name="ck_order_items_quantity_positive"),
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])

    op.create_table(
        "fraud_assessments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column("decision", sa.String(length=50), nullable=False),
        sa.Column("reason_codes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("evaluator_type", sa.String(length=100), nullable=False),
        sa.Column("evaluator_version", sa.String(length=100), nullable=False),
        sa.Column("assessed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint("risk_score >= 0 AND risk_score <= 100", name="ck_fraud_score_range"),
        sa.CheckConstraint(
            "decision IN ('APPROVED', 'REVIEW_REQUIRED', 'REJECTED')",
            name="ck_fraud_decision",
        ),
    )
    op.create_index(
        "ix_fraud_assessments_order_assessed_at", "fraud_assessments", ["order_id", "assessed_at"]
    )

    op.create_table(
        "order_status_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_status", sa.String(length=50), nullable=True),
        sa.Column("to_status", sa.String(length=50), nullable=False),
        sa.Column("reason_code", sa.String(length=100), nullable=True),
        sa.Column("actor_type", sa.String(length=50), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_order_status_history_order_changed_at", "order_status_history", ["order_id", "changed_at"]
    )

    op.create_table(
        "idempotency_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("idempotency_key", sa.String(length=36), nullable=False),
        sa.Column(
            "sales_rep_id",
            sa.String(length=100),
            sa.ForeignKey("sales_representatives.id"),
            nullable=False,
        ),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "sales_rep_id", "idempotency_key", name="uq_idempotency_sales_rep_key"
        ),
    )
    op.create_index("ix_idempotency_records_expires_at", "idempotency_records", ["expires_at"])
    op.create_index("ix_idempotency_records_order_id", "idempotency_records", ["order_id"])

    op.create_table(
        "outbox_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column(
            "aggregate_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_outbox_attempt_count_non_negative"),
        sa.CheckConstraint(
            "status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED')",
            name="ck_outbox_status",
        ),
    )
    op.create_index(
        "ix_outbox_events_status_available_at", "outbox_events", ["status", "available_at"]
    )
    op.create_index("ix_outbox_events_aggregate_id", "outbox_events", ["aggregate_id"])


def downgrade() -> None:
    op.drop_index("ix_outbox_events_aggregate_id", table_name="outbox_events")
    op.drop_index("ix_outbox_events_status_available_at", table_name="outbox_events")
    op.drop_table("outbox_events")
    op.drop_index("ix_idempotency_records_order_id", table_name="idempotency_records")
    op.drop_index("ix_idempotency_records_expires_at", table_name="idempotency_records")
    op.drop_table("idempotency_records")
    op.drop_index("ix_order_status_history_order_changed_at", table_name="order_status_history")
    op.drop_table("order_status_history")
    op.drop_index("ix_fraud_assessments_order_assessed_at", table_name="fraud_assessments")
    op.drop_table("fraud_assessments")
    op.drop_index("ix_order_items_order_id", table_name="order_items")
    op.drop_table("order_items")
    op.drop_index("ix_orders_retailer_created_at", table_name="orders")
    op.drop_index("ix_orders_sales_status_created_at", table_name="orders")
    op.drop_index("ix_orders_sales_created_at", table_name="orders")
    op.drop_table("orders")
    op.drop_table("sales_retailer_assignments")
    op.drop_table("products")
    op.drop_table("retailers")
    op.drop_table("sales_representatives")
