import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PoseResult } from "../../../types"
import { DEFAULT_VERBOSITY } from "../cueArbiter"
import type { PersonaKey } from "../personas"
import type { UseCoachVoiceResult } from "../useCoachVoice"
import { useVoiceCueBridge } from "../useVoiceCueBridge"

function makeFrame(overrides: Partial<PoseResult> = {}): PoseResult {
  return {
    keypoints: [],
    confidence: [],
    score: 80,
    cues: [],
    latency_ms: 20,
    ...overrides,
  }
}

function makeVoice(overrides: Partial<UseCoachVoiceResult> = {}): UseCoachVoiceResult {
  return {
    ready: true,
    manifest: {},
    personas: [],
    persona: "atlas" as PersonaKey,
    setPersona: vi.fn(),
    muted: false,
    setMuted: vi.fn(),
    verbosity: DEFAULT_VERBOSITY,
    setVerbosity: vi.fn(),
    handsFree: false,
    setHandsFree: vi.fn(),
    play: vi.fn(() => true),
    resolveFaultId: vi.fn(() => null),
    reportFired: vi.fn(),
    reportSuppressed: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(performance, "now").mockReturnValue(1000)
})

describe("useVoiceCueBridge", () => {
  it("does nothing on the very first frame (nothing to diff reps against)", () => {
    const voice = makeVoice()
    renderHook(({ result }) => useVoiceCueBridge({ result, exercise: "squat", voice }), {
      initialProps: { result: makeFrame({ reps: 1 }) as PoseResult | null },
    })
    expect(voice.play).not.toHaveBeenCalled()
    expect(voice.reportFired).not.toHaveBeenCalled()
    expect(voice.reportSuppressed).not.toHaveBeenCalled()
  })

  it("fires a cue on a genuine rep boundary, plays it, and reports it", () => {
    const voice = makeVoice({ resolveFaultId: vi.fn(() => "squat.knee_angle.high") })
    const { rerender } = renderHook(({ result }) => useVoiceCueBridge({ result, exercise: "squat", voice }), {
      initialProps: { result: makeFrame({ reps: 1, cues: [], worst_joint: null }) as PoseResult | null },
    })

    rerender({
      result: makeFrame({
        reps: 3, // > 1, so silence_first_rep no longer applies
        cues: ["Squat deeper for full range"],
        worst_joint: "left_knee_angle",
        joint_scores: { left_knee_angle: 60 },
      }),
    })

    expect(voice.play).toHaveBeenCalledWith("squat.knee_angle.high.left", { severity: "high" })
    expect(voice.reportFired).toHaveBeenCalledWith("squat.knee_angle.high.left", "high", expect.any(Number))
    expect(voice.reportSuppressed).not.toHaveBeenCalled()
  })

  it("sets a CueToast twin with the raw cue text on a fired decision", () => {
    const voice = makeVoice({ resolveFaultId: vi.fn(() => "squat.knee_angle.high") })
    const { rerender, result } = renderHook(
      ({ result: frame }) => useVoiceCueBridge({ result: frame, exercise: "squat", voice }),
      { initialProps: { result: makeFrame({ reps: 1 }) as PoseResult | null } },
    )

    rerender({
      result: makeFrame({
        reps: 3,
        cues: ["Squat deeper for full range"],
        worst_joint: "left_knee_angle",
        joint_scores: { left_knee_angle: 60 },
      }),
    })

    expect(result.current.toastCue?.text).toBe("Squat deeper for full range")
    expect(result.current.toastCue?.severity).toBe("high")
  })

  it("reports a distinct fault_lookup_miss instead of the arbiter's generic no_candidates", () => {
    const voice = makeVoice({ resolveFaultId: vi.fn(() => null) })
    const { rerender } = renderHook(
      ({ result: frame }) => useVoiceCueBridge({ result: frame, exercise: "lunge", voice }),
      { initialProps: { result: makeFrame({ reps: 1 }) as PoseResult | null } },
    )

    rerender({
      result: makeFrame({
        reps: 3,
        cues: ["Some out-of-scope cue"],
        worst_joint: "left_knee_angle",
        joint_scores: { left_knee_angle: 60 },
      }),
    })

    expect(voice.play).not.toHaveBeenCalled()
    expect(voice.reportSuppressed).toHaveBeenCalledWith("Some out-of-scope cue", "fault_lookup_miss")
  })

  it("still reports the arbiter's own suppression reason when a real candidate is silenced (e.g. first rep)", () => {
    const voice = makeVoice({ resolveFaultId: vi.fn(() => "squat.knee_angle.high") })
    const { rerender } = renderHook(
      ({ result: frame }) => useVoiceCueBridge({ result: frame, exercise: "squat", voice }),
      { initialProps: { result: makeFrame({ reps: 0 }) as PoseResult | null } },
    )

    // repIndex 1 is the silenced first rep (spec §4 "Silence: first rep").
    rerender({
      result: makeFrame({
        reps: 1,
        cues: ["Squat deeper for full range"],
        worst_joint: "left_knee_angle",
        joint_scores: { left_knee_angle: 60 },
      }),
    })

    expect(voice.play).not.toHaveBeenCalled()
    expect(voice.reportSuppressed).toHaveBeenCalledWith("squat.knee_angle.high.left", "silence_first_rep")
  })

  it("does nothing when reps is undefined (e.g. posing mode)", () => {
    const voice = makeVoice()
    const { rerender } = renderHook(
      ({ result: frame }) => useVoiceCueBridge({ result: frame, exercise: "squat", voice }),
      { initialProps: { result: makeFrame({ reps: undefined }) as PoseResult | null } },
    )
    rerender({ result: makeFrame({ reps: undefined }) })
    expect(voice.play).not.toHaveBeenCalled()
    expect(voice.reportSuppressed).not.toHaveBeenCalled()
  })

  it("does nothing when result is null", () => {
    const voice = makeVoice()
    renderHook(({ result }) => useVoiceCueBridge({ result, exercise: "squat", voice }), {
      initialProps: { result: null as PoseResult | null },
    })
    expect(voice.play).not.toHaveBeenCalled()
  })

  it("re-applies verbosity to the shared arbiter before evaluating the next boundary", () => {
    // Quiet (only "high" allowed) then switched to "hype" (all severities)
    // on the same render that delivers a low-severity candidate — proves
    // the new verbosity was applied before evaluate() ran, not after.
    let voice = makeVoice({ verbosity: "quiet", resolveFaultId: vi.fn(() => "squat.knee_angle.high") })
    const { rerender } = renderHook(
      (props: { result: PoseResult | null; voice: UseCoachVoiceResult }) =>
        useVoiceCueBridge({ result: props.result, exercise: "squat", voice: props.voice }),
      { initialProps: { result: makeFrame({ reps: 1 }) as PoseResult | null, voice } },
    )

    voice = makeVoice({ verbosity: "hype", resolveFaultId: vi.fn(() => "squat.knee_angle.high") })
    rerender({
      result: makeFrame({
        reps: 3,
        cues: ["Squat deeper for full range"],
        worst_joint: "left_knee_angle",
        joint_scores: { left_knee_angle: 99 }, // deficit=1 -> "low" severity
      }),
      voice,
    })

    expect(voice.play).toHaveBeenCalled()
  })
})
