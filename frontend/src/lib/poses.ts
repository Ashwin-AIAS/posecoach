import type { Division, Orientation, PoseName } from "../types"
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
  /** Orientation the user must face. Symmetry is scored only for front/rear. */
  readonly orientation: Extract<Orientation, "front" | "rear" | "side">
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
  side_chest: {
    id: "side_chest",
    orientation: "side",
    label: "Side Chest",
    division: "Open",
    hint: "Stand side-on; bend the front knee, lift the front heel.",
  },
  side_triceps: {
    id: "side_triceps",
    orientation: "side",
    label: "Side Triceps",
    division: "Open",
    hint: "Stand side-on; front leg flexed, heel lifted.",
  },
  rear_lat_spread: {
    id: "rear_lat_spread",
    orientation: "rear",
    label: "Rear Lat Spread",
    division: "Open",
    hint: "Back to camera; hands at your waist, flare the lats.",
  },
  abdominal_and_thigh: {
    id: "abdominal_and_thigh",
    orientation: "front",
    label: "Abdominal & Thigh",
    division: "Open",
    hint: "Face camera; hands behind head, one thigh forward.",
  },
  most_muscular: {
    id: "most_muscular",
    orientation: "front",
    label: "Most Muscular",
    division: "Open",
    hint: "Face camera; fists together, shoulders forward.",
  },
  favorite_classic_pose: {
    id: "favorite_classic_pose",
    orientation: "front",
    label: "Favorite Classic Pose",
    division: "Classic",
    hint: "Face camera; balanced classic stance.",
  },
  mp_front: {
    id: "mp_front",
    orientation: "front",
    label: "Front Pose",
    division: "Men's Physique",
    hint: "Face camera; arms relaxed, feet about hip width.",
  },
  mp_side: {
    id: "mp_side",
    orientation: "side",
    label: "Side Pose",
    division: "Men's Physique",
    hint: "Side-on; one hand on your hip.",
  },
  mp_back: {
    id: "mp_back",
    orientation: "rear",
    label: "Back Pose",
    division: "Men's Physique",
    hint: "Back to camera; spread the lats for a V-taper.",
  },
  qt_front: {
    id: "qt_front",
    orientation: "front",
    label: "Front",
    division: "Bikini",
    hint: "Face camera; relaxed, confident stance.",
  },
  qt_back: {
    id: "qt_back",
    orientation: "rear",
    label: "Back",
    division: "Bikini",
    hint: "Back to camera; relaxed, confident stance.",
  },
  figure_front: {
    id: "figure_front",
    orientation: "front",
    label: "Front",
    division: "Figure",
    hint: "Face camera; hands on hips, show the V-taper.",
  },
  figure_back: {
    id: "figure_back",
    orientation: "rear",
    label: "Back",
    division: "Figure",
    hint: "Back to camera; hands on hips.",
  },
}

export interface DivisionMeta {
  readonly id: Division
  readonly label: string
  /** Mandatory pose lineup, in judging order (mirrors the backend catalogue). */
  readonly mandatories: readonly PoseName[]
}

/** Division → mandatory lineup, mirroring app/analysis/pose_templates.json (P17). */
export const DIVISIONS: Record<Division, DivisionMeta> = {
  open: {
    id: "open",
    label: "Men's Open Bodybuilding",
    mandatories: [
      "front_double_biceps",
      "front_lat_spread",
      "side_chest",
      "side_triceps",
      "rear_double_biceps",
      "rear_lat_spread",
      "abdominal_and_thigh",
      "most_muscular",
    ],
  },
  classic: {
    id: "classic",
    label: "Classic Physique",
    mandatories: ["front_double_biceps", "side_chest", "rear_double_biceps", "abdominal_and_thigh", "favorite_classic_pose"],
  },
  mens_physique: {
    id: "mens_physique",
    label: "Men's Physique",
    mandatories: ["mp_front", "mp_side", "mp_back"],
  },
  bikini: { id: "bikini", label: "Bikini", mandatories: ["qt_front", "qt_back"] },
  wellness: { id: "wellness", label: "Wellness", mandatories: ["qt_front", "qt_back"] },
  figure: { id: "figure", label: "Figure", mandatories: ["figure_front", "figure_back"] },
  womens_physique: {
    id: "womens_physique",
    label: "Women's Physique",
    mandatories: ["front_double_biceps", "side_chest", "rear_double_biceps", "abdominal_and_thigh", "front_lat_spread"],
  },
}

/** Divisions in display order. */
export const DIVISION_LIST: readonly DivisionMeta[] = [
  "open",
  "classic",
  "mens_physique",
  "bikini",
  "wellness",
  "figure",
  "womens_physique",
].map((id) => DIVISIONS[id as Division])

/** Metadata for one division (always defined — `Record` guarantees coverage). */
export function getDivisionMeta(id: Division): DivisionMeta {
  return DIVISIONS[id]
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
