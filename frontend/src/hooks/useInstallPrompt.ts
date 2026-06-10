import { useCallback, useEffect, useState } from "react"

/** The non-standard beforeinstallprompt event (Chromium PWA install flow). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * How this browser can install the PWA:
 * - "native": Chromium fired `beforeinstallprompt` — we can trigger the dialog.
 * - "ios-manual": iOS Safari — no install API exists; the user must use
 *   Share → "Add to Home Screen", so the UI shows instructions instead.
 * - null: already installed, or the browser offers no install path.
 */
export type InstallMode = "native" | "ios-manual" | null

interface InstallPrompt {
  /** Which install affordance the UI should render (see InstallMode). */
  readonly installMode: InstallMode
  /** True when any install affordance should be shown. */
  readonly canInstall: boolean
  /** Trigger the native install dialog; resolves to true if the user accepted.
   *  Always resolves false in "ios-manual" mode (there is no API to call). */
  readonly promptInstall: () => Promise<boolean>
}

/** True when already running as an installed app (home-screen / desktop window). */
function isStandalone(): boolean {
  // jsdom (tests) and very old browsers lack matchMedia — treat as not installed.
  if (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) {
    return true
  }
  // iOS Safari's non-standard flag, true only for a home-screen launch.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** iPhone/iPod/iPad — modern iPadOS masquerades as "Macintosh" but has touch. */
function isIos(): boolean {
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return true
  return ua.includes("Macintosh") && navigator.maxTouchPoints > 1
}

/**
 * Captures the deferred `beforeinstallprompt` event so the UI can offer a
 * branded install affordance instead of the browser's default mini-infobar.
 *
 * iOS never fires `beforeinstallprompt` (Apple provides no install API), so on
 * an iOS browser that is not already installed we report "ios-manual" and the
 * banner renders Share → Add to Home Screen instructions instead of a button.
 */
export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  // Evaluated once per mount — UA and standalone state don't change mid-session.
  const [iosManual] = useState<boolean>(() => isIos() && !isStandalone())

  useEffect(() => {
    const onBeforeInstall = (e: Event): void => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = (): void => setDeferred(null)

    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (deferred === null) return false
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null)
    return outcome === "accepted"
  }, [deferred])

  const installMode: InstallMode = deferred !== null ? "native" : iosManual ? "ios-manual" : null

  return { installMode, canInstall: installMode !== null, promptInstall }
}
