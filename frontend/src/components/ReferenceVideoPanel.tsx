import { memo, useEffect, useState } from "react"

import type { Exercise } from "../types"
import { EXERCISE_META } from "../lib/exercises"

interface ReferenceVideoPanelProps {
  /** Active exercise — selects which curated reference clip is offered. */
  readonly exercise: Exercise
}

/**
 * Standalone, on-demand reference-video section.
 *
 * This is the ONLY place the curated YouTube demo is rendered — it deliberately
 * lives in the sidebar, away from the live camera/tracking stage, and is
 * collapsed by default so no video ever appears while the user is being
 * tracked. The embed is doubly lazy: the panel mounts nothing until the user
 * expands it, and even then a privacy-friendly youtube-nocookie iframe is only
 * injected after an explicit play click (thumbnail facade first). This keeps
 * third-party cookies and video bandwidth off the workout path entirely.
 */
function ReferenceVideoPanelInner({ exercise }: ReferenceVideoPanelProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const meta = EXERCISE_META[exercise]

  // Switching exercise (or collapsing) tears the iframe back down to the facade
  // so we never carry a playing video across exercises or into a collapsed panel.
  useEffect(() => {
    setPlaying(false)
  }, [exercise])

  useEffect(() => {
    if (!open) setPlaying(false)
  }, [open])

  const thumb = `https://i.ytimg.com/vi/${meta.youtubeId}/hqdefault.jpg`
  const embed = `https://www.youtube-nocookie.com/embed/${meta.youtubeId}`

  return (
    <section
      className="rounded-2xl bg-surface-raised/70 shadow-elev-2 backdrop-blur-md"
      data-testid="reference-video-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="reference-video-body"
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        data-testid="reference-video-toggle"
      >
        <span className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">
            ▶
          </span>
          <span>
            <span className="block text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Reference video
            </span>
            <span className="block text-sm font-medium text-white">{meta.label}</span>
          </span>
        </span>
        <span
          className={"text-gray-500 transition-transform duration-200 " + (open ? "rotate-180" : "")}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {open && (
        <div id="reference-video-body" className="px-4 pb-4">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            {playing ? (
              <iframe
                className="h-full w-full"
                src={embed}
                title={`${meta.label} reference video`}
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                className="group relative block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={`Play ${meta.label} reference video`}
                data-testid="reference-video-play"
              >
                <img
                  src={thumb}
                  alt={`${meta.label} reference thumbnail`}
                  className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
                  loading="lazy"
                />
                <span className="absolute inset-0 grid place-content-center">
                  <span className="grid h-14 w-14 place-content-center rounded-full bg-surface-base/70 text-2xl text-white shadow-glow backdrop-blur-sm transition group-hover:scale-105 group-active:scale-95">
                    ▶
                  </span>
                </span>
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            Curated demo · opens only when you choose to watch.
          </p>
        </div>
      )}
    </section>
  )
}

export const ReferenceVideoPanel = memo(ReferenceVideoPanelInner)
