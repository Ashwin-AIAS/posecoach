/**
 * QA-only harness for `BootCard` and `CueToast` (P29 S6). Not imported by
 * App.tsx / main.tsx — reachable only via `voice-preview.html`, which
 * vite build's default single-entry (index.html) never bundles. Mirrors
 * `features/coach/overlay/OverlayPreview.tsx`'s pattern: drive the
 * components with local fixture state instead of a live manifest fetch or
 * WebSocket, so Playwright can exercise persona selection, the unmute gate,
 * and the cue-toast enter/exit lifecycle with no backend involved.
 */
import { useCallback, useState } from "react"

import { BootCard } from "./BootCard"
import { CueToast, type ToastCue } from "./CueToast"
import { DEFAULT_PERSONA, PERSONA_KEYS, PERSONAS, type PersonaKey } from "./personas"
import type { Severity } from "./playbackManager"

const PERSONAS_LIST = PERSONA_KEYS.map((key) => PERSONAS[key])

const FIXTURE_CUES: readonly { readonly text: string; readonly severity: Severity }[] = [
  { text: "Squat deeper for full range", severity: "high" },
  { text: "Own the bottom. Don't rush it.", severity: "medium" },
  { text: "Nice depth — keep your chest up", severity: "milestone" },
]

// Short enough for a Playwright spec to wait out; production uses CueToast's
// own 3200ms default (see CueToast.tsx).
const PREVIEW_VISIBLE_MS = 900

export function VoicePreview(): JSX.Element {
  const [showBoot, setShowBoot] = useState(true)
  const [persona, setPersona] = useState<PersonaKey>(DEFAULT_PERSONA)
  const [ready, setReady] = useState(true)
  const [cueSeq, setCueSeq] = useState(0)
  const [cue, setCue] = useState<ToastCue | null>(null)

  const fireCue = useCallback(() => {
    const fixture = FIXTURE_CUES[cueSeq % FIXTURE_CUES.length]
    setCue({ id: `preview-${cueSeq}`, text: fixture.text, severity: fixture.severity })
    setCueSeq((n) => n + 1)
  }, [cueSeq])

  return (
    <div data-testid="voice-preview-stage" style={{ position: "fixed", inset: 0 }}>
      {/* Above the boot card's own z-50 overlay, so these controls stay
          clickable while the card is up (mirrors a real host page's own
          chrome, which the modal never needs to block). */}
      <div
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          zIndex: 60,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        <button
          type="button"
          data-testid="preview-toggle-ready"
          onClick={() => setReady((r) => !r)}
          style={{ padding: "8px 14px", borderRadius: 999, background: "#23262d", color: "#f4f6f8" }}
        >
          Manifest ready: {String(ready)}
        </button>
        <button
          type="button"
          data-testid="preview-fire-cue"
          onClick={fireCue}
          style={{ padding: "8px 14px", borderRadius: 999, background: "#8b5cff", color: "#0a0b0d" }}
        >
          Fire cue
        </button>
        {!showBoot && (
          <button
            type="button"
            data-testid="preview-reopen-boot"
            onClick={() => setShowBoot(true)}
            style={{ padding: "8px 14px", borderRadius: 999, background: "#23262d", color: "#f4f6f8" }}
          >
            Reopen boot card
          </button>
        )}
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 60,
          display: "flex",
          width: "100%",
          maxWidth: 420,
          justifyContent: "center",
        }}
      >
        <CueToast cue={cue} visibleMs={PREVIEW_VISIBLE_MS} />
      </div>

      {showBoot && (
        <BootCard
          personas={PERSONAS_LIST}
          persona={persona}
          onSelectPersona={setPersona}
          ready={ready}
          onUnmute={() => setShowBoot(false)}
          onDismiss={() => setShowBoot(false)}
        />
      )}
    </div>
  )
}
