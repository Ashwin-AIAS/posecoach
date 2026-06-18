import { memo, useState } from "react"

import type { useAuth } from "../hooks/useAuth"
import { AuthModal } from "./AuthModal"

type AuthHook = ReturnType<typeof useAuth>

interface UserMenuProps {
  readonly auth: AuthHook
  readonly onShowHistory: () => void
}

function UserMenuInner({ auth, onShowHistory }: UserMenuProps): JSX.Element {
  const [showAuth, setShowAuth] = useState(false)

  if (auth.state === "loading") {
    return <span className="text-xs text-gray-500">…</span>
  }

  if (auth.state === "anonymous") {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowAuth(true)}
          className="flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-accent px-3.5 text-sm font-medium text-surface-base transition active:scale-[0.97] hover:brightness-110"
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
        className="shrink-0 whitespace-nowrap text-gray-400 transition hover:text-white active:opacity-60"
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
        className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs text-gray-300 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white"
        data-testid="logout-btn"
      >
        Log out
      </button>
    </div>
  )
}

export const UserMenu = memo(UserMenuInner)
