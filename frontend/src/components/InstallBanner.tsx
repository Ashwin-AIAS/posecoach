import { useState } from "react"

import { useInstallPrompt } from "../hooks/useInstallPrompt"

/**
 * Dismissible bottom banner offering PWA installation. Only renders when the
 * browser has fired `beforeinstallprompt` and the user hasn't dismissed it.
 */
export function InstallBanner(): JSX.Element | null {
  const { canInstall, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(false)

  if (!canInstall || dismissed) return null

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4" data-testid="install-banner">
      <div className="flex animate-caption-in items-center gap-3 rounded-full border border-surface-hairline bg-surface-raised/90 px-4 py-2 shadow-card backdrop-blur-md">
        <span className="text-sm text-gray-200">Install PoseCoach for full-screen training</span>
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-surface-base transition hover:brightness-110"
        >
          Install
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss install prompt"
          className="rounded-md p-1 text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
