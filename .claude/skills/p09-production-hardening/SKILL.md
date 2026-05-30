---
name: p09-production-hardening
description: PoseCoach P09 — Production hardening: rate limiting, security headers, NGINX config, error handling, and load testing. Auto-invoked when working on deployment, security, NGINX, rate limiting, or production readiness.
allowed-tools: Read, Write, Edit, Bash
---

# P09 — Production Hardening

## Goal
Harden the system for real-world use: rate limiting, graceful error handling, NGINX reverse
proxy config, and a load test confirming the system handles concurrent users.

## What Already Exists (P02 deliverables — do NOT recreate)
- `app/middleware/security_headers.py` — all 6 security headers already applied
- `app/middleware/request_timing.py` — request latency middleware already active
- Global exception handler in `app/main.py` — already returns `{"error": "...", "code": 500}`

## What P09 Adds
- `app/middleware/rate_limit.py` — Redis-backed rate limiter (doesn't exist yet)
- `nginx/nginx.conf` — production NGINX config (verify WebSocket upgrade headers)
- `scripts/load_test.py` — locust or k6 load test script
- Production `deploy/docker-compose.prod.yml`

## Security Headers (Already Present — Verify Only)
```python
# These should already be in app/middleware/security_headers.py
headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
}
```
Verify: `curl -I http://localhost:8000/health` — all 6 headers must appear.

## Rate Limiting (to implement)
- Auth endpoints: 10 requests/minute per IP
- Inference WebSocket: 1 concurrent connection per user
- Chatbot: 20 requests/minute per user
- Use Redis (`app.state.redis`) for distributed rate limiting
- Return `HTTP 429 Too Many Requests` when exceeded

## NGINX Config (nginx/nginx.conf)
- Reverse proxy: `/api/` → FastAPI, `/` → React build
- WebSocket upgrade headers **required** for `/ws/`:
  ```nginx
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  ```
- Gzip compression for static assets
- Client max body size: 10MB (for frame uploads)

## Error Handling (verify existing)
- No stack traces in prod responses — global handler returns `{"error": "message", "code": 500}`
- Graceful WebSocket disconnect (no 500 on client close)
- DB connection retry with exponential backoff on startup

## Load Test Target
```bash
# scripts/load_test.py — locust
# 10 concurrent WebSocket users, 60 seconds
# p95 inference latency < 100ms under load
# 0% error rate for auth and history endpoints
```

## Done Criteria
- [ ] `curl -I http://localhost:8000/health` shows all 6 security headers
- [ ] Rate limiting returns 429 on excess requests (test with k6 or curl loop)
- [ ] NGINX serves frontend + proxies `/api/` and `/ws/` correctly
- [ ] Load test passes: 10 concurrent users, 60s, p95 < 100ms
- [ ] No stack traces in error responses (test: send malformed request)

## Thesis Metric
- System performance under load (concurrent user test results)
- Security posture (header audit — all 6 present)
