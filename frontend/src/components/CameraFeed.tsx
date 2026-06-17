import { forwardRef } from "react"
import { CameraOff } from "lucide-react"

import { Icon } from "./ui/Icon"

interface CameraFeedProps {
  readonly error: string | null
  readonly ready: boolean
  /** Mirror the feed (front camera only); the back camera is shown un-mirrored. */
  readonly mirrored: boolean
}

export const CameraFeed = forwardRef<HTMLVideoElement, CameraFeedProps>(
  function CameraFeed({ error, ready, mirrored }, ref) {
    return (
      <div className="relative h-full w-full bg-surface-base">
        <video
          ref={ref}
          className={`${mirrored ? "mirror " : ""}h-full w-full object-cover`}
          autoPlay
          playsInline
          muted
        />

        {!ready && error === null && (
          <div className="absolute inset-0 grid place-content-center gap-3 bg-surface-base/80 text-center">
            <span
              className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-surface-hairline border-t-accent"
              aria-hidden="true"
            />
            <p className="text-sm text-gray-400">Starting camera…</p>
          </div>
        )}

        {error !== null && (
          <div
            className="absolute inset-0 grid place-content-center gap-3 bg-surface-base/95 px-6 text-center"
            role="alert"
          >
            <div className="mx-auto grid h-12 w-12 place-content-center rounded-full bg-score-bad/15">
              <Icon icon={CameraOff} size={22} className="text-score-bad" />
            </div>
            <p className="font-display text-lg font-semibold text-white">Camera unavailable</p>
            <p className="mx-auto max-w-sm text-sm text-gray-400">{error}</p>
            <p className="text-xs text-gray-600">
              Allow camera access in your browser settings, then reload.
            </p>
          </div>
        )}
      </div>
    )
  },
)
