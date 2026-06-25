import { memo } from "react"
import { Activity, ClipboardList, Flame, Settings } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Icon } from "./ui/Icon"

/** Top-level app tab (P23 navigation shell). Coach is today's experience. */
export type TabKey = "coach" | "workouts" | "calories" | "settings"

interface TabBarProps {
  readonly active: TabKey
  readonly onChange: (tab: TabKey) => void
  /** Hidden during a live set so the camera stays the immersive hero. */
  readonly hidden: boolean
}

interface TabDef {
  readonly key: TabKey
  readonly label: string
  readonly icon: LucideIcon
}

const TABS: readonly TabDef[] = [
  { key: "coach", label: "Coach", icon: Activity },
  { key: "workouts", label: "Workouts", icon: ClipboardList },
  { key: "calories", label: "Calories", icon: Flame },
  { key: "settings", label: "Settings", icon: Settings },
]

/**
 * Persistent bottom navigation (P23). Four state-driven tabs — no router. The
 * bar is removed from the DOM entirely while `hidden` so it reserves no layout
 * space during the immersive live-camera experience.
 */
function TabBarInner({ active, onChange, hidden }: TabBarProps): JSX.Element | null {
  if (hidden) return null

  return (
    <nav
      role="tablist"
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-surface-hairline bg-surface-raised/80 shadow-elev-2 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      data-testid="tab-bar"
    >
      {TABS.map(({ key, label, icon }) => {
        const selected = key === active
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={label}
            onClick={() => onChange(key)}
            className={
              "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition ease-spring active:scale-[0.94] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent motion-reduce:transition-none motion-reduce:active:scale-100 " +
              (selected ? "text-accent" : "text-gray-500 hover:text-gray-200")
            }
            data-testid={`tab-${key}`}
          >
            <Icon
              icon={icon}
              size={20}
              className={
                "transition ease-spring motion-reduce:transition-none " + (selected ? "scale-110" : "")
              }
            />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export const TabBar = memo(TabBarInner)
