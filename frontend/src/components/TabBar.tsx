import { memo, useEffect, useRef } from "react"
import { Activity, ClipboardList, Flame, Settings } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Icon } from "./ui/Icon"

/** Top-level app tab (P23 navigation shell). Coach is today's experience. */
export type TabKey = "coach" | "workouts" | "calories" | "settings"

/** CSS var (on :root) carrying the live tab-bar height; 0px while hidden. Other
 *  fixed bottom chrome (e.g. InstallBanner) reads it to sit above the bar. */
const TABBAR_H_VAR = "--tabbar-h"
/** Sensible default when the bar can't be measured yet (e.g. jsdom has no
 *  layout) — roughly icon+label+padding, so the banner still clears the bar. */
const FALLBACK_TABBAR_PX = 52

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
  const navRef = useRef<HTMLElement>(null)

  // Publish the bar's height (incl. safe-area padding) so other fixed bottom
  // chrome can offset above it; reset to 0 while hidden / on unmount so that
  // chrome falls back to its own bottom spacing during a live set.
  useEffect(() => {
    const root = document.documentElement
    if (hidden) {
      root.style.setProperty(TABBAR_H_VAR, "0px")
      return
    }
    const el = navRef.current
    if (el === null) return
    const publish = (): void => {
      const px = Math.max(el.offsetHeight, FALLBACK_TABBAR_PX)
      root.style.setProperty(TABBAR_H_VAR, `${px}px`)
    }
    publish()
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(publish)
      observer.observe(el)
    }
    return () => {
      observer?.disconnect()
      root.style.setProperty(TABBAR_H_VAR, "0px")
    }
  }, [hidden])

  if (hidden) return null

  return (
    <nav
      ref={navRef}
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
              "relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition ease-spring active:scale-[0.94] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent motion-reduce:transition-none motion-reduce:active:scale-100 " +
              (selected ? "text-accent" : "text-gray-500 hover:text-gray-200")
            }
            data-testid={`tab-${key}`}
          >
            {/* Filled pill behind the active icon (P36 C8) — replaces the 2px top line. */}
            <span
              className={
                "flex items-center justify-center rounded-full px-4 py-1 transition ease-spring motion-reduce:transition-none " +
                (selected ? "bg-accent-soft" : "bg-transparent")
              }
              data-testid={`tab-pill-${key}`}
              data-active={selected ? "true" : "false"}
            >
              <Icon
                icon={icon}
                size={20}
                className={
                  "transition ease-spring motion-reduce:transition-none " + (selected ? "scale-105" : "")
                }
              />
            </span>
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export const TabBar = memo(TabBarInner)
