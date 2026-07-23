import { memo, useCallback, useState } from "react"
import { CalendarPlus, ChevronLeft, PencilLine, RefreshCw, ScanBarcode, X } from "lucide-react"

import type { FoodItemOut } from "../types"
import { lookupBarcode } from "../lib/nutritionApi"
import { todayISO } from "../lib/day"
import { AddFoodChooser } from "./AddFoodChooser"
import { AddToDiarySheet } from "./AddToDiarySheet"
import { BarcodeScanner } from "./BarcodeScanner"
import { DiaryDay } from "./DiaryDay"
import { FoodMacroCard } from "./FoodMacroCard"
import { ManualFoodForm } from "./ManualFoodForm"
import { Icon } from "./ui/Icon"

type View = "diary" | "add"
/** The P27 scan machine, plus "choose" (the add-food entry point) and "log". */
type AddMode = "choose" | "scanning" | "loading" | "product" | "not-found" | "manual" | "error" | "log"

interface CaloriesPanelProps {
  /** Deep-links to Settings from a "Sign in" card (P29). */
  readonly onNavigateSettings?: () => void
}

const BARCODE_RE = /^\d{6,14}$/

const PRIMARY_BTN =
  "flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-gray-950 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
const SECONDARY_BTN =
  "flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium text-gray-300 shadow-elev-1 transition ease-spring hover:text-white active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"

/**
 * Calories tab (P28): the tab home is the daily food diary — totals, meal
 * groups, day navigation. Adding food (the P27 scan → macro card → manual
 * fallback machine, plus name search) is a flow launched from the diary and
 * logs to the currently-viewed day. Full-screen, memoized, owns its header —
 * mirrors the SettingsPanel/WorkoutPanel pattern.
 */
function CaloriesPanelInner({ onNavigateSettings }: CaloriesPanelProps): JSX.Element {
  const [view, setView] = useState<View>("diary")
  const [dateISO, setDateISO] = useState<string>(todayISO())
  const [addMode, setAddMode] = useState<AddMode>("choose")
  const [food, setFood] = useState<FoodItemOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openAdd = useCallback((): void => {
    setFood(null)
    setError(null)
    setAddMode("choose")
    setView("add")
  }, [])

  // DiaryDay remounts on return and refetches — the new row is simply there.
  const closeAdd = useCallback((): void => setView("diary"), [])

  const handleDecoded = useCallback((digits: string): void => {
    if (!BARCODE_RE.test(digits)) return // not a retail food code — keep scanning
    setAddMode("loading")
    void (async () => {
      try {
        const result = await lookupBarcode(digits)
        if (result === null) {
          setAddMode("not-found")
        } else {
          setFood(result)
          setAddMode("product")
        }
      } catch (e) {
        const message = (e as Error).message
        setError(/\(401\)/.test(message) ? "Sign in to look up foods." : message)
        setAddMode("error")
      }
    })()
  }, [])

  const handleScannerError = useCallback((message: string): void => {
    setError(message || "Camera unavailable — check permissions.")
    setAddMode("error")
  }, [])

  return (
    <div
      className="flex-1 animate-fade-in overflow-y-auto px-4 py-5 sm:px-6"
      style={{
        paddingTop: "max(1.25rem, env(safe-area-inset-top))",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 5rem)",
      }}
      data-testid="calories-panel"
    >
      <div className="mx-auto max-w-2xl">
        {view === "add" && (
          <button
            type="button"
            onClick={closeAdd}
            className="mb-2 flex min-h-11 items-center gap-1 rounded-full pr-3 text-sm font-medium text-gray-400 transition ease-spring hover:text-white active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
            data-testid="add-back-btn"
          >
            <Icon icon={ChevronLeft} size={18} />
            Diary
          </button>
        )}
        <h2 className="font-display text-xl font-semibold">Calories</h2>
        <p className="mt-1 text-sm text-gray-500">
          {view === "diary"
            ? "Your food diary — running totals for the day."
            : "Add a food to your diary."}
        </p>

        {view === "diary" && (
          <DiaryDay
            dateISO={dateISO}
            onDateChange={setDateISO}
            onAddFood={openAdd}
            onSignIn={onNavigateSettings}
          />
        )}

        {view === "add" && addMode === "choose" && (
          <AddFoodChooser
            onScan={() => setAddMode("scanning")}
            onManual={() => setAddMode("manual")}
            onPick={(picked) => {
              setFood(picked)
              setAddMode("log")
            }}
            onSignIn={onNavigateSettings}
          />
        )}

        {view === "add" && addMode === "scanning" && (
          <div className="mt-6">
            <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-black shadow-elev-2 sm:aspect-video">
              <BarcodeScanner onDecoded={handleDecoded} onError={handleScannerError} />
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 rounded bg-accent/70" />
            </div>
            <p className="mt-3 text-center text-xs text-gray-500">
              Center the barcode in the frame — it scans automatically.
            </p>
            <button
              type="button"
              onClick={() => setAddMode("choose")}
              className={`${SECONDARY_BTN} mx-auto mt-4`}
              data-testid="cancel-scan-btn"
            >
              <Icon icon={X} size={16} />
              Cancel
            </button>
          </div>
        )}

        {view === "add" && addMode === "loading" && (
          <div
            className="mt-8 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-12 text-center shadow-elev-1"
            data-testid="lookup-loading"
          >
            <Icon icon={RefreshCw} size={22} className="animate-spin text-accent motion-reduce:animate-none" />
            <p className="mt-3 text-sm text-gray-400">Looking up product…</p>
          </div>
        )}

        {view === "add" && addMode === "product" && food && (
          <div className="mt-6 space-y-4">
            <FoodMacroCard food={food} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAddMode("log")}
                className={`${PRIMARY_BTN} flex-1`}
                data-testid="add-to-diary-btn"
              >
                <Icon icon={CalendarPlus} size={18} />
                Add to diary
              </button>
              <button
                type="button"
                onClick={() => {
                  setFood(null)
                  setAddMode("scanning")
                }}
                className={SECONDARY_BTN}
                data-testid="scan-another-btn"
              >
                <Icon icon={ScanBarcode} size={16} />
                Scan another
              </button>
              <button type="button" onClick={closeAdd} className={SECONDARY_BTN} data-testid="done-btn">
                Done
              </button>
            </div>
          </div>
        )}

        {view === "add" && addMode === "log" && food && (
          <div className="mt-6 space-y-4">
            <FoodMacroCard food={food} />
            <AddToDiarySheet
              food={food}
              dateISO={dateISO}
              onLogged={closeAdd}
              onCancel={() => setAddMode("product")}
            />
          </div>
        )}

        {view === "add" && addMode === "not-found" && (
          <div
            className="mt-8 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-10 text-center shadow-elev-1"
            data-testid="not-found"
          >
            <h3 className="font-display text-base font-semibold text-gray-100">
              Not in the database yet
            </h3>
            <p className="mt-1.5 max-w-xs text-sm text-gray-500">
              Open Food Facts doesn&apos;t know this barcode. You can add the
              nutrition facts from the label instead.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setAddMode("manual")}
                className={PRIMARY_BTN}
                data-testid="not-found-manual-btn"
              >
                <Icon icon={PencilLine} size={16} />
                Type it in
              </button>
              <button
                type="button"
                onClick={() => setAddMode("scanning")}
                className={SECONDARY_BTN}
                data-testid="not-found-rescan-btn"
              >
                Scan again
              </button>
            </div>
          </div>
        )}

        {view === "add" && addMode === "manual" && (
          <div className="mt-6">
            <ManualFoodForm
              onCreated={(created) => {
                setFood(created)
                setAddMode("log")
              }}
              onCancel={() => setAddMode("choose")}
            />
          </div>
        )}

        {view === "add" && addMode === "error" && (
          <div
            className="mt-8 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-10 text-center shadow-elev-1"
            data-testid="lookup-error"
          >
            <h3 className="font-display text-base font-semibold text-gray-100">
              Something went wrong
            </h3>
            <p role="alert" className="mt-1.5 max-w-xs text-sm text-red-400">
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setAddMode("choose")
              }}
              className={`${SECONDARY_BTN} mt-5`}
              data-testid="error-back-btn"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export const CaloriesPanel = memo(CaloriesPanelInner)
