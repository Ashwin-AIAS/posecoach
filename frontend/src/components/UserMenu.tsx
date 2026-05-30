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
          className="text-sm bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded"
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
        className="text-gray-300 hover:text-white"
        data-testid="history-btn"
      >
        History
      </button>
      <span className="text-gray-400" data-testid="user-email">
        {auth.user?.email}
      </span>
      <button
        type="button"
        onClick={() => void auth.logout()}
        className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
        data-testid="logout-btn"
      >
        Log out
      </button>
    </div>
  )
}

export const UserMenu = memo(UserMenuInner)
