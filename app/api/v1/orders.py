"""Order API endpoints."""

from fastapi import APIRouter

from app.schemas.order_schema import OrderCreateReq, OrderValidateRes
from app.services.order_service import process_order


router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("", response_model=OrderValidateRes)
async def create_order(order_data: OrderCreateReq) -> OrderValidateRes:
    """Receive an SFA order and run the validation workflow."""
    return await process_order(order_data)
