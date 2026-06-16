import type { Orientation, PoseName } from "../types"
import { POSES } from "../types"

/**
 * Presentation metadata for posing mode (P15 seed poses).
 *
 * The scorer (app/analysis/posing_scorer.py + pose_templates.json) owns the
 * biomechanics; this file owns what the UI renders: label, division, the
 * orientation the user must face, and a one-line setup hint.
 *
 * Honest scope (IMPROVEMENT_PLAN_P15-P18.md §2): keypoints see body geometry
 * only. Posing mode scores position, symmetry, and hold — never muscle size or
 * conditioning. `POSING_SCOPE_NOTE` is the user-facing version of that.
 */

export interface PoseMeta {
  readonly id: PoseName
  /** Orientation in which left/right symmetry is meaningful (front/rear only). */
  readonly orientation: Extract<Orientation, "front" | "rear">
  readonly label: string
  readonly division: string
  /** Short plain-English setup hint shown under the picker. */
  readonly hint: string
}

export const POSE_META: Record<PoseName, PoseMeta> = {
  front_double_biceps: {
    id: "front_double_biceps",
    orientation: "front",
    label: "Front Double Biceps",
    division: "Open",
    hint: "Face the camera, elbows up, forearms vertical.",
  },
  front_lat_spread: {
    id: "front_lat_spread",
    orientation: "front",
    label: "Front Lat Spread",
    division: "Open",
    hint: "Face the camera, arms out to the sides, near-straight.",
  },
  rear_double_biceps: {
    id: "rear_double_biceps",
    orientation: "rear",
    label: "Rear Double Biceps",
    division: "Classic",
    hint: "Turn your back to the camera, elbows up.",
  },
}

/** All pose metadata in declaration order. */
export const POSE_META_LIST: readonly PoseMeta[] = POSES.map((id) => POSE_META[id])

/** Metadata for one pose (always defined — `Record` guarantees coverage). */
export function getPoseMeta(id: PoseName): PoseMeta {
  return POSE_META[id]
}

/** Human label for a pose id. */
export function poseLabel(id: PoseName): string {
  return POSE_META[id].label
}

/** User-facing scope statement — what posing mode can and cannot judge. */
export const POSING_SCOPE_NOTE =
  "Scores position, symmetry, and hold — not muscle size or conditioning."
