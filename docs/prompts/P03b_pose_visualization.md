# P03b — Pose Overlay Visual Polish

## Goal
Upgrade the live pose-tracking overlay on the React frontend so the skeleton is informative, looks professional, and every visual element is data-driven (no decoration). Target audience: examiner demo + daily personal use.

## Prerequisites
- P03 WebSocket pipeline is live and streams `{ keypoints: [[x,y,conf]*17], form_score: number, joint_scores: {hip:0-100, knee:0-100, ...}, worst_joint: string, rep_state: "up"|"down"|"hold", rep_count: number }` to the frontend.
- A `<canvas>` is already mounted on top of the `<video>` element with matching dimensions.
- COCO 17-keypoint order. Bone edges defined in `frontend/src/lib/skeleton.ts` (create if missing).

## Deliverables (Implement ALL — do not skip)

### 1. Confidence-tinted joints
- For each of 17 keypoints, color the dot by `kp_conf`:
  - `>= 0.8` → `#22c55e` (green)
  - `0.5–0.8` → `#eab308` (yellow)
  - `< 0.5` → `#ef4444` (red), and reduce dot radius by 40%
- Joint dot radius scales with confidence: `r = 4 + conf * 4` (px).

### 2. Form-correctness bones
- Each bone (edge between two joints) gets colored by whether the joint at its "child" end is in-range per `ANGLE_RANGES`:
  - In range → `#10b981` (emerald)
  - Out of range → `#f43f5e` (rose)
  - Unscored bone (e.g., forearm during squat) → `#94a3b8` (slate, low opacity 0.6)
- Stroke width: 4px. Use `lineCap: "round"`, `lineJoin: "round"`.
- Backend must send `joint_scores` per frame; if missing, fall back to slate.

### 3. Worst-joint spotlight
- The joint listed in `worst_joint` pulses: animate its dot radius between `1.0x` and `1.4x` at 2 Hz using `Math.sin(performance.now()/250)`.
- Add a soft red halo using `ctx.shadowColor = "#ef4444"; ctx.shadowBlur = 20` for that joint only.
- Only active when `form_score < 70`. Above that, no spotlight.

### 4. Motion trails (stroboscopic)
- Keep a ring buffer of the last 8 keypoint frames in a `useRef`.
- Render older frames first, with opacity `0.08 * (i+1)` for the i-th past frame, joint radius 2px, no bones.
- Trail color: same as current confidence color but desaturated.
- Wipe the trail on `rep_state` transition from `"up"` to `"down"` (so trails don't pile up across reps).

### 5. Angle arcs at scored joints
- For each of the 3 scored joint triplets per exercise (read from `ANGLE_RANGES[exercise]`), draw:
  - An arc spanning the current measured angle, centered at the middle joint.
  - Radius 28px. Stroke width 3px.
  - Color matches the form-correctness color of that joint.
  - Degree label (e.g., `92°`) in 12px monospace, offset 36px from joint center, with a 2px black text-shadow for legibility.
- Arc opacity 0.85.

### 6. Velocity-based bone width
- Track per-joint velocity: `v = distance(prev_kp, curr_kp) * fps`.
- Bone stroke width modulates: `width = 3 + clamp(v / 200, 0, 3)` px.
- Smooth velocity with EMA α=0.4 to avoid jitter.

### 7. Skeleton breathing (eccentric phase)
- During `rep_state === "down"` (eccentric), add a subtle pulse to ALL joint radii: multiply by `1 + 0.08 * Math.sin(performance.now()/300)`.
- During `"hold"` (e.g., plank), use a slower 1 Hz pulse with amplitude 0.04.

### 8. Bevel-shaded bones (depth feel)
- Each bone drawn as TWO strokes:
  - Underlay: same color, +20% lightness (use HSL), full width, opacity 1.0.
  - Overlay: same color, -10% lightness, width - 1px, opacity 1.0, offset 1px down-right.
- Helper: `lighten(hex, amount)` and `darken(hex, amount)` in `frontend/src/lib/color.ts`.

### 9. Fake-depth joint scaling
- Estimate torso width: `tw = distance(left_shoulder, right_shoulder)`.
- Scale ALL joints by `tw / tw_reference` where `tw_reference` is the median torso width over the last 30 frames.
- Clamp scale to `[0.7, 1.4]` so jitter doesn't make the skeleton balloon.

### 10. Rep completion particle burst
- On every `rep_count` increment, spawn 18 particles at the worst-joint position (or hip if no worst).
- Particle: radius 3px, color `#22c55e` if `form_score >= 80` else `#f59e0b`.
- Velocity: random angle, speed 4–8 px/frame. Gravity 0.2 px/frame². Lifetime 600ms with linear fade.
- Use a separate `useRef` array; clean up dead particles each frame.

## File Layout
Create or modify:
```
frontend/src/
├── lib/
│   ├── skeleton.ts          # COCO 17-edge list, joint-name lookup
│   ├── color.ts             # lighten, darken, confColor, scoreColor helpers
│   └── poseRenderer.ts      # ALL rendering functions, pure (canvas, state) -> void
├── hooks/
│   ├── usePoseTrail.ts      # ring buffer of last 8 frames + reset on rep
│   ├── usePoseVelocity.ts   # per-joint EMA velocity
│   └── useParticles.ts      # spawn + tick particle system
└── components/
    └── PoseOverlay.tsx      # owns canvas, requestAnimationFrame loop, wires hooks
```

## Performance Rules
- Single `requestAnimationFrame` loop in `PoseOverlay`. No per-element re-renders.
- All canvas state is in `useRef` — NEVER `useState` for per-frame data (would re-render React).
- `ctx.save()` / `ctx.restore()` around every block that mutates global state (shadow, lineWidth).
- Cap effective FPS at 30 even if rAF fires faster: skip frame if `now - last < 33ms`.
- Use `OffscreenCanvas` for the trail layer if Chrome — fall back to a second `<canvas>` for Safari.

## Backend Contract Changes
Modify `app/api/v1/ws_inference.py` to include in each frame payload:
```python
{
  "keypoints": [[x, y, conf], ...],   # already there
  "form_score": float,                # already there
  "joint_scores": {"hip": 87, "knee": 62, "ankle": 91, ...},  # NEW
  "worst_joint": "knee",              # NEW
  "rep_state": "up" | "down" | "hold",  # NEW
  "rep_count": int,                   # already there
  "measured_angles": {"knee": 92.4, "hip": 88.1, ...}  # NEW for arc rendering
}
```
- Compute `joint_scores` in `app/analysis/form_scorer.py` — return a per-joint dict alongside the overall score. Each joint score = how close the joint angle is to the midpoint of its `ANGLE_RANGES` band, mapped to 0–100.
- `worst_joint` = `min(joint_scores, key=joint_scores.get)`.
- `rep_state` already tracked in P03 rep counter — surface it.

## Tests
Add to `tests/`:
- `test_joint_scores.py` — parametrize 3 known squat poses (good/borderline/bad), assert `joint_scores` shape + values within ±5.
- `test_worst_joint.py` — asserts argmin selection.

No frontend unit tests required (rendering is hard to assert) — manual visual QA via Playwright screenshot on a fixture frame in `e2e/pose_overlay.spec.ts`.

## Acceptance Checklist
- [ ] All 10 visual effects render on a live squat session at ≥ 25 fps on a Macbook Air M1.
- [ ] Dropping FPS to 15 (throttle DevTools) does not crash; effects gracefully degrade.
- [ ] Disabling the WebSocket → overlay shows last frame frozen, no JS errors in console.
- [ ] Worst-joint pulse stops when `form_score >= 70`.
- [ ] Particle burst fires exactly once per rep (no double-trigger on jittery rep state).
- [ ] Lighthouse perf score on the workout page ≥ 80 (mobile).
- [ ] No `print()` / `console.log` in shipped code.
- [ ] `ruff check app/`, `mypy app/ --strict`, `pytest -x --cov=app/analysis --cov-fail-under=80` all pass.

## Commit Format
```
[P03b] feat: data-driven pose overlay (confidence tint, form bones, trails, arcs, particles)

- joint dots colored by kp_conf, scaled by torso depth
- bones colored by per-joint form score with bevel shading
- velocity-modulated bone width, breathing during eccentric
- worst-joint spotlight + pulse when score < 70
- angle arcs with degree labels at 3 scored triplets
- 8-frame motion trails, wiped on rep transition
- particle burst on rep completion
- backend: joint_scores + worst_joint + rep_state in WS payload
```

## Out of Scope (Do Not Build)
- 3D rotation of the skeleton (we don't have z-depth from monocular YOLO)
- Heatmap overlays for muscle groups (premium feature, not P03b)
- AR-style "ghost trainer" demonstrating correct form (separate prompt P11+)
- Recording / replay UI (separate from rendering)
