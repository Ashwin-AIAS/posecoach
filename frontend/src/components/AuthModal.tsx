import { memo, useState } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

import type { useAuth } from "../hooks/useAuth"
import { Icon } from "./ui/Icon"

type AuthHook = ReturnType<typeof useAuth>

interface AuthModalProps {
  readonly auth: AuthHook
  readonly onClose: () => void
}

type Mode = "login" | "register"

function AuthModalInner({ auth, onClose }: AuthModalProps): JSX.Element {
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSubmitting(true)
    setLocalError(null)
    try {
      if (mode === "login") await auth.login(email, password)
      else await auth.register(email, password)
      onClose()
    } catch (err) {
      setLocalError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-sm animate-scale-in space-y-4 rounded-2xl bg-surface-raised p-6 text-white shadow-elev-3"
        data-testid="auth-modal"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">
            {mode === "login" ? "Sign in" : "Create account"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-sm text-gray-400 transition hover:bg-surface-overlay hover:text-white active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close"
          >
            <Icon icon={X} size={18} />
          </button>
        </div>

        <label className="block">
          <span className="text-xs text-gray-400">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-surface-hairline bg-surface-base px-3 py-2 outline-none focus:border-accent"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 8 : 1}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="mt-1 w-full rounded-lg border border-surface-hairline bg-surface-base px-3 py-2 outline-none focus:border-accent"
          />
        </label>

        {localError && <p className="text-sm text-score-bad">{localError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-accent py-2 font-medium text-surface-base transition active:scale-[0.97] hover:brightness-110 disabled:bg-surface-hairline disabled:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        >
          {submitting ? "…" : mode === "login" ? "Sign in" : "Register"}
        </button>

        {/* P33: recovery links — only on the login view. Plain anchors: they do a
            full page load to the standalone recovery pages (router-less app). */}
        {mode === "login" && (
          <div className="flex items-center justify-between text-xs">
            <a
              href="/forgot-password"
              className="rounded text-accent underline transition hover:brightness-110 active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="forgot-password-link"
            >
              Forgot password?
            </a>
            <a
              href="/forgot-password?mode=username"
              className="rounded text-gray-400 underline transition hover:text-white active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="forgot-username-link"
            >
              Forgot username?
            </a>
          </div>
        )}

        <p className="text-center text-xs text-gray-400">
          {mode === "login" ? "No account?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="rounded text-accent underline transition hover:brightness-110 active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </form>
    </div>,
    document.body,
  )
}

export const AuthModal = memo(AuthModalInner)
