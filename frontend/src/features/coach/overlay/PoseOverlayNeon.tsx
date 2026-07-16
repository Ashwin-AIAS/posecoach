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
//   hip_trunk_angle) rather than the spec's short keys -> remap on the presentation side
//   (see adaptPoseResult.ts). jointQuality is NOT exposed directly, but result.joint_scores
//   (0-100 per joint, same verbose keys) IS exposed and is banded per-joint client-side
//   using the spec's >=85/70-84/<70 thresholds (graceful-degrade rule in §3.2, applied
//   per-joint since the scorer already grades per-joint - richer than the single-band
//   fallback, still no new scoring). state is NOT a field; derived from result.status
//   (mirrors the existing CameraHud.tsx blocked/statusMessage logic: status !== "ok" ->
//   idle, else score-banded good/error). mirrored is not on PoseResult; it flows from
//   camera.facingMode === "user", the same prop already passed to the legacy PoseOverlay.

import { memo, useEffect, useRef } from "react"

import { drawArcs, drawBones, drawNodes, projectKeypoints } from "./drawSkeleton"
import { drawCornerBrackets, drawCueChip, drawGridAndVignette, drawLegend, drawScanBand, drawStatusLine } from "./drawHud"
import { computeCoverProjection } from "./geometry"
import { OVERLAY } from "./overlayTheme"
import type { OverlayFrame } from "./types"

/** 30fps cap, matching the frozen overlay's convention — plenty smooth for HUD motion. */
const FRAME_MS = 1000 / 30
const PULSE_AMPLITUDE = 0.12

interface PoseOverlayNeonProps {
  readonly frame: OverlayFrame
  /**
   * The displayed `<video>`'s ref, read fresh every draw for its native
   * `videoWidth`/`videoHeight` (§4.2 cover-fit) — same convention as the
   * legacy PoseOverlay's `videoRef` prop. Preferred over `videoSize` for a
   * live camera since native size can change (e.g. front/back camera flip).
   */
  readonly videoRef?: React.RefObject<HTMLVideoElement>
  /**
   * Static native size override, for callers with no `<video>` element (the
   * QA preview harness). Ignored when `videoRef` resolves to a real element.
   */
  readonly videoSize?: { readonly width: number; readonly height: number }
  readonly className?: string
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function PoseOverlayNeonInner({ frame, videoRef, videoSize, className }: PoseOverlayNeonProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Latest props mirrored into refs so the rAF loop never re-subscribes —
  // same pattern as the frozen PoseOverlay.tsx.
  const frameRef = useRef(frame)
  const videoRefPropRef = useRef(videoRef)
  const videoSizeRef = useRef(videoSize)
  frameRef.current = frame
  videoRefPropRef.current = videoRef
  videoSizeRef.current = videoSize

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reducedMotion = prefersReducedMotion()
    let raf = 0
    let lastDraw = 0

    const draw = (now: number): void => {
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
      const videoEl = videoRefPropRef.current?.current ?? null
      const vs =
        videoEl !== null && videoEl.videoWidth > 0
          ? { width: videoEl.videoWidth, height: videoEl.videoHeight }
          : videoSizeRef.current
      const proj = computeCoverProjection(cssW, cssH, vs?.width ?? cssW, vs?.height ?? cssH)
      const pts = projectKeypoints(f, f.mirrored, proj)

      drawGridAndVignette(ctx, cssW, cssH)

      const isIdle = f.state === "idle"
      // §3.2: no person / low conf -> dim the skeleton to base cyan at 40%.
      const drawFrame: OverlayFrame = isIdle ? { ...f, jointQuality: undefined, formScore: null } : f
      const pulse = reducedMotion
        ? 1
        : 1 + PULSE_AMPLITUDE * Math.sin((2 * Math.PI * now) / OVERLAY.motion.pulsePeriodMs)

      ctx.save()
      if (isIdle) ctx.globalAlpha = 0.4
      drawBones(ctx, drawFrame, pts)
      drawArcs(ctx, drawFrame, pts)
      drawNodes(ctx, drawFrame, pts, pulse)
      ctx.restore()

      drawCornerBrackets(ctx, cssW, cssH)
      drawStatusLine(ctx, f.state)
      drawCueChip(ctx, cssW, cssH, f.cue, f.state)
      drawLegend(ctx, cssW)

      if (!reducedMotion) {
        const progress = (now % OVERLAY.motion.scanPeriodMs) / OVERLAY.motion.scanPeriodMs
        drawScanBand(ctx, cssW, cssH, progress)
      }
    }

    // Always run the capped rAF loop (matches the frozen PoseOverlay.tsx
    // convention — it re-measures the canvas box and picks up new frame refs
    // every tick regardless of motion prefs). `reducedMotion` only gates the
    // motion-specific bits inside `draw` (pulse amplitude, scan band), so a
    // static fixture with reduced motion still redraws byte-identical output.
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop)
      if (now - lastDraw < FRAME_MS) return
      lastDraw = now
      draw(now)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [])

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
