/**
 * Adapts the frozen usePoseStream hook's PoseResult (app-level shape, verbose
 * scorer key names) into the neon overlay's read-only OverlayFrame (§3, short
 * key names). Pure mapping — unit/key conversion and the documented 0.5
 * confidence gate (CLAUDE.md "Confidence gate: skip any joint where
 * kp_conf[i] < 0.5") only. No new scoring, smoothing, or rep logic; reads
 * app/types.ts, never app/analysis/** or the WS handler.
 */
import type { PoseResult } from "../../../types"
import { bandFromScore } from "./overlayTheme"
import type { JointQuality } from "./overlayTheme"
import type { OverlayAngleKey, OverlayFrame, OverlayJointKey, OverlayKeypoint, OverlayTopState } from "./types"

const KEYPOINT_COUNT = 17
const CONF_GATE = 0.5
/** score >= this counts as "GOOD FORM" for the top status — matches lib/skeleton.ts's scoreColor "good" band. */
const GOOD_FORM_THRESHOLD = 80

/** Verbose scorer angle key -> the overlay's short joint key (§3.3). No
 * *_shoulder_angle entry: the default arc set has no shoulder arc (§10). */
const JOINT_KEY_MAP: Readonly<Record<string, OverlayJointKey>> = {
  left_elbow_angle: "lElbow",
  right_elbow_angle: "rElbow",
  left_hip_angle: "lHip",
  right_hip_angle: "rHip",
  left_knee_angle: "lKnee",
  right_knee_angle: "rKnee",
  hip_trunk_angle: "spine",
}

const ANGLE_KEY_MAP: Readonly<Record<string, OverlayAngleKey>> = {
  left_elbow_angle: "lElbow",
  right_elbow_angle: "rElbow",
  left_hip_angle: "lHip",
  right_hip_angle: "rHip",
  left_knee_angle: "lKnee",
  right_knee_angle: "rKnee",
}

function mapJointQuality(
  jointScores: Readonly<Record<string, number>> | undefined,
): Partial<Record<OverlayJointKey, JointQuality>> | undefined {
  if (jointScores === undefined) return undefined
  const out: Partial<Record<OverlayJointKey, JointQuality>> = {}
  for (const [verboseKey, score] of Object.entries(jointScores)) {
    const shortKey = JOINT_KEY_MAP[verboseKey]
    if (shortKey === undefined) continue
    out[shortKey] = bandFromScore(score)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function mapAngles(
  measuredAngles: Readonly<Record<string, number>> | undefined,
): Partial<Record<OverlayAngleKey, number>> | undefined {
  if (measuredAngles === undefined) return undefined
  const out: Partial<Record<OverlayAngleKey, number>> = {}
  for (const [verboseKey, degrees] of Object.entries(measuredAngles)) {
    const shortKey = ANGLE_KEY_MAP[verboseKey]
    if (shortKey === undefined) continue
    out[shortKey] = degrees
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function deriveState(result: PoseResult | null): OverlayTopState {
  if (result === null) return "idle"
  const status = result.status ?? "ok" // absent on older servers -> treat as ok
  if (status !== "ok") return "idle"
  if (result.score === null) return "idle"
  return result.score >= GOOD_FORM_THRESHOLD ? "good" : "error"
}

export function toOverlayFrame(result: PoseResult | null, mirrored: boolean): OverlayFrame {
  const keypoints: readonly OverlayKeypoint[] =
    result === null
      ? new Array<OverlayKeypoint>(KEYPOINT_COUNT).fill(null)
      : result.keypoints.map(([x, y], i) => {
          const score = result.confidence[i] ?? 0
          return score >= CONF_GATE ? { x, y, score } : null
        })

  return {
    keypoints,
    formScore: result?.score ?? null,
    jointQuality: mapJointQuality(result?.joint_scores),
    angles: mapAngles(result?.measured_angles),
    cue: result?.cues?.[0] ?? null,
    state: deriveState(result),
    mirrored,
  }
}
