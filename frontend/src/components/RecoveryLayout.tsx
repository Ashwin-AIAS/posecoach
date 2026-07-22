import { memo } from "react"

/**
 * Full-screen dark shell for the standalone account-recovery pages (P33).
 * Mirrors the AuthModal card tokens so the two surfaces feel like one product.
 */

/** Shared field styling — matches AuthModal's inputs. */
export const RECOVERY_INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-surface-hairline bg-surface-base px-3 py-2 text-white outline-none focus:border-accent"

/** Shared primary-button styling (≥44px tap target). */
export const RECOVERY_BUTTON_CLASS =
  "flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-4 font-medium text-surface-base transition active:scale-[0.97] hover:brightness-110 disabled:bg-surface-hairline disabled:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"

/** Shared subtle link styling. */
export const RECOVERY_LINK_CLASS =
  "rounded text-accent underline transition hover:brightness-110 active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"

interface RecoveryLayoutProps {
  readonly title: string
  readonly children: React.ReactNode
}

function RecoveryLayoutInner({ title, children }: RecoveryLayoutProps): JSX.Element {
  return (
    <div
      className="flex min-h-[100svh] w-screen flex-col items-center justify-center bg-surface-base px-4 font-sans text-gray-100"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-full max-w-sm space-y-6">
        <a
          href="/"
          className="block rounded text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Back to PoseCoach"
        >
          <span className="font-display text-2xl font-semibold tracking-tight">
            Pose<span className="text-accent">Coach</span>
          </span>
        </a>
        <div className="space-y-4 rounded-2xl bg-surface-raised p-6 shadow-elev-3">
          <h1 className="font-display text-lg font-semibold">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  )
}

export const RecoveryLayout = memo(RecoveryLayoutInner)
