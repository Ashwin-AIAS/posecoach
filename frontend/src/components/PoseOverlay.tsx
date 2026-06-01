import { memo, useEffect, useRef } from "react"

import type { PoseResult } from "../types"
import type { WorstJoint } from "../lib/joints"
import { ACCENT_COLOR, CONF_LOW, KEYPOINT_COUNT, SKELETON_EDGES, confidenceColor } from "../lib/skeleton"

const WORST_RING_COLOR = "#FF4D4D"

interface PoseOverlayProps {
  readonly result: PoseResult | null
  /** Mirror the overlay to match the mirrored front-camera display. */
  readonly mirrored: boolean
  /** Lowest-scoring joint to emphasise, or null when form is good. */
  readonly worst?: WorstJoint | null
}

function PoseOverlayInner({ result, mirrored, worst = null }: PoseOverlayProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Match canvas resolution to its rendered size for crisp lines
    const rect = canvas.getBoundingClientRect()
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width
      canvas.height = rect.height
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (result === null || result.keypoints.length !== KEYPOINT_COUNT) return
    const { keypoints, confidence } = result

    // Draw limb connections with the accent color + soft glow
    ctx.lineWidth = 4
    ctx.lineCap = "round"
    ctx.strokeStyle = ACCENT_COLOR
    ctx.shadowColor = ACCENT_COLOR
    ctx.shadowBlur = 8
    for (const [a, b] of SKELETON_EDGES) {
      if (confidence[a] < CONF_LOW || confidence[b] < CONF_LOW) continue
      const [xa, ya] = keypoints[a]
      const [xb, yb] = keypoints[b]
      ctx.beginPath()
      ctx.moveTo(xa * canvas.width, ya * canvas.height)
      ctx.lineTo(xb * canvas.width, yb * canvas.height)
      ctx.stroke()
    }

    // Draw joints (confidence-colored), no glow for crisp dots
    ctx.shadowBlur = 0
    for (let i = 0; i < KEYPOINT_COUNT; i++) {
      const conf = confidence[i]
      const color = confidenceColor(conf)
      if (color === "transparent") continue
      const [x, y] = keypoints[i]
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x * canvas.width, y * canvas.height, 5, 0, Math.PI * 2)
      ctx.fill()
    }

    // Emphasise the worst-scoring joint with a red ring on top of the skeleton.
    // Drawn in true keypoint coords, so the CSS mirror keeps it aligned.
    if (worst !== null && confidence[worst.keypointIndex] >= CONF_LOW) {
      const [wx, wy] = keypoints[worst.keypointIndex]
      const cx = wx * canvas.width
      const cy = wy * canvas.height
      ctx.lineWidth = 3
      ctx.strokeStyle = WORST_RING_COLOR
      ctx.shadowColor = WORST_RING_COLOR
      ctx.shadowBlur = 12
      ctx.beginPath()
      ctx.arc(cx, cy, 14, 0, Math.PI * 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }, [result, worst])

  return (
    <canvas
      ref={canvasRef}
      className={`${mirrored ? "mirror " : ""}absolute inset-0 w-full h-full pointer-events-none`}
      aria-hidden="true"
    />
  )
}

export const PoseOverlay = memo(PoseOverlayInner)
