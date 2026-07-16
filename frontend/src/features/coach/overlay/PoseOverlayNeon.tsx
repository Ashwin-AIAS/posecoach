// UI-11 Stage 0 recon (docs/enhancements/PREMIUM_POSE_OVERLAY_UI11.md §7):
// - Current overlay IS frozen: PoseOverlay.tsx, lib/poseRenderer.ts, lib/hudRenderer.ts,
//   lib/skeleton.ts, lib/joints.ts, lib/poses.ts, lib/framing.ts, lib/poseInterpolator.ts,
//   and usePoseStream.ts all appear verbatim on the roadmap's frozen list
//   (WORKOUT_NUTRITION_ROADMAP_P23-P28.md guardrail #1) -> ADD ALONGSIDE, select via
//   VITE_OVERLAY_NEON flag, never edit those files. App.tsx (the Coach render site) is
//   NOT frozen, so the flag-swap lands there (roadmap guardrail #2 precedent: P23 already
//   edits App.tsx to host the tab bar).
// - Hook payload (PoseResult from usePoseStream): formScore = result.score; cue =
//   result.cues[0]; angles are present as result.measured_angles but keyed by the verbose
//   scorer names (left_knee_angle, right_knee_angle, left_hip_angle, right_hip_angle,
//   left_elbow_angle, right_elbow_angle, left_shoulder_angle, right_shoulder_angle,
//   hip_trunk_angle) rather than the spec's short keys -> remap on the presentation side.
//   jointQuality is NOT exposed directly, but result.joint_scores (0-100 per joint, same
//   verbose keys) IS exposed and is banded per-joint client-side using the spec's
//   >=85/70-84/<70 thresholds (graceful-degrade rule in §3.2, applied per-joint since the
//   scorer already grades per-joint - richer than the single-band fallback, still no new
//   scoring). state is NOT a field; derived from result.status (mirrors the existing
//   CameraHud.tsx blocked/statusMessage logic: status !== "ok" -> idle, else score-banded
//   good/error). mirrored is not on PoseResult; it flows from camera.facingMode === "user",
//   the same prop already passed to the legacy PoseOverlay.

import { memo, useEffect, useRef } from "react"

import { computeCoverProjection } from "./geometry"
import { drawArcs, drawBones, drawNodes, projectKeypoints } from "./drawSkeleton"
import type { OverlayFrame } from "./types"

interface PoseOverlayNeonProps {
  readonly frame: OverlayFrame
  /**
   * Native size of the source video, for the cover-fit projection (§4.2).
   * Omit when there is no letterboxing to account for (e.g. a square poster
   * in the QA preview harness) — the canvas's own size is used instead.
   */
  readonly videoSize?: { readonly width: number; readonly height: number }
  readonly className?: string
}

function PoseOverlayNeonInner({ frame, videoSize, className }: PoseOverlayNeonProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(frame)
  const videoSizeRef = useRef(videoSize)
  frameRef.current = frame
  videoSizeRef.current = videoSize

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const draw = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const cssW = rect.width || canvas.clientWidth
      const cssH = rect.height || canvas.clientHeight
      if (cssW <= 0 || cssH <= 0) return

      canvas.width = Math.max(1, Math.round(cssW * dpr))
      canvas.height = Math.max(1, Math.round(cssH * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      const f = frameRef.current
      const vs = videoSizeRef.current
      const proj = computeCoverProjection(cssW, cssH, vs?.width ?? cssW, vs?.height ?? cssH)
      const pts = projectKeypoints(f, f.mirrored, proj)

      drawBones(ctx, f, pts)
      drawArcs(ctx, f, pts)
      drawNodes(ctx, f, pts)
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [frame, videoSize])

  const ariaLabel =
    frame.state === "idle"
      ? "Searching for a person"
      : (frame.cue ?? (frame.state === "good" ? "Good form" : "Form needs adjustment"))

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel}
      data-testid="pose-overlay-neon"
      className={className ?? "pointer-events-none absolute inset-0 h-full w-full"}
    />
  )
}

export const PoseOverlayNeon = memo(PoseOverlayNeonInner)
