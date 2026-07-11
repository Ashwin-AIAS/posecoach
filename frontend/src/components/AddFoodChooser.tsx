import { memo, useEffect, useRef, useState } from "react"
import { PencilLine, RefreshCw, ScanBarcode, Search } from "lucide-react"

import type { FoodItemOut } from "../types"
import { searchFoods } from "../lib/nutritionApi"
import { fmt } from "../lib/macros"
import { Icon } from "./ui/Icon"

interface AddFoodChooserProps {
  /** Start the on-device barcode scan (the P27 machine). */
  readonly onScan: () => void
  /** Open the manual per-100 g form (the P27 form). */
  readonly onManual: () => void
  /** A search hit was picked — straight to the macro card + add sheet. */
  readonly onPick: (food: FoodItemOut) => void
}

const SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LEN = 2

const PRIMARY_BTN =
  "flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-gray-950 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
const SECONDARY_BTN =
  "flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium text-gray-300 shadow-elev-1 transition ease-spring hover:text-white active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"

/**
 * The "Add food" entry point (P28). Search is the everyday path — you scan a
 * product once, then re-log it by name (cached OFF rows + your manual foods).
 * Scan stays the discovery path for new products; manual is the fallback.
 */
function AddFoodChooserInner({ onScan, onManual, onPick }: AddFoodChooserProps): JSX.Element {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<readonly FoodItemOut[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  // Ignore out-of-order responses while the user keeps typing.
  const searchSeq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY_LEN) {
      searchSeq.current += 1
      setResults(null)
      setSearching(false)
      setSearchError(null)
      return
    }
    setSearching(true)
    const timer = window.setTimeout(() => {
      const seq = ++searchSeq.current
      void (async () => {
        try {
          const rows = await searchFoods(q)
          if (seq !== searchSeq.current) return
          setResults(rows)
          setSearchError(null)
        } catch (e) {
          if (seq !== searchSeq.current) return
          setResults(null)
          setSearchError((e as Error).message)
        } finally {
          if (seq === searchSeq.current) setSearching(false)
        }
      })()
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  return (
    <div className="mt-6" data-testid="add-food-chooser">
      <label htmlFor="food-search" className="mb-1 block text-xs font-medium text-gray-500">
        Search your foods
      </label>
      <div className="relative">
        <Icon icon={Search} size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
        <input
          id="food-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. oats, whey, nutella"
          className="w-full min-h-11 rounded-xl bg-white/5 pl-9 pr-3 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="food-search-input"
        />
      </div>
      <p className="mt-1.5 text-[11px] text-gray-600">
        Finds products you&apos;ve scanned before and your manual foods.
      </p>

      {searching && (
        <div className="mt-3 flex items-center gap-2 px-1 text-xs text-gray-500" data-testid="search-loading">
          <Icon icon={RefreshCw} size={13} className="animate-spin motion-reduce:animate-none" />
          Searching…
        </div>
      )}

      {searchError && (
        <p role="alert" className="mt-3 px-1 text-xs text-red-400" data-testid="search-error">
          {searchError}
        </p>
      )}

      {results && results.length > 0 && (
        <div
          className="mt-3 divide-y divide-white/5 rounded-2xl bg-surface-raised px-2 py-1 shadow-elev-1"
          data-testid="food-search-results"
        >
          {results.map((food) => (
            <button
              key={food.id}
              type="button"
              onClick={() => onPick(food)}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left transition ease-spring hover:bg-white/5 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
              data-testid={`food-result-${food.id}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-gray-100">{food.name}</span>
                {food.brand && <span className="block truncate text-xs text-gray-500">{food.brand}</span>}
              </span>
              <span className="hud-numerals shrink-0 text-xs text-gray-400">{fmt(food.kcal_100g)} kcal / 100 g</span>
            </button>
          ))}
        </div>
      )}

      {results && results.length === 0 && !searching && (
        <p className="mt-3 px-1 text-xs text-gray-500" data-testid="search-empty">
          No matches — scan its barcode or type it in below.
        </p>
      )}

      <div className="mt-6 flex items-center gap-3" aria-hidden="true">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-[11px] uppercase tracking-wide text-gray-600">or</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <div className="mt-4 flex flex-col items-stretch gap-3">
        <button type="button" onClick={onScan} className={PRIMARY_BTN} data-testid="scan-btn">
          <Icon icon={ScanBarcode} size={18} />
          Scan a barcode
        </button>
        <button type="button" onClick={onManual} className={SECONDARY_BTN} data-testid="manual-entry-btn">
          <Icon icon={PencilLine} size={16} />
          Type it in instead
        </button>
      </div>

      <p className="mt-6 text-center text-[11px] text-gray-600">
        Product data is community-sourced from Open Food Facts.
      </p>
    </div>
  )
}

export const AddFoodChooser = memo(AddFoodChooserInner)
