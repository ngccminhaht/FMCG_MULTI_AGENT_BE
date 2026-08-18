"""FastAPI application entry point."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import OperationalError

from app.api.v1.orders import router as orders_router
from app.core.config import settings
from app.core.errors import (
    APIError,
    api_error_handler,
    database_unavailable_handler,
    unhandled_exception_handler,
    validation_error_handler,
)
from app.core.request_id import RequestIdMiddleware

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
)
app.add_middleware(RequestIdMiddleware)
app.add_exception_handler(APIError, api_error_handler)
app.add_exception_handler(OperationalError, database_unavailable_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)
app.include_router(orders_router, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["health"])
async def health_check(request: Request) -> dict[str, str]:
    """Return a lightweight process health signal for local orchestration."""
    return {
        "status": "ok",
        "request_id": getattr(request.state, "request_id", ""),
    }
