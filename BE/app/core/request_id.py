"""Request correlation middleware."""

from __future__ import annotations

import re
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Attach a safe request ID to request state and every HTTP response."""

    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        requested_id = request.headers.get("X-Request-Id", "")
        request_id = (
            requested_id
            if _REQUEST_ID_PATTERN.fullmatch(requested_id)
            else uuid4().hex
        )
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response
