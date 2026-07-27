import { memo, useEffect } from "react"
import { createPortal } from "react-dom"
import { Bot, X } from "lucide-react"

import type { Exercise } from "../types"
import { ChatPanel } from "./ChatPanel"
import { Icon } from "./ui/Icon"

interface CoachAiSheetProps {
  /** Selected movement — gives the coach context, no camera session required. */
  readonly exercise: Exercise
  readonly onClose: () => void
}

/**
 * Full-screen "Coach AI" chat, opened in one tap from Home (P35).
 *
 * Deliberately text-only: it never mounts the camera or a pose WebSocket, so a
 * user who only wants to ask a question doesn't have to start a live session.
 * Portaled to `document.body` — a `backdrop-blur` ancestor would otherwise
 * become the containing block for `position: fixed` and push it off-screen.
 */
function CoachAiSheetInner({ exercise, onClose }: CoachAiSheetProps): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Coach AI"
      data-testid="coach-ai-sheet"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-lg flex-col gap-3 rounded-t-2xl bg-surface-raised p-4 shadow-elev-3 animate-scale-in sm:rounded-2xl"
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft">
              <Icon icon={Bot} size={18} className="text-accent" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-white">Coach AI</h2>
              <p className="text-xs text-gray-500">Ask about form, sets, nutrition</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Coach AI"
            className="grid h-11 w-11 shrink-0 place-content-center rounded-full text-gray-400 transition hover:bg-surface-overlay hover:text-white active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="coach-ai-close"
          >
            <Icon icon={X} size={18} />
          </button>
        </div>

        {/* Text-only: no videoRef, so no "+ Frame" button and no camera. */}
        <ChatPanel exercise={exercise} startOpen hideHeader />
      </div>
    </div>,
    document.body,
  )
}

export const CoachAiSheet = memo(CoachAiSheetInner)
