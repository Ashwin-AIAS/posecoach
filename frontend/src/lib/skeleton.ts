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

export function confidenceColor(conf: number): string {
  if (conf >= CONF_HIGH) return "#22c55e"
  if (conf >= CONF_LOW) return "#eab308"
  return "transparent"
}

export function scoreColor(score: number | null): string {
  if (score === null) return "#6b7280"
  if (score >= 80) return "#22c55e"
  if (score >= 60) return "#eab308"
  return "#ef4444"
}
