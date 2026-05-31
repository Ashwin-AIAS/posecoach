import { useEffect, useState } from "react"

import type { Exercise } from "../types"
import { EXERCISE_META } from "../lib/exercises"

interface HowToDrawerProps {
  /** Exercise to show the demo for, or null when the drawer is closed. */
  readonly exercise: Exercise | null
  readonly onClose: () => void
}

/**
 * Modal "how-to" learning surface: a curated demo video, coaching tips, and
 * target muscles. Uses a lite-embed facade — the YouTube thumbnail renders
 * first and the privacy-friendly youtube-nocookie iframe is injected only when
 * the user clicks play, so no third-party cookies load until they opt in and
 * the camera frame loop is never throttled by a background iframe.
 */
export function HowToDrawer({ exercise, onClose }: HowToDrawerProps): JSX.Element | null {
  const [playing, setPlaying] = useState(false)

  // Reset the facade whenever the target exercise changes.
  useEffect(() => {
    setPlaying(false)
  }, [exercise])

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
  const thumb = `https://i.ytimg.com/vi/${meta.youtubeId}/hqdefault.jpg`
  const embed = `https://www.youtube-nocookie.com/embed/${meta.youtubeId}`

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
        className="flex max-h-[88vh] w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-2xl border border-surface-hairline bg-surface-raised shadow-card"
      >
        <div className="flex items-center justify-between border-b border-surface-hairline px-5 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold">{meta.label}</h2>
            <p className="text-xs text-gray-500">
              {meta.category} · {meta.difficulty}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-surface-overlay hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            {playing ? (
              <iframe
                className="h-full w-full"
                src={embed}
                title={`${meta.label} demo`}
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                className="group relative block h-full w-full"
                aria-label={`Play ${meta.label} demo video`}
                data-testid="howto-play"
              >
                <img
                  src={thumb}
                  alt={`${meta.label} demonstration thumbnail`}
                  className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
                  loading="lazy"
                />
                <span className="absolute inset-0 grid place-content-center">
                  <span className="grid h-14 w-14 place-content-center rounded-full bg-surface-base/70 text-2xl text-white shadow-glow backdrop-blur-sm transition group-hover:scale-105">
                    ▶
                  </span>
                </span>
              </button>
            )}
          </div>

          <div className="mt-4">
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
                  className="rounded-full border border-surface-hairline bg-surface-overlay px-2.5 py-1 text-xs text-gray-300"
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
