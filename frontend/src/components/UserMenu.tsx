import { History, LogIn, LogOut, MoreVertical } from "lucide-react"
import { memo, useState } from "react"

import type { useAuth } from "../hooks/useAuth"
import { AuthModal } from "./AuthModal"
import { Icon } from "./ui/Icon"

type AuthHook = ReturnType<typeof useAuth>

interface UserMenuProps {
  readonly auth: AuthHook
  readonly onShowHistory: () => void
  /** Compact overflow menu button for the floating live camera top bar (P36 A2). */
  readonly compact?: boolean
}

function UserMenuInner({ auth, onShowHistory, compact = false }: UserMenuProps): JSX.Element {
  const [showAuth, setShowAuth] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  if (compact) {
    return (
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="Account and history menu"
          title="Account and history"
          className="grid h-11 w-11 shrink-0 place-content-center rounded-full bg-surface-raised/80 text-gray-300 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="overflow-menu-btn"
        >
          <Icon icon={MoreVertical} size={16} />
        </button>

        {menuOpen && (
          <div
            role="menu"
            aria-label="Account and history"
            className="absolute right-0 top-12 z-50 min-w-[11.5rem] rounded-2xl bg-surface-raised p-1.5 shadow-elev-3 animate-scale-in"
            data-testid="overflow-menu"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                onShowHistory()
              }}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-gray-200 transition hover:bg-surface-overlay hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="history-btn"
            >
              <Icon icon={History} size={15} className="text-gray-400" />
              History
            </button>

            {auth.state === "authenticated" ? (
              <>
                <span
                  className="block truncate px-3 py-1.5 text-xs text-gray-500"
                  data-testid="user-email"
                >
                  {auth.user?.email}
                </span>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    void auth.logout()
                  }}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-gray-200 transition hover:bg-surface-overlay hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  data-testid="logout-btn"
                >
                  <Icon icon={LogOut} size={15} className="text-gray-400" />
                  Log out
                </button>
              </>
            ) : (
              auth.state === "anonymous" && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setShowAuth(true)
                  }}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium text-accent transition hover:bg-surface-overlay focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  data-testid="signin-btn"
                >
                  <Icon icon={LogIn} size={15} className="text-accent" />
                  Sign in
                </button>
              )
            )}
          </div>
        )}

        {showAuth && <AuthModal auth={auth} onClose={() => setShowAuth(false)} />}
      </div>
    )
  }

  if (auth.state === "loading") {
    return <span className="text-xs text-gray-500">…</span>
  }

  if (auth.state === "anonymous") {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowAuth(true)}
          className="flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-accent px-3.5 text-sm font-medium text-surface-base transition active:scale-[0.97] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          data-testid="signin-btn"
        >
          Sign in
        </button>
        {showAuth && <AuthModal auth={auth} onClose={() => setShowAuth(false)} />}
      </>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-2 text-sm sm:gap-3">
      <button
        type="button"
        onClick={onShowHistory}
        className="shrink-0 whitespace-nowrap rounded text-gray-400 transition hover:text-white active:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        data-testid="history-btn"
      >
        History
      </button>
      <span className="hidden text-gray-500 sm:inline" data-testid="user-email">
        {auth.user?.email}
      </span>
      <button
        type="button"
        onClick={() => void auth.logout()}
        className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs text-gray-300 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        data-testid="logout-btn"
      >
        Log out
      </button>
    </div>
  )
}

export const UserMenu = memo(UserMenuInner)
