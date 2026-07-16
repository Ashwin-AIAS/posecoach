# Premium Pose Overlay — Cyber Neon HUD (UI-11)

> **Track:** Appearance-only frontend (same tier as UI-00→UI-10).
> **Status:** SPEC / not started.
> **Placement:** `docs/enhancements/PREMIUM_POSE_OVERLAY_UI11.md`
> **Owner path:** Frontend Engineer (lead), Thesis Advisor (SUS mapping), QA (visual + unit gates), DevOps/MLOps (git: one branch, commit per stage, single push at end — see §7).
> **Binding docs to read first:** `docs/enhancements/WORKOUT_NUTRITION_ROADMAP_P23-P28.md`, then this file, then `CLAUDE.md`.

---

## 0. Project Leader — goal, risk, guardrail ruling

**Goal.** Replace the current flat green-dot / red-line overlay in the Coach tab with a **premium cyber-neon HUD**: glowing keypoint nodes, a tapered glowing skeleton, live **joint-angle arcs** with degree readouts, and **color-coded per-joint form feedback** (on-target / adjust / correct) plus a single plain-English coaching cue chip. The purpose is to make the live-coaching view feel credible and premium for **user-study participants** — this directly serves the thesis **SUS ≥ 70 (n ≥ 10)** gate that is still ⏳.

**The guardrail tension (resolved).** The existing overlay is part of the **FROZEN** frontend camera/pose layer. This task must therefore be **additive and appearance-only**:

- Do **NOT** modify `app/api/v1/ws_inference.py`, `app/inference/**`, `app/analysis/**`, the model lifespan, or any **frozen** frontend camera/pose **hook** (the hook that receives WS keypoints).
- Do **NOT** re-implement scoring, smoothing, rep-counting, or keypoint decoding. This layer is **pure presentation** — it renders finished data it is handed.
- Build a **new** presentational component that consumes the already-decoded keypoints + form data as **props** and draws the HUD. Wire it in at the Coach view render site only (a one-line swap), behind a feature flag, with the old overlay kept intact for rollback.
- Dark-only, English-only. No new tables, no new backend, no network calls from this layer.

**Decision Claude Code must confirm on Stage 0** (see §7): whether the *current* overlay renderer component is itself on the frozen list in the roadmap doc.
- If **frozen** → add the new component **alongside** and select it via flag (never edit the frozen file).
- If **not frozen** (it's an appearance-tier component like the UI-xx work) → the new component **replaces** its body, old code preserved behind the flag.
Either way the **data path is untouched**.

**Top risks.** (1) Per-frame render cost on the 30 fps webcam loop — mitigated by Canvas 2D + cheap "underlay glow" instead of `shadowBlur` (§4.4). (2) Coordinate/mirroring mismatch vs. the video element — mitigated by the transform contract in §4.2. (3) Reading per-joint quality the scorer may not expose — mitigated by the graceful-degrade contract in §3.2.

---

## 1. Reference — what "done" looks like

The target is the neon HUD mockup approved in the Cowork session. Reproduce these elements exactly:

- **Dark camera viewport** with a faint dotted grid and a soft radial vignette (the overlay draws over the live `<video>`; the grid/vignette are drawn by the overlay at low alpha).
- **Skeleton bones** — glowing, round-capped, ~5.5 px core, colored per joint quality.
- **Keypoint nodes** — a dark-filled disc with a bright 2.4 px ring + a solid inner core, plus a soft outer glow halo; major joints (shoulder/hip/knee) slightly larger and gently pulsing.
- **Angle arcs** — a 3 px arc at each evaluated joint spanning the interior angle, with a small pill label showing the integer degree (e.g. `77°`), colored to the joint's quality.
- **HUD chrome** — thin corner brackets, a top status line `POSECOACH · LIVE FORM ENGINE` + a colored state dot with `GOOD FORM` / `FORM ERROR`, a bottom coaching-cue chip with a check/✕ glyph, and a 3-item legend (ON TARGET / ADJUST / CORRECT).
- **Motion** — a slow vertical scan-shimmer and subtle node pulse for a "live" feel (respect `prefers-reduced-motion`).

---

## 2. Visual design system (exact tokens)

Put these in a single module, e.g. `frontend/src/features/coach/overlay/overlayTheme.ts`.

```ts
export const OVERLAY = {
  color: {
    base:  '#35E4FF', // neutral cyan — unevaluated bones/nodes, neck, foot, forearm
    good:  '#2BF5B0', // mint neon — on target
    warn:  '#FFC24B', // amber — adjust
    error: '#FF4D6D', // rose-red — correct
    dim:   '#8FA3C0', // HUD labels
    node:  '#0A1120', // node inner fill (dark)
    chipBg:'rgba(7,12,22,0.90)',
  },
  bg: { inner:'#0E1626', mid:'#070C16', outer:'#03060C' }, // radial vignette stops 0/60/100%
  grid: { size: 34, stroke: 'rgba(120,150,200,0.06)' },
  bone: { width: 5.5, spineWidth: 6 },
  node: { rSmall: 5.5, rBig: 7, ringWidth: 2.4, haloSmall: 9, haloBig: 13, haloAlpha: 0.16 },
  arc:  { rKnee: 30, rHip: 30, rElbow: 24, width: 3, labelOffset: 22 },
  glow: { spread: 4, underlayAlpha: 0.35 }, // see §4.4 cheap-glow
  motion: { scanPeriodMs: 4200, pulsePeriodMs: 2400 },
} as const;
```

**Quality → color** is the only semantic mapping: `good→mint`, `warn→amber`, `error→rose`, everything unevaluated → `base` cyan. Keep to these two ramps only.

---

## 3. Data contract (READ-ONLY — this is the whole integration surface)

### 3.1 Input props

The new component receives a single per-frame view-model. It **does not** open the WebSocket, decode keypoints, or compute anything — the existing (frozen) hook already produces this; the overlay just consumes it.

```ts
// 17 COCO keypoints, normalized (xyn), already conf-gated (0.5) upstream.
// null = below confidence / not present this frame.
type KP = { x: number; y: number; score: number } | null;

type JointQuality = 'good' | 'warn' | 'error' | 'base';

interface OverlayFrame {
  keypoints: KP[];                 // length 17, COCO order (§3.3)
  formScore: number | null;        // 0..100 global score (already computed)
  jointQuality?: Partial<Record<   // per-joint quality IF the scorer exposes it
    'lElbow'|'rElbow'|'lHip'|'rHip'|'lKnee'|'rKnee'|'spine', JointQuality
  >>;
  angles?: Partial<Record<         // measured joint angles in degrees IF exposed
    'lElbow'|'rElbow'|'lHip'|'rHip'|'lKnee'|'rKnee', number
  >>;
  cue: string | null;              // plain-English coaching cue (already produced)
  state: 'good' | 'error' | 'idle';// top status; derive from score if absent (§3.2)
  mirrored: boolean;               // true for selfie/front camera
}
```

### 3.2 Graceful degrade (do not add scoring)

The scorer output shape is owned by the frozen `app/analysis/**`; this layer must adapt to whatever it already returns:

- **If `jointQuality` is provided** → color each joint from it directly.
- **If only `formScore` is provided** → derive a single quality band and apply it to all evaluated joints and the cue chip: `≥85 good`, `70–84 warn`, `<70 error`. This keeps the overlay correct without touching the scorer.
- **If `angles` is provided** → label arcs with real degrees. **Else** compute the display angle geometrically from the three keypoints (pure trig, presentation-only — this is *display*, not scoring, and must never feed back into the score).
- **If `cue` is null** → hide the chip. **If `state` is `idle`** (no person / low conf) → dim skeleton to `base` at 40% and show `SEARCHING…`.

> Confirm on Stage 0 exactly which of `jointQuality` / `angles` / `state` the current hook already surfaces. Whatever is missing is derived on the presentation side per the rules above — **never** by editing the analysis core.

### 3.3 COCO-17 index map + skeleton edges

```
0 nose  1 lEye  2 rEye  3 lEar  4 rEar
5 lShoulder 6 rShoulder 7 lElbow 8 rElbow 9 lWrist 10 rWrist
11 lHip 12 rHip 13 lKnee 14 rKnee 15 lAnkle 16 rAnkle

Bones (draw in this order):
  face:   0-1,0-2,1-3,2-4         (base, thin, optional)
  arms:   5-7,7-9, 6-8,8-10       (color: elbow quality)
  torso:  5-6, 5-11,6-12, 11-12   (color: spine quality; 5-11 & 6-12 = spine sides)
  legs:   11-13,13-15, 12-14,14-16(thigh color: worst(hip,knee); shin color: knee)

Angle arcs (default set — configurable per exercise later):
  lKnee = angle(11,13,15)   rKnee = angle(12,14,16)
  lHip  = angle(5,11,13)    rHip  = angle(6,12,14)
  lElbow= angle(5,7,9)      rElbow= angle(6,8,10)
```

---

## 4. Frontend Engineer — implementation

### 4.1 Files (all NEW, additive)

```
frontend/src/features/coach/overlay/
  overlayTheme.ts          # §2 tokens
  geometry.ts              # angle(), arcPath/arcSweep(), toCanvasXY(), pure — unit-tested
  PoseOverlayNeon.tsx      # the component: <canvas> + rAF draw loop, props = OverlayFrame
  drawHud.ts               # corner brackets, status line, cue chip, legend, grid, vignette
  drawSkeleton.ts          # bones, nodes, arcs
  index.ts
frontend/src/features/coach/overlay/__tests__/
  geometry.test.ts         # vitest
```

Wire-in: at the Coach view render site, select overlay by flag
`VITE_OVERLAY_NEON` (default **on** in dev, gated for prod cutover):

```tsx
{overlayNeon
  ? <PoseOverlayNeon frame={overlayFrame} className="coach-overlay" />
  : <PoseOverlayLegacy .../>}
```

`overlayFrame` is assembled from the values the **existing** hook already returns — no new subscriptions.

### 4.2 Rendering approach + coordinate/mirroring contract

- **Canvas 2D**, not SVG. SVG DOM churn at 30 fps is too heavy; the mockup was SVG only for illustration. One `<canvas>` absolutely positioned over the `<video>`, same box.
- Size the backing store to **`devicePixelRatio`**: `canvas.width = cssW * dpr` etc., then `ctx.scale(dpr, dpr)`; draw in CSS px.
- Keypoints are **normalized (xyn)**. Map to canvas with the **same object-fit transform the video uses** (`object-fit: cover` → compute the cover scale + letterbox offset so joints sit on the body, not the padded box):

```ts
// toCanvasXY: n in [0,1] -> css px, honoring cover-fit + mirror
x = mirrored ? (1 - n.x) : n.x;
px = offsetX + x * drawW;   // drawW/offsetX from cover-fit of video into canvas
py = offsetY + n.y * drawH;
```

- **Mirror** for front camera (`mirrored`) — flip X only, and flip arc sweep + label side accordingly.
- Draw every frame the hook emits; if the hook is slower than the display, keep the **last** pose (the core already does hold-last-pose hysteresis) and just re-run the scan/pulse animation via `requestAnimationFrame`.

### 4.3 Draw order (per frame)

1. `clearRect`.
2. Grid + radial vignette (low alpha; skip the vignette if it hurts contrast on real video — A/B in study).
3. Bones (glow underlay pass, then bright core — §4.4).
4. Angle arcs + degree pills.
5. Keypoint nodes (halo → ring → core).
6. HUD chrome: corner brackets, top status, cue chip, legend.
7. Scan-shimmer band (translucent gradient rect advanced by `t`).

### 4.4 Neon glow WITHOUT killing the frame budget

`ctx.shadowBlur` per stroke is the obvious way and the slow way. Use a **two-pass core-and-underlay** instead:

```ts
// underlay: same path, wider + translucent = the "glow"
ctx.lineCap = 'round';
ctx.strokeStyle = hexToRgba(color, 0.35);
ctx.lineWidth  = width + 7;
strokeBone();
// core: full-bright, thin
ctx.strokeStyle = color;
ctx.lineWidth  = width;
strokeBone();
```

Reserve `shadowBlur` only for the ≤10 node halos and the status dot, capped at `spread:4`. Target **overlay draw ≤ 4 ms/frame** on the RTX-3050 dev box; if the study runs on weaker laptops, expose a `?lowfx=1` that drops the scan band + node pulse.

### 4.5 Spine rounding cue (nice-to-have, keep if cheap)

To echo the mockup's "back rounding" read, draw the two spine sides (5-11, 6-12) as a slight quadratic bow whose control-point offset scales with the spine deviation the scorer reports. Purely visual; skip if `jointQuality.spine` is unavailable.

### 4.6 Accessibility & dark-only

- Wrap in a container with `role="img"` and an `aria-label` that restates `state` + `cue` (screen-reader parity with the visual).
- Honor `prefers-reduced-motion: reduce` → no scan band, no pulse (static nodes).
- No light theme. No text below 11 px. Cue chip contrast ≥ 4.5:1 against the dark viewport.

---

## 5. ML / Analysis Engineer — read-only contract note

Nothing to build here. Confirmation only: expose (or confirm already exposed) on the existing hook's per-frame payload the fields in §3.1 (`formScore`, optional `jointQuality`, optional `angles`, `cue`, `state`). If any require a change **inside** `app/analysis/**` to surface, that is **out of scope for UI-11** — STOP and raise it as a separate core-adjacent prompt; do not fold it in here.

---

## 6. QA Engineer — gates

- **vitest** `geometry.test.ts`: `angle()` returns 90° for an L-shape, 180° for collinear, is orientation-independent; `toCanvasXY()` respects mirror + cover-fit (table of known cases).
- **tsc** `--noEmit` clean; **eslint** 0 warnings.
- **Playwright** visual: mount `PoseOverlayNeon` with two fixed fixture frames (`good`, `fault`) over a static poster image; snapshot both; assert the cue chip text + status dot color per state. This is the layout-touching gate.
- **Regression:** the existing Coach/CV suite must stay green **untouched**. If any existing test fails → STOP and report (do not "fix" by editing the core).

**Full checkpoint gate:** `tsc --noEmit` · `eslint` 0 warnings · `vitest` · Playwright green · backend `pytest -x --timeout=30 --cov=app/analysis --cov-fail-under=80` still passing (should be unaffected).

---

## 7. Git workflow + staged plan (UI-11 override — commit per stage, push ONCE at end)

> **Deliberate deviation from the default project discipline, by request for UI-11.**
> The standard rule is commit **and push** after every green stage. For this feature we
> instead keep **one dedicated feature branch**, **commit after each stage's gate is green**,
> and **push the whole branch a single time at the very end** — only after the *entire* plan
> is complete and the final checkpoint gate passes — then open the PR. Owned by the
> **DevOps/MLOps Engineer** role.

**Branch (cut once, off up-to-date `main`):**
```
git checkout main && git pull
git checkout -b feat/ui11-premium-overlay   # rename if you prefer, e.g. premium-overlay — ONE branch for the whole feature
```

**Rule per stage:** run the stage's acceptance gate → when green, `git add` + `git commit -m "[UI-11] …"`.
**Do NOT `git push` between stages.** Commit locally, one stage at a time, strictly in order.

**End of plan only — single push + PR:**
```
git push -u origin feat/ui11-premium-overlay   # the ONE and only push, after all stages + final gate green
# open PR -> main, then STOP
```

Stages (each ends with a **local commit, no push**):

- **Stage 0 — Recon (no code).** Open `WORKOUT_NUTRITION_ROADMAP_P23-P28.md`; determine whether the current overlay component is frozen (→ add-alongside) or appearance-tier (→ replace-with-flag). Confirm which of `jointQuality`/`angles`/`state` the hook already emits. Write findings as a 6-line comment block at the top of `PoseOverlayNeon.tsx`. **Gate:** findings recorded, approach chosen. → commit `[UI-11] docs: overlay recon` (no push).
- **Stage 1 — Geometry + theme.** `overlayTheme.ts`, `geometry.ts`, vitest. **Gate:** vitest + tsc + eslint green. → commit `[UI-11] feat: overlay theme + geometry helpers` (no push).
- **Stage 2 — Skeleton + nodes + arcs** over a static poster (no live video yet), driven by the `good`/`fault` fixtures. **Gate:** Playwright snapshot for both states. → commit `[UI-11] feat: neon skeleton, nodes, angle arcs` (no push).
- **Stage 3 — HUD chrome + motion** (brackets, status, cue chip, legend, scan/pulse, reduced-motion). **Gate:** Playwright updated snapshots; reduced-motion path verified. → commit `[UI-11] feat: HUD chrome + motion` (no push).
- **Stage 4 — Live wiring + flag.** Assemble `OverlayFrame` from the existing hook; mount over `<video>` behind `VITE_OVERLAY_NEON`; DPR + cover-fit + mirror correct on real camera. **Gate:** full checkpoint gate (§6); manual smoke on front + rear camera. → commit `[UI-11] feat: live wiring behind VITE_OVERLAY_NEON` (no push).
- **Stage 5 — Perf + polish.** Confirm ≤4 ms/frame draw; add `?lowfx=1`; final contrast/spacing pass. **Gate:** perf note in PR; full gate green. → commit `[UI-11] perf: cheap-glow + lowfx polish` (no push).
- **Finish:** all stages committed + final gate green → **push the branch once** (`git push -u origin feat/ui11-premium-overlay`) → open **PR to `main`** → **STOP**.

> Note for the DevOps/MLOps agent: nothing goes to the `hf` remote in UI-11. Single push to `origin` only, at the end.

---

## 8. Thesis Advisor — metric mapping

- Primary: **SUS ≥ 70 (n ≥ 10)** ⏳ — a premium, legible coaching overlay is the single highest-leverage lever on perceived usability/aesthetics in the study; this is the point of UI-11.
- Secondary/product: qualitative "coaching clarity" — the per-joint color + single-cue design reduces cognitive load vs. a raw skeleton.
- **Non-metric guardrail:** overlay must not change any measured CV number. `form-score variance < 5%` (✅ 3.35%) and `latency p95 < 100ms` (✅ 57.2/40ms) must be **identical** before/after — this layer is presentation-only. Capture one before/after `inference_complete` latency sample in the PR to prove no regression.

---

## 9. Privacy / integrity checklist

- Frames never written to disk (overlay reads pixels from the live `<video>`/keypoints in memory only). ✅
- No JWT/localStorage, no network, no API keys in this layer. ✅
- `structlog` only if any logging is added (prefer none in the render loop). ✅
- Every added file is additive; no existing table/component behavior altered. ✅

---

## 10. Out of scope (do NOT do in UI-11)

Rep counter, form-score ring, any change to scoring/smoothing/rep logic, any backend or migration, exercise-specific arc sets (later), light theme, i18n. Angle arcs + color-coded feedback only, per the approved mockup.
