---
name: p06-auth-history
description: PoseCoach P06 — JWT authentication, user sessions, and workout history. Auto-invoked when working on auth, login, JWT, cookies, user accounts, session history, or workout logs.
allowed-tools: Read, Write, Edit, Bash
---

# P06 — Auth + Workout History

## Goal
Implement user authentication (JWT in httpOnly cookies) and persistent workout session history — users can log in, have their sessions saved, and review past form scores.

## Actual DB Schema (from app/models.py — CRITICAL)
There is **one flat `WorkoutSession` table** — no separate `PoseSnapshot` table.
```python
class WorkoutSession(Base):
    __tablename__ = "workout_sessions"
    id: Mapped[str]          # UUID
    user_id: Mapped[str]     # FK → users.id
    exercise: Mapped[str]
    rep_count: Mapped[int]
    avg_form_score: Mapped[float]
    keypoints_data: Mapped[dict] = mapped_column(JSON, default=dict)
    # keypoints/scores only — NEVER raw frames (GDPR)
    started_at: Mapped[datetime]
    ended_at: Mapped[datetime | None]
```
**Do NOT create a `pose_snapshots` table.** Store timestamped keypoint snapshots inside
`keypoints_data` as a list of `{"ts": float, "score": float, "kp": [[x,y],...]}` entries.

## Key Files
- `app/core/security.py` — JWT creation + verification
- `app/api/v1/auth.py` — login, logout, refresh endpoints
- `app/api/v1/history.py` — session history endpoints
- `app/models.py` — User + WorkoutSession ORM models (both live here, not in db/models/)
- `alembic/versions/` — initial migration already applied (P02); add new migration only if schema changes

## Auth Rules (CRITICAL — from privacy rules)
- JWT stored in `httpOnly=True`, `secure=True` (prod), `samesite="lax"` cookie
- NEVER return JWT in response body
- NEVER use localStorage — frontend reads auth state via `/api/v1/auth/me`
- JWT payload: `{"sub": user_id, "exp": timestamp}` — nothing else
- Refresh tokens: stored in DB, rotate on use, expire in 30 days
- Passwords: bcrypt hashed (never stored plain)

## API Endpoints
- `POST /api/v1/auth/register` — create account
- `POST /api/v1/auth/login` — set JWT cookie
- `POST /api/v1/auth/logout` — clear cookie
- `GET /api/v1/auth/me` — get current user from cookie
- `GET /api/v1/history/sessions` — list user's workout sessions
- `GET /api/v1/history/sessions/{id}` — session detail (keypoints_data from JSON column)
- `DELETE /api/v1/history/sessions/{id}` — delete session (GDPR)

## Session Saving Pattern
WorkoutSession row is created at WebSocket connect (if user authenticated).
Every ~5 seconds, append a snapshot entry to `keypoints_data`:
```python
snapshot = {"ts": time.time(), "score": score, "kp": kp.tolist()}
session.keypoints_data = session.keypoints_data + [snapshot]
await db.flush()
```
Session is closed (set `ended_at`) at WebSocket disconnect.

## Done Criteria
- [ ] Register + login + logout flow works
- [ ] JWT in httpOnly cookie confirmed via browser dev tools (not in JS-accessible storage)
- [ ] Workout sessions save snapshots into `keypoints_data` JSON column
- [ ] History page displays session list + per-session replay data
- [ ] GDPR delete endpoint works
- [ ] `pytest tests/test_auth.py` and `tests/test_history.py` green
- [ ] No new Alembic migration needed unless schema expands

## Thesis Metric
- Auth security (JWT storage compliance)
- Session persistence reliability
