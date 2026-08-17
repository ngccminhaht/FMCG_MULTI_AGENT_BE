"""Deterministic local fraud evaluator used by the M1 outbox worker."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.db.models import Order
from app.domain.order import FraudDecision


@dataclass(frozen=True)
class FraudRiskResult:
    """Normalized evaluator output persisted as a FraudAssessment."""

    risk_score: int
    decision: FraudDecision
    reason_codes: list[str]
    evaluator_type: str = "mock_rule_engine"
    evaluator_version: str = "m1-0.1"


def _ensure_aware(timestamp: datetime) -> datetime:
    """Normalize SQLite/local timestamps for the worker's time calculations."""
    return timestamp if timestamp.tzinfo is not None else timestamp.replace(tzinfo=timezone.utc)


def _client_local_order_time(order: Order) -> datetime:
    """Reconstruct client-local time from UTC storage plus original offset."""
    utc_order_time = _ensure_aware(order.order_time).astimezone(timezone.utc)
    return utc_order_time + timedelta(minutes=order.order_timezone_offset_minutes)


def evaluate_fraud_risk(order: Order) -> FraudRiskResult:
    """Evaluate stable local rules; replace this adapter with AI in a later phase.

    Rule order is deliberate and matches the local baseline document.
    """
    local_order_time = _client_local_order_time(order)
    if local_order_time.hour >= 22 or local_order_time.hour < 5:
        return FraudRiskResult(
            risk_score=75,
            decision=FraudDecision.REVIEW_REQUIRED,
            reason_codes=["OUTSIDE_STANDARD_ORDER_HOURS"],
        )
    if order.declared_total_amount_vnd >= 20_000_000:
        return FraudRiskResult(
            risk_score=95,
            decision=FraudDecision.REJECTED,
            reason_codes=["AMOUNT_ABOVE_REJECTION_THRESHOLD"],
        )
    if order.declared_total_amount_vnd >= 5_000_000:
        return FraudRiskResult(
            risk_score=60,
            decision=FraudDecision.REVIEW_REQUIRED,
            reason_codes=["AMOUNT_ABOVE_REVIEW_THRESHOLD"],
        )
    return FraudRiskResult(
        risk_score=15,
        decision=FraudDecision.APPROVED,
        reason_codes=["MOCK_LOW_RISK"],
    )
