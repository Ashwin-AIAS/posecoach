/**
 * Wires the S1-S7 voice-coach pieces into the live WS frame stream (P29 S8).
 *
 * Follows the `useCueVoice` precedent exactly
 * (`frontend/src/hooks/useCueVoice.ts`, already live in `App.tsx` reading
 * `pose.result?.cues?.[0]`): a plain hook that takes `result`/`exercise` as
 * arguments from `App.tsx` and reads them read-only. `usePoseStream.ts` and
 * `useWebSocket.ts` are never imported here and never modified — this hook
 * only ever sees whatever `App.tsx` already has in hand from its own
 * `usePoseStream()` call.
 *
 * Rep boundaries are derived by diffing `result.reps` frame-to-frame (S8
 * decision) — never a timer, never polling the score (spec §4 "Trigger").
 * On each new boundary, at most one fault candidate is built from `cues[0]`
 * + `worst_joint` (`cueBridge.ts` — S8 decision: `cues[1]` is unreachable
 * under the arbiter's own "max cues per rep = 1" cap and carries no side
 * attribution anyway) and handed to a `CueArbiter` shared for the hook's
 * lifetime. A fired decision plays through `useCoachVoice`'s
 * `PlaybackManager` and produces the on-screen twin for `<CueToast>`; every
 * outcome — fired or suppressed, including an out-of-scope-exercise lookup
 * miss — is reported for the spec §11 thesis metrics.
 *
 * Status faults (`mismatch`, `insufficient_confidence`, `wrong_orientation`)
 * are deliberately out of scope here: they're signalled through `result.status`,
 * not through a rep boundary, and arbitrating on them is a different trigger
 * model than this rep-boundary bridge implements.
 */
import { useEffect, useRef, useState } from "react"

import type { Exercise, PoseResult } from "../../types"

import { CueArbiter } from "./cueArbiter"
import { buildFaultCandidate, isNewRepBoundary } from "./cueBridge"
import type { ToastCue } from "./CueToast"
import type { UseCoachVoiceResult } from "./useCoachVoice"

export interface UseVoiceCueBridgeOptions {
  readonly result: PoseResult | null
  readonly exercise: Exercise
  readonly voice: UseCoachVoiceResult
}

export interface UseVoiceCueBridgeResult {
  /** The on-screen twin of the most recently fired cue — feed straight to `<CueToast cue={...} />`. */
  readonly toastCue: ToastCue | null
}

/** Live wiring for the boot card / cue toast / cue arbitration (P29 S8). */
export function useVoiceCueBridge(opts: UseVoiceCueBridgeOptions): UseVoiceCueBridgeResult {
  const { result, exercise, voice } = opts
  const arbiterRef = useRef<CueArbiter | null>(null)
  if (arbiterRef.current === null) {
    arbiterRef.current = new CueArbiter(voice.verbosity)
  }
  const lastRepsRef = useRef<number | null>(null)
  const [toastCue, setToastCue] = useState<ToastCue | null>(null)

  // Verbosity can change mid-session from a *different* useCoachVoice
  // instance (the Settings tab's own — synced only through localStorage,
  // per that hook's own design note). Re-applying it here on every change
  // keeps this session's arbiter in step without a page reload.
  useEffect(() => {
    arbiterRef.current?.setVerbosity(voice.verbosity)
  }, [voice.verbosity])

  useEffect(() => {
    if (!result) return
    const reps = result.reps
    const previousReps = lastRepsRef.current
    lastRepsRef.current = reps ?? previousReps
    if (!isNewRepBoundary(reps, previousReps)) return

    const arbiter = arbiterRef.current
    if (!arbiter) return

    const built = buildFaultCandidate(result, exercise, voice.resolveFaultId)
    const timestampMs = performance.now()
    const decision = arbiter.evaluate({
      repIndex: reps,
      timestampMs,
      faults: built.candidate ? [built.candidate] : [],
    })

    if (decision.fire && decision.faultId && decision.severity) {
      const startedAtMs = performance.now()
      voice.play(decision.faultId, { severity: decision.severity })
      voice.reportFired(decision.faultId, decision.severity, performance.now() - startedAtMs)
      setToastCue({
        id: `${decision.faultId}-${timestampMs}`,
        text: built.cueText ?? decision.faultId,
        severity: decision.severity,
      })
      return
    }

    if (built.lookupMiss && built.cueText) {
      // Distinct from the arbiter's own suppression reasons (S8 decision):
      // an out-of-scope exercise's cue must show up in the §11 metrics, not
      // vanish into the generic "no_candidates" the arbiter would otherwise
      // have returned for this same empty-candidates call.
      voice.reportSuppressed(built.cueText, "fault_lookup_miss")
      return
    }

    if (decision.reason) {
      voice.reportSuppressed(built.candidate?.faultId ?? built.cueText ?? "unknown", decision.reason)
    }
  }, [result, exercise, voice])

  return { toastCue }
}
