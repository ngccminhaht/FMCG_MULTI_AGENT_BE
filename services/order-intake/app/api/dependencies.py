"""Reusable FastAPI dependencies for the local MVP."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.errors import APIError

local_bearer_auth = HTTPBearer(
    auto_error=False,
    scheme_name="bearerAuth",
    bearerFormat="opaque",
    description="Local MVP token: Bearer dev-hung-001",
)


@dataclass(frozen=True)
class CurrentSalesRep:
    """Authenticated caller identity available to order endpoints."""

    sales_rep_id: str


async def get_current_sales_rep(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(local_bearer_auth),
    ],
) -> CurrentSalesRep:
    """Validate the local bearer token and return the server-side identity.

    This is intentionally a local adapter. A future production adapter can validate
    an SFA/JWT token without changing endpoint request bodies or service ownership.
    """
    if credentials is None or credentials.credentials != settings.dev_sales_token:
        raise APIError(
            status_code=401,
            code="UNAUTHENTICATED",
            message="Authentication is required.",
        )
    return CurrentSalesRep(sales_rep_id=settings.dev_sales_rep_id)
