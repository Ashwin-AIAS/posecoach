/**
 * Client-side persona config for the P29 voice coach (S4).
 *
 * Mirrors the public shape served by `GET /api/v1/voice/personas`
 * (`app/voice/personas.py` / `app/voice/router.py`) so the UI has a
 * synchronous, zero-latency value to render before that fetch resolves, and
 * something to fall back to if it fails — the persona picker must never be
 * empty on a flaky connection. `useCoachVoice` treats a live fetch (when it
 * adds one) as the source of truth; this is the seed/fallback only.
 *
 * Cue key format is `{persona}.{fault_id}.{severity}` per spec §5 — this
 * module owns the `{persona}` half.
 */

export type PersonaKey = "atlas" | "forge" | "vector"

export const PERSONA_KEYS: readonly PersonaKey[] = ["atlas", "forge", "vector"]

export const DEFAULT_PERSONA: PersonaKey = "atlas"

export interface PersonaMeta {
  readonly key: PersonaKey
  readonly name: string
  readonly tone: string
  readonly voiceTexture: string
}

export const PERSONAS: Readonly<Record<PersonaKey, PersonaMeta>> = {
  atlas: {
    key: "atlas",
    name: "ATLAS",
    tone: "Loud, hype, celebratory. Short bursts.",
    voiceTexture: "deep/booming",
  },
  forge: {
    key: "forge",
    name: "FORGE",
    tone: "Slow, gravelly, mind-muscle. Cue-heavy.",
    voiceTexture: "gravelly/older",
  },
  vector: {
    key: "vector",
    name: "VECTOR",
    tone: "Clipped, deadpan, numeric. Reads state back.",
    voiceTexture: "flat/neutral",
  },
}

/** Narrow an arbitrary string (e.g. a `localStorage` read) to a `PersonaKey`. */
export function isPersonaKey(value: string): value is PersonaKey {
  return (PERSONA_KEYS as readonly string[]).includes(value)
}
