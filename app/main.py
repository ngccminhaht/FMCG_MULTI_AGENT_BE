"""FastAPI application entry point."""

from fastapi import FastAPI

from app.api.v1.orders import router as orders_router
from app.core.config import settings


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
)
app.include_router(orders_router, prefix=settings.api_v1_prefix)
