/**
 * Data contract for the neon overlay (UI-11 §3.1) — read-only presentation
 * input. The component never opens the WebSocket, decodes keypoints, scores
 * form, or computes reps; it only draws what it's handed.
 */
import type { JointQuality } from "./overlayTheme"

/** One decoded, already conf-gated (>=0.5 upstream) COCO-17 keypoint, or null if absent this frame. */
export type OverlayKeypoint = { readonly x: number; readonly y: number; readonly score: number } | null

/** Short joint keys the overlay draws quality/angle info for (§3.1, §3.3). */
export type OverlayJointKey = "lElbow" | "rElbow" | "lHip" | "rHip" | "lKnee" | "rKnee" | "spine"
export type OverlayAngleKey = Exclude<OverlayJointKey, "spine">

export type OverlayTopState = "good" | "error" | "idle"

export interface OverlayFrame {
  /** length 17, COCO order (§3.3) */
  readonly keypoints: readonly OverlayKeypoint[]
  /** 0..100 global score, already computed */
  readonly formScore: number | null
  /** Per-joint quality IF the scorer exposes it */
  readonly jointQuality?: Partial<Record<OverlayJointKey, JointQuality>>
  /** Measured joint angles in degrees IF exposed */
  readonly angles?: Partial<Record<OverlayAngleKey, number>>
  /** Plain-English coaching cue, already produced */
  readonly cue: string | null
  /** Top status; derive from score if absent (§3.2) */
  readonly state: OverlayTopState
  /** True for selfie/front camera */
  readonly mirrored: boolean
}
