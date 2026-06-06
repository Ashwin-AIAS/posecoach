# PoseCoach — Premium Frontend Features: Implementation Plan

> Paste-ready spec for Claude Code. Each feature below is an independent unit with
> exact file touch points, code-level changes, thesis-metric mapping, and verification.
> Ship them one at a time, gating each behind the quality gate + `/verify`.

---

## 0. Guardrails (read before any edit)

These come from the project's own `CLAUDE.md` and `.claude/rules/`. Do not violate:

- **Thesis-first.** Every feature here must map to a thesis evaluation metric. Items in
  §5 ("Out of scope") are explicitly NOT to be built for the thesis.
- **Prompt ordering.** The repo executes prompts P01→P10 in order; **P03 (WebSocket +
  Inference) is next**. Features 1 and 2 fit *inside* P03's frontend work. Features 3 and 4
  are small follow-ons — do them as a deliberate frontend-polish unit, not a mid-P03 detour.
- **Frontend rules:** TypeScript strict, **no `any`**, Tailwind utility classes only (no
  inline styles except dynamic values), PascalCase components / camelCase hooks,
  `requestAnimationFrame` for the camera loop (never `setInterval`), **never** put work on the
  frame path that isn't needed. **No `localStorage`/`sessionStorage`** for auth.
- **Backend rules (only relevant if you touch the server — you shouldn't for 3 of 4):**
  `structlog` not `print`; never log frames/keypoint arrays/PII; **never pass `end2end=False`**
  to YOLO; keypoints via `.xyn`.
- **Tests:** frontend = Vitest (`cd frontend && npx vitest run`); keep tests beside the
  feature in `frontend/src/__tests__/`. Quality gate must stay green.

---

## 1. Back-camera / Tripod Mode  ⭐ (primary request)

**Why it's worth it:** the back camera's win is *framing and optics*, not megapixels — the
pipeline downsamples every frame to 320×240 @ 2 FPS and YOLO runs at 640px, so sensor
resolution barely reaches the model. The real benefit: the user can prop the phone on a
tripod and step back to get their **whole body in frame**, which is exactly what squat /
deadlift scoring needs (fewer joints fall below the 0.5 confidence gate).

**Thesis mapping:** "tripod/rear-camera framing increases keypoint visibility" is a
measurable ablation — compare mean keypoint confidence and the count of sub-0.5 joints,
front vs. back framing. Map to *keypoint visibility / detection completeness*.

**Current state (already half-built):**
- `frontend/src/hooks/useCamera.ts` already accepts `facingMode: "user" | "environment"`.
- `frontend/src/App.tsx` hardcodes `facingMode: "user"` and calls `camera.start()` once.
- `frontend/src/index.css` flips **both** the video and the skeleton overlay together:
  `video.mirror, canvas.pose-overlay { transform: scaleX(-1) }`.

**Key insight — do NOT flip keypoints in JS.** `usePoseStream` captures the *raw,
unmirrored* video to its canvas, so model keypoints are always in true coordinates. The CSS
flip on the overlay exists only to match the mirrored *display*. Therefore: for the back
camera, simply **drop the mirror class on both `<video>` and the overlay `<canvas>`** and
everything stays aligned. No coordinate math.

### Changes

**`frontend/src/index.css`** — make the flip class-driven so it can be toggled per element:
```css
/* Replace the existing combined rule with a single reusable class. */
.mirror {
  -webkit-transform: scaleX(-1);
  transform: scaleX(-1);
}
```

**`frontend/src/hooks/useCamera.ts`** — support runtime switching:
- Track the active `facingMode` in state (initialise from options).
- Add `flip()` that `stop()`s the current stream, toggles `user`⇄`environment`, then
  `start()`s again. The current `start()` early-returns on an existing stream, so the flip
  MUST stop first.
- For `environment`, request a larger source (e.g. `{ width: 1280, height: 720 }`) so the
  320×240 downsample is cleaner; keep 640×480 for `user`.
- Wrap acquisition in try/catch and fall back to the previous mode if the requested camera
  doesn't exist (desktops have one camera; `facingMode` is ignored gracefully there).
- Return `{ facingMode, flip }` in addition to the existing API.

**`frontend/src/components/CameraFeed.tsx`** — add a `mirrored: boolean` prop; apply the
`mirror` class only when `mirrored` is true:
```tsx
className={`${mirrored ? "mirror " : ""}h-full w-full object-cover`}
```

**`frontend/src/components/PoseOverlay.tsx`** — add a `mirrored: boolean` prop; apply the
`mirror` class to the overlay `<canvas>` only when `mirrored` is true. (It currently relies
on the CSS rule keyed off `canvas.pose-overlay`; switch it to the shared `.mirror` class.)

**`frontend/src/App.tsx`** — own the state and wire the UI:
- `const [facingMode, setFacingMode] = useState<"user" | "environment">("user")`.
- Pass `facingMode` into `useCamera`; pass `mirrored={facingMode === "user"}` to both
  `CameraFeed` and `PoseOverlay`.
- Add a **Flip camera** button (icon, e.g. 🔄) in `CameraHud` or the header that calls
  `camera.flip()` and updates `facingMode`. Make it `pointer-events-auto` since the HUD is
  pass-through.
- `<video>` already has `playsInline` (required for iOS) — keep it.

### Acceptance criteria
- On a phone, the flip button switches front⇄back; the back camera is **not** mirrored and
  the skeleton overlay still lands on the correct limbs.
- On desktop (single camera), the button is harmless — no crash, falls back gracefully.
- Frame path unchanged: still 2 FPS, still off the async loop.

### Tests (`frontend/src/__tests__/`)
- `CameraFeed.mirror.test.tsx`: asserts the `mirror` class is present for `mirrored` and
  absent otherwise.
- Extend a `useCamera` test (mock `navigator.mediaDevices.getUserMedia`): `flip()` stops the
  old stream and requests the new `facingMode`.

---

## 2. "Worst-Joint" Callout  ⭐ (signature differentiator, frontend-only)

**Why:** this is Kemtai's headline feature — show the *exact* body part to fix. It's also
literally your thesis contribution over the single-angle AIGym baseline (multi-joint Fit3D
scoring). **Zero backend work** — `PoseResult.joint_scores` (per-joint 0–100, keyed by names
like `"left_knee_angle"`) is already computed in `form_scorer.py` and streamed by
`ws_inference.py`.

**Thesis mapping:** *form-scoring richness* — "we surface the lowest-scoring joint, enabled
by multi-joint scoring, which a single-angle rep counter cannot."

### Changes
- Add a helper (e.g. `frontend/src/lib/joints.ts`) mapping each `joint_scores` key →
  `{ keypointIndex, bodyPart }`. **Read the exact key strings from the `ANGLE_RANGES` dict in
  `app/analysis/form_scorer.py`** — do not guess them. COCO-17 index reference for the
  highlight: `5/6 shoulders, 7/8 elbows, 9/10 wrists, 11/12 hips, 13/14 knees, 15/16 ankles`.
- In `App.tsx` (or a small `useWorstJoint(result)` hook): compute `argmin(joint_scores)` only
  when the overall score is below a threshold (e.g. < 80) so it doesn't nag on good reps.
- In `PoseOverlay.tsx`: draw the worst joint's keypoint with an emphasised red ring / pulse,
  on top of the normal skeleton.
- Optional chip in `CameraHud`: `Fix: left knee` (plain English, ≤ 8 words — matches the cue
  rule).

### Acceptance criteria
- When a rep scores poorly, the offending joint is visibly highlighted and named.
- When form is good, no highlight (no false alarms).
- Highlight stays aligned under both mirror states from Feature 1.

### Test
- `worstJoint.test.ts`: given a `joint_scores` map, returns the correct key/index; returns
  `null` when overall score is high.

---

## 3. Per-Rep Score Timeline

**Why:** Kemtai/Onyx give a per-rep score, not just a session average. You already stream
`reps` and `score`; you just aren't capturing score *per rep*.

**Thesis mapping:** *rep-counter accuracy + form-score consistency* — per-rep granularity is
useful evaluation data and demos well.

### Changes
- `frontend/src/hooks/useSessionStats.ts`: add a `repScores` ref (array). In the existing
  `useEffect`, detect when `result.reps` **increments** (compare to a `lastReps` ref); on
  increment, push the current score into `repScores`. Expose `repScores` in `snapshot()` and
  clear it in `reset()`.
  - *Caveat to note in code:* the instantaneous score at the rep boundary can be noisy. v1 =
    snapshot score on increment. A cleaner v2 tracks the representative (e.g. min) score
    within each rep window — leave a `// TODO(v2)` comment.
- `frontend/src/components/SessionSummary.tsx`: render `repScores` as a small sparkline / bar
  row (canvas or pure SVG with Tailwind — no new deps).

### Acceptance criteria
- Finishing a set shows one score bar per counted rep; bar count == rep count.
- Plank (isometric, `reps == 0`) shows the hold timeline instead, not an empty chart.

### Test
- Extend `useSessionStats`-style test: feed a sequence where `reps` climbs 0→1→2→3 with
  varying scores; assert `snapshot().repScores` captures one entry per increment.

---

## 4. Progress-Over-Time Analytics

**Why:** "track your progress" is the most common premium hook. **No backend work** —
`GET /api/v1/history/sessions` already returns `{ exercise, rep_count, avg_form_score,
started_at, ended_at }` per session, fetched via the cookie-auth `apiFetch` in
`frontend/src/lib/api.ts`.

**Thesis mapping:** *longitudinal engagement / user-study narrative* — measurable.

### Changes
- In `frontend/src/components/HistoryPanel.tsx`: fetch the session list (it likely already
  does), group by `exercise`, and plot `avg_form_score` over `started_at`.
- Render a lightweight line/area chart in pure SVG (no chart library — keep the bundle lean
  and PWA-fast). A simple `points` polyline scaled to the panel width is enough.
- Add an exercise filter (reuse the existing exercise metadata in `lib/exercises.ts`).

### Acceptance criteria
- The panel shows a trend line of average form score across sessions, filterable by exercise.
- Empty state (no history yet) renders a friendly hint, not a broken axis.

### Test
- `HistoryTrend.test.tsx`: given a mocked session list, the chart renders the right number of
  points and the empty state when the list is empty.

---

## 4b. Premium UI polish (optional, low-risk, no thesis metric)

Cheap wins that make it *feel* premium. None require backend changes; none are thesis
deliverables — do them only if time allows after the above.

- **Haptic on rep complete:** `navigator.vibrate?.(30)` when `reps` increments (mobile only;
  guard for support). Wire it in the same place as Feature 3's increment detection.
- **Animated transitions:** count-up on the rep number; smooth color interpolation on the
  `ScoreRing` between bad→mid→good.
- **Tripod position guide:** a one-time silhouette overlay ("step back until your whole body
  fits") shown when entering back-camera mode. Borderline thesis-useful since it improves
  framing/data quality — but treat as polish.

---

## 5. Out of scope for the thesis (do NOT build now)

Competitors have these, but none map to a CV evaluation metric — building them burns thesis
time and risks scope creep against the P01→P10 sequence:

- Gamification: streaks, badges, leaderboards, challenges.
- Workout programming / plan libraries / nutrition tracking.
- Social sharing / feed.
- Subscription tiers / paywall.
- **Progress photos & body measurements** — additionally these *conflict with your own GDPR
  rule* ("never store user frames/images"). Hard no.

Park these in a "post-submission / portfolio" backlog.

---

## 6. Suggested order & verification

1. **Feature 1 (back camera)** — inside P03 frontend work.
2. **Feature 2 (worst-joint)** — inside P03; pairs naturally with the overlay work.
3. **Feature 3 (per-rep timeline)** then **Feature 4 (progress trend)** — a dedicated
   frontend-polish unit after P03 stabilises.
4. **§4b polish** — last, only if time allows.

After each feature:
```bash
cd frontend && npx vitest run            # unit tests green
cd frontend && npx tsc --noEmit          # strict types, no `any`
cd frontend && npx playwright test        # if E2E touched
```
Then run the project quality gate / `/verify` before checkpointing. Commit format:
`[P03] feat: rear-camera tripod mode with conditional mirror`.
