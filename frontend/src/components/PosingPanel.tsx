import { memo } from "react"

import { getPoseMeta, POSING_SCOPE_NOTE } from "../lib/poses"
import type { PoseName, PoseResult } from "../types"

interface PosingPanelProps {
  readonly result: PoseResult | null
  readonly pose: PoseName
}

function metric(value: number | null | undefined, suffix = ""): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)}${suffix}`
}

/** Posing-mode readout: pose score, symmetry, and live hold timer (P15). */
function PosingPanelInner({ result, pose }: PosingPanelProps): JSX.Element {
  const meta = getPoseMeta(pose)
  const status = result?.status
  const hold = result?.hold
  const orientationMismatch = status === "wrong_orientation"
  const facingHint =
    meta.orientation === "rear"
      ? "Turn your back to the camera"
      : meta.orientation === "side"
        ? "Stand side-on to the camera"
        : "Turn to face the camera"

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-surface-hairline bg-surface-raised/60 p-4"
      data-testid="posing-panel"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-white">{meta.label}</h2>
        <span className="text-[11px] uppercase tracking-[0.16em] text-gray-500">{meta.division}</span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-surface-overlay p-2.5">
          <div className="hud-numerals text-xl font-semibold text-white" data-testid="posing-score">
            {metric(result?.score)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Pose</div>
        </div>
        <div className="rounded-xl bg-surface-overlay p-2.5">
          <div className="hud-numerals text-xl font-semibold text-white" data-testid="posing-symmetry">
            {meta.orientation === "side" ? "N/A" : metric(result?.symmetry)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Symmetry</div>
        </div>
        <div className="rounded-xl bg-surface-overlay p-2.5">
          <div className="hud-numerals text-xl font-semibold text-white" data-testid="posing-hold">
            {hold ? `${hold.seconds.toFixed(1)}s` : "—"}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Hold</div>
        </div>
      </div>

      {hold?.steady && (
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-score-good">
          <span className="h-1.5 w-1.5 rounded-full bg-score-good" aria-hidden="true" />
          Holding steady
        </div>
      )}

      {orientationMismatch && (
        <p className="rounded-lg bg-score-mid/10 px-3 py-2 text-xs text-score-mid" data-testid="posing-orientation-warn">
          {result?.cues?.[0] ?? facingHint}
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-gray-500">{POSING_SCOPE_NOTE}</p>
    </section>
  )
}

export const PosingPanel = memo(PosingPanelInner)
