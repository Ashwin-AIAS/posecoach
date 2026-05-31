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
          className="rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-surface-base transition hover:brightness-110"
          data-testid="signin-btn"
        >
          Sign in
        </button>
        {showAuth && <AuthModal auth={auth} onClose={() => setShowAuth(false)} />}
      </>
    )
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        type="button"
        onClick={onShowHistory}
        className="text-gray-400 transition hover:text-white"
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
        className="rounded-full border border-surface-hairline px-2.5 py-1 text-xs text-gray-300 transition hover:border-accent/50 hover:text-white"
        data-testid="logout-btn"
      >
        Log out
      </button>
    </div>
  )
}

export const UserMenu = memo(UserMenuInner)
