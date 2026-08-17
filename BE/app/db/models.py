"""SQLAlchemy ORM models for the local M1 schema."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

_JSON_TYPE = JSON().with_variant(JSONB, "postgresql")


class SalesRepresentative(Base):
    """Local read model for a sales representative identity."""

    __tablename__ = "sales_representatives"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Retailer(Base):
    """Local read model for a retailer."""

    __tablename__ = "retailers"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Product(Base):
    """Local product catalog entry used for M1 order validation."""

    __tablename__ = "products"

    sku: Mapped[str] = mapped_column(String(100), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SalesRetailerAssignment(Base):
    """Defines which retailers a sales representative may submit orders for."""

    __tablename__ = "sales_retailer_assignments"

    sales_rep_id: Mapped[str] = mapped_column(
        ForeignKey("sales_representatives.id"), primary_key=True
    )
    retailer_id: Mapped[str] = mapped_column(ForeignKey("retailers.id"), primary_key=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Order(Base):
    """Transactional order aggregate root."""

    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint(
            "sales_rep_id", "client_order_id", name="uq_orders_sales_rep_client_order"
        ),
        CheckConstraint(
            "declared_total_amount_vnd > 0", name="ck_orders_declared_total_positive"
        ),
        CheckConstraint(
            "order_timezone_offset_minutes BETWEEN -840 AND 840",
            name="ck_orders_timezone_offset_range",
        ),
        CheckConstraint(
            "status IN ('PENDING_FRAUD_CHECK', 'APPROVED', 'REVIEW_REQUIRED', 'REJECTED')",
            name="ck_orders_status",
        ),
        Index("ix_orders_sales_created_at", "sales_rep_id", "created_at"),
        Index("ix_orders_sales_status_created_at", "sales_rep_id", "status", "created_at"),
        Index("ix_orders_retailer_created_at", "retailer_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    client_order_id: Mapped[str] = mapped_column(String(100), nullable=False)
    sales_rep_id: Mapped[str] = mapped_column(
        ForeignKey("sales_representatives.id"), nullable=False
    )
    retailer_id: Mapped[str] = mapped_column(ForeignKey("retailers.id"), nullable=False)
    order_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    order_timezone_offset_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    declared_total_amount_vnd: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    assessments: Mapped[list[FraudAssessment]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    """One SKU/quantity line attached to an order."""

    __tablename__ = "order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "product_sku", name="uq_order_items_order_product"),
        CheckConstraint("quantity > 0", name="ck_order_items_quantity_positive"),
        Index("ix_order_items_order_id", "order_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    product_sku: Mapped[str] = mapped_column(String(100), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    order: Mapped[Order] = relationship(back_populates="items")


class FraudAssessment(Base):
    """Append-only fraud evaluation result for an order."""

    __tablename__ = "fraud_assessments"
    __table_args__ = (
        CheckConstraint("risk_score >= 0 AND risk_score <= 100", name="ck_fraud_score_range"),
        CheckConstraint(
            "decision IN ('APPROVED', 'REVIEW_REQUIRED', 'REJECTED')",
            name="ck_fraud_decision",
        ),
        Index("ix_fraud_assessments_order_assessed_at", "order_id", "assessed_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    decision: Mapped[str] = mapped_column(String(50), nullable=False)
    reason_codes: Mapped[list[str]] = mapped_column(_JSON_TYPE, nullable=False)
    evaluator_type: Mapped[str] = mapped_column(String(100), nullable=False)
    evaluator_version: Mapped[str] = mapped_column(String(100), nullable=False)
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    order: Mapped[Order] = relationship(back_populates="assessments")


class OrderStatusHistory(Base):
    """Audit record for every order state transition."""

    __tablename__ = "order_status_history"
    __table_args__ = (Index("ix_order_status_history_order_changed_at", "order_id", "changed_at"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    to_status: Mapped[str] = mapped_column(String(50), nullable=False)
    reason_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    actor_type: Mapped[str] = mapped_column(String(50), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class IdempotencyRecord(Base):
    """Maps a safe client retry key to one order."""

    __tablename__ = "idempotency_records"
    __table_args__ = (
        UniqueConstraint(
            "sales_rep_id", "idempotency_key", name="uq_idempotency_sales_rep_key"
        ),
        Index("ix_idempotency_records_expires_at", "expires_at"),
        Index("ix_idempotency_records_order_id", "order_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    idempotency_key: Mapped[str] = mapped_column(String(36), nullable=False)
    sales_rep_id: Mapped[str] = mapped_column(
        ForeignKey("sales_representatives.id"), nullable=False
    )
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class OutboxEvent(Base):
    """Durable event that a worker processes after the order transaction commits."""

    __tablename__ = "outbox_events"
    __table_args__ = (
        CheckConstraint("attempt_count >= 0", name="ck_outbox_attempt_count_non_negative"),
        CheckConstraint(
            "status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED')",
            name="ck_outbox_status",
        ),
        Index("ix_outbox_events_status_available_at", "status", "available_at"),
        Index("ix_outbox_events_aggregate_id", "aggregate_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    aggregate_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    payload: Mapped[dict[str, Any]] = mapped_column(_JSON_TYPE, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
