"""Order API endpoints for the local M1 contract."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentSalesRep, get_current_sales_rep
from app.db.session import get_db
from app.domain.order import OrderStatus
from app.schemas.order_schema import (
    ErrorResponse,
    OrderAcceptedResponse,
    OrderCreateReq,
    OrderDetailResponse,
    OrderListResponse,
)
from app.services.order_service import create_order, get_order_detail, list_orders

router = APIRouter(prefix="/orders", tags=["Orders"])

_ERROR_RESPONSE = {"model": ErrorResponse}

_CREATE_ORDER_RESPONSES = {
    status.HTTP_202_ACCEPTED: {
        "description": "Order has been persisted and is awaiting fraud evaluation.",
        "headers": {
            "Location": {
                "description": "Relative URI of the newly accepted order.",
                "schema": {"type": "string"},
            },
            "Idempotency-Replayed": {
                "description": "True when this response is a successful replay of an earlier request.",
                "schema": {"type": "boolean"},
            },
        },
    },
    status.HTTP_401_UNAUTHORIZED: {
        **_ERROR_RESPONSE,
        "description": "Authentication is missing, invalid, or expired.",
    },
    status.HTTP_403_FORBIDDEN: {
        **_ERROR_RESPONSE,
        "description": "The authenticated sales representative is not assigned to the retailer.",
    },
    status.HTTP_409_CONFLICT: {
        **_ERROR_RESPONSE,
        "description": "An idempotency or client-order identifier conflict occurred.",
    },
    status.HTTP_422_UNPROCESSABLE_ENTITY: {
        **_ERROR_RESPONSE,
        "description": "Request path, header, body, or business validation failed.",
    },
    status.HTTP_500_INTERNAL_SERVER_ERROR: {
        **_ERROR_RESPONSE,
        "description": "An unexpected error occurred.",
    },
    status.HTTP_503_SERVICE_UNAVAILABLE: {
        **_ERROR_RESPONSE,
        "description": "A dependency needed to safely accept the order is unavailable.",
    },
}

_LIST_ORDER_RESPONSES = {
    status.HTTP_401_UNAUTHORIZED: {
        **_ERROR_RESPONSE,
        "description": "Authentication is missing, invalid, or expired.",
    },
    status.HTTP_422_UNPROCESSABLE_ENTITY: {
        **_ERROR_RESPONSE,
        "description": "Request path or query validation failed.",
    },
    status.HTTP_500_INTERNAL_SERVER_ERROR: {
        **_ERROR_RESPONSE,
        "description": "An unexpected error occurred.",
    },
}

_GET_ORDER_RESPONSES = {
    status.HTTP_401_UNAUTHORIZED: {
        **_ERROR_RESPONSE,
        "description": "Authentication is missing, invalid, or expired.",
    },
    status.HTTP_404_NOT_FOUND: {
        **_ERROR_RESPONSE,
        "description": "The order does not exist or is not visible to the caller.",
    },
    status.HTTP_422_UNPROCESSABLE_ENTITY: {
        **_ERROR_RESPONSE,
        "description": "Request path validation failed.",
    },
    status.HTTP_500_INTERNAL_SERVER_ERROR: {
        **_ERROR_RESPONSE,
        "description": "An unexpected error occurred.",
    },
}


@router.post(
    "",
    response_model=OrderAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    responses=_CREATE_ORDER_RESPONSES,
)
def create_order_endpoint(
    order_data: OrderCreateReq,
    response: Response,
    idempotency_key: Annotated[UUID, Header(alias="Idempotency-Key")],
    current_sales_rep: Annotated[CurrentSalesRep, Depends(get_current_sales_rep)],
    db: Annotated[Session, Depends(get_db)],
) -> OrderAcceptedResponse:
    """Persist an order and return its initial async fraud-check state."""
    result = create_order(
        db,
        current_sales_rep=current_sales_rep,
        idempotency_key=idempotency_key,
        order_data=order_data,
    )
    response.headers["Location"] = f"/api/v1/orders/{result.order.order_id}"
    response.headers["Idempotency-Replayed"] = str(result.idempotency_replayed).lower()
    return result.order


@router.get("", response_model=OrderListResponse, responses=_LIST_ORDER_RESPONSES)
def list_orders_endpoint(
    current_sales_rep: Annotated[CurrentSalesRep, Depends(get_current_sales_rep)],
    db: Annotated[Session, Depends(get_db)],
    status_filter: Annotated[OrderStatus | None, Query(alias="status")] = None,
    retailer_id: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> OrderListResponse:
    """List orders owned by the authenticated sales representative."""
    return list_orders(
        db,
        current_sales_rep=current_sales_rep,
        status_filter=status_filter,
        retailer_id=retailer_id,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{order_id}",
    response_model=OrderDetailResponse,
    responses=_GET_ORDER_RESPONSES,
)
def get_order_endpoint(
    order_id: UUID,
    current_sales_rep: Annotated[CurrentSalesRep, Depends(get_current_sales_rep)],
    db: Annotated[Session, Depends(get_db)],
) -> OrderDetailResponse:
    """Return one caller-owned order and its latest fraud assessment."""
    return get_order_detail(
        db,
        current_sales_rep=current_sales_rep,
        order_id=order_id,
    )
