"""Database-outbox worker for M1 fraud evaluation."""

from __future__ import annotations

import argparse
import logging
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import FraudAssessment, Order, OrderStatusHistory, OutboxEvent
from app.db.session import SessionLocal
from app.domain.order import FraudDecision, OrderStatus, OutboxEventStatus
from app.services.fraud_service import FraudRiskResult, evaluate_fraud_risk

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_aware(timestamp: datetime) -> datetime:
    return timestamp if timestamp.tzinfo is not None else timestamp.replace(tzinfo=timezone.utc)


def _reclaim_stale_processing_events(db: Session, now: datetime) -> None:
    """Make events claimable again after a worker crashes while holding a lease."""
    stale_before = now - timedelta(minutes=5)
    db.execute(
        update(OutboxEvent)
        .where(
            OutboxEvent.status == OutboxEventStatus.PROCESSING.value,
            OutboxEvent.locked_at < stale_before,
        )
        .values(
            status=OutboxEventStatus.PENDING.value,
            locked_at=None,
            available_at=now,
        )
    )


def _claim_next_event(db: Session, now: datetime) -> UUID | None:
    """Claim one pending event in a committed short transaction."""
    _reclaim_stale_processing_events(db, now)
    event = db.scalar(
        select(OutboxEvent)
        .where(
            OutboxEvent.status == OutboxEventStatus.PENDING.value,
            OutboxEvent.available_at <= now,
        )
        .order_by(OutboxEvent.available_at, OutboxEvent.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if event is None:
        db.commit()
        return None

    event.status = OutboxEventStatus.PROCESSING.value
    event.attempt_count += 1
    event.locked_at = now
    db.commit()
    return event.id


def _apply_assessment(
    db: Session,
    *,
    order: Order,
    result: FraudRiskResult,
    assessed_at: datetime,
) -> None:
    """Append assessment/history and apply a legal final M1 state transition."""
    if order.status != OrderStatus.PENDING_FRAUD_CHECK.value:
        return

    db.add(
        FraudAssessment(
            id=uuid4(),
            order_id=order.id,
            risk_score=result.risk_score,
            decision=result.decision.value,
            reason_codes=result.reason_codes,
            evaluator_type=result.evaluator_type,
            evaluator_version=result.evaluator_version,
            assessed_at=assessed_at,
        )
    )
    previous_status = order.status
    order.status = result.decision.value
    db.add(
        OrderStatusHistory(
            id=uuid4(),
            order_id=order.id,
            from_status=previous_status,
            to_status=result.decision.value,
            reason_code=result.reason_codes[0],
            actor_type="FRAUD_WORKER",
            changed_at=assessed_at,
        )
    )


def _handle_processing_failure(event_id: UUID, error: Exception) -> None:
    """Retry transient failure or move the order to safe review after max attempts."""
    with SessionLocal() as db:
        event = db.get(OutboxEvent, event_id)
        if event is None:
            return
        now = _now()
        event.last_error = str(error)[:1000]
        order = db.get(Order, event.aggregate_id)

        if event.attempt_count >= settings.outbox_max_attempts:
            if order is not None:
                _apply_assessment(
                    db,
                    order=order,
                    result=FraudRiskResult(
                        risk_score=100,
                        decision=FraudDecision.REVIEW_REQUIRED,
                        reason_codes=["FRAUD_EVALUATION_UNAVAILABLE"],
                    ),
                    assessed_at=now,
                )
            event.status = OutboxEventStatus.FAILED.value
            event.processed_at = now
            event.locked_at = None
        else:
            retry_delay_seconds = min(2**event.attempt_count, 60)
            event.status = OutboxEventStatus.PENDING.value
            event.available_at = now + timedelta(seconds=retry_delay_seconds)
            event.locked_at = None
        db.commit()


def _process_claimed_event(event_id: UUID) -> bool:
    """Process a single claimed order.created event and persist its final result."""
    try:
        with SessionLocal() as db:
            event = db.get(OutboxEvent, event_id)
            if event is None or event.status != OutboxEventStatus.PROCESSING.value:
                return False
            if event.event_type != "order.created.v1":
                raise ValueError(f"Unsupported outbox event type: {event.event_type}")

            order = db.get(Order, event.aggregate_id)
            if order is None:
                raise ValueError("Outbox event references a missing order")

            result = evaluate_fraud_risk(order)
            now = _now()
            _apply_assessment(db, order=order, result=result, assessed_at=now)
            event.status = OutboxEventStatus.PUBLISHED.value
            event.processed_at = now
            event.locked_at = None
            event.last_error = None
            db.commit()
            return True
    except Exception as exc:  # noqa: BLE001 - worker must persist failure state
        logger.exception("Fraud worker failed for event %s", event_id)
        _handle_processing_failure(event_id, exc)
        return False


def process_next_outbox_event() -> bool:
    """Claim and process at most one durable outbox event."""
    with SessionLocal() as db:
        event_id = _claim_next_event(db, _now())
    return event_id is not None and _process_claimed_event(event_id)


def process_pending_outbox_events(limit: int = 100) -> int:
    """Process up to limit claimed events and return the number handled successfully.

    A failed event is safely requeued (or terminally failed) by its own handler.
    It must not prevent other currently available events from being processed in
    the same worker poll.
    """
    processed = 0
    for _ in range(limit):
        with SessionLocal() as db:
            event_id = _claim_next_event(db, _now())
        if event_id is None:
            break
        if _process_claimed_event(event_id):
            processed += 1
    return processed


def main() -> None:
    """Run the worker once or as a local development loop."""
    parser = argparse.ArgumentParser(description="Process local M1 fraud outbox events")
    parser.add_argument("--once", action="store_true", help="Process currently available events once")
    parser.add_argument("--limit", type=int, default=100, help="Maximum events per poll")
    args = parser.parse_args()

    if args.once:
        processed = process_pending_outbox_events(limit=args.limit)
        print(f"Processed {processed} fraud outbox event(s).")
        return

    print("Fraud worker is polling. Press Ctrl+C to stop.")
    try:
        while True:
            processed = process_pending_outbox_events(limit=args.limit)
            if processed == 0:
                time.sleep(settings.worker_poll_interval_seconds)
    except KeyboardInterrupt:
        print("Fraud worker stopped.")


if __name__ == "__main__":
    main()
