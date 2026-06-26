import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Play, RotateCcw } from "lucide-react"

import { ScoreRing } from "./ScoreRing"
import { Icon } from "./ui/Icon"

const PRESET_SECONDS = [60, 90, 120, 180, 300]

interface RestTimerProps {
  /** Auto-start the timer when this flips to true (e.g. after completing a set). */
  readonly autoStart?: boolean
  readonly defaultSeconds?: number
}

function RestTimerInner({ autoStart = false, defaultSeconds = 90 }: RestTimerProps): JSX.Element {
  const [duration, setDuration] = useState(defaultSeconds)
  const [remaining, setRemaining] = useState(defaultSeconds)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback((): void => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setRunning(false)
  }, [])

  const reset = useCallback(
    (secs?: number): void => {
      stop()
      const d = secs ?? duration
      setDuration(d)
      setRemaining(d)
    },
    [stop, duration],
  )

  const start = useCallback((): void => {
    setRunning(true)
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          stop()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [stop])

  // Auto-start on prop flip.
  useEffect(() => {
    if (autoStart && !running) {
      reset(duration)
      start()
    }
    // Intentionally not including `running` — we only react to autoStart changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  // Cleanup on unmount.
  useEffect(() => () => stop(), [stop])

  const pct = duration > 0 ? (remaining / duration) * 100 : 0
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0")
  const ss = String(remaining % 60).padStart(2, "0")

  return (
    <div className="flex flex-col items-center gap-3" data-testid="rest-timer">
      {/* Reuse ScoreRing as a countdown ring (score = % remaining) */}
      <div className="relative" aria-label={`Rest timer: ${mm}:${ss}`} role="timer">
        <ScoreRing score={Math.round(pct)} size={96} label="REST" />
        <p
          className="absolute inset-0 flex items-center justify-center font-display text-sm font-semibold text-gray-100"
          aria-hidden="true"
        >
          {/* Overlaid time display — positioned below the ring label */}
          <span className="mt-8 text-[11px] font-mono text-gray-400">
            {mm}:{ss}
          </span>
        </p>
      </div>

      {/* Preset chips */}
      <div className="flex flex-wrap justify-center gap-1.5">
        {PRESET_SECONDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => reset(s)}
            aria-pressed={duration === s && !running}
            className={
              "min-h-[44px] rounded-full px-2.5 text-xs font-medium transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
              (duration === s
                ? "bg-accent-soft text-accent"
                : "bg-surface-raised text-gray-400 shadow-elev-1 hover:text-white")
            }
          >
            {s < 60 ? `${s}s` : `${s / 60}m`}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          aria-label="Reset timer"
          className="grid h-11 w-11 place-content-center rounded-full bg-surface-raised text-gray-400 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="rest-timer-reset"
        >
          <Icon icon={RotateCcw} size={14} />
        </button>
        <button
          type="button"
          onClick={running ? stop : start}
          aria-label={running ? "Pause timer" : "Start timer"}
          className="flex min-h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-xs font-semibold text-surface-base shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="rest-timer-toggle"
        >
          <Icon icon={Play} size={12} />
          {running ? "Pause" : "Start"}
        </button>
      </div>
    </div>
  )
}

export const RestTimer = memo(RestTimerInner)
