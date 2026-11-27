---
name: p06-auth-history
description: PoseCoach P06 — JWT authentication, user sessions, and workout history. Auto-invoked when working on auth, login, JWT, cookies, user accounts, session history, or workout logs.
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

## Auth Rules (CRITICAL — from privacy rules)
- JWT stored in `httpOnly=True`, `secure=True` (prod), `samesite="lax"` cookie
- NEVER return JWT in response body
- NEVER use localStorage — frontend reads auth state via `/api/v1/auth/me`
- JWT payload: `{"sub": user_id, "exp": timestamp}` — nothing else
- Passwords: bcrypt hashed (never stored plain)

## Done Criteria
- [ ] Register + login + logout flow works
- [ ] JWT in httpOnly cookie confirmed (not in JS-accessible storage)
- [ ] Workout sessions save snapshots into `keypoints_data` JSON column
- [ ] History page displays session list + per-session replay data
- [ ] GDPR delete endpoint works
- [ ] `pytest tests/test_auth.py` and `tests/test_history.py` green
