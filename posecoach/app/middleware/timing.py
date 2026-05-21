import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.metrics import http_request_duration_seconds, http_requests_total


def _endpoint_label(request: Request) -> str:
    """Normalize the request path for low-cardinality Prometheus labels.

    Uses the matched route template (e.g. ``/api/v1/sessions/{id}``) when
    available; otherwise falls back to the raw path.
    """
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else request.url.path


class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        elapsed = time.perf_counter() - start
        response.headers["X-Process-Time"] = f"{elapsed * 1000:.2f}ms"

        endpoint = _endpoint_label(request)
        http_request_duration_seconds.labels(
            method=request.method, endpoint=endpoint
        ).observe(elapsed)
        http_requests_total.labels(
            method=request.method,
            endpoint=endpoint,
            status_code=str(response.status_code),
        ).inc()
        return response
