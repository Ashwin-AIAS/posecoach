/**
 * Visual twin of a spoken cue (P29 S6) — spec §4 "Attention budget — both
 * should win": the voice lane never becomes the only channel, so every cue
 * the arbiter fires must render here too, at zero extra cost to a muted or
 * hands-free-off user.
 *
 * Purely presentational and driven by a single `cue` prop (the arbiter's
 * chosen fault, rendered as `{ id, text, severity }` by whatever wires it up
 * — a later stage; this component has no opinion on where the text comes
 * from). One slot only, mirroring the arbiter's own "max cues per rep = 1"
 * rule: a new cue replaces whatever is showing instead of stacking a queue,
 * which matches spec §4's "never queue stale advice."
 *
 * Enter/exit animate `transform`/`opacity` only (`voice.css`) so the toast
 * stays on the compositor and never competes with the pose pipeline. Exit
 * is a `.leaving` class the component adds itself after `visibleMs`; the
 * node unmounts on that animation's `animationend`, not on a timer, so it
 * never disappears mid-transition.
 */
import { useEffect, useRef, useState } from "react"

import type { Severity } from "./playbackManager"
import "./voice.css"

export interface ToastCue {
  /** Unique per firing (e.g. `${faultId}-${timestampMs}`) — remounts the toast so a repeat fault still re-animates. */
  readonly id: string
  readonly text: string
  readonly severity: Severity
}

export interface CueToastProps {
  readonly cue: ToastCue | null
  /** How long the toast stays fully visible before it starts leaving. Untuned, like every other P29 timing constant (spec §4). */
  readonly visibleMs?: number
}

const DEFAULT_VISIBLE_MS = 3200

/** Severity → dot color, reusing the app's existing red/amber/green form-score scale. */
const SEVERITY_DOT: Readonly<Record<Severity, string>> = {
  high: "bg-score-bad",
  medium: "bg-score-mid",
  low: "bg-score-good",
  milestone: "bg-accent",
}

/** The on-screen twin of whatever `useCoachVoice`/`cueArbiter` just spoke (or would have, if muted). */
export function CueToast({ cue, visibleMs = DEFAULT_VISIBLE_MS }: CueToastProps): JSX.Element | null {
  const [shown, setShown] = useState<ToastCue | null>(null)
  const [leaving, setLeaving] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!cue) return
    setShown(cue)
    setLeaving(false)
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setLeaving(true), visibleMs)
    return () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    }
    // `cue` is compared by reference/identity via its `id` field by callers —
    // a genuinely new firing always passes a new object.
  }, [cue, visibleMs])

  if (!shown) return null

  return (
    <div
      key={shown.id}
      role="status"
      aria-live="polite"
      className={
        "voice-cue-toast pointer-events-none flex max-w-xs items-center gap-2 rounded-full bg-black/70 px-3.5 py-2 text-sm text-gray-100 shadow-elev-2 backdrop-blur-sm " +
        (leaving ? "leaving" : "")
      }
      onAnimationEnd={() => {
        if (leaving) setShown(null)
      }}
      data-testid="cue-toast"
      data-severity={shown.severity}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[shown.severity]}`}
        aria-hidden="true"
      />
      <span className="truncate">{shown.text}</span>
    </div>
  )
}
