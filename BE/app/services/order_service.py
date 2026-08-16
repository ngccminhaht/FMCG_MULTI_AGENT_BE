"""Order processing and persistence workflow."""

from typing import Any
from uuid import UUID, uuid4

from app.schemas.order_schema import OrderCreateReq, OrderStatus, OrderValidateRes
from app.services.fraud_service import evaluate_fraud_risk


_ORDER_STORE: dict[UUID, dict[str, Any]] = {}


async def process_order(order_data: OrderCreateReq) -> OrderValidateRes:
    """Store an order, evaluate fraud risk, and persist its final status."""
    order_id = uuid4()
    _ORDER_STORE[order_id] = {
        "order": order_data.model_dump(mode="json"),
        "status": OrderStatus.PENDING,
        "risk_score": None,
    }

    fraud_result = await evaluate_fraud_risk(order_data)
    final_status = OrderStatus(fraud_result["status"])
    risk_score = fraud_result["risk_score"]

    _ORDER_STORE[order_id].update(
        status=final_status,
        risk_score=risk_score,
    )

    message = (
        "Order approved after fraud-risk evaluation."
        if final_status is OrderStatus.APPROVED
        else "Order is pending fraud-risk evaluation."
    )
    return OrderValidateRes(
        order_id=order_id,
        risk_score=risk_score,
        status=final_status,
        message=message,
    )
