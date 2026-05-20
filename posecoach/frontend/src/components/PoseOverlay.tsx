import { memo, useEffect, useRef } from "react"

import type { PoseResult } from "../types"
import { CONF_LOW, KEYPOINT_COUNT, SKELETON_EDGES, confidenceColor } from "../lib/skeleton"

interface PoseOverlayProps {
  readonly result: PoseResult | null
}

function PoseOverlayInner({ result }: PoseOverlayProps): JSX.Element {
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

    // Draw limb connections
    ctx.lineWidth = 3
    for (const [a, b] of SKELETON_EDGES) {
      if (confidence[a] < CONF_LOW || confidence[b] < CONF_LOW) continue
      const [xa, ya] = keypoints[a]
      const [xb, yb] = keypoints[b]
      ctx.strokeStyle = "#60a5fa"
      ctx.beginPath()
      ctx.moveTo(xa * canvas.width, ya * canvas.height)
      ctx.lineTo(xb * canvas.width, yb * canvas.height)
      ctx.stroke()
    }

    // Draw joints
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
  }, [result])

  return (
    <canvas
      ref={canvasRef}
      className="pose-overlay absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    />
  )
}

export const PoseOverlay = memo(PoseOverlayInner)
