"""Pydantic schemas for the order validation workflow."""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


Identifier = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]


class OrderStatus(str, Enum):
    """Supported states returned by the order validation workflow."""

    PENDING = "PENDING"
    APPROVED = "APPROVED"


class OrderItem(BaseModel):
    """A product line submitted by the SFA application."""

    model_config = ConfigDict(extra="forbid")

    product_sku: Identifier
    quantity: int = Field(gt=0)


class OrderCreateReq(BaseModel):
    """Payload submitted by a sales representative for a retailer."""

    model_config = ConfigDict(extra="forbid")

    sales_rep_id: Identifier
    retailer_id: Identifier
    order_time: datetime
    items: list[OrderItem] = Field(min_length=1)
    total_amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)


class OrderValidateRes(BaseModel):
    """Result after an order has passed through fraud-risk evaluation."""

    model_config = ConfigDict(extra="forbid")

    order_id: UUID
    risk_score: int = Field(ge=0, le=100)
    status: OrderStatus
    message: str = Field(min_length=1)
