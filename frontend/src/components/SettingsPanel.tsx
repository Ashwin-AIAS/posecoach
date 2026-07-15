import { memo, useState } from "react"
import { LogOut, ShieldCheck, Trash2 } from "lucide-react"

import type { useAuth } from "../hooks/useAuth"
import { isLatencyDiagEnabled } from "../hooks/useLatencyProbe"
import { useUnitPref, type Unit } from "../hooks/useUnitPref"
import { AuthModal } from "./AuthModal"
import { LatencyDiagnostics } from "./LatencyDiagnostics"
import { Icon } from "./ui/Icon"

type AuthHook = ReturnType<typeof useAuth>

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "0.1.0"
const UNITS: readonly Unit[] = ["kg", "lb"]

interface SettingsPanelProps {
  readonly auth: AuthHook
  /** Return to the Coach tab after the account is deleted. */
  readonly onNavigateCoach: () => void
}

/** A titled card section — mirrors the dark-token surfaces used across the app. */
function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">{title}</h3>
      <div className="rounded-2xl bg-surface-raised p-4 shadow-elev-1">{children}</div>
    </section>
  )
}

/**
 * Settings tab (P23). Reuses the existing auth surface (`useAuth` + `AuthModal`,
 * `DELETE /auth/account`) and a client-side units preference. Full-screen,
 * memoized, owns its header — mirrors the HistoryPanel pattern.
 */
function SettingsPanelInner({ auth, onNavigateCoach }: SettingsPanelProps): JSX.Element {
  const { unit, setUnit } = useUnitPref()
  const [showAuth, setShowAuth] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const onDelete = async (): Promise<void> => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await auth.deleteAccount()
      setConfirmingDelete(false)
      onNavigateCoach()
    } catch (e) {
      setDeleteError((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="flex-1 animate-fade-in overflow-y-auto px-4 py-5 sm:px-6"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
      data-testid="settings-panel"
    >
      <div className="mx-auto max-w-2xl">
        <h2 className="font-display text-xl font-semibold">Settings</h2>

        <Section title="Profile">
          {auth.state === "loading" ? (
            <p className="text-sm text-gray-500">…</p>
          ) : auth.state === "authenticated" ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-100" data-testid="settings-email">
                  {auth.user?.email}
                </p>
                <p className="text-xs text-gray-500">Signed in</p>
              </div>
              <button
                type="button"
                onClick={() => void auth.logout()}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium text-gray-300 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:text-white active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                data-testid="settings-logout-btn"
              >
                <Icon icon={LogOut} size={15} />
                Log out
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-400">Sign in to sync your sessions across devices.</p>
              <button
                type="button"
                onClick={() => setShowAuth(true)}
                className="flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-accent px-3.5 text-sm font-medium text-surface-base transition ease-spring hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised motion-reduce:transition-none"
                data-testid="settings-signin-btn"
              >
                Sign in
              </button>
            </div>
          )}
        </Section>

        <Section title="Preferences">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-100">Units</p>
              <p className="text-xs text-gray-500">Weight display for the workout logger</p>
            </div>
            <div
              role="radiogroup"
              aria-label="Weight units"
              className="flex shrink-0 rounded-full bg-surface-base p-0.5 shadow-elev-1"
            >
              {UNITS.map((u) => {
                const selected = unit === u
                return (
                  <button
                    key={u}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setUnit(u)}
                    className={
                      "min-h-11 rounded-full px-4 text-sm font-medium transition ease-spring focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none " +
                      (selected ? "bg-accent-soft text-accent" : "text-gray-400 hover:text-white")
                    }
                    data-testid={`unit-${u}`}
                  >
                    {u.toUpperCase()}
                  </button>
                )
              })}
            </div>
          </div>
        </Section>

        <Section title="About">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-display text-sm font-semibold">
                Pose<span className="text-accent">Coach</span>
              </span>
            </div>
            <span className="hud-numerals text-xs text-gray-500" data-testid="app-version">
              v{APP_VERSION}
            </span>
          </div>
          <div className="mt-3 flex items-start gap-2 border-t border-surface-hairline pt-3">
            <Icon icon={ShieldCheck} size={15} className="mt-0.5 shrink-0 text-gray-500" />
            <p className="text-xs leading-relaxed text-gray-500">
              Camera frames are processed on-device for pose estimation and are never uploaded or
              stored. Only anonymized keypoints and form scores are saved to your account.
            </p>
          </div>
        </Section>

        <Section title="Account">
          {auth.state === "authenticated" ? (
            !confirmingDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium text-score-bad shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                data-testid="delete-account-btn"
              >
                <Icon icon={Trash2} size={15} />
                Delete account
              </button>
            ) : (
              <div data-testid="delete-confirm">
                <p className="text-sm text-gray-300">
                  This permanently deletes your account and all saved sessions. This cannot be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                    className="min-h-11 rounded-full px-3.5 text-xs font-medium text-gray-300 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:text-white active:translate-y-0 active:scale-[0.97] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete()}
                    disabled={deleting}
                    className="min-h-11 rounded-full bg-score-bad px-3.5 text-xs font-semibold text-surface-base transition ease-spring hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:scale-[0.97] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised motion-reduce:transition-none"
                    data-testid="confirm-delete-btn"
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
                {deleteError && <p className="mt-2 text-sm text-score-bad">{deleteError}</p>}
              </div>
            )
          ) : (
            <p className="text-sm text-gray-500">Sign in to manage your account.</p>
          )}
        </Section>

        {/* P31: dev-flagged latency probe (LATENCY_OPTIMIZATION_PLAN.md Phase 2 §1).
            Hidden from real users — dev builds, or `?diag=1` once in production. */}
        {isLatencyDiagEnabled() && (
          <Section title="Developer — Latency">
            <LatencyDiagnostics />
          </Section>
        )}
      </div>

      {showAuth && <AuthModal auth={auth} onClose={() => setShowAuth(false)} />}
    </div>
  )
}

export const SettingsPanel = memo(SettingsPanelInner)
