"""Environment-backed application configuration."""

import os
from functools import lru_cache

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _env_bool(name: str, default: bool = False) -> bool:
    """Read a conventional boolean environment variable."""
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


class Settings(BaseModel):
    """Runtime settings for the local MVP backend."""

    model_config = ConfigDict(frozen=True, validate_default=True)

    app_name: str = Field(
        default_factory=lambda: os.getenv("APP_NAME", "FMCG Multi-Agent System"),
        min_length=1,
    )
    app_version: str = Field(
        default_factory=lambda: os.getenv("APP_VERSION", "0.1.0"),
        min_length=1,
    )
    api_v1_prefix: str = Field(
        default_factory=lambda: os.getenv("API_V1_PREFIX", "/api/v1"),
        min_length=1,
    )
    debug: bool = Field(default_factory=lambda: _env_bool("APP_DEBUG"))

    database_url: str = Field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL",
            "postgresql+psycopg://fmcg:fmcg@localhost:5432/fmcg_mvp",
        ),
        min_length=1,
    )
    database_echo: bool = Field(default_factory=lambda: _env_bool("DATABASE_ECHO"))

    dev_sales_token: str = Field(
        default_factory=lambda: os.getenv("DEV_SALES_TOKEN", "dev-hung-001"),
        min_length=1,
    )
    dev_sales_rep_id: str = Field(
        default_factory=lambda: os.getenv("DEV_SALES_REP_ID", "HUNG-001"),
        min_length=1,
    )
    idempotency_ttl_hours: int = Field(
        default_factory=lambda: int(os.getenv("IDEMPOTENCY_TTL_HOURS", "24")),
        ge=1,
        le=720,
    )
    outbox_max_attempts: int = Field(
        default_factory=lambda: int(os.getenv("OUTBOX_MAX_ATTEMPTS", "3")),
        ge=1,
        le=20,
    )
    worker_poll_interval_seconds: float = Field(
        default_factory=lambda: float(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "2")),
        gt=0,
        le=60,
    )

    @field_validator("api_v1_prefix")
    @classmethod
    def validate_api_v1_prefix(cls, value: str) -> str:
        """Normalize the prefix so routers can append paths safely."""
        normalized = value.strip()
        if not normalized.startswith("/"):
            raise ValueError("API_V1_PREFIX must start with '/'")
        return normalized.rstrip("/") or "/"


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()


settings = get_settings()
