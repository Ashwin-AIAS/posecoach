import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { apiJson } from "../../lib/api"

import { DEFAULT_PERSONA, PERSONA_KEYS, PERSONAS, isPersonaKey, type PersonaKey, type PersonaMeta } from "./personas"
import { PlaybackManager, type PlayOptions, type VoiceManifest } from "./playbackManager"

const PERSONA_STORAGE_KEY = "pc.voice.persona"
const MUTED_STORAGE_KEY = "pc.voice.muted"

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

export interface UseCoachVoiceResult {
  /** True once the manifest has loaded and the playback manager is live. */
  readonly ready: boolean
  readonly manifest: VoiceManifest
  readonly personas: readonly PersonaMeta[]
  readonly persona: PersonaKey
  readonly setPersona: (key: PersonaKey) => void
  readonly muted: boolean
  readonly setMuted: (muted: boolean) => void
  /**
   * Manual playback escape hatch (S4). `faultId` is combined with the
   * selected persona into the `{persona}.{fault_id}.{severity}` cue key from
   * spec §5 — callers pass the `fault_id.severity` suffix. No rep-boundary
   * arbitration yet; `cueArbiter.ts` (S5) will own *when* this gets called.
   */
  readonly play: (faultId: string, options: PlayOptions) => boolean
}

/**
 * The only public surface the rest of the app talks to for voice coaching.
 * Owns the manifest fetch, the persona/mute prefs (persisted the same way
 * `useUnitPref` persists units — plain `localStorage`, never auth data), and
 * a single `PlaybackManager` instance for the lifetime of the hook.
 */
export function useCoachVoice(): UseCoachVoiceResult {
  const [manifest, setManifest] = useState<VoiceManifest>({})
  const [ready, setReady] = useState(false)
  const [persona, setPersonaState] = useState<PersonaKey>(readStoredPersona)
  const [muted, setMutedState] = useState<boolean>(readStoredMuted)
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

  const play = useCallback(
    (faultId: string, options: PlayOptions): boolean => {
      if (muted || !managerRef.current) return false
      return managerRef.current.playCue(`${persona}.${faultId}`, options)
    },
    [persona, muted],
  )

  const personas = useMemo<readonly PersonaMeta[]>(() => PERSONA_KEYS.map((key) => PERSONAS[key]), [])

  return { ready, manifest, personas, persona, setPersona, muted, setMuted, play }
}
