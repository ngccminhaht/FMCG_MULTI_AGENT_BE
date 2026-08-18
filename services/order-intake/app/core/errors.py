"""Consistent API error types and FastAPI exception handlers."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

logger = logging.getLogger(__name__)


class APIError(Exception):
    """Expected application error that can be represented by the API contract."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: list[dict[str, str]] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or []
        super().__init__(message)


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _error_body(
    request: Request,
    *,
    code: str,
    message: str,
    details: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "details": details or [],
        }
    }
    request_id = _request_id(request)
    if request_id:
        body["error"]["request_id"] = request_id
    return body


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    """Convert expected domain/application errors to the contract envelope."""
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(
            request,
            code=exc.code,
            message=exc.message,
            details=exc.details,
        ),
    )


async def database_unavailable_handler(
    request: Request,
    exc: OperationalError,
) -> JSONResponse:
    """Return a retryable contract error when the transactional database is down."""
    logger.warning("Database unavailable while serving a request: %s", exc.__class__.__name__)
    return JSONResponse(
        status_code=503,
        content=_error_body(
            request,
            code="SERVICE_UNAVAILABLE",
            message="The service cannot accept orders at this time. Please retry.",
        ),
    )


async def validation_error_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """Normalize FastAPI validation errors without exposing framework internals."""
    details = [
        {
            "field": ".".join(str(part) for part in error["loc"] if part != "body"),
            "reason": error["type"],
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content=_error_body(
            request,
            code="VALIDATION_ERROR",
            message="Request validation failed.",
            details=details,
        ),
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Avoid leaking exception details while retaining server-side diagnostics."""
    logger.exception("Unhandled request failure", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=_error_body(
            request,
            code="INTERNAL_ERROR",
            message="An unexpected error occurred.",
        ),
    )
