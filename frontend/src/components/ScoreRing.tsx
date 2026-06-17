import { memo, useEffect, useId, useRef, useState } from "react"

import { scoreColor } from "../lib/skeleton"

interface ScoreRingProps {
  /** 0–100 form score, or null when no person/score is available. */
  readonly score: number | null
  /** Outer diameter in pixels. */
  readonly size?: number
  /** Optional caption under the number (e.g. "FORM"). */
  readonly label?: string
}

const STROKE = 16
const TRACK = "#23262D"

/** bad < 60 ≤ mid < 80 ≤ good — mirrors `scoreColor` in lib/skeleton. */
function scoreBand(score: number | null): 0 | 1 | 2 {
  if (score === null) return 0
  if (score >= 80) return 2
  if (score >= 60) return 1
  return 0
}

/** jsdom (tests) and very old browsers lack matchMedia — treat as reduced motion. */
function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return true
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

const COUNT_UP_MS = 450

/** Counts from the previous displayed value up to `target`, snapping instantly when reduced. */
function useCountUp(target: number, reduced: boolean): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)

  useEffect(() => {
    if (reduced) {
      fromRef.current = target
      setValue(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    const start = performance.now()
    let frame = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(from + (target - from) * eased)
      if (t < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, reduced])

  return value
}

/**
 * Circular form-score gauge — the HUD's signature element. The arc length is
 * driven by `score` via `stroke-dashoffset` with a CSS transition, the stroke
 * follows a gradient along the red→amber→green ramp, the number counts up to
 * its new value, and a band-up improvement triggers a brief celebration pulse.
 * Pure SVG + CSS/rAF — no heavy work on the frame path.
 */
function ScoreRingInner({ score, size = 132, label = "FORM" }: ScoreRingProps): JSX.Element {
  const gradientId = useId()
  const radius = (size - STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100
  const offset = circumference * (1 - pct)
  const color = scoreColor(score)
  const reduced = prefersReducedMotion()

  const target = score === null ? 0 : Math.round(Math.max(0, Math.min(100, score)))
  const displayed = useCountUp(target, reduced)

  const band = scoreBand(score)
  const prevBandRef = useRef(band)
  const [celebrating, setCelebrating] = useState(false)

  useEffect(() => {
    if (band > prevBandRef.current && !reduced) {
      setCelebrating(true)
      const t = setTimeout(() => setCelebrating(false), 500)
      prevBandRef.current = band
      return () => clearTimeout(t)
    }
    prevBandRef.current = band
    return undefined
  }, [band, reduced])

  return (
    <div
      className={"relative grid place-items-center" + (celebrating ? " animate-ring-celebrate" : "")}
      style={{ width: size, height: size }}
      role="img"
      aria-label={score === null ? "Form score unavailable" : `Form score ${Math.round(score)} of 100`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FF4D4D" />
            <stop offset="50%" stopColor="#FFB23D" />
            <stop offset="100%" stopColor="#36D399" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={TRACK} strokeWidth={STROKE} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={score === null ? color : `url(#${gradientId})`}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 0.45s ease-out",
            filter: `drop-shadow(0 0 8px ${color}66)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span
          className="hud-numerals font-display font-semibold leading-none"
          style={{ color, fontSize: size * 0.3 }}
          data-testid="ring-score-value"
        >
          {score === null ? "—" : Math.round(displayed)}
        </span>
        <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-gray-500">{label}</span>
      </div>
    </div>
  )
}

export const ScoreRing = memo(ScoreRingInner)
