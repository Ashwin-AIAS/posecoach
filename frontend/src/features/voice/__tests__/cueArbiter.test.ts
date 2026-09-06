import { describe, expect, it } from "vitest"

import { CueArbiter, VERBOSITY_PRESETS, type CueDecision, type RepEvent } from "../cueArbiter"

/** Convenience: assert a decision was suppressed for exactly this reason. */
function expectSuppressed(decision: CueDecision, reason: CueDecision["reason"]): void {
  expect(decision).toEqual({ fire: false, faultId: null, severity: null, reason })
}

describe("CueArbiter — spec P29 §4 rule table", () => {
  it("Global min interval — suppresses a cue fired before 4000ms have passed since the last one", () => {
    const arbiter = new CueArbiter("normal")
    arbiter.startSet(null)

    const first = arbiter.evaluate({ repIndex: 2, timestampMs: 0, faults: [{ faultId: "a", severity: "high" }] })
    expect(first).toEqual({ fire: true, faultId: "a", severity: "high", reason: null })

    // Only 1000ms later — well under the 4000ms floor.
    const tooSoon = arbiter.evaluate({
      repIndex: 3,
      timestampMs: 1000,
      faults: [{ faultId: "b", severity: "high" }],
    })
    expectSuppressed(tooSoon, "min_interval")

    // Exactly 4000ms later — the floor is inclusive.
    const atFloor = arbiter.evaluate({
      repIndex: 4,
      timestampMs: 4000,
      faults: [{ faultId: "b", severity: "high" }],
    })
    expect(atFloor).toEqual({ fire: true, faultId: "b", severity: "high", reason: null })
  })

  it("Max cues per rep — fires at most one cue even with several fault candidates on the same rep", () => {
    const arbiter = new CueArbiter("normal")
    arbiter.startSet(null)

    const decision = arbiter.evaluate({
      repIndex: 2,
      timestampMs: 0,
      faults: [
        { faultId: "elbow_flare", severity: "medium" },
        { faultId: "knee_valgus", severity: "high" },
      ],
    })

    // A single decision object naming a single fault — there is no way for
    // this API to surface two cues for one rep.
    expect(decision).toEqual({ fire: true, faultId: "knee_valgus", severity: "high", reason: null })
  })

  it("Per-fault cooldown — suppresses a repeated fault within 20000ms even when interval and budget allow it", () => {
    const arbiter = new CueArbiter("normal")
    arbiter.startSet(null)

    const first = arbiter.evaluate({
      repIndex: 2,
      timestampMs: 0,
      faults: [{ faultId: "elbow_flare", severity: "high" }],
    })
    expect(first.fire).toBe(true)

    // 5000ms later clears the min-interval rule easily, but it's the same
    // fault only 5s after it last fired — well inside the 20s cooldown.
    const repeated = arbiter.evaluate({
      repIndex: 3,
      timestampMs: 5000,
      faults: [{ faultId: "elbow_flare", severity: "high" }],
    })
    expectSuppressed(repeated, "fault_cooldown")

    // 25000ms after the first firing — cooldown has expired.
    const afterCooldown = arbiter.evaluate({
      repIndex: 4,
      timestampMs: 25000,
      faults: [{ faultId: "elbow_flare", severity: "high" }],
    })
    expect(afterCooldown).toEqual({ fire: true, faultId: "elbow_flare", severity: "high", reason: null })
  })

  it("Soft budget per set — after the per-set cap, only high-severity candidates still fire", () => {
    const arbiter = new CueArbiter("normal") // perSetCap: 3, severities: high + medium
    arbiter.startSet(null)

    // Spend the budget: 3 cues, distinct faults, 4000ms apart so only the
    // budget rule (not interval or cooldown) is in play.
    const events: RepEvent[] = [
      { repIndex: 2, timestampMs: 0, faults: [{ faultId: "a", severity: "high" }] },
      { repIndex: 3, timestampMs: 4000, faults: [{ faultId: "b", severity: "high" }] },
      { repIndex: 4, timestampMs: 8000, faults: [{ faultId: "c", severity: "high" }] },
    ]
    for (const event of events) {
      expect(arbiter.evaluate(event).fire).toBe(true)
    }
    expect(arbiter.cuesFiredInSet).toBe(3)

    // Budget is spent — a medium-severity fault (normally allowed by the
    // "normal" preset) is now suppressed.
    const overBudgetMedium = arbiter.evaluate({
      repIndex: 5,
      timestampMs: 12000,
      faults: [{ faultId: "d", severity: "medium" }],
    })
    expectSuppressed(overBudgetMedium, "budget_exhausted")

    // But a high-severity fault still gets through past the cap.
    const overBudgetHigh = arbiter.evaluate({
      repIndex: 6,
      timestampMs: 16000,
      faults: [{ faultId: "e", severity: "high" }],
    })
    expect(overBudgetHigh).toEqual({ fire: true, faultId: "e", severity: "high", reason: null })
  })

  it("Silence: first rep — never fires on rep 1, then fires normally from rep 2 on", () => {
    const arbiter = new CueArbiter("normal")
    arbiter.startSet(null)

    const onFirstRep = arbiter.evaluate({
      repIndex: 1,
      timestampMs: 0,
      faults: [{ faultId: "a", severity: "high" }],
    })
    expectSuppressed(onFirstRep, "silence_first_rep")

    const onSecondRep = arbiter.evaluate({
      repIndex: 2,
      timestampMs: 5000,
      faults: [{ faultId: "a", severity: "high" }],
    })
    expect(onSecondRep.fire).toBe(true)
  })

  it("Silence: final 2 reps — never fires on the last two reps of a set with a known target", () => {
    const arbiter = new CueArbiter("normal")
    arbiter.startSet(10) // final two = reps 9 and 10

    const midSet = arbiter.evaluate({ repIndex: 8, timestampMs: 0, faults: [{ faultId: "a", severity: "high" }] })
    expect(midSet.fire).toBe(true)

    const penultimate = arbiter.evaluate({
      repIndex: 9,
      timestampMs: 10000,
      faults: [{ faultId: "b", severity: "high" }],
    })
    expectSuppressed(penultimate, "silence_final_reps")

    const last = arbiter.evaluate({ repIndex: 10, timestampMs: 20000, faults: [{ faultId: "c", severity: "high" }] })
    expectSuppressed(last, "silence_final_reps")

    // Without a known target, there is no "final two" to silence.
    const untargeted = new CueArbiter("normal")
    untargeted.startSet(null)
    const lateRepNoTarget = untargeted.evaluate({
      repIndex: 99,
      timestampMs: 0,
      faults: [{ faultId: "a", severity: "high" }],
    })
    expect(lateRepNoTarget.fire).toBe(true)
  })

  it("Stale-cue drop — discards a decision for a rep index lower than the highest rep already seen", () => {
    const arbiter = new CueArbiter("normal")
    arbiter.startSet(null)

    const ahead = arbiter.evaluate({ repIndex: 5, timestampMs: 0, faults: [{ faultId: "a", severity: "high" }] })
    expect(ahead.fire).toBe(true)

    // A late-arriving event for an earlier rep (repIndex 3 < highest seen
    // 5) is dropped even though 10000ms easily clears the min interval and
    // it's a different, uncooled-down fault.
    const stale = arbiter.evaluate({
      repIndex: 3,
      timestampMs: 10000,
      faults: [{ faultId: "b", severity: "high" }],
    })
    expectSuppressed(stale, "stale_rep")
  })

  it("Preemption — the arbiter always selects the highest-severity eligible candidate on a rep", () => {
    const arbiter = new CueArbiter("hype") // allows every severity, so all three compete on merit
    arbiter.startSet(null)

    const decision = arbiter.evaluate({
      repIndex: 2,
      timestampMs: 0,
      faults: [
        { faultId: "low_fault", severity: "low" },
        { faultId: "high_fault", severity: "high" },
        { faultId: "medium_fault", severity: "medium" },
      ],
    })

    expect(decision).toEqual({ fire: true, faultId: "high_fault", severity: "high", reason: null })
  })
})

describe("CueArbiter — spec P29 §4 verbosity presets", () => {
  it("Quiet preset — high severity only, 12000ms floor, cap 1", () => {
    expect(VERBOSITY_PRESETS.quiet).toEqual({ minIntervalMs: 12000, perSetCap: 1, severities: ["high"] })

    const arbiter = new CueArbiter("quiet")
    arbiter.startSet(null)

    const mediumBlocked = arbiter.evaluate({
      repIndex: 2,
      timestampMs: 0,
      faults: [{ faultId: "a", severity: "medium" }],
    })
    expectSuppressed(mediumBlocked, "severity_not_allowed")

    const firstHigh = arbiter.evaluate({
      repIndex: 3,
      timestampMs: 100,
      faults: [{ faultId: "b", severity: "high" }],
    })
    expect(firstHigh).toEqual({ fire: true, faultId: "b", severity: "high", reason: null })

    // 4900ms after the last firing — comfortably clears "normal"'s 4000ms
    // floor but not quiet's 12000ms one.
    const tooSoon = arbiter.evaluate({
      repIndex: 4,
      timestampMs: 5000,
      faults: [{ faultId: "c", severity: "high" }],
    })
    expectSuppressed(tooSoon, "min_interval")

    const afterFloor = arbiter.evaluate({
      repIndex: 5,
      timestampMs: 12300,
      faults: [{ faultId: "d", severity: "high" }],
    })
    expect(afterFloor).toEqual({ fire: true, faultId: "d", severity: "high", reason: null })
  })

  it("Normal preset (default) — high and medium fire, low and milestone do not", () => {
    expect(VERBOSITY_PRESETS.normal).toEqual({
      minIntervalMs: 4000,
      perSetCap: 3,
      severities: ["high", "medium"],
    })

    const arbiter = new CueArbiter("normal")
    arbiter.startSet(null)

    expectSuppressed(
      arbiter.evaluate({ repIndex: 2, timestampMs: 0, faults: [{ faultId: "a", severity: "low" }] }),
      "severity_not_allowed",
    )
    expectSuppressed(
      arbiter.evaluate({ repIndex: 3, timestampMs: 100, faults: [{ faultId: "b", severity: "milestone" }] }),
      "severity_not_allowed",
    )

    const mediumFires = arbiter.evaluate({
      repIndex: 4,
      timestampMs: 200,
      faults: [{ faultId: "c", severity: "medium" }],
    })
    expect(mediumFires).toEqual({ fire: true, faultId: "c", severity: "medium", reason: null })

    const highFires = arbiter.evaluate({
      repIndex: 5,
      timestampMs: 4300,
      faults: [{ faultId: "d", severity: "high" }],
    })
    expect(highFires).toEqual({ fire: true, faultId: "d", severity: "high", reason: null })
  })

  it("Hype preset — every severity including milestone can fire, floor 3000ms, cap 5", () => {
    expect(VERBOSITY_PRESETS.hype).toEqual({
      minIntervalMs: 3000,
      perSetCap: 5,
      severities: ["high", "medium", "low", "milestone"],
    })

    const arbiter = new CueArbiter("hype")
    arbiter.startSet(null)

    const milestoneFires = arbiter.evaluate({
      repIndex: 2,
      timestampMs: 0,
      faults: [{ faultId: "pr", severity: "milestone" }],
    })
    expect(milestoneFires).toEqual({ fire: true, faultId: "pr", severity: "milestone", reason: null })

    // Exactly hype's 3000ms floor later.
    const lowFires = arbiter.evaluate({
      repIndex: 3,
      timestampMs: 3000,
      faults: [{ faultId: "elbow_flare", severity: "low" }],
    })
    expect(lowFires).toEqual({ fire: true, faultId: "elbow_flare", severity: "low", reason: null })
  })
})
