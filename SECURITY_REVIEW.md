# PoseCoach / GymVision — Security Audit

**Date:** 2026-08-07
**Commit audited:** `e4415ff` (branch `chore/eval-01-corpus-scaffold`)
**Scope:** full working tree (557 tracked files) + all 225 commits of git history across every ref, including the Hugging Face Space remote.
**Audit type:** read-only. No file was modified; no fix was applied.

---

## 1. Project map

### Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI 0.115 / Python 3.11, uvicorn, SQLAlchemy 2.0 async ORM, Alembic |
| Data | PostgreSQL (asyncpg), Redis (cache + WS connection guard), ChromaDB (RAG vectors) |
| CV | YOLO26-Pose via direct ONNX Runtime (`OnnxPoseSession`), PIL/numpy decode |
| LLM | Gemini 3.5 Flash (`google-genai`), Qwen 2.5-VL via OpenRouter, Tavily web fallback |
| Frontend | React 18 + TypeScript + Vite + Tailwind, PWA. **Not Next.js** — no SSR, no `NEXT_PUBLIC_` surface |
| Auth | JWT HS256 in httpOnly cookies, bcrypt passwords, refresh-token rotation |

### Deployment topology (verified live)

```
  user browser
        │
        ├─ https://<vercel-domain>/*  ──308 redirect──►  ashwintaibu-posecoach.hf.space
        │      (frontend/vercel.json:2-8 — Vercel is a pure redirect shim,
        │       it hosts no code and holds no secrets)
        │
        └─ https://ashwintaibu-posecoach.hf.space
                 │
                 └─ HF Space (Docker SDK, app_port 8000) — SAME ORIGIN for everything:
                       /                 → React SPA served by app/static_spa.py
                       /api/v1/*         → FastAPI routers
                       /ws/inference     → WebSocket pose inference
                       /docs, /openapi.json → FastAPI docs  ⚠ publicly reachable
                       → Postgres (managed), Redis, ChromaDB
```

**P30 collapsed this to a same-origin deploy.** The Dockerfile (`Dockerfile:8-17,58`) builds the SPA in stage 1 with no `VITE_API_URL`, so the client uses relative paths, and `app/static_spa.py` mounts the build. Consequence: cross-origin CORS and `SameSite=None` cookies — the classic risk surface for a split Vercel/HF deploy — are **not** in play here. `.env.example:55-58` documents `COOKIE_SAMESITE=lax` as the production value.

**Hugging Face Space visibility: PUBLIC — confirmed.** An unauthenticated fetch of `https://huggingface.co/spaces/Ashwintaibu/posecoach/raw/main/README.md` returns the file. The Space repo and its **entire git history** are world-readable.

### Entry points

| Kind | Route | Auth |
|---|---|---|
| WebSocket | `/ws/inference` | **Optional** — anonymous allowed, no session persisted |
| SSE | `POST /api/v1/chat/stream` | **None** |
| Public | `GET /api/v1/model/pose.onnx`, `/health`, `/health/deep`, `/docs`, `/openapi.json` | None |
| Auth | `/api/v1/auth/{register,login,refresh,logout,me,account}` | mixed (by design) |
| Recovery | `/api/v1/auth/{forgot-password,forgot-username,reset-password}` | None (by design) |
| Protected | all of `/api/v1/{history,workouts,nutrition}/*` | `Depends(get_current_user)` on every route |
| Ops | `GET /metrics` | Bearer token; 404s when `METRICS_TOKEN` unset (fail-closed) |
| Background | RAG index build + exercise-catalog seed, both in lifespan (`app/main.py:157,161`) |

### Authentication & user-data flow

Register/login → bcrypt verify (`app/auth/security.py:39-49`) → access JWT (15 min) + refresh JWT (30 d) issued as httpOnly cookies. The refresh cookie is path-scoped to `/api/v1/auth/refresh` (`app/api/v1/auth.py:42,54`) so it never rides along with normal requests. Only the SHA-256 hash of the refresh token is persisted (`app/models.py:90`); refresh rotates and revokes (`auth.py:144`). The WebSocket resolves the same cookie optionally (`ws_inference.py:152,182`) and only then creates a `WorkoutSession` row. Every per-user read/write filters on `user_id`; nested resources join up to the owning `workout_logs.user_id`.

---

## 2. Findings

**2 High · 6 Medium · 11 Low · 0 Critical**

---

### H-1 — `/api/v1/chat/stream` is unauthenticated and accepts an unbounded image, allowing LLM quota and billing drain

**Severity: High** — a publicly deployed, unauthenticated endpoint that spends the owner's paid OpenRouter/Gemini/Tavily quota, with the only control being a per-IP limit that rotating IPs defeat.
**Category:** OWASP API4:2023 Unrestricted Resource Consumption · CWE-770 (Allocation Without Limits) · CWE-306 (Missing Authentication for Critical Function)
**Files:** `app/api/v1/chat.py:186-195`, `app/api/v1/chat.py:439-451`, `app/rate_limit.py:24,30`

```python
# app/api/v1/chat.py:186-195
class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    exercise: str | None = Field(default=None, max_length=32)
    frame: str | None = Field(default=None, description="Base64 JPEG snapshot (optional)")   # ← no max_length
    history: list[HistoryMessage] | None = Field(default=None, max_length=10, ...)

# app/api/v1/chat.py:439-441 — note: no Depends(get_current_user)
@router.post("/stream")
@limiter.limit(CHAT_RATE_LIMIT)
async def chat_stream(request: Request, payload: ChatRequest) -> StreamingResponse:
```

Every other field is bounded. `frame` is not — and its mere presence forces the expensive multimodal path: `chat_router.route(payload.query, has_frame=True)` returns `"qwen"` unconditionally (`app/chatbot/router.py:43-44`), which forwards the blob to OpenRouter as a `data:image/jpeg;base64,...` URL (`app/chatbot/qwen_client.py:53`). Contrast the WebSocket, which does cap frames at `MAX_FRAME_BYTES = 512 * 1024` (`ws_inference.py:108,277-280`) — the chat path simply never got the same guard.

Rate limiting is `10/minute` keyed by `get_remote_address` (`rate_limit.py:24,30`), i.e. per source IP with no per-account or global budget.

**Attack scenario.** An attacker reads `https://ashwintaibu-posecoach.hf.space/openapi.json` (public — see L-1), finds `POST /api/v1/chat/stream`, and scripts it from a rotating residential-proxy pool. Each request carries a 20 MB base64 image and forces a Qwen-2.5-VL-72B vision call. A few hundred requests/minute exhausts the OpenRouter credit balance and the Gemini free-tier quota within the hour; legitimate users then get `build_smart_fallback()` canned text instead of coaching. The same requests also drive Tavily searches through the speculative-search path (`chat.py:254-256`). No account is needed, nothing is logged that identifies the attacker beyond an IP, and each request holds an uploaded blob in server memory (see M-1).

**Fix.**

1. Bound the frame, matching the WebSocket's existing limit:

```python
# app/api/v1/chat.py
MAX_FRAME_B64_CHARS = 512 * 1024   # mirrors ws_inference.MAX_FRAME_BYTES

class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    exercise: str | None = Field(default=None, max_length=32)
    frame: str | None = Field(
        default=None, max_length=MAX_FRAME_B64_CHARS,
        description="Base64 JPEG snapshot (optional)",
    )
    history: list[HistoryMessage] | None = Field(default=None, max_length=10, ...)
```

2. Require authentication for the vision path at minimum — it is the one that costs real money. Anonymous text chat can stay if that is a product requirement:

```python
@router.post("/stream")
@limiter.limit(CHAT_RATE_LIMIT)
async def chat_stream(
    request: Request,
    payload: ChatRequest,
    user: User | None = Depends(get_optional_user),
) -> StreamingResponse:
    if payload.frame and user is None:
        raise HTTPException(status_code=401, detail="sign in to use visual coaching")
```

3. Add a global daily provider budget (a Redis `INCR` with a 24 h TTL checked before the LLM call) so no combination of IPs can exceed a spend ceiling. Rate-limiting alone cannot bound cost.

---

### H-2 — Password-reset mail defaults to the console backend, writing raw reset tokens and user emails into production logs

**Severity: High** — the default configuration turns the log stream into a full account-takeover oracle for a live app with real users, and directly violates the project's own `privacy-and-thesis.md` rule against logging tokens or PII.
**Category:** OWASP A09:2021 Security Logging Failures · CWE-532 (Insertion of Sensitive Information into Log File) · CWE-640 (Weak Password Recovery Mechanism)
**Files:** `app/mail/mailer.py:32-34`, `app/mail/mailer.py:58-66`, `app/api/v1/auth_recovery.py:45,61-63,112`

```python
# app/mail/mailer.py:32-34
def _backend() -> str:
    """Return the configured mail backend name (``console`` by default)."""
    return os.environ.get("MAIL_BACKEND", "console").strip().lower()   # ← fails OPEN to console

# app/mail/mailer.py:58-66
async def _deliver(to: str, subject: str, body: str, event: str) -> None:
    if _backend() == "smtp":
        ...
        logger.info("mail_sent", backend="smtp", event_name=event)
        return
    # Dev console transport — intentionally logs the link so it's copyable.
    logger.info("mail_console", backend="console", event_name=event, to=to, body=body)
```

`body` is the message built at `auth_recovery.py`/`mailer.py:71-75`, which embeds `_reset_url(raw_token)` — the **raw, unhashed, single-use reset token** (`auth_recovery.py:61-63,102,112`). The console branch also logs the recipient's email address (`to=to`).

The design elsewhere is careful — `secrets.token_urlsafe(32)`, SHA-256 hash at rest, single-use `used_at`, 20-minute TTL, enumeration-safe generic responses. All of that is undone if `MAIL_BACKEND` is not explicitly set to `smtp` in the deployed environment, because the token is emitted in cleartext to stdout.

**This code is live.** `git ls-tree hf/main` confirms `app/api/v1/auth_recovery.py` and `app/mail/mailer.py` are on the deployed Space ref, and `/openapi.json` on the running Space lists `POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password`. `CLAUDE.local.md` records "SMTP env still pending", and `FRONTEND_BASE_URL` also defaults to `http://localhost:5173` (`auth_recovery.py:45`) — a reset link pointing at localhost is a strong signal the recovery env vars were never configured on the Space.

**Attack scenario.** Anyone who can read the Space's runtime logs — a collaborator added to the Space, anyone who obtains the HF account session, or a future log-shipping integration — submits `POST /api/v1/auth/forgot-password` with a victim's email, reads the `mail_console` line, extracts the token from the URL, and calls `POST /api/v1/auth/reset-password` within 20 minutes. Full account takeover, no password needed. Separately, every recovery request permanently associates a real user email with a log line, which is a GDPR problem independent of the takeover.

**Fix.** Make the insecure transport impossible to select by accident in a non-development environment:

```python
# app/mail/mailer.py
def _backend() -> str:
    """Return the mail backend; the console transport is development-only."""
    backend = os.environ.get("MAIL_BACKEND", "console").strip().lower()
    if backend == "console" and os.environ.get("ENVIRONMENT", "development") != "development":
        raise RuntimeError(
            "MAIL_BACKEND=console logs raw reset tokens and is forbidden outside development; "
            "set MAIL_BACKEND=smtp and the SMTP_* vars."
        )
    return backend
```

and drop the sensitive fields even from the dev line (`body` minus the token, or log only the token's hash prefix).

**Rotation / cleanup required at the provider:**
- Any reset token already written to the Space logs must be treated as compromised. They are single-use with a 20-minute TTL, so `DELETE FROM password_reset_tokens;` invalidates every outstanding one.
- Purge or restart the Space to clear the existing log buffer, and set `MAIL_BACKEND=smtp`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `FRONTEND_BASE_URL=https://ashwintaibu-posecoach.hf.space` as HF Space **secrets** (not repo variables) before the recovery flow is used again.

---

### M-1 — No request body size limit anywhere in the stack

**Severity: Medium** — unauthenticated memory exhaustion on a 2-vCPU Space; the amplifier that makes H-1 a denial-of-service and not just a billing problem.
**Category:** CWE-770 (Allocation of Resources Without Limits) · OWASP API4:2023
**Files:** `Dockerfile:79`, `app/main.py:182-207`, `deploy/docker-compose.prod.yml:36-39`

```dockerfile
# Dockerfile:79 — the production entrypoint the HF Space actually runs
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
```

The Space runs uvicorn directly. `nginx/nginx.conf` (which would have imposed the 1 MB `client_max_body_size` default) is only used by `deploy/docker-compose.prod.yml`, a path that is **not** the live deployment. uvicorn imposes no body limit, and no ASGI middleware in `app/main.py:193-207` checks `Content-Length`. Starlette buffers the full body before Pydantic ever sees the field-level `max_length`, so even the H-1 fix does not prevent the allocation — it only rejects it after the fact.

**Attack scenario.** `POST /api/v1/chat/stream` with a 500 MB JSON body. The request is buffered in memory before validation; `--workers 1` means one such request stalls the entire app. Ten concurrent requests OOM-kill the container. Rate limiting does not help: slowapi evaluates its limit inside the route, after the body is read.

**Fix.** Reject oversized bodies at the ASGI edge, before buffering:

```python
# app/middleware/body_limit.py
MAX_BODY_BYTES = 1 * 1024 * 1024   # 1 MB — the largest legitimate payload is a chat frame

class BodyLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        raw = request.headers.get("content-length")
        if raw and raw.isdigit() and int(raw) > MAX_BODY_BYTES:
            return JSONResponse(status_code=413, content={"detail": "request body too large"})
        return await call_next(request)
```

Register it in `app/main.py` alongside the other middleware. A chunked request without `Content-Length` still slips past a header check, so pair this with a platform-level cap if one becomes available.

---

### M-2 — CSP allows `'unsafe-inline'` scripts on a page that holds camera permission

**Severity: Medium** — no XSS sink exists today, but this is the one control that would contain one, and the blast radius here includes the user's camera.
**Category:** OWASP A05:2021 Security Misconfiguration · CWE-1021 · CWE-693 (Protection Mechanism Failure)
**File:** `app/middleware/security_headers.py:17,21-32`

```python
response.headers["Permissions-Policy"] = "camera=self, microphone=(), geolocation=()"
...
response.headers["Content-Security-Policy"] = (
    "default-src 'self'; "
    "connect-src 'self' ws: wss:; "
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; "   # ← 'unsafe-inline' negates script CSP
    ...
)
```

`'wasm-unsafe-eval'` is correctly scoped and justified (onnxruntime-web needs it, and it permits WASM compilation only, not JS `eval`). `'unsafe-inline'` is the problem: it permits any injected `<script>` to execute, which is precisely what CSP exists to stop. Because this is a same-origin deploy, an inline script inherits the page's `camera=self` grant and can call `getUserMedia()` and stream frames to an attacker-controlled endpoint — `connect-src` allows any `ws:`/`wss:` destination, so exfiltration is unconstrained too.

Also note `X-XSS-Protection: 1; mode=block` (line 15) is a dead header — removed from all modern browsers, and historically a vulnerability source itself. Harmless, but it should not be mistaken for coverage.

**Attack scenario.** A future feature renders any user-controlled string as HTML (a workout note, a custom exercise name, a chat citation) — the CSP that should have blocked the resulting injection instead allows it, and the payload silently captures webcam frames.

**Fix.** Vite emits no inline scripts by default, so `'unsafe-inline'` can most likely be dropped outright. Verify with `grep -c "<script>" static/index.html` after a build; if a small inline bootstrap exists, hash it and allow the hash rather than all inline script. Tighten `connect-src` to the deploy origin:

```python
"script-src 'self' 'wasm-unsafe-eval'; "
"connect-src 'self'; "          # same-origin WS is covered by 'self'
```

and delete the `X-XSS-Protection` line.

---

### M-3 — WebSocket endpoint performs no Origin validation

**Severity: Medium** — currently defanged by the `SameSite=lax` cookie default, but that default lives in a single env var that this project has previously set to `none`, so the safety margin is one config change wide.
**Category:** CWE-1385 (Missing Origin Validation in WebSockets) · OWASP A01:2021
**Files:** `app/api/v1/ws_inference.py:123-124,139,152`, `app/auth/deps.py:20-36`

```python
@router.websocket("/ws/inference")
async def ws_inference(websocket: WebSocket) -> None:
    await websocket.accept()          # ← accepts before any Origin check
    ...
    access_token = websocket.cookies.get(ACCESS_COOKIE)   # ← cookie honoured regardless of origin
```

`CORSMiddleware` (`app/main.py:197-203`) does not apply to WebSocket handshakes — Starlette's CORS middleware only handles HTTP scope. Nothing else inspects the `Origin` header, so any website can open a socket to this endpoint.

The mitigation is indirect: `_resolve_samesite()` defaults `COOKIE_SAMESITE` to `lax` (`deps.py:28`), and a WebSocket handshake from a third-party page is not a top-level navigation, so Lax cookies are withheld and the hijacked socket is anonymous. That mitigation disappears entirely if `COOKIE_SAMESITE=none` is ever set — which the code explicitly still supports (`deps.py:29-32`) and which the deploy history shows was the correct value during the cross-origin Vercel→HF era, before P30.

**Attack scenario (if `COOKIE_SAMESITE=none` on the live Space).** A victim who is signed in visits `evil.com`, which opens `wss://ashwintaibu-posecoach.hf.space/ws/inference`. The browser attaches the victim's `access_token`; the server resolves the user and creates a `WorkoutSession` row under their identity (`ws_inference.py:409-419`). The attacker streams synthetic frames, polluting the victim's workout history and the adaptive-coach recommendations derived from it, and consumes the victim's one-socket-per-user Redis guard (`ws_inference.py:243`) so their real session is rejected as a "duplicate connection".

**Fix.** Validate the origin before `accept()`, reusing the CORS allowlist:

```python
_ALLOWED_WS_ORIGINS = frozenset(
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()
)

@router.websocket("/ws/inference")
async def ws_inference(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    # Same-origin deploy: the SPA's own Origin is the Space URL. Allow a missing
    # Origin (non-browser clients cannot ride a victim's cookies anyway).
    if origin is not None and origin not in _ALLOWED_WS_ORIGINS:
        await websocket.close(code=1008)
        return
    await websocket.accept()
```

Add the Space URL to `ALLOWED_ORIGINS` on the Space so this stays consistent with the HTTP allowlist.

---

### M-4 — Decompression-bomb exposure in the pose frame decoder

**Severity: Medium** — unauthenticated (the WebSocket allows anonymous connections), and a single request can allocate hundreds of MB on a small Space.
**Category:** CWE-409 (Improper Handling of Highly-Compressed Data) · CWE-400
**Files:** `app/inference/runner.py:83-101`, `app/api/v1/ws_inference.py:108`

```python
def _decode_frame(frame_b64: str, size: int) -> tuple[npt.NDArray[np.uint8], LetterboxMeta]:
    raw = base64.b64decode(frame_b64)
    img = Image.open(BytesIO(raw)).convert("RGB")     # ← no format allowlist, no pixel budget
    w0, h0 = img.size
    ...
    resized = img.resize((new_w, new_h), Image.Resampling.BILINEAR)
```

`MAX_FRAME_BYTES = 512 * 1024` bounds the *compressed* input, not the *decoded* pixel count. Pillow's built-in `MAX_IMAGE_PIXELS` (~89 M) only raises `DecompressionBombError` above **2×** that threshold — between 89 M and 178 M pixels it emits a warning and proceeds. A ~300 KB JPEG of a flat colour easily encodes 10000×10000 = 100 M pixels, landing squarely in the warn-and-proceed band: `.convert("RGB")` then allocates ~300 MB, and `.resize()` allocates again.

`Image.open` also accepts any format Pillow supports, not just JPEG, widening the decoder attack surface beyond what the protocol needs. `base64.b64decode` is called without `validate=True`, so malformed input is silently coerced rather than rejected.

**Attack scenario.** An attacker opens the maximum 3 anonymous sockets from each of a handful of IPs (`MAX_ANON_CONNS_PER_IP = 3`, `MAX_WS_CONNECTIONS = 64`) and streams 100-megapixel bombs at 15 fps. The `ThreadPoolExecutor(max_workers=2)` (`main.py:139`) saturates immediately and the container OOMs. Legitimate users see "server at capacity".

**Fix.**

```python
# app/inference/runner.py
_MAX_DECODED_PIXELS = 4096 * 4096   # far above any legitimate capture profile
_ALLOWED_FORMATS = frozenset({"JPEG", "MPO"})

def _decode_frame(frame_b64: str, size: int) -> tuple[npt.NDArray[np.uint8], LetterboxMeta]:
    raw = base64.b64decode(frame_b64, validate=True)
    img = Image.open(BytesIO(raw))
    if img.format not in _ALLOWED_FORMATS:
        raise ValueError(f"unsupported frame format {img.format!r}")
    w0, h0 = img.size                       # available before decode
    if w0 * h0 > _MAX_DECODED_PIXELS:
        raise ValueError(f"frame too large: {w0}x{h0}")
    img = img.convert("RGB")
    ...
```

`run_inference` already wraps the call in `try/except` and returns `None` (`runner.py:173-179`), so a raised `ValueError` degrades to the existing "no person detected" response with no further change.

---

### M-5 — `python-jose==3.3.0` sits in the JWT verification path with published CVEs and no maintenance

**Severity: Medium** — the specific published exploits do not appear reachable given how this app calls the library, but it is unmaintained crypto code on the authentication hot path.
**Category:** OWASP A06:2021 Vulnerable and Outdated Components · CWE-1395
**Files:** `requirements.txt:20`, `app/auth/security.py:18,60,89`

`pip-audit` reports 5 advisories against the pinned version:

| ID | Issue | Fixed in |
|---|---|---|
| PYSEC-2024-232 (CVE-2024-33663) | Algorithm confusion with OpenSSH ECDSA and other key formats | 3.4.0 |
| PYSEC-2024-233 (CVE-2024-33664) | "JWT bomb" — DoS via high-compression-ratio JWE | 3.4.0 |
| PYSEC-2025-185 | `jwe.decrypt` decompression DoS | *no fix* |

**Reachability assessment — the honest picture.** Both headline CVEs look **not exploitable as this app is written**:

- CVE-2024-33663 requires the verifier to accept a caller-influenced algorithm or an asymmetric key format. `decode_token` pins `algorithms=[ALGORITHM]` with `ALGORITHM = "HS256"` and a symmetric secret (`security.py:22,89`), which is the documented mitigation.
- CVE-2024-33664 / PYSEC-2025-185 live in `jwe.decrypt`. This app only calls `jwt.decode`, which routes through JWS, not JWE.

What remains is the structural risk: `python-jose` has no maintained release beyond 3.4.0, and both cookies handed to `jwt.decode` (`auth.py:122`, `deps.py:71`) are fully attacker-controlled. A future advisory in the JWS path lands directly on unauthenticated input.

**Fix.** Short term, `python-jose[cryptography]==3.4.0`. Better, migrate to `PyJWT` — the API change is small and confined to `app/auth/security.py`:

```python
import jwt
from jwt import PyJWTError

def _encode(payload, ttl, token_type):
    ...
    return jwt.encode(body, _get_secret(), algorithm=ALGORITHM)

def decode_token(token: str, expected_type: str) -> dict[str, Any] | None:
    try:
        claims = jwt.decode(token, _get_secret(), algorithms=[ALGORITHM])
    except PyJWTError as exc:
        logger.info("jwt_decode_failed", error=str(exc))
        return None
    ...
```

This also drops the transitive `ecdsa==0.19.2`, which carries an unfixed Minerva timing advisory (PYSEC-2026-1325) and is unused here.

---

### M-6 — `starlette==0.38.6` and `python-multipart==0.0.9` carry unpatched DoS advisories

**Severity: Medium** — the web framework running in production is ~9 versions behind its first security fix; the highest-impact advisories are not reachable today only because the app happens to declare no form endpoints.
**Category:** OWASP A06:2021 · CWE-1395
**Files:** `requirements.txt:6,8` (starlette is transitive via `fastapi==0.115.0`)

| Package | ID | Issue | Fixed in |
|---|---|---|---|
| starlette 0.38.6 | PYSEC-2026-1943 | Unbounded buffering of non-file multipart fields → memory exhaustion | 0.40.0 |
| starlette 0.38.6 | PYSEC-2026-161 | `Host` header not validated when rebuilding `request.url` | 1.0.1 |
| starlette 0.38.6 | PYSEC-2026-249 | `max_fields`/`max_part_size` silently ignored for urlencoded bodies | 1.3.1 |
| starlette 0.38.6 | PYSEC-2026-2281 | `StaticFiles` UNC-path SSRF (Windows hosts only) | 1.1.0 |
| python-multipart 0.0.9 | PYSEC-2026-3039, -3040, -3036/7/8, -1851 | Multiple parser DoS paths | 0.0.18 – 0.0.31 |

**Reachability.** No route declares `Form(...)`, `File(...)`, or `UploadFile`, and nothing calls `request.form()`, so the multipart and urlencoded parsers are never invoked — the DoS advisories are dormant. PYSEC-2026-161 is live but low-impact here: `request.url` is used only for the log field in `_unhandled_exception_handler` (`main.py:48`), never for an authorization decision. The `StaticFiles` UNC issue needs a Windows host; the Space is Linux.

The exposure is that all of this rests on the app never gaining a file-upload or form endpoint — a fragile invariant for a project shipping features weekly.

**Fix.** `fastapi>=0.115.6` (which pulls `starlette>=0.41.3`) and `python-multipart>=0.0.18`. Both are patch-compatible with the current code. Re-run `pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80` — the CLAUDE.local.md notes record that this pin was hand-tuned once before to fix a `TestClient`/httpx interaction, so treat the test suite as the gate.

---

### L-1 — Interactive API documentation is publicly served in production

**Severity: Low** — real reconnaissance value, no direct auth impact; every listed route still enforces its own authorization.
**Category:** OWASP A05:2021 · CWE-200 (Exposure of Sensitive Information)
**File:** `app/main.py:182-187`

```python
app = FastAPI(
    title="PoseCoach API",
    description="Real-time AI gym exercise form correction",
    version="1.0.0",
    lifespan=lifespan,
)   # docs_url / redoc_url / openapi_url left at their defaults
```

**Verified live:** `https://ashwintaibu-posecoach.hf.space/docs` returns "PoseCoach API - Swagger UI", and `/openapi.json` returns the complete schema — 45 routes with full request/response models. `app/static_spa.py:26-34` explicitly reserves `/docs`, `/redoc`, and `/openapi.json` so the SPA catch-all does not shadow them.

Severity is held at Low because the SPA bundle already reveals most endpoint paths and each route independently enforces `get_current_user`. It still hands an attacker an exact, machine-readable map — including the unauthenticated `/chat/stream` of H-1 and the recovery routes of H-2 — with zero effort.

**Fix.**

```python
_IS_PROD = os.environ.get("ENVIRONMENT", "development") == "production"

app = FastAPI(
    title="PoseCoach API",
    description="Real-time AI gym exercise form correction",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if _IS_PROD else "/docs",
    redoc_url=None if _IS_PROD else "/redoc",
    openapi_url=None if _IS_PROD else "/openapi.json",
)
```

Note this requires `ENVIRONMENT=production` to actually be set on the Space — the same variable already gates HSTS (`security_headers.py:19`) and cookie `Secure` (`deps.py:17`), so confirming it is set is worth doing regardless (see "Needs verification").

---

### L-2 — Weak development credentials committed to a public repository

**Severity: Low** — dev-only compose files not used by the live deploy, but they are world-readable and one is a footgun.
**Category:** CWE-1188 (Insecure Default Initialization) · CWE-798
**File:** `docker-compose.yml:11,49,58,110-111`

```yaml
POSTGRES_PASSWORD: dev_password                                      # :11
JWT_SECRET: ${JWT_SECRET:-dev_secret_change_in_production}           # :49
METRICS_TOKEN: ${METRICS_TOKEN:-dev_metrics_token_change_me}         # :58
GF_SECURITY_ADMIN_USER: admin                                        # :110
GF_SECURITY_ADMIN_PASSWORD: admin                                    # :111
```

The HF Space does not use this file, and `deploy/docker-compose.prod.yml` correctly uses `${VAR:?...}` fail-loud syntax throughout with no insecure defaults (lines 41-46, 72, 113). Two mitigating details worth recording:

- The `JWT_SECRET` fallback is 31 characters, and `_get_secret()` rejects anything under 32 (`app/auth/security.py:34-35`). It therefore **fails closed** — the app refuses to start rather than signing tokens with a public secret. That is luck, not design.
- Grafana `admin/admin` binds `0.0.0.0:3001` in the dev compose. Anyone running `docker-compose up` on a shared network exposes an admin console with the default password.

**Fix.** Apply the prod file's discipline to the dev file — `${JWT_SECRET:?set JWT_SECRET (>=32 chars)}` and `${GRAFANA_PASSWORD:?set GRAFANA_PASSWORD}` — so a missing value is a startup error rather than a public credential. Bind Grafana to `127.0.0.1:3001:3000`.

---

### L-3 — `.dockerignore` does not exclude `.env`

**Severity: Low** — currently harmless; purely a future-proofing gap.
**Category:** CWE-538 (Insertion of Sensitive Information into Externally-Accessible File)
**File:** `.dockerignore` (whole file — it lists only the EVAL-01 video corpus)

`.env` exists locally and is correctly gitignored (`.gitignore:16`), so it never reaches the HF builder. And today's `Dockerfile` uses explicit `COPY` statements for `app/`, `alembic/`, `scripts/`, `models/`, `data/knowledge_base/`, and the frontend build — never `COPY . .` — so `.env` cannot enter the image even locally. **No leak exists.**

The gap is that a single future `COPY . .` would bake local secrets into a layer of an image published from a public repo, and nothing would flag it.

**Fix.** Add to `.dockerignore`, keeping the file's existing "why" comment style:

```
# Never ship local secrets into an image layer, whatever the COPY looks like.
.env
.env.*
!.env.example
```

---

### L-4 — Embedding model is downloaded from Hugging Face Hub at runtime with no revision pin

**Severity: Low** — supply-chain exposure; the specific `transformers` RCE paths need a compromised upstream repo.
**Category:** CWE-494 (Download of Code Without Integrity Check) · OWASP A08:2021
**File:** `app/chatbot/rag.py:30,60-65`

```python
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

@lru_cache(maxsize=1)
def _get_embedder() -> SentenceTransformer:
    from sentence_transformers import SentenceTransformer
    logger.info("loading_embedder", model=EMBEDDING_MODEL)
    return SentenceTransformer(EMBEDDING_MODEL)     # ← no revision=, no local_files_only
```

The Dockerfile deliberately does not bake the index (`Dockerfile:60-63`), so every cold boot fetches this model over the network. `pip-audit` flags `transformers==4.57.6` (transitive) with several model-loading RCE advisories — PYSEC-2026-2289 (malicious `config.json` pointing `_attn_implementation_internal` at an attacker repo) and PYSEC-2026-2288 (`torch.load` without `weights_only=True` on `torch<2.6`, and this project pins `torch==2.4.1`). Without a pinned revision, a compromised or hijacked upstream repo is executed on the next Space restart.

**Fix.** Pin the exact commit:

```python
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_REVISION = "<full 40-char commit sha from the model repo>"

@lru_cache(maxsize=1)
def _get_embedder() -> SentenceTransformer:
    from sentence_transformers import SentenceTransformer
    logger.info("loading_embedder", model=EMBEDDING_MODEL, revision=EMBEDDING_REVISION)
    return SentenceTransformer(EMBEDDING_MODEL, revision=EMBEDDING_REVISION)
```

Better still, bake the model into the image at build time and set `HF_HUB_OFFLINE=1` at runtime — that removes both the supply-chain window and the cold-start network dependency.

---

### L-5 — 14 npm advisories in the frontend dependency tree (development-only)

**Severity: Low** — **none reach users.** `npm audit --omit=dev` reports **0 vulnerabilities**, so the shipped bundle is clean.
**Category:** OWASP A06:2021
**File:** `frontend/package.json`

Full-tree `npm audit`: 14 vulnerabilities (2 critical, 7 high, 4 moderate, 1 low), all in dev tooling — `vitest`/`@vitest/coverage-v8`, `vite`, `esbuild`, `postcss` (GHSA-r28c-9q8g-f849 arbitrary `.map` disclosure), `ws` (GHSA-96hv-2xvq-fx4p memory-exhaustion DoS), `@babel/core`, `brace-expansion`.

The exposure is to the developer machine and any CI runner, not to the deployment — chiefly the Vite dev server, which several of these advisories target.

**Fix.** `npm audit fix` clears the non-breaking subset. The vitest/vite majors need `npm audit fix --force` plus a run of the 248-test Vitest suite and the Playwright specs; schedule that rather than doing it under time pressure. Not urgent.

---

### L-6 — `torch==2.4.1` carries 16 advisories

**Severity: Low** — not reachable from user input in this application.
**Category:** OWASP A06:2021
**File:** `requirements.txt:27`

`pip-audit` lists 16 advisories including PYSEC-2025-41 (CVE-2025-32434 — `torch.load` RCE bypassing `weights_only=True`, fixed in 2.6.0). Reachability is genuinely low: the deployed Space runs the direct ONNX Runtime path (`MODEL_PATH=models/yolo_posecoach_v1.onnx`, `app/main.py:130-135`), so `torch.load` never touches user data. The `.pt` fallback (`main.py:138`) loads a repo-controlled file. Torch remains installed because `ultralytics` imports it.

It does, however, compound L-4: `torch<2.6` is the precondition for the `transformers` `_load_rng_state` RCE.

**Fix.** Upgrade to `torch>=2.6.0` when the ultralytics pin allows. Lower priority than M-5/M-6. Alternatively, drop torch from the runtime image entirely — the ONNX path does not need it — which removes 16 advisories and a large chunk of image size in one move.

---

### L-7 — No email verification on registration and no password-strength policy

**Severity: Low** — enables junk/impersonating accounts and weak credentials; not an auth bypass.
**Category:** CWE-521 (Weak Password Requirements) · CWE-1390
**Files:** `app/auth/schemas.py:10-12`, `app/api/v1/auth.py:71-90`

```python
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)   # length only — no complexity, no breach check
```

`register` creates a usable account immediately with no ownership proof for the address. Anyone can register `someone-else@example.com`; that address then receives password-reset mail from this service. `min_length=8` permits `password`, `12345678`, and every other top-of-the-list credential.

Bcrypt hashing itself is correct — `hash_password` pre-hashes with SHA-256 to sidestep bcrypt's 72-byte truncation and uses `gensalt()` (`security.py:28-41`). This is about what gets hashed, not how.

**Fix.** For a thesis project with a real user study, a breach-list check is the highest value per line — reject the top few thousand known-compromised passwords, or call the k-anonymity HIBP range API. Add an email-verification token reusing the existing `PasswordResetToken` pattern if accounts are to be trusted at all.

---

### L-8 — Two unbounded inputs on authenticated endpoints

**Severity: Low** — authenticated-only, self-inflicted, bounded by other limits.
**Category:** CWE-1284 (Improper Validation of Specified Quantity in Input)
**Files:** `app/workouts/schemas.py:172`, `app/api/v1/history.py:77,83`

```python
# workouts/schemas.py:172 — no upper bound on the list
exercise_ids: list[str] = Field(min_length=1)
```

`create_routine` (`workouts.py:561-567`) feeds this straight into `Exercise.id.in_(body.exercise_ids)`. A 100 000-element list becomes a single enormous `IN` clause.

```python
# history.py:77,83
limit: int = 50
... .limit(min(limit, 200))
```

`min(-5, 200)` is `-5`. Postgres rejects a negative `LIMIT`, so `?limit=-1` produces an unhandled 500 rather than a clean 422. Cosmetic, but it is an unhandled-exception path an authenticated user can trigger at will.

**Fix.**

```python
exercise_ids: list[str] = Field(min_length=1, max_length=100)
```
```python
limit: int = Query(default=50, ge=1, le=200)   # then drop the min() and use `limit` directly
```

The rest of the codebase already does this correctly — `browse_exercises` uses `Query(default=50, ge=1, le=200)` (`workouts.py:177`) and the nutrition schemas bound every numeric field. These two are the outliers.

---

### L-9 — Anonymous WebSocket inference is free compute

**Severity: Low** — connection ceilings exist and are well-reasoned; the residual gap is that they are per-process and there is no server-side frame-rate cap.
**Category:** OWASP API4:2023 · CWE-770
**File:** `app/api/v1/ws_inference.py:115-116,223-238`

```python
MAX_WS_CONNECTIONS = int(os.environ.get("MAX_WS_CONNECTIONS", "64"))
MAX_ANON_CONNS_PER_IP = int(os.environ.get("MAX_ANON_CONNS_PER_IP", "3"))
```

These are real defences and the code comments correctly document them as per-process ceilings for a single-worker deploy. Two residual gaps: with 64 global slots and 3 per IP, **22 IPs** fill the server and lock out every legitimate user; and once connected, nothing server-side limits frame rate — the 15 FPS cap is client-side only (`frontend/CLAUDE.md`), so a scripted client can submit as fast as the executor drains, monopolising both worker threads.

**Fix.** Add a per-connection frame-rate guard in the receive loop (drop or `await asyncio.sleep()` when frames arrive faster than ~20 fps), and lower `MAX_ANON_CONNS_PER_IP` to 1 — a legitimate anonymous user needs exactly one camera socket.

---

### L-10 — Client IP address logged on every WebSocket connection

**Severity: Low** — GDPR-relevant PII in logs; contradicts the project's own stated rule.
**Category:** CWE-532 · GDPR Art. 5(1)(c) data minimisation
**File:** `app/api/v1/ws_inference.py:186,224,229`

```python
logger.info("ws_connected", client=websocket.client, authenticated=bool(session_user_id))
```

`websocket.client` is an `Address(host, port)` tuple — the raw client IP. `privacy-and-thesis.md` and `app/CLAUDE.md` both state logs must carry no PII beyond `user_id`, and an IP address is personal data under GDPR. Every other log call in the codebase is scrupulous about this, which makes this an oversight rather than a policy gap.

**Fix.** `logger.info("ws_connected", authenticated=bool(session_user_id))`. The two capacity-rejection lines (224, 229) have a genuine operational need for the IP — hash it with a per-deploy salt, or accept it with a documented short retention.

---

### L-11 — Editor artifacts tracked in a public repository

**Severity: Low** — hygiene only. Verified to contain no secrets.
**Category:** CWE-540 (Inclusion of Sensitive Information in Source Code)
**Files:** `.fuse_hidden0000001300000001` … `.fuse_hidden0000001700000005` (5 tracked files, ~13 KB each)

WSL FUSE artifacts — orphaned copies of `IMPROVEMENT_PLAN_P15–P18.md` left behind when the file was edited while open. I grepped all five for credential-shaped assignments and found none; they contain project planning prose only.

They are nonetheless committed to a **public** HF Space and a public GitHub repo, and they are the kind of accidental inclusion that leaks something real next time.

**Fix.** `git rm --cached .fuse_hidden*` and add `.fuse_hidden*` to `.gitignore`.

---

## 3. Needs verification

Items I could not confirm from the repository. Each is stated as a question with the check that answers it.

1. **Contents of the local `.env`.** Both `.env` and `.env.example` are blocked by a `deny` rule in `.claude/settings.json:77-78`, so I did not read them (I read `.env.example` from git, since it is a committed public placeholder file — it is clean). **I cannot confirm what real keys the local `.env` holds or whether it has ever left this machine.** It is correctly gitignored and absent from all 225 commits. *Check: confirm `.env` has never been emailed, pasted, or copied into a Colab notebook — the `colab-and-drive.md` workflow moves files to Drive routinely.*

2. **Is `MAIL_BACKEND=smtp` set on the live Space?** This is the single fact that decides whether H-2 is a latent misconfiguration or an active token leak. *Check: HF Space → Settings → Variables and secrets. Also grep the running logs for `mail_console`.*

3. **Is `ENVIRONMENT=production` set on the Space?** It gates HSTS (`security_headers.py:19`), cookie `Secure` (`deps.py:17`), and JSON log rendering (`logging_config.py:19`). If unset, all three silently fall back to development behaviour — including `secure=False` cookies. *Check: `curl -sI https://ashwintaibu-posecoach.hf.space/health | grep -i strict-transport` — if HSTS is absent, the variable is not set and cookies are not `Secure`.*

4. **What is `COOKIE_SAMESITE` on the Space?** Decides whether M-3 is theoretical or live. *Check: the same `curl -sI` on a login response, or read the Space variables.*

5. **What is `ALLOWED_ORIGINS` on the Space?** With `allow_credentials=True` (`main.py:200`), a stale cross-origin entry from the pre-P30 Vercel era would be an unnecessary trust grant. Browsers reject `*` with credentials, so the catastrophic case is impossible — but a leftover origin is not.

6. **Vercel deployment protection and preview deployments.** `frontend/vercel.json` is a pure 308 redirect with no secrets, and the Vercel project holds no code. Still worth confirming no `VITE_*` values with secret content are configured in the Vercel dashboard, and that preview deployments are not publicly indexed. *Check: Vercel → Settings → Environment Variables, and Settings → Deployment Protection.*

7. **Historical HF Space force-pushes.** `hf/main` and `origin/main` currently point at the same commit `b36da37`, and I scanned all reachable objects. Memory notes record that `hf/main` has diverged and been force-pushed before; force-pushed objects can survive on the remote as unreachable-but-fetchable blobs. *Check: `git fetch hf '+refs/*:refs/remotes/hf-all/*'` then re-grep, or ask HF support to garbage-collect the Space repo.*

8. **HF Space log retention and collaborator list.** Determines who can read the H-2 tokens. *Check: HF Space → Settings → who has write access.*

---

## 4. Summary

### Counts

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 6 |
| Low | 11 |
| **Total** | **19** |

### Top 3 to fix first

1. **H-2 — password-reset tokens in production logs.** This is the only finding with a direct path to full account takeover, and it is a two-line fix. The reset flow is deployed and publicly callable *right now* (`/openapi.json` on the live Space lists it), the mailer fails **open** to the token-logging transport, and the project's own notes say the SMTP variables were never set. Fix the default, set the Space secrets, and clear `password_reset_tokens`.

2. **H-1 — unauthenticated chat with an unbounded image.** Highest likelihood of exploitation by far: it needs no account, no skill, and no target research beyond reading the public OpenAPI schema. The loss is immediate and financial — the OpenRouter balance and Gemini quota — plus a denial of the coaching feature for real users. The frame cap is a one-line Pydantic change; the auth gate on the vision path is a few more.

3. **M-1 + M-4 together — unbounded request bodies and undetected decompression bombs.** These are the same class of bug at two layers, they compound H-1, and a single 500 MB body or one 100-megapixel JPEG will OOM a `--workers 1` container on a 2-vCPU Space. Both fixes are small and self-contained, and `run_inference`'s existing `try/except` already absorbs the M-4 change with no caller updates.

After those, the dependency work (M-5, M-6) is the highest-value remaining item — `fastapi>=0.115.6` and `python-multipart>=0.0.18` are drop-in, and replacing `python-jose` with `PyJWT` touches one file.

### Clean — categories with no findings

- **SQL / NoSQL injection — clean.** Every query in `app/` uses the SQLAlchemy async ORM with bound parameters. Repo-wide search for f-string/concatenated SQL, `text(f"...")`, and `.execute(f"...")` returned zero hits. The only raw SQL is the literal `text("SELECT 1")` health probe (`main.py:144,257`).
- **OS command injection — clean.** No `subprocess`, `os.system`, `os.popen`, `shell=True`, or `ffmpeg`/`ffprobe` invocation anywhere in `app/`. Video handling is entirely in-memory via PIL.
- **Insecure deserialization — clean.** No `pickle`, `yaml.load`, `marshal`, `eval`, `exec`, or `__import__` in `app/`. All external JSON goes through `json.loads` into Pydantic models.
- **XSS — clean.** No `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` anywhere in `frontend/src`. All user and LLM text renders as React text nodes, which escape by default. Chat tokens, workout notes, and custom exercise names were each traced to their render sites. (The CSP weakness of M-2 is defence-in-depth for a sink that does not currently exist.)
- **Hardcoded secrets — clean.** Scanned the working tree and all 225 commits across every ref (`git grep` over `git rev-list --all`) for Google, OpenAI/OpenRouter, Tavily, HF, GitHub, Slack, and AWS key formats, PEM private keys, and credentialed `postgres://`/`redis://`/`mongodb://` URLs. Zero hits. Every secret is read via `os.environ` at use time; `.env.example` contains only placeholders. **No secret requires rotation as a result of this audit** — the one exception is the reset tokens under H-2, which are application-issued rather than provider credentials.
- **Secrets in the client bundle — clean.** The only build-time variables are `VITE_API_URL`, `VITE_OVERLAY_NEON`, `VITE_APP_VERSION`, and `VITE_BUILD_SHA` — none secret. The production build injects no `VITE_API_URL` at all (`Dockerfile:15-17`), so the client uses relative paths. All LLM calls are server-side; no provider key ever reaches the browser.
- **Access control / IDOR — clean, and notably well done.** Every route under `/history`, `/workouts`, and `/nutrition` declares `Depends(get_current_user)` and filters on `user_id == current_user.id`. Nested resources enforce ownership by joining up to the owner (`_load_owned_set` joins `LoggedSet → LoggedExercise → WorkoutLog.user_id`, `workouts.py:387-395`). Foreign IDs return 404 rather than 403, so existence is not leaked (`history.py:269`, `workouts.py:7-8`). `cv_link_set` copies the form score server-side from an owned session instead of trusting the client (`workouts.py:530-531`). Custom exercises are isolated by `visible_to(user_id)` (`workouts.py:158`). I found no missing ownership check.
- **JWT and session handling — clean.** HS256 with `algorithms=[ALGORITHM]` pinned on decode (no `none`/algorithm confusion), `exp` on every token, a `type` claim checked on every decode to prevent refresh-for-access substitution, a secret rejected below 32 characters, `jti` for refresh uniqueness, 15-minute access / 30-day refresh TTLs, rotation with revocation, and SHA-256-hashed storage. Cookies are `httpOnly` + `secure` (env-gated) + `SameSite`, with the refresh cookie path-scoped. No token is ever placed in a response body or in `localStorage` — verified across the whole frontend.
- **Password storage — clean.** bcrypt with `gensalt()`, SHA-256 pre-hash to handle the 72-byte limit correctly (`security.py:28-41`), `hmac.compare_digest` for token comparison, and constant-time metrics-token comparison via `secrets.compare_digest` (`main.py:220`).
- **File upload / path traversal — clean.** There are no upload endpoints. The only `FileResponse` calls serve server-controlled constants: `model_assets.py:29-36` reads the `MODEL_PATH` env var (operator-controlled) with an `.onnx` suffix check and an `is_file()` guard, and `static_spa.py` resolves paths at mount time from a fixed dict. No user-controlled string reaches a filesystem path.
- **SSRF — clean.** Every outbound URL is a module-level constant: Tavily (`web_search.py:21`), OpenRouter (`qwen_client.py:22`), Open Food Facts (`off_client.py:19`), jsDelivr (`seed_exercises.py:39,42`). `WEB_SEARCH_URL` is operator-configurable but never user-influenced. The only user-derived component of any outbound request is the OFF barcode, validated against `^\d{6,14}$` before use (`nutrition.py:52,117-121`).
- **Enumeration resistance — clean.** `forgot-password` and `forgot-username` return byte-identical responses whether or not the account exists (`auth_recovery.py:46-48,117,136`), with work performed only for real users. Rate-limited per IP *and* per submitted email (`auth_recovery.py:92-93`).
- **Frame privacy (thesis requirement) — clean.** JPEG frames are decoded in memory and discarded; only keypoint coordinates and scores are persisted (`ws_inference.py:552-558`, `models.py:54-55`). No frame bytes are logged or written to disk anywhere in the pipeline. `DELETE /auth/account` cascades correctly across sessions, refresh tokens, prep cycles, reset tokens, and manual foods (GDPR Art. 17).
- **CI/CD — clean by absence.** No `.github/` directory exists, and none appears in any commit. Nothing is deployed by automation, so there are no workflow secrets or injectable pipeline inputs. (Deployment is manual `git push` to two remotes.)
- **Frontend production dependencies — clean.** `npm audit --omit=dev` → **0 vulnerabilities**.
- **Database configuration — clean.** `alembic.ini:13` has an empty `sqlalchemy.url`; the real URL is injected from `os.environ["POSTGRES_URL"]` at runtime (`alembic/env.py:23`). TLS is configurable via `POSTGRES_SSL` through `connect_args`, with a correct comment explaining why `sslmode` in the URL does not work with asyncpg (`db.py:11-23`).
- **Error handling — clean.** A catch-all handler returns a fixed JSON shape and never leaks a stack trace (`main.py:42-49`). Debug mode is off; FastAPI is constructed without `debug=True`.
