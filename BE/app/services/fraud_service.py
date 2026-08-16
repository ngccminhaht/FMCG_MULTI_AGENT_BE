"""AI fraud-risk evaluation service."""

from typing import TypedDict

from app.schemas.order_schema import OrderCreateReq, OrderStatus


class FraudRiskResult(TypedDict):
    """Normalized result expected from the future AI integration."""

    risk_score: int
    status: OrderStatus


async def evaluate_fraud_risk(order_data: OrderCreateReq) -> FraudRiskResult:
    """Return a mock result until the external AI evaluator is integrated."""
    _ = order_data
    return {
        "risk_score": 15,
        "status": OrderStatus.APPROVED,
    }
