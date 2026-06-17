import type { ReactNode } from "react"

const ELEVATION_CLASS = {
  1: "shadow-elev-1",
  2: "shadow-elev-2",
  3: "shadow-elev-3",
} as const

interface CardProps {
  readonly children: ReactNode
  readonly elevation?: 1 | 2 | 3
  readonly className?: string
}

/**
 * Raised surface primitive used in place of hairline-border containers.
 * Depth comes from elevation + a subtle inset top highlight, not a border.
 */
export function Card({ children, elevation = 2, className = "" }: CardProps): JSX.Element {
  return (
    <div className={`rounded-2xl bg-surface-raised ${ELEVATION_CLASS[elevation]} ${className}`}>
      {children}
    </div>
  )
}
