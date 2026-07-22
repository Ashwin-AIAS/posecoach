# P33 — Account Recovery (Forgot Password / Forgot Username)

**Stage:** P33
**Branch:** `feat/p33-account-recovery`
**Depends on:** P32 (latest on `main`)
**Status:** SPEC — ready to run
**Owner of record:** the executing agent, acting as senior full-stack engineer
**Binding parent doc:** `docs/enhancements/WORKOUT_NUTRITION_ROADMAP_P23-P28.md` (guardrails carry forward)

---

## 1. Goal

Give a locked-out user the standard, self-service recovery flow:

> **Login → "Forgot password?" → new page → enter email → receive reset link → set new password → log back in.**

Plus a lightweight **"Forgot username?"** that emails the username to the registered address. This is a **product + security feature**, fully additive, and must not touch the frozen pose-estimation core or any existing table.

---

## 2. Operating mode — **AUTONOMOUS** (read this first)

This stage is executed **end-to-end by the agent with no human in the loop.** The human (Ashwin) is not a reviewer, an approver, or a gate. Assume he is away from the screen the entire time.

**The agent MUST:**

- Work **continuously through every sub-stage without pausing** for review, confirmation, sign-off, or a human "go". Never idle waiting for input.
- Act as the **senior engineer of record**: make design, naming, refactor, and file-**deletion** decisions on its own judgment. Record the *why* in the commit message — never in a question to the human.
- **Self-run** every acceptance gate and the full quality gate. If green → commit → push → immediately start the next sub-stage. If a gate is red → fix it and re-run; do not report a red gate that the agent itself introduced, just fix it.
- Be **authorized to** create, modify, and **delete** files (outside the frozen core), add dependencies, write migrations, and **open AND self-merge its own PR to `main` once all gates are green.**

**The agent MUST NOT:**

- Ask the human to review, approve, confirm, or "take a look".
- Stop at the end of a sub-stage to wait for permission before starting the next.
- Leave the feature half-built because a decision felt like the human's to make — make the senior call and move on.

**The ONLY hard-stops** (pause, write a one-line report at `docs/enhancements/P33_BLOCKED.md`, and stop):

1. A **pre-existing test** (written before P33) fails — per the frozen-core rule, **STOP and report; never "fix" it by editing the core.**
2. Shipping the feature would require **modifying the frozen core** (`app/api/v1/ws_inference.py`, `app/inference/**`, `app/analysis/**` scorers/smoothers, model lifespan, frozen frontend camera/pose hooks) **or altering an existing table**. That means the plan is wrong — stop and report.
3. An **unrecoverable environment failure** (a required dependency will not install after reasonable retries).

Note: **missing SMTP credentials are NOT a hard-stop** — see §4. Dev and tests never need real email creds, so the agent is never blocked on them.

---

## 3. Guardrails still in force (autonomy ≠ recklessness)

Autonomy removes the *human review pauses*, not the engineering discipline. The agent enforces all of these on itself:

- **Frozen core is untouchable.** New features read finished data via the API only.
- **Additive only.** New table via a new Alembic migration, new router, new components. **Never alter existing tables or existing component behavior.**
- **Privacy:** JWT never in `localStorage`; secrets env-only; `structlog` only (never `print`/`logging`); never log the raw token, password, or full email — `user_id` + event name only.
- **Quality gate must pass before every commit:** `ruff check app/ --fix`, `mypy app/ --strict`, `pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80`. Frontend: `tsc --noEmit`, `eslint` (0 warnings), `vitest`, and **Playwright** (this stage adds pages → layout-touching).
- **Dark-only, English-only.**
- **Commit format:** `[P33] type: description`. **slowapi gotcha:** no `from __future__ import annotations` in the new router.

---

## 4. Locked design decisions (do not re-litigate)

| Decision | Choice | Rationale |
|---|---|---|
| Recovery channel | **Email** (link-based) | Matches the classic flow requested |
| Email transport | **Free Gmail SMTP** via app password, env-only | No paid provider; sufficient at thesis/demo scale |
| Dev / test transport | **Console mailer** (dev) + **mock SMTP** (tests) | Nothing ever blocks on real creds |
| Token style | One-time **link** with token in query | Classic "click the link" UX |
| Token security | `secrets.token_urlsafe(32)`, stored as **SHA-256 hash**, single-use, **20-min TTL** | Leaked DB row is useless |
| Enumeration | **Identical generic response** whether or not the account exists | No account discovery via the form |
| Session invalidation | **NONE** — rely on short-lived access tokens | Explicitly descoped; documented as future work |
| Rate limiting | slowapi/Redis, **3 requests / hour** per IP + per email | Already in the stack (P27 pattern) |

---

## 5. Data model & migration

New table only. Migration number = **next in sequence** (`0008_password_reset` if `0007_nutrition` is still the latest — verify against `alembic/versions/` before writing).

`password_reset_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `user_id` | FK → `users.id`, indexed | not null |
| `token_hash` | str, unique, indexed | SHA-256 hex of the raw token |
| `expires_at` | datetime (tz-aware) | `now + RESET_TOKEN_TTL_MIN` |
| `used_at` | datetime, nullable | set on successful reset |
| `created_at` | datetime, default `now()` | |

`alembic upgrade head` and `downgrade` must both run clean on Postgres and on the SQLite in-memory test DB.

---

## 6. Backend

New router: `app/api/v1/auth_recovery.py` (registered additively; do not edit the existing auth router's behavior).

| Endpoint | Body | Response |
|---|---|---|
| `POST /api/v1/auth/forgot-password` | `{ email }` | Always `200` + generic message. If user exists: mint token, store hash, email link. Rate-limited. |
| `POST /api/v1/auth/forgot-username` | `{ email }` | Always `200` + generic message. If user exists: email the username. Rate-limited. |
| `POST /api/v1/auth/reset-password` | `{ token, new_password }` | Look up by `sha256(token)`; reject if missing / expired / `used_at` set; enforce password policy; **reuse the existing password hasher**; set new password; set `used_at`; `200`. |

New mailer module: `app/mail/mailer.py`

- `send_password_reset(email, reset_url)` and `send_username(email, username)`.
- Backend selected by `MAIL_BACKEND` env: `console` (logs the link via structlog — dev) or `smtp` (real send — prod).
- Never construct or log the token beyond the URL handed to the transport.

Reset URL: `{FRONTEND_BASE_URL}/reset-password?token={raw_token}`.

---

## 7. Frontend (React 18 + TS + Tailwind, dark-only)

- **Login page:** add a **"Forgot password?"** link (and a small "Forgot username?" link). Do not change existing login behavior.
- **New page `/forgot-password`:** single email field → on submit shows the generic confirmation screen (*"If that email is registered, we've sent a reset link."*).
- **New page `/reset-password`:** reads `?token=` from the URL, two new-password fields (with match + policy validation) → on success routes to login with a "password updated" toast.
- New API-client methods for the three endpoints. Premium dark UI, consistent with the existing shell.

---

## 8. Config / env (additive)

```
MAIL_BACKEND=console          # console (dev) | smtp (prod)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<gmail address>
SMTP_PASSWORD=<gmail app password>   # env-only, injected at deploy
SMTP_FROM="PoseCoach <no-reply@...>"
FRONTEND_BASE_URL=https://<hf-space-url>
RESET_TOKEN_TTL_MIN=20
```

Document these in `.env.example`. The real Gmail app password is injected only at deploy — the agent never needs it to build, test, or run locally.

---

## 9. Sub-stages & self-run gates (auto-proceed, no human pause)

| # | Work | Self-run acceptance gate | On green |
|---|---|---|---|
| S1 | Model + migration `0008_password_reset` | `alembic upgrade head` + `downgrade` clean; model imports; `mypy`/`ruff` green | commit `[P33] feat: password_reset_tokens table + migration` → push |
| S2 | `app/mail/mailer.py` + env wiring | unit test: console backend logs a reset URL; smtp backend selectable | commit `[P33] feat: mailer (console/smtp backends)` → push |
| S3 | `auth_recovery.py` router + rate limiting | pytest: enumeration-safe responses, token expiry, single-use, bad-token reject, rate-limit trip — all green | commit `[P33] feat: recovery endpoints` → push |
| S4 | Frontend pages + login links + API client | `tsc --noEmit`, `eslint` 0 warnings, `vitest`, Playwright happy-path e2e | commit `[P33] feat: recovery UI` → push |
| S5 | Docs + finalize | full quality gate green; update roadmap status line | commit `[P33] docs: P33 done` → **open PR → self-merge on green** → STOP |

Never start sub-stage N+1 before N's push succeeds. Never wait for a human between them.

---

## 10. Tests (must be written, must pass)

**Backend (pytest, SQLite in-memory, SMTP mocked):**
- `forgot-password` returns an identical `200` body for a registered vs. unregistered email (enumeration guard).
- A token row is created for a real user, none for an unknown email.
- Valid token → password changes, `used_at` set.
- Expired token → rejected. Used token → rejected. Garbage token → rejected.
- Rate limit trips after the configured threshold.
- Mailer invoked with a correctly-formed reset URL (mock asserts).

**Frontend (vitest + Playwright):**
- Forgot-password form renders, submits, shows the generic confirmation.
- Reset-password form enforces matching + policy, submits, routes to login.
- Playwright: full request→reset→login happy path against the console mailer.

Existing `app/analysis` coverage gate (≥80%) stays green (untouched).

---

## 11. Thesis mapping

Logged as a **security / product feature** in the evaluation chapter: anti-enumeration responses + hashed, single-use, time-boxed tokens are the defensible security-design points. Session-invalidation-on-reset is named explicitly as **descoped future work** (short-lived tokens are the compensating control).

---

## 12. Definition of done

- A user can complete the full flow: request reset → receive link (console in dev / Gmail in prod) → set a new password → log in.
- "Forgot username?" emails the username.
- All quality gates green; **PR opened and self-merged to `main`.**
- **No** frozen-core file touched; **no** existing table altered; **no** paid email provider required.
- Then **STOP** — the stage is complete.
