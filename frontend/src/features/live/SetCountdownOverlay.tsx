import { memo, useEffect, useState } from "react"

interface SetCountdownOverlayProps {
  /** Initial countdown seconds (default 3 -> 3-2-1). */
  readonly seconds?: number
  /** Step interval in ms (default 1000ms). */
  readonly stepMs?: number
  /** Invoked when the 3-2-1 countdown completes (or is skipped) -> calls stats.reset(). */
  readonly onComplete: () => void
}

/**
 * 3-2-1 set-start countdown overlay over the camera stage (P36 A5) so the user
 * can walk back to the mirror before session stats begin accumulating.
 * Reduced-motion safe via the global prefers-reduced-motion rule in index.css.
 */
function SetCountdownOverlayInner({
  seconds = 3,
  stepMs = 1000,
  onComplete,
}: SetCountdownOverlayProps): JSX.Element {
  const [remaining, setRemaining] = useState<number>(seconds)

  useEffect(() => {
    if (remaining <= 0) {
      onComplete()
      return undefined
    }
    const timer = setTimeout(() => {
      setRemaining((prev) => prev - 1)
    }, stepMs)
    return () => clearTimeout(timer)
  }, [remaining, stepMs, onComplete])

  const display = Math.max(1, remaining)

  return (
    <div
      className=" absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-surface-base/70 backdrop-blur-sm animate-fade-in"
      role="status"
      aria-live="assertive"
      aria-label={`Starting set in ${display}`}
      data-testid="set-countdown-overlay"
    >
      <div className="grid h-36 w-36 place-content-center rounded-full bg-surface-raised/90 shadow-elev-3">
        <span
          key={display}
          className="hud-numerals animate-number-pop font-display text-[5.5rem] font-bold leading-none text-accent"
          data-testid="set-countdown-value"
        >
          {display}
        </span>
      </div>
      <p className="text-sm font-medium text-gray-200">Step back to the mirror</p>
      <button
        type="button"
        onClick={onComplete}
        className="flex min-h-11 items-center justify-center rounded-full bg-surface-raised px-5 text-xs font-medium text-gray-200 shadow-elev-1 transition ease-spring active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        data-testid="set-countdown-skip"
      >
        Start now
      </button>
    </div>
  )
}

export const SetCountdownOverlay = memo(SetCountdownOverlayInner)
