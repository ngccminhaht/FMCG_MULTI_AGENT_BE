"""Order lifecycle concepts for M1."""

from enum import Enum


class OrderStatus(str, Enum):
    """Allowed order statuses in the M1 state machine."""

    PENDING_FRAUD_CHECK = "PENDING_FRAUD_CHECK"
    APPROVED = "APPROVED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    REJECTED = "REJECTED"


class FraudDecision(str, Enum):
    """Final decisions emitted by a fraud evaluator."""

    APPROVED = "APPROVED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    REJECTED = "REJECTED"


class OutboxEventStatus(str, Enum):
    """Processing states for durable outbox events."""

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    PUBLISHED = "PUBLISHED"
    FAILED = "FAILED"
