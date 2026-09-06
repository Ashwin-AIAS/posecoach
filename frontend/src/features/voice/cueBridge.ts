/**
 * Pure decision-building logic for turning one WS frame into a
 * `CueArbiter` `RepEvent` (P29 S8). Kept separate from `useVoiceCueBridge.ts`'s
 * React hook so rep-boundary detection, fault-id resolution, and the
 * severity math are fully unit-testable with plain frame-shaped fixtures —
 * no rendering, no timers, no camera, no WebSocket.
 *
 * S8 decisions this module implements exactly (see
 * docs/prompts/P29_VOICE_COACH_PERSONAS.md's S8 notes):
 *
 *  - Arbitrate on `cues[0]` + `worst_joint` only. `cues[1]` (when present) is
 *    ignored entirely — it has no side attribution (the frame carries no
 *    per-cue joint) and the arbiter's own "max cues per rep = 1" cap means
 *    it could never fire anyway.
 *  - Severity = `100 - joint_scores[worst_joint]` (the deficit), exactly the
 *    formula `app/analysis/form_scorer.py` already uses internally
 *    (`100.0 - js`) — bucketed into high/medium/low by
 *    `SEVERITY_DEFICIT_THRESHOLDS` below, which are as provisional/untuned
 *    as every other P29 threshold (spec §4 "Constants are provisional").
 *  - A cue whose text has no S1 lookup entry (an out-of-scope exercise) is
 *    reported with the distinct `"fault_lookup_miss"` reason rather than
 *    disappearing into the arbiter's generic `"no_candidates"`.
 */
import type { FaultCandidate } from "./cueArbiter"
import type { Severity } from "./playbackManager"

/** The subset of `PoseResult` this module reads — kept structural so tests
 * never need to import the full frontend `types.ts` PoseResult shape. */
export interface CueFrame {
  readonly cues: readonly string[]
  readonly reps?: number
  readonly worst_joint?: string | null
  readonly joint_scores?: Readonly<Record<string, number>>
}

/** `(exercise, cueText) -> template fault id, or null if out of the S1 scope`. */
export type FaultResolver = (exercise: string, cueText: string) => string | null

/** ⚠️ UNTUNED (spec §4) — same class of provisional constant as `CUE_ARBITER_CONFIG`. */
export const SEVERITY_DEFICIT_THRESHOLDS = { high: 30, medium: 15 } as const

/** Bucket a joint-score deficit (0-100) into a cue severity. Never returns
 * `"milestone"` — that's for positive-reinforcement cues with no fault behind
 * them, out of scope for a deficit-driven candidate. */
export function severityFromDeficit(deficit: number): Severity {
  if (deficit >= SEVERITY_DEFICIT_THRESHOLDS.high) return "high"
  if (deficit >= SEVERITY_DEFICIT_THRESHOLDS.medium) return "medium"
  return "low"
}

/** `"left_knee_angle"` -> `"left"`; a centre joint (no prefix) -> `null`. Mirrors
 * `app/voice/fault_taxonomy.py`'s `_joint_base` side-splitting exactly. */
export function sideOf(joint: string): "left" | "right" | null {
  if (joint.startsWith("left_")) return "left"
  if (joint.startsWith("right_")) return "right"
  return null
}

export interface BuiltCandidate {
  /** `null` when there's nothing to arbitrate on this rep — no cue, no worst joint, or a lookup miss. */
  readonly candidate: FaultCandidate | null
  /** True when `cues[0]` existed but had no S1 lookup entry (S8: out-of-scope exercise). */
  readonly lookupMiss: boolean
  /** The raw cue sentence this candidate (or miss) came from — the `CueToast` twin's text, verbatim. */
  readonly cueText: string | null
}

/** Build (at most) one fault candidate from a frame, per the S8 decisions above. */
export function buildFaultCandidate(
  frame: CueFrame,
  exercise: string,
  resolveFaultId: FaultResolver,
): BuiltCandidate {
  const cueText = frame.cues[0] ?? null
  const worstJoint = frame.worst_joint ?? null
  if (!cueText || !worstJoint) {
    return { candidate: null, lookupMiss: false, cueText }
  }

  const templateFaultId = resolveFaultId(exercise, cueText)
  if (!templateFaultId) {
    return { candidate: null, lookupMiss: true, cueText }
  }

  const side = sideOf(worstJoint)
  const faultId = side ? `${templateFaultId}.${side}` : templateFaultId
  const deficit = 100 - (frame.joint_scores?.[worstJoint] ?? 100)
  return {
    candidate: { faultId, severity: severityFromDeficit(deficit) },
    lookupMiss: false,
    cueText,
  }
}

/**
 * True when `reps` is a genuine new rep-boundary versus `previousReps`
 * (rep counts only ever increase within a set — spec §4 "Trigger": cues
 * fire only on the rep-boundary transition, never mid-rep, never on a
 * reset/first-seen frame with nothing to diff against).
 */
export function isNewRepBoundary(reps: number | undefined, previousReps: number | null): reps is number {
  return reps !== undefined && previousReps !== null && reps > previousReps
}
