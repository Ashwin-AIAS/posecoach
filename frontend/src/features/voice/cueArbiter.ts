/**
 * Cue arbitration (P29 S5) — decides WHEN a rep-boundary cue is allowed to
 * speak, implementing spec §4's rule table exactly:
 *
 *   Rule                    | Default | Reason
 *   -------------------------|---------|-------
 *   Global min interval      | 4000ms  | Prevents chatter
 *   Max cues per rep         | 1       | One thought at a time
 *   Per-fault cooldown       | 20000ms | Never repeat the same correction
 *   Soft budget per set      | 3       | After this, high severity only
 *   Silence: first rep       | on      | Let the scorer settle
 *   Silence: final 2 reps    | on      | Grinding phase — do not interrupt
 *   Stale-cue drop           | on      | Discard any cue whose rep index < current rep
 *   Preemption               | severity-based | Higher severity cuts off lower mid-playback
 *
 * "Preemption" is split across two modules by design (spec §3): this file
 * decides which single candidate wins a rep's one cue slot (always the
 * highest-severity eligible one — the arbiter-side half of preemption);
 * `playbackManager.ts` (S4) is what actually cuts off audio still playing
 * when that decision reaches the speaker (the audio-side half).
 *
 * This module is a pure decision function plus small, explicit, timestamp-
 * keyed state — no DOM, no WebSocket, no audio. It is driven by whatever
 * calls `evaluate()` with a `RepEvent`; the real caller (a later stage)
 * derives that event from the existing WS message stream. Fully
 * unit-testable with synthetic rep sequences, no camera needed.
 *
 * Every number below is hand-authored with no empirical backing — the same
 * class of weakness already flagged elsewhere in the codebase (see
 * CLAUDE.local.md's rep-counter and latency notes). They live together in
 * `CUE_ARBITER_CONFIG` so they can be fitted from real session data later
 * and defended honestly in the thesis (spec §4, "Constants are provisional").
 */

import { SEVERITY_RANK, type Severity } from "./playbackManager"

export type { Severity }

export type VerbosityPreset = "quiet" | "normal" | "hype"

export interface VerbosityConfig {
  readonly minIntervalMs: number
  readonly perSetCap: number
  readonly severities: readonly Severity[]
}

/** Spec §4 "Verbosity presets (Settings tab)" table, verbatim. */
export const VERBOSITY_PRESETS: Readonly<Record<VerbosityPreset, VerbosityConfig>> = {
  quiet: { minIntervalMs: 12000, perSetCap: 1, severities: ["high"] },
  normal: { minIntervalMs: 4000, perSetCap: 3, severities: ["high", "medium"] },
  hype: { minIntervalMs: 3000, perSetCap: 5, severities: ["high", "medium", "low", "milestone"] },
}

export const DEFAULT_VERBOSITY: VerbosityPreset = "normal"

/**
 * ⚠️ UNTUNED (spec §4). All thresholds live here, together, on purpose —
 * see the module doc comment above.
 */
export const CUE_ARBITER_CONFIG = {
  maxCuesPerRep: 1,
  perFaultCooldownMs: 20000,
  silenceFirstRep: true,
  silenceFinalTwoReps: true,
  staleCueDrop: true,
  verbosityPresets: VERBOSITY_PRESETS,
} as const

export type CueArbiterConfig = typeof CUE_ARBITER_CONFIG

/** One fault candidate detected on a rep boundary, before arbitration picks (at most) one. */
export interface FaultCandidate {
  readonly faultId: string
  readonly severity: Severity
}

/** One rep-boundary transition from the rep counter — never a mid-rep sample (spec §4 "Trigger"). */
export interface RepEvent {
  /** 1-based index of the rep that just completed. */
  readonly repIndex: number
  /** Wall-clock ms this boundary fired — drives every timing rule below. */
  readonly timestampMs: number
  /** Every fault detected on this rep; the arbiter picks at most one. Order doesn't matter. */
  readonly faults: readonly FaultCandidate[]
}

export type SuppressReason =
  | "stale_rep"
  | "silence_first_rep"
  | "silence_final_reps"
  | "min_interval"
  | "fault_cooldown"
  | "budget_exhausted"
  | "severity_not_allowed"
  | "no_candidates"

export interface CueDecision {
  readonly fire: boolean
  readonly faultId: string | null
  readonly severity: Severity | null
  /** Which rule suppressed this rep's cue; `null` when `fire` is `true`. */
  readonly reason: SuppressReason | null
}

function suppressed(reason: SuppressReason): CueDecision {
  return { fire: false, faultId: null, severity: null, reason }
}

/**
 * Stateful arbiter — one instance per active set (or reuse across sets via
 * `startSet`, which resets the per-set counters). `evaluate()` is the only
 * decision entry point; everything else is bookkeeping for it.
 */
export class CueArbiter {
  private readonly config: CueArbiterConfig
  private verbosity: VerbosityConfig
  private verbosityKey: VerbosityPreset

  private totalReps: number | null = null
  private highestRepSeen = 0
  private cuesFiredThisSet = 0
  private lastFiredAtMs = -Infinity
  private readonly faultCooldowns = new Map<string, number>()

  constructor(preset: VerbosityPreset = DEFAULT_VERBOSITY, config: CueArbiterConfig = CUE_ARBITER_CONFIG) {
    this.config = config
    this.verbosityKey = preset
    this.verbosity = config.verbosityPresets[preset]
  }

  get currentVerbosity(): VerbosityPreset {
    return this.verbosityKey
  }

  get cuesFiredInSet(): number {
    return this.cuesFiredThisSet
  }

  setVerbosity(preset: VerbosityPreset): void {
    this.verbosityKey = preset
    this.verbosity = this.config.verbosityPresets[preset]
  }

  /**
   * Begin a new set. Resets the per-set budget and stale-rep tracking —
   * fault cooldowns and the global min-interval clock deliberately persist
   * across sets, since both are wall-clock rules about not repeating
   * yourself, not per-set concepts. `totalReps` is `null` for a free-form
   * (untargeted) set, which disables the final-two-reps silence window —
   * there is no "final two" without a target.
   */
  startSet(totalReps: number | null): void {
    this.totalReps = totalReps
    this.highestRepSeen = 0
    this.cuesFiredThisSet = 0
  }

  /** Decide whether (and which single fault) fires a cue for this rep boundary. */
  evaluate(event: RepEvent): CueDecision {
    const { repIndex, timestampMs, faults } = event

    if (this.config.staleCueDrop && repIndex < this.highestRepSeen) {
      return suppressed("stale_rep")
    }
    this.highestRepSeen = Math.max(this.highestRepSeen, repIndex)

    if (this.config.silenceFirstRep && repIndex <= 1) {
      return suppressed("silence_first_rep")
    }

    if (this.config.silenceFinalTwoReps && this.totalReps !== null && repIndex > this.totalReps - 2) {
      return suppressed("silence_final_reps")
    }

    if (timestampMs - this.lastFiredAtMs < this.verbosity.minIntervalMs) {
      return suppressed("min_interval")
    }

    if (faults.length === 0) {
      return suppressed("no_candidates")
    }

    const overBudget = this.cuesFiredThisSet >= this.verbosity.perSetCap
    const allowedSeverities: readonly Severity[] = overBudget ? ["high"] : this.verbosity.severities

    const onCooldown = (faultId: string): boolean => {
      const last = this.faultCooldowns.get(faultId)
      return last !== undefined && timestampMs - last < this.config.perFaultCooldownMs
    }

    const severityEligible = faults.filter((f) => allowedSeverities.includes(f.severity))
    if (severityEligible.length === 0) {
      return suppressed(overBudget ? "budget_exhausted" : "severity_not_allowed")
    }

    // Max cues per rep = 1 by construction: exactly one candidate (the
    // highest-ranked eligible one) is ever chosen per evaluate() call.
    const chosen = severityEligible
      .filter((f) => !onCooldown(f.faultId))
      .slice()
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0]
    if (!chosen) {
      return suppressed("fault_cooldown")
    }

    this.lastFiredAtMs = timestampMs
    this.cuesFiredThisSet += 1
    this.faultCooldowns.set(chosen.faultId, timestampMs)
    return { fire: true, faultId: chosen.faultId, severity: chosen.severity, reason: null }
  }
}
