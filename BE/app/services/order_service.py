"""Durable order-intake and read workflows for M1."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import CurrentSalesRep
from app.core.config import settings
from app.core.errors import APIError
from app.db.models import (
    FraudAssessment,
    IdempotencyRecord,
    Order,
    OrderItem as OrderItemModel,
    OrderStatusHistory,
    OutboxEvent,
    Product,
    Retailer,
    SalesRetailerAssignment,
)
from app.domain.order import FraudDecision, OrderStatus, OutboxEventStatus
from app.schemas.order_schema import (
    FraudAssessmentSummary,
    OrderAcceptedResponse,
    OrderCreateReq,
    OrderDetailResponse,
    OrderItem,
    OrderListItem,
    OrderListResponse,
)


@dataclass(frozen=True)
class CreateOrderResult:
    """Order response and replay metadata returned to the HTTP adapter."""

    order: OrderAcceptedResponse
    idempotency_replayed: bool


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_aware(timestamp: datetime) -> datetime:
    """Normalize database timestamps for the API's timezone-aware contract."""
    return timestamp if timestamp.tzinfo is not None else timestamp.replace(tzinfo=timezone.utc)


def _timezone_offset_minutes(order_time: datetime) -> int:
    """Capture the client offset before PostgreSQL normalizes order_time to UTC."""
    offset = order_time.utcoffset()
    if offset is None:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="order_time must include a timezone offset.",
        )
    return int(offset.total_seconds() // 60)


def _request_fingerprint(order_data: OrderCreateReq) -> str:
    """Return a stable SHA-256 fingerprint of the logical client payload."""
    canonical_data = order_data.model_dump(mode="json")
    # Item position is not persisted and detail reads are SKU-sorted, so it must
    # not make an otherwise identical idempotent submission look different.
    canonical_data["items"] = sorted(
        canonical_data["items"], key=lambda item: item["product_sku"]
    )
    canonical_payload = json.dumps(
        canonical_data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest()


def _latest_assessment(order: Order) -> FraudAssessment | None:
    """Return the newest append-only assessment already loaded for an order."""
    if not order.assessments:
        return None
    return max(order.assessments, key=lambda assessment: _ensure_aware(assessment.assessed_at))


def _assessment_summary(order: Order) -> FraudAssessmentSummary | None:
    assessment = _latest_assessment(order)
    if assessment is None:
        return None
    return FraudAssessmentSummary(
        risk_score=assessment.risk_score,
        decision=FraudDecision(assessment.decision),
        reason_codes=assessment.reason_codes,
        evaluator_type=assessment.evaluator_type,
        evaluator_version=assessment.evaluator_version,
        assessed_at=_ensure_aware(assessment.assessed_at),
    )


def _accepted_response(order: Order) -> OrderAcceptedResponse:
    """Map a persisted order to the create-order response contract."""
    return OrderAcceptedResponse(
        order_id=order.id,
        client_order_id=order.client_order_id,
        status=OrderStatus(order.status),
        created_at=_ensure_aware(order.created_at),
        updated_at=_ensure_aware(order.updated_at),
        fraud_assessment=_assessment_summary(order),
    )


def _detail_response(order: Order) -> OrderDetailResponse:
    """Map a caller-owned order to the detail read contract."""
    accepted = _accepted_response(order)
    return OrderDetailResponse(
        **accepted.model_dump(),
        sales_rep_id=order.sales_rep_id,
        retailer_id=order.retailer_id,
        order_time=_ensure_aware(order.order_time),
        items=[
            OrderItem(product_sku=item.product_sku, quantity=item.quantity)
            for item in sorted(order.items, key=lambda item: item.product_sku)
        ],
        declared_total_amount_vnd=order.declared_total_amount_vnd,
    )


def _list_item(order: Order) -> OrderListItem:
    """Map a caller-owned order to a compact list representation."""
    return OrderListItem(
        order_id=order.id,
        client_order_id=order.client_order_id,
        retailer_id=order.retailer_id,
        declared_total_amount_vnd=order.declared_total_amount_vnd,
        status=OrderStatus(order.status),
        order_time=_ensure_aware(order.order_time),
        updated_at=_ensure_aware(order.updated_at),
    )


def _validate_assignment_and_products(
    db: Session,
    *,
    sales_rep_id: str,
    order_data: OrderCreateReq,
) -> None:
    """Enforce local master-data and assignment rules before mutation."""
    retailer = db.get(Retailer, order_data.retailer_id)
    if retailer is None or not retailer.is_active:
        raise APIError(
            status_code=403,
            code="RETAILER_NOT_ASSIGNED",
            message="The retailer is not assigned to the authenticated sales representative.",
            details=[{"field": "retailer_id", "reason": "not_assigned"}],
        )

    assignment = db.scalar(
        select(SalesRetailerAssignment).where(
            SalesRetailerAssignment.sales_rep_id == sales_rep_id,
            SalesRetailerAssignment.retailer_id == order_data.retailer_id,
            SalesRetailerAssignment.is_active.is_(True),
        )
    )
    if assignment is None:
        raise APIError(
            status_code=403,
            code="RETAILER_NOT_ASSIGNED",
            message="The retailer is not assigned to the authenticated sales representative.",
            details=[{"field": "retailer_id", "reason": "not_assigned"}],
        )

    requested_skus = {item.product_sku for item in order_data.items}
    active_skus = set(
        db.scalars(
            select(Product.sku).where(
                Product.sku.in_(requested_skus),
                Product.is_active.is_(True),
            )
        ).all()
    )
    unavailable_skus = sorted(requested_skus - active_skus)
    if unavailable_skus:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="One or more products are unavailable.",
            details=[
                {"field": "items", "reason": f"unknown_or_inactive_sku:{sku}"}
                for sku in unavailable_skus
            ],
        )


def _record_idempotency_replay(
    db: Session,
    *,
    sales_rep_id: str,
    idempotency_key: str,
    fingerprint: str,
    order: Order,
    now: datetime,
) -> None:
    """Attach a new safe retry key to an already-known equivalent client order."""
    db.add(
        IdempotencyRecord(
            id=uuid4(),
            idempotency_key=idempotency_key,
            sales_rep_id=sales_rep_id,
            request_fingerprint=fingerprint,
            order_id=order.id,
            created_at=now,
            expires_at=now + timedelta(hours=settings.idempotency_ttl_hours),
        )
    )


def _idempotency_key_reused_error() -> APIError:
    """Build the stable response for a key reused with another request."""
    return APIError(
        status_code=409,
        code="IDEMPOTENCY_KEY_REUSED",
        message="The idempotency key was already used with a different request payload.",
    )


def _client_order_id_conflict_error() -> APIError:
    """Build the stable response for a client order ID reused with another request."""
    return APIError(
        status_code=409,
        code="CLIENT_ORDER_ID_CONFLICT",
        message="The client order ID already exists with a different request payload.",
    )


def _replay_from_idempotency_record(
    db: Session,
    *,
    idempotency_record: IdempotencyRecord,
    fingerprint: str,
) -> CreateOrderResult:
    """Return a replay or its precise conflict after finding a winning key record."""
    if idempotency_record.request_fingerprint != fingerprint:
        raise _idempotency_key_reused_error()

    existing_order = db.get(Order, idempotency_record.order_id)
    if existing_order is None:
        raise APIError(
            status_code=500,
            code="INTERNAL_ERROR",
            message="The idempotency record references a missing order.",
        )
    return CreateOrderResult(
        order=_accepted_response(existing_order),
        idempotency_replayed=True,
    )


def _recover_after_create_integrity_error(
    db: Session,
    *,
    sales_rep_id: str,
    idempotency_key: str,
    fingerprint: str,
    client_order_id: str,
    now: datetime,
    original_error: IntegrityError,
) -> CreateOrderResult:
    """Resolve a concurrent unique-key race into the public idempotency contract."""
    db.rollback()

    # One retry allows a competing equivalent request to finish attaching the same
    # idempotency record before this request reads the durable winning state.
    for _ in range(2):
        idempotency_record = db.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.sales_rep_id == sales_rep_id,
                IdempotencyRecord.idempotency_key == idempotency_key,
            )
        )
        if idempotency_record is not None:
            if _ensure_aware(idempotency_record.expires_at) > now:
                return _replay_from_idempotency_record(
                    db,
                    idempotency_record=idempotency_record,
                    fingerprint=fingerprint,
                )
            db.delete(idempotency_record)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                continue

        equivalent_client_order = db.scalar(
            select(Order).where(
                Order.sales_rep_id == sales_rep_id,
                Order.client_order_id == client_order_id,
            )
        )
        if equivalent_client_order is None:
            raise APIError(
                status_code=500,
                code="INTERNAL_ERROR",
                message="The order could not be persisted safely.",
            ) from original_error
        if equivalent_client_order.request_fingerprint != fingerprint:
            raise _client_order_id_conflict_error()

        _record_idempotency_replay(
            db,
            sales_rep_id=sales_rep_id,
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            order=equivalent_client_order,
            now=now,
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue

        db.refresh(equivalent_client_order)
        return CreateOrderResult(
            order=_accepted_response(equivalent_client_order),
            idempotency_replayed=True,
        )

    raise APIError(
        status_code=500,
        code="INTERNAL_ERROR",
        message="The order could not be persisted safely.",
    ) from original_error


def create_order(
    db: Session,
    *,
    current_sales_rep: CurrentSalesRep,
    idempotency_key: UUID,
    order_data: OrderCreateReq,
) -> CreateOrderResult:
    """Persist an order and its durable outbox event in one transaction."""
    now = _now()
    sales_rep_id = current_sales_rep.sales_rep_id
    normalized_key = str(idempotency_key)
    fingerprint = _request_fingerprint(order_data)

    idempotency_record = db.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.sales_rep_id == sales_rep_id,
            IdempotencyRecord.idempotency_key == normalized_key,
        )
    )
    if idempotency_record is not None:
        if _ensure_aware(idempotency_record.expires_at) > now:
            return _replay_from_idempotency_record(
                db,
                idempotency_record=idempotency_record,
                fingerprint=fingerprint,
            )
        db.delete(idempotency_record)
        db.flush()

    equivalent_client_order = db.scalar(
        select(Order).where(
            Order.sales_rep_id == sales_rep_id,
            Order.client_order_id == order_data.client_order_id,
        )
    )
    if equivalent_client_order is not None:
        if equivalent_client_order.request_fingerprint != fingerprint:
            raise _client_order_id_conflict_error()
        _record_idempotency_replay(
            db,
            sales_rep_id=sales_rep_id,
            idempotency_key=normalized_key,
            fingerprint=fingerprint,
            order=equivalent_client_order,
            now=now,
        )
        try:
            db.commit()
        except IntegrityError as exc:
            return _recover_after_create_integrity_error(
                db,
                sales_rep_id=sales_rep_id,
                idempotency_key=normalized_key,
                fingerprint=fingerprint,
                client_order_id=order_data.client_order_id,
                now=now,
                original_error=exc,
            )
        db.refresh(equivalent_client_order)
        return CreateOrderResult(
            order=_accepted_response(equivalent_client_order),
            idempotency_replayed=True,
        )

    _validate_assignment_and_products(
        db,
        sales_rep_id=sales_rep_id,
        order_data=order_data,
    )

    order_id = uuid4()
    event_id = uuid4()
    order = Order(
        id=order_id,
        client_order_id=order_data.client_order_id,
        sales_rep_id=sales_rep_id,
        retailer_id=order_data.retailer_id,
        order_time=order_data.order_time.astimezone(timezone.utc),
        order_timezone_offset_minutes=_timezone_offset_minutes(order_data.order_time),
        received_at=now,
        declared_total_amount_vnd=order_data.declared_total_amount_vnd,
        status=OrderStatus.PENDING_FRAUD_CHECK.value,
        request_fingerprint=fingerprint,
    )
    db.add(order)
    try:
        # Persist the aggregate root before scalar-FK children are queued. These
        # child models do not all have ORM relationships that establish flush order.
        db.flush()
    except IntegrityError as exc:
        return _recover_after_create_integrity_error(
            db,
            sales_rep_id=sales_rep_id,
            idempotency_key=normalized_key,
            fingerprint=fingerprint,
            client_order_id=order_data.client_order_id,
            now=now,
            original_error=exc,
        )

    db.add_all(
        [
            OrderItemModel(
                id=uuid4(),
                order_id=order_id,
                product_sku=item.product_sku,
                quantity=item.quantity,
            )
            for item in order_data.items
        ]
    )
    db.add(
        OrderStatusHistory(
            id=uuid4(),
            order_id=order_id,
            from_status=None,
            to_status=OrderStatus.PENDING_FRAUD_CHECK.value,
            reason_code="ORDER_ACCEPTED",
            actor_type="SYSTEM",
            changed_at=now,
        )
    )
    _record_idempotency_replay(
        db,
        sales_rep_id=sales_rep_id,
        idempotency_key=normalized_key,
        fingerprint=fingerprint,
        order=order,
        now=now,
    )
    db.add(
        OutboxEvent(
            id=event_id,
            event_type="order.created.v1",
            aggregate_id=order_id,
            payload={
                "event_id": str(event_id),
                "event_type": "order.created.v1",
                "occurred_at": now.isoformat(),
                "correlation_id": None,
                "data": {"order_id": str(order_id)},
            },
            status=OutboxEventStatus.PENDING.value,
            attempt_count=0,
            available_at=now,
        )
    )

    try:
        db.commit()
    except IntegrityError as exc:
        return _recover_after_create_integrity_error(
            db,
            sales_rep_id=sales_rep_id,
            idempotency_key=normalized_key,
            fingerprint=fingerprint,
            client_order_id=order_data.client_order_id,
            now=now,
            original_error=exc,
        )

    db.refresh(order)
    return CreateOrderResult(order=_accepted_response(order), idempotency_replayed=False)


def get_order_detail(
    db: Session,
    *,
    current_sales_rep: CurrentSalesRep,
    order_id: UUID,
) -> OrderDetailResponse:
    """Return one order only when it belongs to the authenticated sale."""
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.assessments))
        .where(Order.id == order_id, Order.sales_rep_id == current_sales_rep.sales_rep_id)
    )
    if order is None:
        raise APIError(
            status_code=404,
            code="ORDER_NOT_FOUND",
            message="The requested order was not found.",
        )
    return _detail_response(order)


def list_orders(
    db: Session,
    *,
    current_sales_rep: CurrentSalesRep,
    status_filter: OrderStatus | None,
    retailer_id: str | None,
    page: int,
    page_size: int,
) -> OrderListResponse:
    """Return one page of orders owned by the authenticated sale."""
    filters = [Order.sales_rep_id == current_sales_rep.sales_rep_id]
    if status_filter is not None:
        filters.append(Order.status == status_filter.value)
    if retailer_id is not None:
        filters.append(Order.retailer_id == retailer_id)

    total_items = int(db.scalar(select(func.count()).select_from(Order).where(*filters)) or 0)
    orders = list(
        db.scalars(
            select(Order)
            .where(*filters)
            .order_by(Order.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    total_pages = (total_items + page_size - 1) // page_size if total_items else 0
    return OrderListResponse(
        items=[_list_item(order) for order in orders],
        page=page,
        page_size=page_size,
        total_items=total_items,
        total_pages=total_pages,
    )
