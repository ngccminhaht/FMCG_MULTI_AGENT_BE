"""Environment-backed application configuration."""

import os
from functools import lru_cache

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Settings(BaseModel):
    """Runtime settings loaded from process environment variables."""

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
    debug: bool = Field(
        default_factory=lambda: os.getenv("APP_DEBUG", "false").strip().lower()
        in {"1", "true", "yes", "on"}
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
    """Return the cached application settings."""
    return Settings()


settings = get_settings()
