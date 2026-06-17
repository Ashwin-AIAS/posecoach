import type { LucideIcon } from "lucide-react"

interface IconProps {
  readonly icon: LucideIcon
  readonly size?: number
  readonly strokeWidth?: number
  readonly className?: string
  readonly "aria-hidden"?: boolean
  readonly "aria-label"?: string
}

const DEFAULT_SIZE = 18
const DEFAULT_STROKE_WIDTH = 1.75

/**
 * Single import point for Lucide icons so size/strokeWidth stay consistent
 * across the app. Defaults to aria-hidden — pass aria-label to make an icon
 * itself the accessible name (e.g. when it has no adjacent text label).
 */
export function Icon({
  icon: LucideComponent,
  size = DEFAULT_SIZE,
  strokeWidth = DEFAULT_STROKE_WIDTH,
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps): JSX.Element {
  return (
    <LucideComponent
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={ariaLabel ? undefined : ariaHidden ?? true}
      aria-label={ariaLabel}
    />
  )
}
