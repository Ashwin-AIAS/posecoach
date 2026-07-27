import { memo, useEffect, useRef, useState } from "react"
import { Footprints, Target } from "lucide-react"

import type { DailyTotals, NutritionGoalOut } from "../types"
import { activityEquivalents, progressFraction, remainingOf } from "../lib/budget"
import { fmt } from "../lib/macros"
import { Icon } from "./ui/Icon"

interface BudgetSummaryProps {
  /** The viewed day's totals, summed from the rows the diary is showing. */
  readonly totals: DailyTotals
  /** The user's targets, or null/absent when none is set (P34.2). */
  readonly goal?: NutritionGoalOut | null
  /** Opens the target editor; the affordance is hidden when not provided. */
  readonly onEditTarget?: () => void
}

/** jsdom (tests) and very old browsers lack matchMedia — treat as reduced motion. */
function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return true
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

const COUNT_UP_MS = 450

/** Counts from the previous displayed value to `target`; snaps when reduced. */
function useCountUp(target: number): number {
  const reduced = prefersReducedMotion()
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

function MacroBar({
  label,
  grams,
  share,
}: {
  label: string
  grams: number
  share: number
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-gray-400">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
        {/* Width is data-driven — proportion of today's macro grams. */}
        <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
      </div>
      <span className="hud-numerals w-14 shrink-0 text-right text-xs text-gray-300">
        {fmt(grams)} g
      </span>
    </div>
  )
}

const LINK_BTN =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-accent transition ease-spring active:scale-[0.97] hover:text-accent/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"

/**
 * The day's headline numbers (P34.2).
 *
 * With a target set, the hero is what's **left** — the number that answers
 * "did my log save?" by visibly moving; consumed stays visible underneath.
 * With no target it is the plain kcal total exactly as P28 shipped it, plus a
 * one-tap way to set one.
 *
 * Over-budget tone is a settled product decision: calm, never shaming, and the
 * activity equivalent is revealed only if the user asks for it — it is context,
 * not a quota to work off.
 */
function BudgetSummaryInner({ totals, goal, onEditTarget }: BudgetSummaryProps): JSX.Element {
  const [showActivity, setShowActivity] = useState(false)

  const kcal = remainingOf(goal?.kcal_target, totals.kcal)
  const protein = remainingOf(goal?.protein_target_g, totals.protein_g)

  // Hero counts to whatever number is on screen: remaining (or, over, by how much).
  const heroValue = kcal ? Math.abs(kcal.remaining) : totals.kcal
  const animated = useCountUp(heroValue)

  const macroGrams = totals.protein_g + totals.carbs_g + totals.fat_g
  const share = (g: number): number => (macroGrams > 0 ? (g / macroGrams) * 100 : 0)

  const over = kcal?.over ?? false
  const surplus = kcal && kcal.over ? -kcal.remaining : 0
  const equivalents = showActivity ? activityEquivalents(surplus) : []

  return (
    <div className="mt-4 rounded-2xl bg-surface-raised p-4 shadow-elev-1" data-testid="daily-totals">
      <div className="flex items-baseline gap-2">
        <span
          className={`hud-numerals text-3xl font-semibold ${over ? "text-amber-400" : "text-accent"}`}
          data-testid={kcal ? "remaining-kcal" : "totals-kcal"}
        >
          {fmt(animated)}
        </span>
        <span className="text-sm text-gray-500">
          {kcal ? (over ? "kcal over" : "kcal left") : "kcal"}
        </span>
      </div>

      {kcal && (
        <>
          <p className="mt-1 text-xs text-gray-500" data-testid="consumed-of-target">
            <span className="hud-numerals" data-testid="totals-kcal">
              {fmt(kcal.consumed)}
            </span>{" "}
            of <span className="hud-numerals">{fmt(kcal.target)}</span> kcal
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${over ? "bg-amber-400" : "bg-accent"}`}
              style={{ width: `${progressFraction(kcal) * 100}%` }}
              data-testid="budget-bar"
            />
          </div>
          {protein && (
            <p className="mt-2 text-xs text-gray-400" data-testid="remaining-protein">
              Protein{" "}
              <span className="hud-numerals text-gray-200">
                {fmt(Math.abs(protein.remaining))} g
              </span>{" "}
              {protein.over ? "over" : "left"} of{" "}
              <span className="hud-numerals">{fmt(protein.target)} g</span>
            </p>
          )}
        </>
      )}

      <div className="mt-3 space-y-2">
        <MacroBar label="Protein" grams={totals.protein_g} share={share(totals.protein_g)} />
        <MacroBar label="Carbs" grams={totals.carbs_g} share={share(totals.carbs_g)} />
        <MacroBar label="Fat" grams={totals.fat_g} share={share(totals.fat_g)} />
      </div>

      {over && (
        <div className="mt-3 rounded-xl bg-white/5 px-3 py-2.5" data-testid="over-budget-note">
          <p className="text-xs text-gray-300">
            You&apos;re a bit over today — no stress. One day doesn&apos;t decide much.
          </p>
          <button
            type="button"
            onClick={() => setShowActivity((s) => !s)}
            className={`${LINK_BTN} mt-1`}
            aria-expanded={showActivity}
            data-testid="activity-toggle"
          >
            <Icon icon={Footprints} size={14} />
            {showActivity ? "Hide" : "What's that in activity?"}
          </button>
          {showActivity && (
            <div className="mt-1" data-testid="activity-equivalent">
              <p className="text-xs text-gray-400">
                Roughly, {fmt(surplus)} kcal is about{" "}
                {equivalents.map((a, i) => (
                  <span key={a.key}>
                    {i > 0 && (i === equivalents.length - 1 ? ", or " : ", ")}
                    <span className="hud-numerals text-gray-200">{a.minutes} min</span> of a{" "}
                    {a.label}
                  </span>
                ))}{" "}
                for an average adult.
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Just for context — not something you need to do.
              </p>
            </div>
          )}
        </div>
      )}

      {onEditTarget && (
        <button
          type="button"
          onClick={onEditTarget}
          className={`${LINK_BTN} mt-2`}
          data-testid={kcal ? "edit-target-btn" : "set-target-btn"}
        >
          <Icon icon={Target} size={14} />
          {kcal ? "Edit daily target" : "Set a daily target"}
        </button>
      )}
    </div>
  )
}

export const BudgetSummary = memo(BudgetSummaryInner)
