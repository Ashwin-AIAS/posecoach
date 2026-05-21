import { memo, useState } from "react"

import type { useAuth } from "../hooks/useAuth"

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

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-gray-900 text-white p-6 rounded-lg shadow-xl w-full max-w-sm space-y-4"
        data-testid="auth-modal"
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">
            {mode === "login" ? "Sign in" : "Create account"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white text-sm"
            aria-label="Close"
          >
            ✕
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
            className="w-full mt-1 bg-gray-800 px-3 py-2 rounded outline-none focus:ring-1 focus:ring-blue-500"
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
            className="w-full mt-1 bg-gray-800 px-3 py-2 rounded outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        {localError && <p className="text-red-400 text-sm">{localError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 py-2 rounded font-medium"
        >
          {submitting ? "…" : mode === "login" ? "Sign in" : "Register"}
        </button>

        <p className="text-xs text-gray-400 text-center">
          {mode === "login" ? "No account?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-blue-400 hover:text-blue-300 underline"
          >
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  )
}

export const AuthModal = memo(AuthModalInner)
