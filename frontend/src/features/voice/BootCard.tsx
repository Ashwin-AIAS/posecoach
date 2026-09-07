/**
 * Voice coach boot card (P29 S6) — persona picker + the browser-autoplay
 * unmute gesture (spec §4 "Autoplay").
 *
 * Purely presentational: every value is a prop, nothing here reads
 * `useCoachVoice` directly, so it renders identically inside the real app
 * (wherever a later stage mounts it) and inside the QA-only preview harness
 * (`voice-preview.html` / `VoicePreview.tsx`) used by Playwright.
 *
 * Persona chips animate in via `voice.css`'s `.voice-persona-chip` +
 * `--i` stagger; "Unmute" and "Stay muted" are both explicit user
 * gestures, satisfying the browser autoplay-policy requirement before any
 * cue audio can play. Mute state itself lives in `useCoachVoice`
 * (localStorage — device-specific, readable before any network call).
 */
import type { CSSProperties } from "react"
import { Volume2 } from "lucide-react"

import { Icon } from "../../components/ui/Icon"
import type { PersonaKey, PersonaMeta } from "./personas"
import "./voice.css"

export interface BootCardProps {
  readonly personas: readonly PersonaMeta[]
  readonly persona: PersonaKey
  readonly onSelectPersona: (key: PersonaKey) => void
  /** True once the voice manifest has loaded — Unmute is disabled until then (nothing to play yet). */
  readonly ready: boolean
  /** User gesture that satisfies the browser autoplay policy and turns cues on. */
  readonly onUnmute: () => void
  /** Dismiss without changing mute state — the card never forces sound on the user. */
  readonly onDismiss: () => void
}

/** Persona picker + unmute gate, shown once per session before coaching audio can play. */
export function BootCard({
  personas,
  persona,
  onSelectPersona,
  ready,
  onUnmute,
  onDismiss,
}: BootCardProps): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your coach"
      data-testid="voice-boot-card"
    >
      <div className="w-full max-w-sm animate-scale-in rounded-t-2xl bg-surface-raised p-5 shadow-elev-3 sm:rounded-2xl">
        <h2 className="font-display text-lg font-semibold text-gray-100">Pick your coach</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          Short spoken cues between reps, in the voice you pick below. Every cue also shows on
          screen as a caption — muting loses no coaching, just the audio.
        </p>

        <div role="radiogroup" aria-label="Coach persona" className="mt-4 flex flex-col gap-2">
          {personas.map((p, i) => {
            const selected = p.key === persona
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelectPersona(p.key)}
                style={{ "--i": i } as CSSProperties}
                className={
                  "voice-persona-chip flex min-h-11 items-center rounded-xl px-3.5 py-2.5 text-left transition ease-spring active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none " +
                  (selected
                    ? "bg-accent-soft text-accent shadow-elev-1"
                    : "bg-surface-base text-gray-300 hover:text-white")
                }
                data-testid={`voice-persona-${p.key}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{p.name}</span>
                  <span className="block truncate text-[11px] text-gray-500">{p.tone}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-11 flex-1 rounded-full px-3.5 text-xs font-medium text-gray-400 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:text-white active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
            data-testid="voice-boot-stay-muted"
          >
            Stay muted
          </button>
          <button
            type="button"
            onClick={onUnmute}
            disabled={!ready}
            title={ready ? "Turn on coach voice" : "Loading voices…"}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-3.5 text-sm font-semibold text-surface-base shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.97] disabled:translate-y-0 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised motion-reduce:transition-none"
            data-testid="voice-boot-unmute"
          >
            <Icon icon={Volume2} size={15} />
            {ready ? "Unmute" : "Loading…"}
          </button>
        </div>
      </div>
    </div>
  )
}
