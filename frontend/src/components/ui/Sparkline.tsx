/** Compact accent-colored trend line — shared by SessionSummary and history cards. */
export function Sparkline({
  values,
  label = "Average score trend",
}: {
  readonly values: readonly number[]
  readonly label?: string
}): JSX.Element {
  const w = 220
  const h = 48
  const max = Math.max(...values, 100)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = values.length > 1 ? w / (values.length - 1) : 0
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ")
  const lastX = (values.length - 1) * step
  const lastY = h - ((values[values.length - 1] - min) / span) * h
  return (
    <svg width={w} height={h} className="w-full" role="img" aria-label={label}>
      <polyline
        points={points}
        fill="none"
        stroke="rgb(var(--accent))"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={3} fill="rgb(var(--accent))" />
    </svg>
  )
}

/** Big-number + label tile — the "Apple-style" stat card building block. */
export function StatTile({
  label,
  value,
  color,
}: {
  readonly label: string
  readonly value: string
  readonly color?: string
}): JSX.Element {
  return (
    <div className="rounded-xl bg-surface-overlay p-3 text-center shadow-elev-1">
      <div className="hud-numerals font-display text-2xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
    </div>
  )
}
