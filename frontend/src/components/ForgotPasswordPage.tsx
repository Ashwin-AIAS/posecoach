import { useState } from "react"

import { friendlyMessage } from "../lib/api"
import { requestPasswordReset, requestUsername } from "../lib/recoveryApi"
import {
  RECOVERY_BUTTON_CLASS,
  RECOVERY_INPUT_CLASS,
  RECOVERY_LINK_CLASS,
  RecoveryLayout,
} from "./RecoveryLayout"

/**
 * Standalone `/forgot-password` page (P33). One email field; on submit it shows
 * an enumeration-safe confirmation regardless of whether the account exists.
 * A toggle switches to the "forgot username?" reminder (same generic behavior).
 * `?mode=username` in the URL preselects the reminder variant.
 */
type Mode = "password" | "username"

function initialMode(): Mode {
  if (typeof window === "undefined") return "password"
  return new URLSearchParams(window.location.search).get("mode") === "username"
    ? "username"
    : "password"
}

export function ForgotPasswordPage(): JSX.Element {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isUsername = mode === "username"
  const title = isUsername ? "Forgot username" : "Forgot password"
  const confirmation = isUsername
    ? "If that email is registered, we've sent the username to it."
    : "If that email is registered, we've sent a reset link to it."

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (isUsername) await requestUsername(email)
      else await requestPasswordReset(email)
      setSubmitted(true)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <RecoveryLayout title="Check your email">
        <p className="text-sm text-gray-300" data-testid="forgot-confirmation">
          {confirmation}
        </p>
        <a href="/" className={`inline-block text-sm ${RECOVERY_LINK_CLASS}`}>
          Back to sign in
        </a>
      </RecoveryLayout>
    )
  }

  return (
    <RecoveryLayout title={title}>
      <p className="text-sm text-gray-400">
        {isUsername
          ? "Enter your account email and we'll send you your username."
          : "Enter your account email and we'll send you a link to reset your password."}
      </p>
      <form onSubmit={submit} className="space-y-4" data-testid="forgot-form">
        <label className="block">
          <span className="text-xs text-gray-400">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className={RECOVERY_INPUT_CLASS}
          />
        </label>

        {error !== null && <p className="text-sm text-score-bad">{error}</p>}

        <button type="submit" disabled={submitting} className={RECOVERY_BUTTON_CLASS}>
          {submitting ? "…" : isUsername ? "Send username" : "Send reset link"}
        </button>
      </form>

      <div className="flex flex-col gap-1 text-center text-xs text-gray-400">
        <button
          type="button"
          onClick={() => {
            setMode(isUsername ? "password" : "username")
            setError(null)
          }}
          className={RECOVERY_LINK_CLASS}
        >
          {isUsername ? "Forgot your password instead?" : "Forgot your username instead?"}
        </button>
        <a href="/" className={RECOVERY_LINK_CLASS}>
          Back to sign in
        </a>
      </div>
    </RecoveryLayout>
  )
}
