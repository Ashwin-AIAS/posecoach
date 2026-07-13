# P30 — Same-Origin Deploy: Serve the Frontend from the Space

> Executable prompt for Claude Code. Run after P29 is merged (it is — #10).
> Read `WORKOUT_NUTRITION_ROADMAP_P23-P28.md` first. Pose core stays frozen.

- **Owner:** Claude Code
- **Branch:** `feat/p30-same-origin-deploy`
- **Depends on:** P29 merged; Space healthy (`/health/deep` all ok)
- **New thesis metric:** none — but this unblocks the SUS study (testers get one
  working URL) and closes the production auth outage found 2026-07-13.

---

## Why P30 exists (root cause, verified live 2026-07-13)

Sign-in from `posecoach-rho.vercel.app` fails with "Failed to fetch". Diagnosis
(browser-verified against prod):

- Any CORS **preflight OPTIONS** to `*.hf.space` is answered by Hugging Face's
  edge, not by our app: bare `200` with only `access-control-allow-origin`
  (echoed for *any* origin) + `access-control-max-age: 600` — **no
  `allow-methods`, no `allow-credentials`, no `allow-headers`**. Confirmed by
  header fingerprint: real requests carry `server: uvicorn` + `x-request-id`;
  preflight responses carry neither, on every path.
- Browsers therefore reject every preflighted request (POST/PATCH/DELETE with
  JSON, credentialed) from any external origin. Simple GETs pass (no preflight)
  — which is why the catalog loaded while sign-in died.
- **Not fixable in app code.** `CORSMiddleware` is configured correctly; it
  never receives the OPTIONS. P29's server-side smoke test passed because it
  bypassed browser preflight semantics — the gate was wrong, not the code.

**Decision:** one origin. The Space serves the built frontend; API, WS, and
static files share `https://ashwintaibu-posecoach.hf.space`. CORS ceases to
apply, cookies are first-party, the frozen WS flow is same-origin. Vercel is
retired to a redirect (or deleted).

---

## Open decisions — confirm or reframe before running

1. Canonical URL = `https://ashwintaibu-posecoach.hf.space`. Vercel project
   kept only as a 308 redirect to it (single `vercel.json` with `redirects`),
   so old links/installed PWAs don't strand. OK?
2. `COOKIE_SAMESITE` env on the Space reverts to unset (default `lax`) —
   `none` was only needed for the now-dead cross-origin path. Env-driven
   plumbing from P29 stays (useful for local dev). OK?
3. `VITE_API_URL` is **empty** for the production build (same-origin relative
   paths — the code's original default). The Vercel-specific build env is
   retired. OK?

---

## Goal / Definition of Done

1. Register → sign in → start workout → log sets → finish → barcode scan →
   log food → live Coach WS — all working **in a real browser** at the Space
   URL, verified by an automated browser-level check, then on a phone.
2. The PWA installs from the Space origin (manifest + SW served correctly).
3. No frozen pose-core file changed; `app/main.py` gains only a static-files
   mount (after all routers; lifespan untouched). Dockerfile gains a frontend
   build stage. All quality gates green.

---

## Stage A — Build & serve the frontend from the Space

- `Dockerfile`: add a `node:20-alpine` build stage — `npm ci && npm run build`
  in `frontend/` (no `VITE_API_URL`, same-origin) — and copy `frontend/dist`
  into the runtime image (e.g. `/app/static`).
- `app/main.py` (additive, after the `include_router` block):
  - Serve `index.html` at `/`, static assets, `manifest.webmanifest`, `sw.js`,
    icons. Use `StaticFiles` + an SPA fallback that returns `index.html` for
    unknown **non-`/api`, non-`/ws`, non-`/docs`, non-`/metrics`** paths (tab
    routes / PWA start_url). Guard: if the static dir is absent (local dev,
    CI), skip the mount — tests and `uvicorn` dev flow unchanged.
  - `sw.js` and `index.html` responses: `Cache-Control: no-cache` (SW update
    semantics); hashed `/assets/*`: long-lived immutable cache.
- Mind the existing CSP middleware: verify `script-src 'self'` etc. permit the
  built bundle (it should — no external CDNs in the build).
- **Gate:** `docker build` succeeds; container locally serves `/` (app shell),
  `/api/v1/health` (JSON), `/docs`; pytest suite untouched and green
  (mount skipped under tests); `ruff`/`mypy --strict` clean.
- Commit: `[P30] feat: build frontend into Space image + same-origin static serve`

## Stage B — Retire the cross-origin path

- `frontend/vercel.json`: replace contents with a permanent redirect of all
  paths to the Space URL.
- Docs: update `docs/hf_migration_handoff.md` pointers; note `ALLOWED_ORIGINS`
  now only needs `http://localhost:5173` (dev); `COOKIE_SAMESITE` unset in
  prod (STOP and hand the Space env change to the user — do not edit Space
  settings yourself).
- **Gate:** grep — no remaining hardcoded `vercel.app` origin in app code or
  built config (docs/history references fine).
- Commit: `[P30] chore: retire Vercel origin — redirect to Space`

## Stage C — Browser-level prod gate (the test P29 was missing)

- New Playwright spec `e2e/prod-smoke.spec.ts`, tagged/skipped unless
  `PROD_BASE_URL` is set: against the live Space —
  register throwaway user → sign in (asserts no "Failed to fetch") → start
  workout → add exercise → log a set → finish → food search → log entry →
  `DELETE /auth/account` cleanup. This exercises real preflight/cookie
  behavior a server-side curl cannot.
- Wire a `npm run smoke:prod` script; document running it after every
  `git push hf main`.
- **Gate:** spec passes against the deployed Space (run after Stage D push).
- Commit: `[P30] test: browser-level production smoke gate`

## Stage D — Deploy + verify

- Merge PR → `git push hf main` → Space rebuilds (now includes frontend).
- Run Stage C's smoke spec against prod; then user's manual phone pass:
  install PWA from the Space URL, full loop incl. live Coach WS.
- STOP and hand to user: remove `COOKIE_SAMESITE` from Space env (or set
  `lax`), confirm Vercel redirect deploy.
- Commit: `[P30] chore: deploy notes + prod verification`

End with PR to `main`, then STOP.

---

## Guardrails specific to P30

- Frozen pose-core untouched. `app/main.py` edit is the static mount only —
  lifespan, model, executor, routers unchanged.
- The SPA fallback must never shadow `/api/*`, `/ws/*`, `/docs`, `/openapi.json`,
  `/metrics`, `/health*` — route order/exclusion tested explicitly.
- No JWT in localStorage; cookies stay httpOnly (`lax` suffices same-origin).
- structlog only. Dark-only, English-only. Additive only.
