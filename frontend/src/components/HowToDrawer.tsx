import { useEffect } from "react"
import { X } from "lucide-react"

import type { Exercise } from "../types"
import { EXERCISE_META } from "../lib/exercises"
import { Icon } from "./ui/Icon"

interface HowToDrawerProps {
  /** Exercise to show the tips for, or null when the drawer is closed. */
  readonly exercise: Exercise | null
  readonly onClose: () => void
}

/**
 * Modal "how-to" learning surface: static coaching tips and target muscles for
 * the chosen exercise. The reference video deliberately does NOT live here —
 * this surface is reachable from the live tracking chrome (CameraHud / empty
 * stage), so embedding a clip would pop a video over the workout. The curated
 * demo lives in the standalone, collapsed-by-default ReferenceVideoPanel in the
 * sidebar instead (see P11). This drawer stays text-only and instant.
 */
export function HowToDrawer({ exercise, onClose }: HowToDrawerProps): JSX.Element | null {
  useEffect(() => {
    if (exercise === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [exercise, onClose])

  if (exercise === null) return null
  const meta = EXERCISE_META[exercise]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`How to ${meta.label}`}
      data-testid="howto-drawer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-elev-3"
      >
        <div className="flex items-center justify-between px-5 py-3 shadow-elev-1">
          <div>
            <h2 className="font-display text-lg font-semibold">{meta.label}</h2>
            <p className="text-xs text-gray-500">
              {meta.category} · {meta.difficulty}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 transition hover:bg-surface-overlay hover:text-white active:scale-90"
            aria-label="Close"
          >
            <Icon icon={X} size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Form tips</h3>
            <ul className="mt-2 space-y-1.5">
              {meta.formTips.map((tip) => (
                <li key={tip} className="flex items-start gap-2 text-sm text-gray-100">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4">
            <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Primary muscles</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {meta.primaryMuscles.map((m) => (
                <span
                  key={m}
                  className="rounded-full bg-surface-overlay px-2.5 py-1 text-xs text-gray-300 shadow-elev-1"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
