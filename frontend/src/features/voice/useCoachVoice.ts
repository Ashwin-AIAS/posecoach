import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { apiJson } from "../../lib/api"

import { DEFAULT_VERBOSITY, VERBOSITY_PRESETS, type VerbosityPreset } from "./cueArbiter"
import { DEFAULT_PERSONA, PERSONA_KEYS, PERSONAS, isPersonaKey, type PersonaKey, type PersonaMeta } from "./personas"
import { PlaybackManager, type PlayOptions, type Severity, type VoiceManifest } from "./playbackManager"
import { reportCueFired, reportCueSuppressed } from "./telemetry"

const PERSONA_STORAGE_KEY = "pc.voice.persona"
const MUTED_STORAGE_KEY = "pc.voice.muted"
const VERBOSITY_STORAGE_KEY = "pc.voice.verbosity"
const HANDS_FREE_STORAGE_KEY = "pc.voice.handsfree"

function readStoredPersona(): PersonaKey {
  try {
    const stored = window.localStorage.getItem(PERSONA_STORAGE_KEY)
    return stored && isPersonaKey(stored) ? stored : DEFAULT_PERSONA
  } catch {
    return DEFAULT_PERSONA
  }
}

function readStoredMuted(): boolean {
  try {
    // Unset (fresh install) defaults to muted — audio needs the boot card's
    // UNMUTE gesture before it can play at all (browser autoplay policy).
    return window.localStorage.getItem(MUTED_STORAGE_KEY) !== "0"
  } catch {
    return true
  }
}

function isVerbosityPreset(value: string): value is VerbosityPreset {
  return value in VERBOSITY_PRESETS
}

function readStoredVerbosity(): VerbosityPreset {
  try {
    const stored = window.localStorage.getItem(VERBOSITY_STORAGE_KEY)
    return stored && isVerbosityPreset(stored) ? stored : DEFAULT_VERBOSITY
  } catch {
    return DEFAULT_VERBOSITY
  }
}

function readStoredHandsFree(): boolean {
  try {
    return window.localStorage.getItem(HANDS_FREE_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export interface UseCoachVoiceResult {
  /** True once the manifest has loaded and the playback manager is live. */
  readonly ready: boolean
  readonly manifest: VoiceManifest
  readonly personas: readonly PersonaMeta[]
  readonly persona: PersonaKey
  readonly setPersona: (key: PersonaKey) => void
  readonly muted: boolean
  readonly setMuted: (muted: boolean) => void
  /** Settings-tab verbosity preset (spec §4 table) — consumed by `CueArbiter.setVerbosity`. */
  readonly verbosity: VerbosityPreset
  readonly setVerbosity: (preset: VerbosityPreset) => void
  /**
   * Phone-propped-up mode (spec §4 "Attention budget"): screen focus alone
   * can't tell hands-free apart from "user is just glancing away", so this
   * is an explicit toggle rather than inferred from Page Visibility.
   */
  readonly handsFree: boolean
  readonly setHandsFree: (handsFree: boolean) => void
  /**
   * Manual playback escape hatch (S4). `faultId` is combined with the
   * selected persona into the `{persona}.{fault_id}.{severity}` cue key from
   * spec §5 — callers pass the `fault_id.severity` suffix. No rep-boundary
   * arbitration yet; `cueArbiter.ts` (S5) will own *when* this gets called.
   */
  readonly play: (faultId: string, options: PlayOptions) => boolean
  /**
   * Report a cue the arbiter decided to speak, for the thesis metrics in
   * spec §11 (`voice_cue_fired` / `voice_cue_latency_ms`, S7). Persona is
   * filled in automatically from the current selection. Fire-and-forget —
   * never throws, never awaited.
   */
  readonly reportFired: (faultId: string, severity: Severity, latencyMs?: number) => void
  /** Report a cue the arbiter suppressed, and why (S7's `voice_cue_suppressed`). */
  readonly reportSuppressed: (faultId: string, reason: string) => void
}

/**
 * The only public surface the rest of the app talks to for voice coaching.
 * Owns the manifest fetch, the persona/mute/verbosity/hands-free prefs
 * (persisted the same way `useUnitPref` persists units — plain
 * `localStorage`, never auth data), and a single `PlaybackManager` instance
 * for the lifetime of the hook.
 *
 * `localStorage` here is a deliberate choice (P29 S6), not the oversight the
 * project's "no localStorage" rule usually flags: that rule is about JWTs
 * and auth data specifically (see CLAUDE.md's Auth/Privacy sections). These
 * four prefs are device-specific display settings — same category as
 * `useUnitPref`'s units toggle — and must be readable synchronously, before
 * any network round-trip, so the Settings tab and (later) the boot card
 * never flash a wrong default while a fetch is in flight. `SettingsPanel`
 * wires directly into this hook's setters; there is no server-backed store
 * for these and none is planned.
 */
export function useCoachVoice(): UseCoachVoiceResult {
  const [manifest, setManifest] = useState<VoiceManifest>({})
  const [ready, setReady] = useState(false)
  const [persona, setPersonaState] = useState<PersonaKey>(readStoredPersona)
  const [muted, setMutedState] = useState<boolean>(readStoredMuted)
  const [verbosity, setVerbosityState] = useState<VerbosityPreset>(readStoredVerbosity)
  const [handsFree, setHandsFreeState] = useState<boolean>(readStoredHandsFree)
  const managerRef = useRef<PlaybackManager | null>(null)

  useEffect(() => {
    let cancelled = false
    apiJson<VoiceManifest>("/api/v1/voice/manifest")
      .then((data) => {
        if (cancelled) return
        managerRef.current = new PlaybackManager({ manifest: data })
        setManifest(data)
        setReady(true)
      })
      .catch(() => {
        // No manifest yet (fresh checkout pre-S2, offline, or a stripped
        // test env) — voice silently stays unavailable. CueToast still shows
        // the text twin per §4, so a muted/unavailable user loses nothing.
      })
    return () => {
      cancelled = true
      managerRef.current?.dispose()
      managerRef.current = null
    }
  }, [])

  const setPersona = useCallback((key: PersonaKey): void => {
    setPersonaState(key)
    try {
      window.localStorage.setItem(PERSONA_STORAGE_KEY, key)
    } catch {
      // private mode — keep the in-memory value only
    }
  }, [])

  const setMuted = useCallback((next: boolean): void => {
    setMutedState(next)
    try {
      window.localStorage.setItem(MUTED_STORAGE_KEY, next ? "1" : "0")
    } catch {
      // private mode — keep the in-memory value only
    }
  }, [])

  const setVerbosity = useCallback((preset: VerbosityPreset): void => {
    setVerbosityState(preset)
    try {
      window.localStorage.setItem(VERBOSITY_STORAGE_KEY, preset)
    } catch {
      // private mode — keep the in-memory value only
    }
  }, [])

  const setHandsFree = useCallback((next: boolean): void => {
    setHandsFreeState(next)
    try {
      window.localStorage.setItem(HANDS_FREE_STORAGE_KEY, next ? "1" : "0")
    } catch {
      // private mode — keep the in-memory value only
    }
  }, [])

  const play = useCallback(
    (faultId: string, options: PlayOptions): boolean => {
      if (muted || !managerRef.current) return false
      return managerRef.current.playCue(`${persona}.${faultId}`, options)
    },
    [persona, muted],
  )

  const personas = useMemo<readonly PersonaMeta[]>(() => PERSONA_KEYS.map((key) => PERSONAS[key]), [])

  const reportFired = useCallback(
    (faultId: string, severity: Severity, latencyMs?: number): void => {
      reportCueFired({ faultId, severity, persona, latencyMs })
    },
    [persona],
  )

  const reportSuppressed = useCallback(
    (faultId: string, reason: string): void => {
      reportCueSuppressed({ faultId, reason, persona })
    },
    [persona],
  )

  return {
    ready,
    manifest,
    personas,
    persona,
    setPersona,
    muted,
    setMuted,
    verbosity,
    setVerbosity,
    handsFree,
    setHandsFree,
    play,
    reportFired,
    reportSuppressed,
  }
}
