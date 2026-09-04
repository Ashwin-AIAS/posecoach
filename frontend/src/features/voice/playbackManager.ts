/**
 * Single-channel voice playback core (P29 S4).
 *
 * Two lanes share one manager: `cue` (deterministic, pre-rendered,
 * sub-second — fired by the rep-boundary arbiter) and `rag` (generative,
 * streamed, multi-second — the chatbot speaking a persona-voiced answer).
 * Per spec §3/§4: cue audio always wins. Concretely that means two
 * mechanisms, not one:
 *
 *  - **Preemption** (cue vs. cue): a higher-severity cue stops a
 *    lower-or-equal-severity cue outright and takes the lane. Rank order is
 *    `SEVERITY_RANK`.
 *  - **Ducking** (cue vs. rag): a cue never stops RAG audio, it ducks it —
 *    ramps the RAG lane's gain to ~0.25 over 300ms so the cue is audible on
 *    top, then ramps back to 1.0 over 300ms once the cue lane goes idle.
 *
 * No arbitration (min interval, cooldowns, budgets, silence windows — §4's
 * rule table) lives here. This module only knows how to play, preempt, and
 * duck; `cueArbiter.ts` (S5) decides *whether* and *when* to call it.
 *
 * Browser audio objects (`Audio`, `AudioContext`, `GainNode`, …) are taken
 * behind small structural interfaces rather than the DOM lib types directly,
 * so a unit test can inject plain fakes instead of needing a real WebAudio
 * implementation (jsdom has none). The default factories below use the real
 * globals and are what production code gets.
 */

export type Severity = "high" | "medium" | "low" | "milestone"

/** Higher wins preemption. `milestone` ranks with `low` per spec §4. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  high: 3,
  medium: 2,
  low: 1,
  milestone: 1,
}

export type Lane = "cue" | "rag"

/** One entry of `frontend/public/voice/manifest.json` (see `app/voice/router.py`). */
export interface ManifestEntry {
  readonly file: string
  readonly hash: string
  readonly dur_ms: number
}

export type VoiceManifest = Readonly<Record<string, ManifestEntry>>

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, startTime: number): unknown
  linearRampToValueAtTime(value: number, endTime: number): unknown
  cancelScheduledValues(startTime: number): unknown
}

export interface GainNodeLike {
  readonly gain: AudioParamLike
  connect(destination: unknown): unknown
}

export interface AudioSourceNodeLike {
  connect(destination: unknown): unknown
}

export interface AudioElementLike {
  src: string
  play(): Promise<void>
  pause(): void
  addEventListener(type: "ended" | "error", listener: () => void): void
  removeEventListener(type: "ended" | "error", listener: () => void): void
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly destination: unknown
  createGain(): GainNodeLike
  createMediaElementSource(element: AudioElementLike): AudioSourceNodeLike
}

export interface PlaybackManagerDeps {
  readonly manifest: VoiceManifest
  /** Prefix before each manifest `file` entry. Default matches `frontend/public/voice/`. */
  readonly baseUrl?: string
  readonly createAudioElement?: (src: string) => AudioElementLike
  readonly createAudioContext?: () => AudioContextLike
}

export interface PlayOptions {
  readonly severity: Severity
  /** Fires once, on natural completion, playback error, or lane teardown — never on preemption. */
  readonly onEnded?: () => void
}

const DEFAULT_BASE_URL = "/voice/"
const DUCK_GAIN = 0.25
const FULL_GAIN = 1.0
const RAMP_SECONDS = 0.3

interface LaneState {
  readonly key: string
  readonly audio: AudioElementLike
  readonly gain: GainNodeLike
  readonly severity?: Severity
}

function defaultCreateAudioElement(src: string): AudioElementLike {
  const el = new Audio(src)
  el.preload = "auto"
  return el
}

function defaultCreateAudioContext(): AudioContextLike {
  return new AudioContext()
}

export class PlaybackManager {
  private readonly manifest: VoiceManifest
  private readonly baseUrl: string
  private readonly createAudioElement: (src: string) => AudioElementLike
  private readonly createAudioContextImpl: () => AudioContextLike
  private ctx: AudioContextLike | null = null
  private cue: LaneState | null = null
  private rag: LaneState | null = null
  private ragDucked = false

  constructor(deps: PlaybackManagerDeps) {
    this.manifest = deps.manifest
    this.baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL
    this.createAudioElement = deps.createAudioElement ?? defaultCreateAudioElement
    this.createAudioContextImpl = deps.createAudioContext ?? defaultCreateAudioContext
  }

  get currentCue(): { key: string; severity: Severity } | null {
    if (!this.cue) return null
    return { key: this.cue.key, severity: this.cue.severity as Severity }
  }

  get currentRag(): { key: string } | null {
    return this.rag ? { key: this.rag.key } : null
  }

  get isRagDucked(): boolean {
    return this.ragDucked
  }

  /** Manifest lookup as a playable URL, or `null` if the key isn't in the manifest. */
  resolveUrl(key: string): string | null {
    const entry = this.manifest[key]
    if (!entry) return null
    return `${this.baseUrl}${entry.file}?v=${entry.hash}`
  }

  /** Warm the browser's cache for upcoming cues without playing them. */
  preload(keys: readonly string[]): void {
    for (const key of keys) {
      const url = this.resolveUrl(key)
      if (url) this.createAudioElement(url)
    }
  }

  /**
   * Play a cue-lane clip. Returns `false` without side effects if the key
   * isn't in the manifest, or if a cue of equal-or-higher severity already
   * owns the lane (S5 preemption rule). Ducks the RAG lane if it's live.
   */
  playCue(key: string, options: PlayOptions): boolean {
    if (this.cue && SEVERITY_RANK[options.severity] <= SEVERITY_RANK[this.cue.severity as Severity]) {
      return false
    }
    const started = this.start("cue", key, options)
    if (started && this.rag) this.duckRag()
    return started
  }

  /** Play a RAG-lane clip. Always replaces whatever the RAG lane was playing. */
  playRag(key: string, options: Omit<PlayOptions, "severity"> = {}): boolean {
    return this.start("rag", key, options)
  }

  stopCue(): void {
    this.stopLane("cue")
  }

  stopRag(): void {
    this.stopLane("rag")
  }

  stopAll(): void {
    this.stopLane("cue")
    this.stopLane("rag")
  }

  /** Release the AudioContext and stop both lanes — call on unmount. */
  dispose(): void {
    this.stopAll()
    this.ctx = null
  }

  private context(): AudioContextLike {
    if (!this.ctx) this.ctx = this.createAudioContextImpl()
    return this.ctx
  }

  private start(lane: Lane, key: string, options: { severity?: Severity; onEnded?: () => void }): boolean {
    const url = this.resolveUrl(key)
    if (!url) return false

    // Preempting our own lane, never the other one's.
    this.stopLane(lane, { preempted: true })

    const ctx = this.context()
    const audio = this.createAudioElement(url)
    const gain = ctx.createGain()
    gain.gain.value = FULL_GAIN
    ctx.createMediaElementSource(audio).connect(gain)
    gain.connect(ctx.destination)

    const state: LaneState = { key, audio, gain, severity: options.severity }
    if (lane === "cue") this.cue = state
    else this.rag = state

    const onEnded = (): void => {
      audio.removeEventListener("ended", onEnded)
      audio.removeEventListener("error", onEnded)
      if (lane === "cue") {
        if (this.cue === state) this.cue = null
        if (this.ragDucked) this.restoreRag()
      } else if (this.rag === state) {
        this.rag = null
      }
      options.onEnded?.()
    }
    audio.addEventListener("ended", onEnded)
    audio.addEventListener("error", onEnded)

    // Autoplay/decode failure clears the lane the same way natural end does,
    // instead of leaving it stuck "playing" forever.
    void audio.play().catch(onEnded)
    return true
  }

  private stopLane(lane: Lane, opts: { preempted?: boolean } = {}): void {
    const state = lane === "cue" ? this.cue : this.rag
    if (!state) return
    state.audio.pause()
    if (lane === "cue") {
      this.cue = null
      // A preempting cue is about to (re-)duck RAG itself; only restore
      // when the cue lane is actually going idle.
      if (!opts.preempted && this.ragDucked) this.restoreRag()
    } else {
      this.rag = null
    }
  }

  private duckRag(): void {
    if (!this.rag) return
    this.rampGain(this.rag.gain, DUCK_GAIN)
    this.ragDucked = true
  }

  private restoreRag(): void {
    if (this.rag) this.rampGain(this.rag.gain, FULL_GAIN)
    this.ragDucked = false
  }

  private rampGain(gain: GainNodeLike, target: number): void {
    const now = this.context().currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(target, now + RAMP_SECONDS)
  }
}
