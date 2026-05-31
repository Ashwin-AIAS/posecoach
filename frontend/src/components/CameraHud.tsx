import { memo } from "react"

import type { PoseResult } from "../types"
import { ScoreRing } from "./ScoreRing"

interface CameraHudProps {
  readonly result: PoseResult | null
  /** Whether the camera stage is live (hide the HUD before the feed is ready). */
  readonly active: boolean
}

/**
 * Floating heads-up display drawn over the camera stage: a corner form-score
 * ring and the top coaching cue rendered as a lower-third caption. Pointer
 * events pass through to the stage; only chrome animates (never the frame path).
 */
function CameraHudInner({ result, active }: CameraHudProps): JSX.Element | null {
  if (!active) return null
  const score = result?.score ?? null
  const topCue = result?.cues?.[0]
  const holdS = result?.hold_s

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Corner score ring on a glass chip */}
      <div className="absolute right-3 top-3 rounded-2xl border border-surface-hairline/70 bg-surface-base/45 p-1.5 backdrop-blur-md">
        <ScoreRing score={score} size={104} />
      </div>

      {/* Plank hold badge */}
      {holdS !== undefined && (
        <div className="absolute left-3 top-3 rounded-full border border-surface-hairline/70 bg-surface-base/45 px-3 py-1.5 backdrop-blur-md">
          <span className="hud-numerals text-sm font-semibold text-accent">{holdS.toFixed(1)}s</span>
          <span className="ml-1.5 text-[11px] uppercase tracking-wide text-gray-400">hold</span>
        </div>
      )}

      {/* Lower-third coaching caption */}
      {topCue !== undefined && topCue.length > 0 && (
        <div className="absolute inset-x-0 bottom-6 flex justify-center px-4">
          <p
            key={topCue}
            className="animate-caption-in max-w-md rounded-full border border-surface-hairline/70 bg-surface-base/65 px-5 py-2.5 text-center text-base font-medium text-white shadow-card backdrop-blur-md"
          >
            {topCue}
          </p>
        </div>
      )}
    </div>
  )
}

export const CameraHud = memo(CameraHudInner)
