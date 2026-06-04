import { memo } from "react"

import type { Exercise, PoseResult, PoseStatus } from "../types"
import type { WorstJoint } from "../lib/joints"
import { ScoreRing } from "./ScoreRing"

/** Fallback banner copy when the backend can't score a frame and sends no cue. */
const STATUS_FALLBACK: Record<Exclude<PoseStatus, "ok">, string> = {
  no_person: "Step into frame",
  insufficient_confidence: "Hold still — adjusting to you",
}

interface CameraHudProps {
  readonly result: PoseResult | null
  /** Whether the camera stage is live (hide the HUD before the feed is ready). */
  readonly active: boolean
  readonly exercise: Exercise
  readonly onShowHowTo: (ex: Exercise) => void
  /** Lowest-scoring joint to name, or null when form is good. */
  readonly worst?: WorstJoint | null
}

/**
 * Floating heads-up display drawn over the camera stage: a corner form-score
 * ring and the top coaching cue rendered as a lower-third caption. Pointer
 * events pass through to the stage; only chrome animates (never the frame path).
 */
function CameraHudInner({ result, active, exercise, onShowHowTo, worst = null }: CameraHudProps): JSX.Element | null {
  if (!active) return null
  const score = result?.score ?? null
  const topCue = result?.cues?.[0]
  const holdS = result?.hold_s
  const reps = result?.reps ?? 0
  const isPlank = exercise === "plank"
  // A missing status (older server) means a normally-scored frame.
  const status: PoseStatus = result?.status ?? "ok"
  // When the backend couldn't score the frame, surface why — distinctly from a
  // coaching cue — so the user knows to reposition rather than read it as form.
  const blocked = status !== "ok"
  const statusMessage = blocked ? (topCue ?? STATUS_FALLBACK[status]) : undefined

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Corner score ring on a glass chip */}
      <div className="absolute right-3 top-3 rounded-2xl border border-surface-hairline/70 bg-surface-base/45 p-1.5 backdrop-blur-md">
        <ScoreRing score={score} size={104} />
      </div>

      {/* Worst-joint callout — the exact body part to fix (multi-joint scoring) */}
      {!blocked && worst !== null && (
        <div
          className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-score-bad/40 bg-score-bad/15 px-3 py-1 text-sm font-medium text-score-bad backdrop-blur-md"
          data-testid="worst-joint-chip"
        >
          Fix: {worst.bodyPart}
        </div>
      )}

      {/* How-to info button (re-opens the demo for the active exercise) */}
      <button
        type="button"
        onClick={() => onShowHowTo(exercise)}
        aria-label="Show how-to demo"
        className="pointer-events-auto absolute bottom-4 right-4 grid h-9 w-9 place-content-center rounded-full border border-surface-hairline/70 bg-surface-base/55 text-gray-300 backdrop-blur-md transition hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ?
      </button>

      {/* Top-left: plank hold timer, otherwise the large rep counter */}
      {isPlank ? (
        holdS !== undefined && (
          <div className="absolute left-3 top-3 rounded-2xl border border-surface-hairline/70 bg-surface-base/45 px-3 py-2 backdrop-blur-md">
            <span className="hud-numerals font-display text-2xl font-semibold text-accent">
              {holdS.toFixed(1)}s
            </span>
            <span className="ml-1.5 text-[11px] uppercase tracking-wide text-gray-400">hold</span>
          </div>
        )
      ) : (
        <div
          className="absolute left-3 top-3 flex items-baseline gap-1.5 rounded-2xl border border-surface-hairline/70 bg-surface-base/45 px-3 py-2 backdrop-blur-md"
          data-testid="rep-counter"
        >
          <span className="hud-numerals font-display text-3xl font-semibold leading-none text-white">
            {reps}
          </span>
          <span className="text-[11px] uppercase tracking-wide text-gray-400">reps</span>
        </div>
      )}

      {/* Center status banner — shown when the frame couldn't be scored, so the
          user knows to reposition rather than reading it as a form correction. */}
      {blocked && statusMessage !== undefined && (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
          <p
            data-testid="status-banner"
            className="animate-caption-in max-w-xs rounded-2xl border border-accent/40 bg-surface-base/70 px-5 py-3 text-center text-base font-medium text-accent shadow-card backdrop-blur-md"
          >
            {statusMessage}
          </p>
        </div>
      )}

      {/* Lower-third coaching caption (only on normally-scored frames) */}
      {!blocked && topCue !== undefined && topCue.length > 0 && (
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
