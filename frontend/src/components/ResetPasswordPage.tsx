import { useState } from "react"

import { friendlyMessage } from "../lib/api"
import { resetPassword } from "../lib/recoveryApi"
import {
  RECOVERY_BUTTON_CLASS,
  RECOVERY_INPUT_CLASS,
  RECOVERY_LINK_CLASS,
  RecoveryLayout,
} from "./RecoveryLayout"

/**
 * Standalone `/reset-password` page (P33). Reads `?token=` from the URL, takes
 * two new-password fields (with match + min-length validation), and on success
 * shows a confirmation with a link back to sign in. The token is single-use and
 * time-boxed server-side; a missing/expired/used token surfaces the backend's
 * generic rejection.
 */
const MIN_PASSWORD_LENGTH = 8

function tokenFromUrl(): string {
  if (typeof window === "undefined") return ""
  return new URLSearchParams(window.location.search).get("token") ?? ""
}

export function ResetPasswordPage(): JSX.Element {
  const [token] = useState(tokenFromUrl)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (token === "") {
    return (
      <RecoveryLayout title="Invalid reset link">
        <p className="text-sm text-gray-300" data-testid="reset-invalid">
          This link is missing its reset token. Request a new one to continue.
        </p>
        <a href="/forgot-password" className={`inline-block text-sm ${RECOVERY_LINK_CLASS}`}>
          Request a new link
        </a>
      </RecoveryLayout>
    )
  }

  if (done) {
    return (
      <RecoveryLayout title="Password updated">
        <p className="text-sm text-gray-300" data-testid="reset-success">
          Your password has been updated. You can now sign in with your new password.
        </p>
        <a href="/" className={RECOVERY_BUTTON_CLASS} data-testid="reset-go-signin">
          Go to sign in
        </a>
      </RecoveryLayout>
    )
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setSubmitting(true)
    try {
      await resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <RecoveryLayout title="Set a new password">
      <form onSubmit={submit} className="space-y-4" data-testid="reset-form">
        <label className="block">
          <span className="text-xs text-gray-400">New password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className={RECOVERY_INPUT_CLASS}
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400">Confirm new password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className={RECOVERY_INPUT_CLASS}
          />
        </label>

        {error !== null && (
          <p className="text-sm text-score-bad" data-testid="reset-error">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className={RECOVERY_BUTTON_CLASS}>
          {submitting ? "…" : "Update password"}
        </button>
      </form>

      <a href="/" className={`inline-block text-center text-xs ${RECOVERY_LINK_CLASS}`}>
        Back to sign in
      </a>
    </RecoveryLayout>
  )
}
