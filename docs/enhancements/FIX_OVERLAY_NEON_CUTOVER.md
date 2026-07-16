# Fix — Neon Overlay Not Visible After Merge (UI-11 Cutover)

> **Track:** Appearance-only frontend config fix (follow-up to `PREMIUM_POSE_OVERLAY_UI11.md`).
> **Status:** SPEC / not started.
> **Placement:** `docs/enhancements/FIX_OVERLAY_NEON_CUTOVER.md`
> **Owner path:** Frontend Engineer (lead), DevOps/MLOps (build vars + deploy — see §5 MANUAL).
> **Read first:** `PREMIUM_POSE_OVERLAY_UI11.md` (§4.1 flag, §3 data contract), then this file.

---

## 0. Project Leader — problem & root cause

**Symptom.** UI-11 was implemented and merged to `main`, but the live app still shows the **old** overlay — no neon skeleton, no angle arcs, no color-coded joints.

**Root cause (confirmed in code — not a bug in the feature).** The overlay is gated by the `VITE_OVERLAY_NEON` flag, resolved in `frontend/src/features/coach/overlay/flag.ts`:

```
if VITE_OVERLAY_NEON is set  -> ON unless the literal string "false"
else                         -> import.meta.env.DEV   // ON only in `npm run dev`
```

So the neon overlay auto-enables **only in the Vite dev server**. In any *built* artifact (`npm run build`, Docker, the HF Space) `import.meta.env.DEV === false`, and `VITE_OVERLAY_NEON` is **set nowhere** in the repo (no `.env*`, Dockerfile, compose, or vite config defines it). A production build therefore falls back to the legacy `PoseOverlay` **by design** (`App.tsx` ~L362, `OVERLAY_NEON_ENABLED ? <PoseOverlayNeon…> : <PoseOverlay…>`). Merging to `main` changed nothing visible because nothing turned the flag on.

Two compounding facts:
- Vite inlines env vars at **build time**, so the flag must be set **before** `npm run build` — a runtime env var does nothing.
- UI-11 was pushed to `origin` only; the **HF Space was never redeployed** (no `git push hf main`), so the deployed Space is still entirely old code regardless of the flag.

**The feature itself is fine.** `drawArcs` already computes each angle geometrically when the server omits `measured_angles`, and `effectiveQuality` falls back to coloring by the global form score when `joint_scores` is absent — so once the flag is on, arcs + colors + cue render. Per-joint precision is a later polish item, not this fix.

**Goal of this fix.** Make a plain production build show the neon overlay (cut it over from "dev-only" to "on by default"), with a clean escape hatch back to legacy.

---

## 1. Guardrails

- Appearance-only / additive. Do **NOT** touch the frozen CV core (`ws_inference.py`, `inference/**`, `analysis/**`, model lifespan, frozen pose hook). This fix is frontend flag/config only.
- Keep the legacy `PoseOverlay` in place and reachable via the flag (instant rollback).
- Dark-only, English-only. No backend, DB, or network changes.

---

## 2. Frontend Engineer — the change

**Decision (pick A, recommended):**

- **A — Flip the default to ON (recommended).** Change `flag.ts` so the overlay is on by default in every environment, with `VITE_OVERLAY_NEON="false"` as the only-off escape hatch. Single source of truth, no per-build env needed.

  ```ts
  export function isOverlayNeonEnabled(env: ImportMetaEnv = import.meta.env): boolean {
    // UI-11 cutover: neon overlay is now the default in all environments.
    // Set VITE_OVERLAY_NEON="false" to fall back to the legacy overlay.
    return (env.VITE_OVERLAY_NEON as string | undefined) !== "false"
  }
  ```

- **B — Env-only cutover (if you'd rather keep prod gated).** Leave `flag.ts`, add `frontend/.env.production` with `VITE_OVERLAY_NEON=true`. Requires the var to exist in every build environment (local `.env.production` **and** the HF Space build vars — see §5).

Go with **A** unless there's a reason to keep prod on legacy. Whichever is chosen, update `frontend/src/features/coach/overlay/__tests__/flag.test.ts` to match the new default (e.g. assert `isOverlayNeonEnabled(env({ DEV: false }))` is now `true` under option A).

No other code changes. `App.tsx`, `drawSkeleton.ts`, `adaptPoseResult.ts` are already correct.

---

## 3. QA Engineer — gates

- `vitest` `flag.test.ts` updated and green.
- `tsc --noEmit` clean; `eslint` 0 warnings.
- **Local prod smoke:** `npm run build && npm run preview` → open Coach tab → neon overlay renders (skeleton, arcs, cue chip). This is the real acceptance check — it reproduces the production condition that `npm run dev` hides.
- Existing Coach/CV suite stays green, untouched. If anything fails → STOP and report.

---

## 4. Git workflow + stages (commit per stage, push ONCE at end)

Same discipline as UI-11: one branch, local commits per green stage, a single push at the very end, then PR to `main`.

```
git checkout main && git pull
git checkout -b fix/overlay-neon-cutover
```

- **Stage 1 — Flip flag + tests.** Apply option A (or B), update `flag.test.ts`. **Gate:** vitest + tsc + eslint green. → commit `[UI-11] fix: default neon overlay on (prod cutover)` (no push).
- **Stage 2 — Prod-build smoke.** `npm run build && npm run preview`, confirm the overlay renders in the built app; note it in the PR body. **Gate:** manual smoke pass + full frontend gate. → commit `[UI-11] test: prod-build overlay smoke note` (no push).
- **Finish:** both stages committed + gates green → **push once** (`git push -u origin fix/overlay-neon-cutover`) → open **PR to `main`** → **STOP**.

---

## 5. ⚠️ MANUAL — cannot be done by Claude Code (do these yourself)

These need a running environment / external dashboards / a live server, so Claude Code must **flag and stop**, not attempt them:

1. **Redeploy the HF Space.** UI-11 + this fix only reach `origin`. To update the live app you must run `git push hf main` yourself after the PR is merged. (Nothing in this repo auto-deploys the Space.)
2. **Option B only — HF Space build variable.** If you chose option B, add `VITE_OVERLAY_NEON=true` in the Space's **Settings → Variables** (build-time), or it won't be inlined in the Space build. Option A avoids this entirely.
3. **Clear the PWA / service-worker cache.** The installed PWA caches the old JS bundle; after redeploy, hard-reload (or uninstall/reinstall the PWA, or bump the service-worker version) on each test device or you'll keep seeing the old overlay.
4. **Verify per-joint data (polish, separate).** Confirm from the live WS payload whether the server sends `joint_scores` and `measured_angles`. If it does not and you want per-joint precision (individual red/amber joints + exact server angles rather than the global-score fallback), that lives in `app/analysis/**` — **frozen core**, so it is a **separate core-adjacent prompt**, not part of this appearance fix. Flag it; do not fold it in here.

---

## 6. Out of scope

Any scorer/analysis change, backend, migrations, the `hf` push itself, PWA cache-busting infra, per-joint angle sourcing. This fix only makes the already-built neon overlay visible in a production build.
