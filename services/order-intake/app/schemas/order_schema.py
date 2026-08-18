"""Pydantic request and response schemas for M1 order APIs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.domain.order import FraudDecision, OrderStatus

Identifier = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]


class OrderItem(BaseModel):
    """A single product line submitted by the SFA client."""

    model_config = ConfigDict(extra="forbid")

    product_sku: Identifier
    quantity: int = Field(gt=0)


class OrderCreateReq(BaseModel):
    """Contract body for POST /api/v1/orders."""

    model_config = ConfigDict(extra="forbid")

    client_order_id: Identifier
    retailer_id: Identifier
    order_time: AwareDatetime
    items: list[OrderItem] = Field(min_length=1)
    declared_total_amount_vnd: int = Field(gt=0)

    @field_validator("items")
    @classmethod
    def validate_unique_product_skus(cls, items: list[OrderItem]) -> list[OrderItem]:
        """Require the SFA client to aggregate duplicate SKU rows before submit."""
        skus = [item.product_sku for item in items]
        if len(skus) != len(set(skus)):
            raise ValueError("Each product_sku may appear only once in an order")
        return items

    @model_validator(mode="after")
    def validate_order_time_not_too_far_in_future(self) -> "OrderCreateReq":
        """Allow offline submissions while rejecting clearly invalid future timestamps."""
        future_limit = datetime.now(timezone.utc) + timedelta(minutes=5)
        if self.order_time > future_limit:
            raise ValueError("order_time may not be more than 5 minutes in the future")
        return self


class FraudAssessmentSummary(BaseModel):
    """Latest fraud decision displayed to the SFA client."""

    model_config = ConfigDict(extra="forbid")

    risk_score: int = Field(ge=0, le=100)
    decision: FraudDecision
    reason_codes: list[str] = Field(min_length=1)
    evaluator_type: str = Field(min_length=1, max_length=100)
    evaluator_version: str = Field(min_length=1, max_length=100)
    assessed_at: AwareDatetime


class OrderAcceptedResponse(BaseModel):
    """Response returned after a durable async order acceptance."""

    model_config = ConfigDict(extra="forbid")

    order_id: UUID
    client_order_id: str
    status: OrderStatus
    created_at: AwareDatetime
    updated_at: AwareDatetime
    fraud_assessment: FraudAssessmentSummary | None = None


class OrderDetailResponse(OrderAcceptedResponse):
    """Full order representation for GET /api/v1/orders/{order_id}."""

    sales_rep_id: str
    retailer_id: str
    order_time: AwareDatetime
    items: list[OrderItem] = Field(min_length=1)
    declared_total_amount_vnd: int = Field(gt=0)


class OrderListItem(BaseModel):
    """Compact order representation for list responses."""

    model_config = ConfigDict(extra="forbid")

    order_id: UUID
    client_order_id: str
    retailer_id: str
    declared_total_amount_vnd: int = Field(gt=0)
    status: OrderStatus
    order_time: AwareDatetime
    updated_at: AwareDatetime


class OrderListResponse(BaseModel):
    """One page of orders owned by the authenticated sales representative."""

    model_config = ConfigDict(extra="forbid")

    items: list[OrderListItem]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total_items: int = Field(ge=0)
    total_pages: int = Field(ge=0)


class ErrorDetail(BaseModel):
    """A field-level reason included in a normalized API error."""

    model_config = ConfigDict(extra="forbid")

    field: str
    reason: str


class ErrorBody(BaseModel):
    """Stable error envelope contents shared by all documented failures."""

    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    details: list[ErrorDetail] = Field(default_factory=list)
    request_id: str | None = None


class ErrorResponse(BaseModel):
    """Normalized HTTP error response emitted by the API exception handlers."""

    model_config = ConfigDict(extra="forbid")

    error: ErrorBody
