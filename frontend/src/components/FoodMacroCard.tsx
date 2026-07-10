import { memo } from "react"
import { UtensilsCrossed } from "lucide-react"

import type { FoodItemOut } from "../types"
import { Icon } from "./ui/Icon"

interface FoodMacroCardProps {
  readonly food: FoodItemOut
}

/** Round to one decimal and drop a trailing ".0" — macro labels stay compact. */
function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function MacroRow({
  label,
  per100,
  servingG,
}: {
  label: string
  per100: number
  servingG: number | null
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-sm text-gray-300">{label}</span>
      <span className="hud-numerals text-sm text-gray-100">
        {fmt(per100)} g
        {servingG !== null && (
          <span className="ml-2 text-xs text-gray-500">{fmt((per100 * servingG) / 100)} g / serving</span>
        )}
      </span>
    </div>
  )
}

/**
 * The scanned-product result card (P27): kcal headline + protein/carbs/fat
 * per 100 g, with per-serving values when the serving size is known. Shows the
 * community-data disclaimer for Open Food Facts rows.
 */
function FoodMacroCardInner({ food }: FoodMacroCardProps): JSX.Element {
  const servingG = food.serving_size_g
  return (
    <div className="rounded-2xl bg-surface-raised p-4 shadow-elev-2" data-testid="food-macro-card">
      <div className="flex items-center gap-3">
        {food.image_url ? (
          <img
            src={food.image_url}
            alt=""
            className="h-14 w-14 shrink-0 rounded-xl bg-white/5 object-contain"
            loading="lazy"
          />
        ) : (
          <div className="grid h-14 w-14 shrink-0 place-content-center rounded-xl bg-white/5">
            <Icon icon={UtensilsCrossed} size={22} className="text-gray-500" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-semibold text-gray-100">{food.name}</h3>
          {food.brand && <p className="truncate text-xs text-gray-500">{food.brand}</p>}
        </div>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="hud-numerals text-3xl font-semibold text-accent" data-testid="kcal-headline">
          {fmt(food.kcal_100g)}
        </span>
        <span className="text-sm text-gray-500">kcal / 100 g</span>
        {servingG !== null && (
          <span className="ml-auto text-xs text-gray-500">
            {fmt((food.kcal_100g * servingG) / 100)} kcal / {food.serving_label ?? `${fmt(servingG)} g`}
          </span>
        )}
      </div>

      <div className="mt-3 divide-y divide-white/5">
        <MacroRow label="Protein" per100={food.protein_100g} servingG={servingG} />
        <MacroRow label="Carbs" per100={food.carbs_100g} servingG={servingG} />
        <MacroRow label="Fat" per100={food.fat_100g} servingG={servingG} />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-gray-600">
        {food.source === "off"
          ? "Community data from Open Food Facts — values may vary by region and batch."
          : "Your manual entry."}
      </p>
    </div>
  )
}

export const FoodMacroCard = memo(FoodMacroCardInner)
