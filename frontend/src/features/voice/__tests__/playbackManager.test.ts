import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  PlaybackManager,
  type AudioContextLike,
  type AudioElementLike,
  type GainNodeLike,
  type VoiceManifest,
} from "../playbackManager"

const MANIFEST: VoiceManifest = {
  "atlas.elbow_flare.high": { file: "atlas/elbow_flare.high.mp3", hash: "aaa111", dur_ms: 1500 },
  "atlas.knee_valgus.low": { file: "atlas/knee_valgus.low.mp3", hash: "bbb222", dur_ms: 1200 },
  "vector.rag_answer": { file: "vector/rag_answer.mp3", hash: "ccc333", dur_ms: 4000 },
}

/** Minimal fake `<audio>` element — records calls, fires listeners on demand. */
class FakeAudio implements AudioElementLike {
  src = ""
  played = 0
  paused = 0
  private listeners: Record<string, Array<() => void>> = { ended: [], error: [] }

  constructor(src: string) {
    this.src = src
  }

  play(): Promise<void> {
    this.played += 1
    return Promise.resolve()
  }

  pause(): void {
    this.paused += 1
  }

  addEventListener(type: "ended" | "error", listener: () => void): void {
    this.listeners[type].push(listener)
  }

  removeEventListener(type: "ended" | "error", listener: () => void): void {
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener)
  }

  /** Test-only: simulate the clip finishing (or erroring). */
  fire(type: "ended" | "error"): void {
    for (const listener of [...this.listeners[type]]) listener()
  }
}

/**
 * Minimal fake `GainNode`. Real Web Audio ramps need a real clock, so the
 * fake just applies `linearRampToValueAtTime`'s target immediately — good
 * enough to assert the manager scheduled the right target value.
 */
function makeFakeGain(): GainNodeLike {
  const state = { value: 1 }
  return {
    gain: {
      get value(): number {
        return state.value
      },
      set value(v: number) {
        state.value = v
      },
      setValueAtTime: vi.fn((value: number) => {
        state.value = value
      }),
      linearRampToValueAtTime: vi.fn((value: number) => {
        state.value = value
      }),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
  }
}

/** Minimal fake `AudioContext` — deterministic clock, gain/source factories. */
class FakeAudioContext implements AudioContextLike {
  currentTime = 0
  destination = {}
  gains: GainNodeLike[] = []

  createGain(): GainNodeLike {
    const gain = makeFakeGain()
    this.gains.push(gain)
    return gain
  }

  createMediaElementSource(_element: AudioElementLike): { connect: (destination: unknown) => unknown } {
    return { connect: vi.fn() }
  }
}

interface Harness {
  manager: PlaybackManager
  ctx: FakeAudioContext
  audios: FakeAudio[]
  latestAudio: () => FakeAudio
}

function makeHarness(manifest: VoiceManifest = MANIFEST): Harness {
  const ctx = new FakeAudioContext()
  const audios: FakeAudio[] = []
  const manager = new PlaybackManager({
    manifest,
    createAudioContext: () => ctx,
    createAudioElement: (src) => {
      const audio = new FakeAudio(src)
      audios.push(audio)
      return audio
    },
  })
  return { manager, ctx, audios, latestAudio: () => audios[audios.length - 1] }
}

describe("PlaybackManager", () => {
  let h: Harness

  beforeEach(() => {
    h = makeHarness()
  })

  it("plays a cue and resolves its URL from the manifest (file + hash query)", () => {
    const started = h.manager.playCue("atlas.knee_valgus.low", { severity: "low" })
    expect(started).toBe(true)
    expect(h.latestAudio().src).toBe("/voice/atlas/knee_valgus.low.mp3?v=bbb222")
    expect(h.latestAudio().played).toBe(1)
    expect(h.manager.currentCue).toEqual({ key: "atlas.knee_valgus.low", severity: "low" })
  })

  it("returns false and plays nothing for a key missing from the manifest", () => {
    const started = h.manager.playCue("atlas.unknown_fault.high", { severity: "high" })
    expect(started).toBe(false)
    expect(h.audios).toHaveLength(0)
  })

  describe("severity preemption (cue vs. cue)", () => {
    it("a higher-severity cue preempts (stops) a lower-severity cue still playing", () => {
      h.manager.playCue("atlas.knee_valgus.low", { severity: "low" })
      const lowAudio = h.latestAudio()

      const started = h.manager.playCue("atlas.elbow_flare.high", { severity: "high" })

      expect(started).toBe(true)
      expect(lowAudio.paused).toBe(1) // the low-severity clip was cut off
      expect(h.latestAudio().played).toBe(1) // the new high-severity clip started
      expect(h.manager.currentCue).toEqual({ key: "atlas.elbow_flare.high", severity: "high" })
    })

    it("a lower-severity cue does NOT preempt a higher-severity cue in progress", () => {
      h.manager.playCue("atlas.elbow_flare.high", { severity: "high" })
      const highAudio = h.latestAudio()

      const started = h.manager.playCue("atlas.knee_valgus.low", { severity: "low" })

      expect(started).toBe(false)
      expect(highAudio.paused).toBe(0) // untouched
      expect(h.audios).toHaveLength(1) // no second clip was ever created
      expect(h.manager.currentCue).toEqual({ key: "atlas.elbow_flare.high", severity: "high" })
    })

    it("an equal-severity cue does NOT preempt (only strictly higher wins)", () => {
      h.manager.playCue("atlas.elbow_flare.high", { severity: "high" })
      const firstAudio = h.latestAudio()

      const started = h.manager.playCue("atlas.elbow_flare.high", { severity: "high" })

      expect(started).toBe(false)
      expect(firstAudio.paused).toBe(0)
    })

    it("clears currentCue and calls onEnded when a cue finishes naturally (not preempted)", () => {
      const onEnded = vi.fn()
      h.manager.playCue("atlas.knee_valgus.low", { severity: "low", onEnded })
      h.latestAudio().fire("ended")

      expect(onEnded).toHaveBeenCalledTimes(1)
      expect(h.manager.currentCue).toBeNull()
    })
  })

  describe("ducking (cue vs. RAG)", () => {
    it("ducks the RAG lane's gain to ~0.25 when a cue starts over it, and restores it to 1.0 once the cue ends", () => {
      h.manager.playRag("vector.rag_answer")
      const ragGainNode = h.ctx.gains[0]

      h.manager.playCue("atlas.elbow_flare.high", { severity: "high" })

      expect(h.manager.isRagDucked).toBe(true)
      expect(ragGainNode.gain.value).toBeCloseTo(0.25)
      expect(ragGainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.25, expect.any(Number))

      // RAG audio itself is only ducked, never stopped, by a cue.
      const ragAudio = h.audios[0]
      expect(ragAudio.paused).toBe(0)

      // Cue finishes -> gain ramps back up.
      h.latestAudio().fire("ended")

      expect(h.manager.isRagDucked).toBe(false)
      expect(ragGainNode.gain.value).toBeCloseTo(1.0)
      expect(ragGainNode.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1.0, expect.any(Number))
    })

    it("keeps RAG ducked (does not restore mid-way) when one cue preempts another", () => {
      h.manager.playRag("vector.rag_answer")
      const ragGainNode = h.ctx.gains[0]

      h.manager.playCue("atlas.knee_valgus.low", { severity: "low" })
      expect(ragGainNode.gain.value).toBeCloseTo(0.25)

      // Higher-severity cue preempts the low one — RAG should stay ducked,
      // not bounce back to full gain in between.
      h.manager.playCue("atlas.elbow_flare.high", { severity: "high" })
      expect(h.manager.isRagDucked).toBe(true)
      expect(ragGainNode.gain.value).toBeCloseTo(0.25)

      // Only once the cue lane actually goes idle does gain restore.
      h.latestAudio().fire("ended")
      expect(h.manager.isRagDucked).toBe(false)
      expect(ragGainNode.gain.value).toBeCloseTo(1.0)
    })

    it("does not duck when no RAG audio is playing", () => {
      h.manager.playCue("atlas.elbow_flare.high", { severity: "high" })
      expect(h.manager.isRagDucked).toBe(false)
      expect(h.manager.currentRag).toBeNull()
    })
  })

  describe("lifecycle", () => {
    it("stopAll pauses both lanes and clears their state", () => {
      h.manager.playCue("atlas.elbow_flare.high", { severity: "high" })
      h.manager.playRag("vector.rag_answer")

      h.manager.stopAll()

      expect(h.manager.currentCue).toBeNull()
      expect(h.manager.currentRag).toBeNull()
      for (const audio of h.audios) expect(audio.paused).toBe(1)
    })

    it("playRag always replaces a prior RAG clip", () => {
      h.manager.playRag("vector.rag_answer")
      const firstRag = h.latestAudio()

      h.manager.playRag("vector.rag_answer")

      expect(firstRag.paused).toBe(1)
      expect(h.latestAudio().played).toBe(1)
    })
  })
})
