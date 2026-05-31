/** COCO 17-keypoint indices and skeleton edges. */

export const KEYPOINT_COUNT = 17

export const KP = {
  NOSE: 0,
  LEFT_EYE: 1,
  RIGHT_EYE: 2,
  LEFT_EAR: 3,
  RIGHT_EAR: 4,
  LEFT_SHOULDER: 5,
  RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7,
  RIGHT_ELBOW: 8,
  LEFT_WRIST: 9,
  RIGHT_WRIST: 10,
  LEFT_HIP: 11,
  RIGHT_HIP: 12,
  LEFT_KNEE: 13,
  RIGHT_KNEE: 14,
  LEFT_ANKLE: 15,
  RIGHT_ANKLE: 16,
} as const

/** 17 edges connecting the COCO skeleton joints. */
export const SKELETON_EDGES: ReadonlyArray<readonly [number, number]> = [
  [KP.NOSE, KP.LEFT_EYE],
  [KP.NOSE, KP.RIGHT_EYE],
  [KP.LEFT_EYE, KP.LEFT_EAR],
  [KP.RIGHT_EYE, KP.RIGHT_EAR],
  [KP.LEFT_SHOULDER, KP.RIGHT_SHOULDER],
  [KP.LEFT_SHOULDER, KP.LEFT_ELBOW],
  [KP.LEFT_ELBOW, KP.LEFT_WRIST],
  [KP.RIGHT_SHOULDER, KP.RIGHT_ELBOW],
  [KP.RIGHT_ELBOW, KP.RIGHT_WRIST],
  [KP.LEFT_SHOULDER, KP.LEFT_HIP],
  [KP.RIGHT_SHOULDER, KP.RIGHT_HIP],
  [KP.LEFT_HIP, KP.RIGHT_HIP],
  [KP.LEFT_HIP, KP.LEFT_KNEE],
  [KP.LEFT_KNEE, KP.LEFT_ANKLE],
  [KP.RIGHT_HIP, KP.RIGHT_KNEE],
  [KP.RIGHT_KNEE, KP.RIGHT_ANKLE],
]

export const CONF_HIGH = 0.7
export const CONF_LOW = 0.4

/** Electric-blue accent — keep in sync with the --accent token in index.css. */
export const ACCENT_COLOR = "#3D9BFF"

// Form-score ramp: red → amber → green (matches the `score` tokens in tailwind.config).
const SCORE_BAD = "#FF4D4D"
const SCORE_MID = "#FFB23D"
const SCORE_GOOD = "#36D399"
const SCORE_NONE = "#6B7280"

export function confidenceColor(conf: number): string {
  if (conf >= CONF_HIGH) return SCORE_GOOD
  if (conf >= CONF_LOW) return SCORE_MID
  return "transparent"
}

export function scoreColor(score: number | null): string {
  if (score === null) return SCORE_NONE
  if (score >= 80) return SCORE_GOOD
  if (score >= 60) return SCORE_MID
  return SCORE_BAD
}

/** Short HUD label for a scorer joint key, e.g. "left_knee_angle" → "L Knee". */
export function jointLabel(key: string): string {
  if (key === "hip_trunk_angle") return "Trunk"
  const cleaned = key.replace(/_angle$/, "").replace(/_/g, " ")
  return cleaned
    .replace(/^left /, "L ")
    .replace(/^right /, "R ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
