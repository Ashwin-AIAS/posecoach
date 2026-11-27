import { memo, useEffect, useRef, useState } from "react"
import { TriangleAlert } from "lucide-react"

import { formFrameBand, formFrameBoxShadow, formFrameColor } from "../features/live/formFrame"
import { triggerRepHaptic } from "../lib/haptics"
import type { Exercise, PoseResult, PoseStatus } from "../types"
import type { WorstJoint } from "../lib/joints"
import { exerciseLabel } from "../lib/exercises"
import { ScoreRing } from "./ScoreRing"
import { Icon } from "./ui/Icon"

/** Fallback banner copy when the backend can't score a frame and sends no cue. */
const STATUS_FALLBACK: Record<Exclude<PoseStatus, "ok">, string> = {
  no_person: "Step into frame",
  insufficient_confidence: "Hold still — adjusting to you",
  mismatch: "Doesn't match the exercise",
  wrong_orientation: "Turn to the right orientation",
  unknown_pose: "Pick a pose to score",
}

interface CameraHudProps {
  readonly result: PoseResult | null
  /** Whether the camera stage is live (hide the HUD before the feed is ready). */
  readonly active: boolean
  readonly exercise: Exercise
  readonly onShowHowTo: (ex: Exercise) => void
  /** Lowest-scoring joint to name, or null when form is good. */
  readonly worst?: WorstJoint | null
  /** Whether tactile vibration on rep increment is enabled (P36 A4). */
  readonly hapticsEnabled?: boolean
}

const REP_PULSE_MS = 260

/**
 * Floating heads-up display drawn over the camera stage: a corner form-score
 * ring and the top coaching cue rendered as a lower-third caption. Pointer
 * events pass through to the stage; only chrome animates (never the frame path).
 */
function CameraHudInner({
  result,
  active,
  exercise,
  onShowHowTo,
  worst = null,
  hapticsEnabled = true,
}: CameraHudProps): JSX.Element | null {
  const reps = result?.reps ?? 0
  const prevRepsRef = useRef<number>(reps)
  const [repPulse, setRepPulse] = useState(false)

  useEffect(() => {
    if (!active) {
      prevRepsRef.current = reps
      setRepPulse(false)
      return undefined
    }
    if (reps > prevRepsRef.current) {
      prevRepsRef.current = reps
      triggerRepHaptic(hapticsEnabled)
      setRepPulse(true)
      const timer = setTimeout(() => setRepPulse(false), REP_PULSE_MS)
      return () => clearTimeout(timer)
    }
    prevRepsRef.current = reps
    return undefined
  }, [reps, active, hapticsEnabled])

  if (!active) return null
  const score = result?.score ?? null
  const topCue = result?.cues?.[0]
  const holdS = result?.hold_s
  const isPlank = exercise === "plank"
  // A missing status (older server) means a normally-scored frame.
  const status: PoseStatus = result?.status ?? "ok"
  // When the backend couldn't score the frame, surface why — distinctly from a
  // coaching cue — so the user knows to reposition rather than read it as form.
  const blocked = status !== "ok"
  const isMismatch = status === "mismatch"
  const statusMessage = blocked ? (topCue ?? STATUS_FALLBACK[status]) : undefined
  // What the movement was checked against — names the exercise in the banner.
  const expected = result?.expected_exercise ?? exercise
  const frameBand = formFrameBand(score, status)
  const frameColor = formFrameColor(score, status)
  const frameShadow = formFrameBoxShadow(score, status, repPulse)

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* P36 A3/A4: 3-4px inset form-colour frame on the camera stage edge,
          tinted by the score ramp and easing over 300ms, with a brief accent
          flash on every rep increment. */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          boxShadow: frameShadow,
          transition: "box-shadow 300ms ease-out",
        }}
        data-testid="form-colour-frame"
        data-band={frameBand}
        data-tint={frameColor}
        data-rep-pulse={repPulse ? "true" : "false"}
        aria-hidden="true"
      />

      {/* Compact secondary score ring (88px) on a glass chip below the floating top bar */}
      <div className="absolute right-3 top-16 rounded-2xl bg-surface-base/45 p-1.5 shadow-elev-1 backdrop-blur-md">
        <ScoreRing score={score} size={88} />
      </div>

      {/* Worst-joint callout — a soft accent glow, never a hard outline, so it
          reads as a gentle highlight rather than an alarm. Positioned below the
          floating top bar so it never collides with it (P36 A2/A3). */}
      {!blocked && worst !== null && (
        <div
          className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-score-bad/15 px-3 py-1 text-sm font-medium text-score-bad backdrop-blur-md"
          style={{ boxShadow: "0 0 24px -2px rgba(255, 77, 77, 0.5)" }}
          data-testid="worst-joint-chip"
        >
          Fix: {worst.bodyPart}
        </div>
      )}

      {/* How-to info button (re-opens the demo for the active exercise) — kept
          bottom-left so it never collides with the flip-camera control, which
          owns bottom-right on the camera stage (P20). */}
      <button
        type="button"
        onClick={() => onShowHowTo(exercise)}
        aria-label="Show how-to demo"
        className="pointer-events-auto absolute bottom-4 left-4 grid h-9 w-9 place-content-center rounded-full bg-surface-base/55 text-gray-300 shadow-elev-1 backdrop-blur-md transition hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ?
      </button>

      {/* Top-left dashboard cluster: plank hold timer or the large rep counter,
          with the exercise name receding underneath in smaller, low-contrast text. */}
      {isPlank ? (
        holdS !== undefined && (
          <div className="absolute left-3 top-16 rounded-2xl bg-surface-base/45 px-3 py-2 shadow-elev-1 backdrop-blur-md">
            <div className="flex items-baseline gap-1.5">
              <span className="hud-numerals font-display text-3xl font-semibold leading-none text-accent">
                {holdS.toFixed(1)}s
              </span>
              <span className="text-[11px] uppercase tracking-wide text-gray-400">hold</span>
            </div>
            <span className="mt-0.5 block text-[11px] font-medium text-gray-500">
              {exerciseLabel(exercise)}
            </span>
          </div>
        )
      ) : (
        <div
          className="absolute left-3 top-16 rounded-2xl bg-surface-base/45 px-3.5 py-2 shadow-elev-1 backdrop-blur-md"
          data-testid="rep-counter"
        >
          <div className="flex items-baseline gap-1.5">
            <span
              key={reps}
              className="hud-numerals inline-block animate-number-pop font-display text-[4.5rem] font-semibold leading-none text-white"
              data-testid="rep-hero-number"
              data-rep-pulse={repPulse ? "true" : "false"}
            >
              {reps}
            </span>
            <span className="text-xs uppercase tracking-wide text-gray-400">reps</span>
          </div>
          <span className="mt-0.5 block text-[11px] font-medium text-gray-500">
            {exerciseLabel(exercise)}
          </span>
        </div>
      )}

      {/* Wrong-exercise banner (P13) — distinct amber warning so the user knows
          the movement doesn't match the chosen exercise and the score is withheld
          on purpose (not a low score, not a "can't see you"). */}
      {isMismatch && (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
          <div
            data-testid="mismatch-banner"
            className="animate-caption-in max-w-sm rounded-2xl border border-score-mid/60 bg-surface-base/80 px-5 py-3 text-center shadow-card backdrop-blur-md"
          >
            <p className="flex items-center justify-center gap-1.5 text-base font-semibold text-score-mid">
              <Icon icon={TriangleAlert} size={16} className="shrink-0" />
              Doesn't look like {exerciseLabel(expected)}
            </p>
            {statusMessage !== undefined && (
              <p className="mt-1 text-sm text-gray-200">{statusMessage}</p>
            )}
          </div>
        </div>
      )}

      {/* Center status banner — shown when the frame couldn't be scored, so the
          user knows to reposition rather than reading it as a form correction. */}
      {blocked && !isMismatch && statusMessage !== undefined && (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
          <p
            data-testid="status-banner"
            className="animate-caption-in max-w-xs rounded-2xl border border-accent/40 bg-surface-base/70 px-5 py-3 text-center text-base font-medium text-accent shadow-card backdrop-blur-md"
          >
            {statusMessage}
          </p>
        </div>
      )}

      {/* Lower-third coaching caption (only on normally-scored frames): >=20px, max 2 lines */}
      {!blocked && topCue !== undefined && topCue.length > 0 && (
        <div className="absolute inset-x-0 bottom-6 flex justify-center px-4">
          <p
            key={topCue}
            data-testid="hud-top-cue"
            className="animate-caption-in line-clamp-2 max-w-lg rounded-2xl bg-surface-base/75 px-5 py-2.5 text-center text-xl font-medium leading-snug text-white shadow-elev-1 backdrop-blur-md"
          >
            {topCue}
          </p>
        </div>
      )}
    </div>
  )
}

export const CameraHud = memo(CameraHudInner)
