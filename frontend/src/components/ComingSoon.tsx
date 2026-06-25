import { memo } from "react"
import type { LucideIcon } from "lucide-react"

import { Icon } from "./ui/Icon"

interface ComingSoonProps {
  readonly title: string
  readonly subtitle: string
  readonly icon: LucideIcon
}

/**
 * On-brand placeholder for tabs whose feature work lands in a later prompt
 * (P24–P28). Centered, dark-token styling; reserves bottom space so the fixed
 * tab bar never overlaps it.
 */
function ComingSoonInner({ title, subtitle, icon }: ComingSoonProps): JSX.Element {
  return (
    <div
      className="flex flex-1 animate-fade-in flex-col items-center justify-center px-6 text-center"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4rem)" }}
      data-testid="coming-soon"
    >
      <div className="grid h-16 w-16 place-content-center rounded-2xl bg-surface-raised shadow-elev-2">
        <Icon icon={icon} size={28} className="text-accent" />
      </div>
      <h2 className="mt-5 font-display text-xl font-semibold text-gray-100">{title}</h2>
      <p className="mt-1.5 max-w-xs text-sm text-gray-500">{subtitle}</p>
      <span className="mt-4 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-accent">
        Coming soon
      </span>
    </div>
  )
}

export const ComingSoon = memo(ComingSoonInner)
