/**
 * Fixed fixture frames for QA (§6): a "good" rep and a "fault" rep over the
 * same mid-squat pose, differing only in scoring/quality/cue — mirrors the
 * fixture shape already used by e2e/pose_overlay.spec.ts for the legacy
 * overlay. The `angles` labels are computed from the same POSE coordinates
 * via `angle()` (not hand-typed), so the printed degree pill always agrees
 * with the arc actually drawn from those keypoints. Used by the
 * overlay-preview harness and Playwright visual snapshots, never by
 * production code.
 */
import { angle } from "./geometry"
import type { Point2D } from "./geometry"
import type { OverlayFrame, OverlayKeypoint } from "./types"

const L_SHOULDER = 5
const R_SHOULDER = 6
const L_ELBOW = 7
const R_ELBOW = 8
const L_WRIST = 9
const R_WRIST = 10
const L_HIP = 11
const R_HIP = 12
const L_KNEE = 13
const R_KNEE = 14
const L_ANKLE = 15
const R_ANKLE = 16

// A mid-squat pose with knees genuinely tracking outside the hip/ankle line
// (so the front-view 2D projection reads a realistic bent angle, per the
// real Fit3D-derived squat percentiles in app/analysis/angle_ranges.json —
// bottom-of-rep left_knee_angle p5-p95 spans ~70-179deg, left_hip_angle
// ~64-157deg — rather than an anatomically-flat "L" shape.
const POSE: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.08], // nose
  [0.47, 0.075], // lEye
  [0.53, 0.075], // rEye
  [0.44, 0.08], // lEar
  [0.56, 0.08], // rEar
  [0.38, 0.22], // lShoulder
  [0.62, 0.22], // rShoulder
  [0.3, 0.34], // lElbow
  [0.7, 0.34], // rElbow
  [0.34, 0.46], // lWrist
  [0.66, 0.46], // rWrist
  [0.42, 0.52], // lHip
  [0.58, 0.52], // rHip
  [0.26, 0.62], // lKnee — tracked out
  [0.74, 0.62], // rKnee — tracked out
  [0.4, 0.92], // lAnkle
  [0.6, 0.92], // rAnkle
]

const keypoints: readonly OverlayKeypoint[] = POSE.map(([x, y]) => ({ x, y, score: 0.9 }))

function pt(i: number): Point2D {
  const [x, y] = POSE[i]
  return { x, y }
}

// Computed straight from POSE, so the printed label always matches the arc.
const ANGLES = {
  lKnee: Math.round(angle(pt(L_HIP), pt(L_KNEE), pt(L_ANKLE))),
  rKnee: Math.round(angle(pt(R_HIP), pt(R_KNEE), pt(R_ANKLE))),
  lHip: Math.round(angle(pt(L_SHOULDER), pt(L_HIP), pt(L_KNEE))),
  rHip: Math.round(angle(pt(R_SHOULDER), pt(R_HIP), pt(R_KNEE))),
  lElbow: Math.round(angle(pt(L_SHOULDER), pt(L_ELBOW), pt(L_WRIST))),
  rElbow: Math.round(angle(pt(R_SHOULDER), pt(R_ELBOW), pt(R_WRIST))),
} as const

export const GOOD_FRAME: OverlayFrame = {
  keypoints,
  formScore: 92,
  jointQuality: {
    lElbow: "good",
    rElbow: "good",
    lHip: "good",
    rHip: "good",
    lKnee: "good",
    rKnee: "good",
    spine: "good",
  },
  angles: ANGLES,
  cue: "Nice depth — keep your chest up",
  state: "good",
  mirrored: true,
}

export const FAULT_FRAME: OverlayFrame = {
  keypoints,
  formScore: 55,
  jointQuality: {
    lElbow: "warn",
    rElbow: "warn",
    lHip: "error",
    rHip: "warn",
    lKnee: "error",
    rKnee: "warn",
    spine: "error",
  },
  angles: ANGLES,
  cue: "Squat deeper for full range",
  state: "error",
  mirrored: true,
}

export const IDLE_FRAME: OverlayFrame = {
  keypoints: POSE.map(() => null),
  formScore: null,
  cue: null,
  state: "idle",
  mirrored: true,
}

export const FIXTURES = { good: GOOD_FRAME, fault: FAULT_FRAME, idle: IDLE_FRAME } as const
export type FixtureName = keyof typeof FIXTURES

// Native aspect ratio this POSE was authored against (square) — the preview
// harness sizes its stage to match so canvas-space angles equal these
// precomputed ones exactly (cover-fit is a uniform scale only when the
// "video" and canvas aspect ratios match, see OverlayPreview.tsx).
export const FIXTURE_ASPECT = "1 / 1"
