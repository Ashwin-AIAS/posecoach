import { memo, useState } from "react"

import { calculatePlates } from "../lib/plateCalculator"
import { useUnitPref } from "../hooks/useUnitPref"

interface PlateCalculatorProps {
  readonly defaultTargetKg?: number
}

function PlateCalculatorInner({ defaultTargetKg }: PlateCalculatorProps): JSX.Element {
  const { unit } = useUnitPref()
  const toKg = (v: number): number => (unit === "lb" ? v / 2.2046 : v)
  const fromKg = (v: number): number => (unit === "lb" ? v * 2.2046 : v)

  const defaultDisplay = defaultTargetKg ? fromKg(defaultTargetKg) : 100
  const [targetDisplay, setTargetDisplay] = useState(
    Math.round(defaultDisplay * 10) / 10,
  )
  const [barDisplay, setBarDisplay] = useState(unit === "lb" ? 45 : 20)

  const targetKg = toKg(targetDisplay)
  const barKg = toKg(barDisplay)
  const plates = calculatePlates(targetKg, barKg)

  return (
    <div className="flex flex-col gap-3" data-testid="plate-calculator">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
        Plate calculator
      </h3>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[11px] text-gray-500">Target ({unit})</span>
          <input
            type="number"
            inputMode="decimal"
            value={targetDisplay}
            onChange={(e) => setTargetDisplay(Number(e.target.value))}
            className="h-9 w-full rounded-lg bg-surface-overlay px-3 text-sm text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Target weight in ${unit}`}
            data-testid="plate-calc-target"
          />
        </label>
        <label className="flex w-20 flex-col gap-1">
          <span className="text-[11px] text-gray-500">Bar ({unit})</span>
          <input
            type="number"
            inputMode="decimal"
            value={barDisplay}
            onChange={(e) => setBarDisplay(Number(e.target.value))}
            className="h-9 w-full rounded-lg bg-surface-overlay px-3 text-sm text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Bar weight in ${unit}`}
            data-testid="plate-calc-bar"
          />
        </label>
      </div>
      {plates.length === 0 ? (
        <p className="text-sm text-gray-500">No plates needed.</p>
      ) : (
        <div className="flex flex-wrap gap-2" data-testid="plate-result">
          {plates.map(({ weight, count }) => (
            <span
              key={weight}
              className="rounded-full bg-surface-raised px-3 py-1 text-sm font-medium text-gray-200 shadow-elev-1"
            >
              {count} × {weight}kg
            </span>
          ))}
          <span className="rounded-full bg-surface-overlay px-3 py-1 text-xs text-gray-500">
            per side
          </span>
        </div>
      )}
    </div>
  )
}

export const PlateCalculator = memo(PlateCalculatorInner)
