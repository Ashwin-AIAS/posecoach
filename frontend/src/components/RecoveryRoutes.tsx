import { ForgotPasswordPage } from "./ForgotPasswordPage"
import { ResetPasswordPage } from "./ResetPasswordPage"

/**
 * Minimal path dispatcher for the standalone account-recovery pages (P33).
 *
 * The app is deliberately router-less (state-based views in App.tsx), so the
 * two recovery pages — which must be reachable at real, shareable URLs (the
 * emailed reset link is `/reset-password?token=…`) — are matched here off
 * `window.location.pathname` at load. Returns `null` for any other path so the
 * normal `<App />` renders. Navigation to/from these pages is a full page load
 * (plain `<a href>`), which keeps the router-less design intact.
 */
export function getRecoveryRoute(pathname: string): JSX.Element | null {
  if (pathname === "/forgot-password") return <ForgotPasswordPage />
  if (pathname === "/reset-password") return <ResetPasswordPage />
  return null
}
