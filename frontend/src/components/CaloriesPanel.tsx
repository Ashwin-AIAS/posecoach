import { memo, useCallback, useState } from "react"
import { CalendarPlus, CheckCircle2, PencilLine, RefreshCw, ScanBarcode, X } from "lucide-react"

import type { FoodItemOut } from "../types"
import { lookupBarcode } from "../lib/nutritionApi"
import { todayISO } from "../lib/day"
import { AddToDiarySheet } from "./AddToDiarySheet"
import { BarcodeScanner } from "./BarcodeScanner"
import { FoodMacroCard } from "./FoodMacroCard"
import { ManualFoodForm } from "./ManualFoodForm"
import { Icon } from "./ui/Icon"

type Mode = "idle" | "scanning" | "loading" | "product" | "not-found" | "manual" | "error" | "log" | "logged"

const BARCODE_RE = /^\d{6,14}$/

const PRIMARY_BTN =
  "flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-gray-950 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
const SECONDARY_BTN =
  "flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium text-gray-300 shadow-elev-1 transition ease-spring hover:text-white active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"

/**
 * Calories tab (P27): scan a barcode on-device → see calories + macros, with a
 * manual-entry fallback for products Open Food Facts doesn't know. Logging to
 * the daily diary arrives in P28. Full-screen, memoized, owns its header —
 * mirrors the SettingsPanel/WorkoutPanel pattern.
 */
function CaloriesPanelInner(): JSX.Element {
  const [mode, setMode] = useState<Mode>("idle")
  const [food, setFood] = useState<FoodItemOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleDecoded = useCallback((digits: string): void => {
    if (!BARCODE_RE.test(digits)) return // not a retail food code — keep scanning
    setMode("loading")
    void (async () => {
      try {
        const result = await lookupBarcode(digits)
        if (result === null) {
          setMode("not-found")
        } else {
          setFood(result)
          setMode("product")
        }
      } catch (e) {
        const message = (e as Error).message
        setError(/\(401\)/.test(message) ? "Sign in to look up foods." : message)
        setMode("error")
      }
    })()
  }, [])

  const handleScannerError = useCallback((message: string): void => {
    setError(message || "Camera unavailable — check permissions.")
    setMode("error")
  }, [])

  return (
    <div
      className="flex-1 animate-fade-in overflow-y-auto px-4 py-5 sm:px-6"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
      data-testid="calories-panel"
    >
      <div className="mx-auto max-w-2xl">
        <h2 className="font-display text-xl font-semibold">Calories</h2>
        <p className="mt-1 text-sm text-gray-500">
          Scan a product barcode to see its calories and macros.
        </p>

        {mode === "idle" && (
          <div className="mt-8 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-10 text-center shadow-elev-1">
            <div className="grid h-16 w-16 place-content-center rounded-2xl bg-accent-soft">
              <Icon icon={ScanBarcode} size={28} className="text-accent" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-gray-400">
              Point your camera at any food barcode. Scanning happens on your
              device — only the number is looked up.
            </p>
            <button
              type="button"
              onClick={() => setMode("scanning")}
              className={`${PRIMARY_BTN} mt-6`}
              data-testid="scan-btn"
            >
              <Icon icon={ScanBarcode} size={18} />
              Scan a barcode
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={`${SECONDARY_BTN} mt-3`}
              data-testid="manual-entry-btn"
            >
              <Icon icon={PencilLine} size={16} />
              Type it in instead
            </button>
            <p className="mt-6 text-[11px] text-gray-600">
              Product data is community-sourced from Open Food Facts.
            </p>
          </div>
        )}

        {mode === "scanning" && (
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
              onClick={() => setMode("idle")}
              className={`${SECONDARY_BTN} mx-auto mt-4`}
              data-testid="cancel-scan-btn"
            >
              <Icon icon={X} size={16} />
              Cancel
            </button>
          </div>
        )}

        {mode === "loading" && (
          <div
            className="mt-8 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-12 text-center shadow-elev-1"
            data-testid="lookup-loading"
          >
            <Icon icon={RefreshCw} size={22} className="animate-spin text-accent motion-reduce:animate-none" />
            <p className="mt-3 text-sm text-gray-400">Looking up product…</p>
          </div>
        )}

        {mode === "product" && food && (
          <div className="mt-6 space-y-4">
            <FoodMacroCard food={food} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("log")}
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
                  setMode("scanning")
                }}
                className={SECONDARY_BTN}
                data-testid="scan-another-btn"
              >
                <Icon icon={ScanBarcode} size={16} />
                Scan another
              </button>
              <button
                type="button"
                onClick={() => {
                  setFood(null)
                  setMode("idle")
                }}
                className={SECONDARY_BTN}
                data-testid="done-btn"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {mode === "log" && food && (
          <div className="mt-6 space-y-4">
            <FoodMacroCard food={food} />
            <AddToDiarySheet
              food={food}
              dateISO={todayISO()}
              onLogged={() => {
                setFood(null)
                setMode("logged")
              }}
              onCancel={() => setMode("product")}
            />
          </div>
        )}

        {mode === "logged" && (
          <div
            className="mt-8 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-10 text-center shadow-elev-1"
            data-testid="logged-confirmation"
          >
            <Icon icon={CheckCircle2} size={28} className="text-accent" />
            <h3 className="mt-3 font-display text-base font-semibold text-gray-100">
              Added to your diary
            </h3>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setMode("scanning")}
                className={PRIMARY_BTN}
                data-testid="logged-scan-another-btn"
              >
                <Icon icon={ScanBarcode} size={18} />
                Scan another
              </button>
              <button
                type="button"
                onClick={() => setMode("idle")}
                className={SECONDARY_BTN}
                data-testid="logged-done-btn"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {mode === "not-found" && (
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
                onClick={() => setMode("manual")}
                className={PRIMARY_BTN}
                data-testid="not-found-manual-btn"
              >
                <Icon icon={PencilLine} size={16} />
                Type it in
              </button>
              <button
                type="button"
                onClick={() => setMode("scanning")}
                className={SECONDARY_BTN}
                data-testid="not-found-rescan-btn"
              >
                Scan again
              </button>
            </div>
          </div>
        )}

        {mode === "manual" && (
          <div className="mt-6">
            <ManualFoodForm
              onCreated={(created) => {
                setFood(created)
                setMode("product")
              }}
              onCancel={() => setMode("idle")}
            />
          </div>
        )}

        {mode === "error" && (
          <div
            className="mt-8 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-10 text-center shadow-elev-1"
            data-testid="lookup-error"
          >
            <p role="alert" className="max-w-xs text-sm text-red-400">
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setMode("idle")
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
