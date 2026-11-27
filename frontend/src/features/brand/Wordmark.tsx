import { memo } from "react"

import { BRAND } from "./brand"

interface WordmarkProps {
  /** HTML element to render — defaults to `h1` to match the app header. */
  readonly as?: "h1" | "span"
  readonly className?: string
}

/**
 * Reusable brand wordmark (P36 C8). Reads its text from `BRAND` and its accent
 * colour from `--accent` so future rebranding is a single-file swap.
 */
function WordmarkInner({ as = "h1", className = "" }: WordmarkProps): JSX.Element {
  const Tag = as
  return (
    <Tag
      className={`shrink-0 whitespace-nowrap font-display text-lg font-semibold tracking-tight ${className}`.trim()}
      data-testid="brand-wordmark"
    >
      {BRAND.prefix}
      <span className="text-accent">{BRAND.highlight}</span>
    </Tag>
  )
}

export const Wordmark = memo(WordmarkInner)
