/**
 * Worst-joint callout support — maps each backend `joint_scores` key to the
 * COCO-17 keypoint that vertexes its angle, plus a plain-English body-part name.
 *
 * Key strings are taken verbatim from `app/analysis/form_scorer.py`
 * (`_EXERCISE_JOINTS`); each vertex index matches `ANGLE_TRIPLETS` in
 * `app/analysis/keypoint_utils.py` (the middle, vertex, keypoint).
 */

import { KP } from "./skeleton"

export interface JointInfo {
  /** COCO-17 keypoint index to highlight (the angle's vertex). */
  readonly keypointIndex: number
  /** Plain-English body part for the callout chip (≤ 8 words overall). */
  readonly bodyPart: string
}

/**
 * `hip_trunk_angle` is computed at the hip midpoint (no single keypoint), so we
 * anchor its highlight to the left hip and label it "core".
 */
export const JOINT_INFO: Readonly<Record<string, JointInfo>> = {
  left_knee_angle: { keypointIndex: KP.LEFT_KNEE, bodyPart: "left knee" },
  right_knee_angle: { keypointIndex: KP.RIGHT_KNEE, bodyPart: "right knee" },
  left_hip_angle: { keypointIndex: KP.LEFT_HIP, bodyPart: "left hip" },
  right_hip_angle: { keypointIndex: KP.RIGHT_HIP, bodyPart: "right hip" },
  left_elbow_angle: { keypointIndex: KP.LEFT_ELBOW, bodyPart: "left elbow" },
  right_elbow_angle: { keypointIndex: KP.RIGHT_ELBOW, bodyPart: "right elbow" },
  left_shoulder_angle: { keypointIndex: KP.LEFT_SHOULDER, bodyPart: "left shoulder" },
  right_shoulder_angle: { keypointIndex: KP.RIGHT_SHOULDER, bodyPart: "right shoulder" },
  hip_trunk_angle: { keypointIndex: KP.LEFT_HIP, bodyPart: "core" },
}

/** Only nag when the overall form score is below this (good reps stay clean). */
export const WORST_JOINT_THRESHOLD = 80

export interface WorstJoint {
  /** The backend joint_scores key (e.g. "left_knee_angle"). */
  readonly key: string
  /** COCO-17 keypoint index to highlight. */
  readonly keypointIndex: number
  /** Plain-English body part for the callout chip. */
  readonly bodyPart: string
  /** That joint's 0–100 score. */
  readonly score: number
}

/**
 * Returns the lowest-scoring joint, but only when the overall score is below
 * WORST_JOINT_THRESHOLD — so a good rep produces no callout. Returns null when
 * there is no score, no joint data, or form is good.
 */
export function worstJoint(
  jointScores: Readonly<Record<string, number>> | undefined,
  overallScore: number | null,
): WorstJoint | null {
  if (overallScore === null || overallScore >= WORST_JOINT_THRESHOLD) return null
  if (jointScores === undefined) return null

  let worst: WorstJoint | null = null
  for (const [key, score] of Object.entries(jointScores)) {
    const info = JOINT_INFO[key]
    if (info === undefined) continue
    if (worst === null || score < worst.score) {
      worst = { key, keypointIndex: info.keypointIndex, bodyPart: info.bodyPart, score }
    }
  }
  return worst
}
