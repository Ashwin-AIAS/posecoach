import { useState } from "react"

import { useInstallPrompt } from "../hooks/useInstallPrompt"

/**
 * Dismissal is persisted so the iOS instructions don't nag on every visit
 * (iOS has no `appinstalled` event we could listen for instead). Wrapped in
 * try/catch: Safari private mode throws on any localStorage write.
 */
const DISMISS_KEY = "posecoach-install-dismissed"

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1"
  } catch {
    return false
  }
}

function persistDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1")
  } catch {
    // Private mode — banner will simply reappear next visit.
  }
}

/**
 * Dismissible bottom banner offering PWA installation.
 *
 * Two modes (from useInstallPrompt):
 * - "native"     — Chromium fired beforeinstallprompt → branded Install button.
 * - "ios-manual" — iOS Safari has no install API → Share → Add to Home Screen
 *   instructions, since Apple's only install path is manual.
 */
export function InstallBanner(): JSX.Element | null {
  const { installMode, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState<boolean>(readDismissed)

  if (installMode === null || dismissed) return null

  const dismiss = (): void => {
    persistDismissed()
    setDismissed(true)
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4" data-testid="install-banner">
      <div className="flex animate-caption-in items-center gap-3 rounded-full border border-surface-hairline bg-surface-raised/90 px-4 py-2 shadow-card backdrop-blur-md">
        {installMode === "native" ? (
          <>
            <span className="text-sm text-gray-200">Install PoseCoach for full-screen training</span>
            <button
              type="button"
              onClick={() => void promptInstall()}
              className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-surface-base transition hover:brightness-110"
            >
              Install
            </button>
          </>
        ) : (
          <span className="text-sm text-gray-200" data-testid="ios-install-hint">
            Install PoseCoach: tap{" "}
            {/* iOS share glyph — square with up arrow, drawn inline so it matches Safari's icon */}
            <svg
              viewBox="0 0 24 24"
              className="inline h-4 w-4 -translate-y-0.5 text-accent"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-label="Share"
              role="img"
            >
              <path d="M12 15V3" />
              <path d="M8 7l4-4 4 4" />
              <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
            </svg>{" "}
            <span className="font-medium text-white">Share</span> →{" "}
            <span className="font-medium text-white">Add to Home Screen</span>
          </span>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded-md p-1 text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
