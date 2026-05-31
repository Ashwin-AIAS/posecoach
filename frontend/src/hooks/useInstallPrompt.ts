import { useCallback, useEffect, useState } from "react"

/** The non-standard beforeinstallprompt event (Chromium PWA install flow). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

interface InstallPrompt {
  /** True when the browser has offered an installable PWA and it isn't installed yet. */
  readonly canInstall: boolean
  /** Trigger the native install dialog; resolves to true if the user accepted. */
  readonly promptInstall: () => Promise<boolean>
}

/**
 * Captures the deferred `beforeinstallprompt` event so the UI can offer a
 * branded install affordance instead of the browser's default mini-infobar.
 */
export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

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

  return { canInstall: deferred !== null, promptInstall }
}
