---
name: p09-production-hardening
description: PoseCoach P09 — Production hardening: rate limiting, security headers, NGINX config, error handling, and load testing. Auto-invoked when working on deployment, security, NGINX, rate limiting, or production readiness.
---

# P09 — Production Hardening

## Goal
Harden the system for real-world use: rate limiting, graceful error handling, NGINX reverse proxy config, and a load test confirming the system handles concurrent users.

## Done Criteria
- [ ] `curl -I http://localhost:8000/health` shows all 6 security headers
- [ ] Rate limiting returns 429 on excess requests
- [ ] NGINX serves frontend + proxies `/api/` and `/ws/` correctly
- [ ] Load test passes: 10 concurrent users, 60s, p95 < 100ms
- [ ] No stack traces in error responses
