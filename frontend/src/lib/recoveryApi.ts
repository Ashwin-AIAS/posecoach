/**
 * Account-recovery API client (P33).
 *
 * Three unauthenticated endpoints — forgot-password, forgot-username, and
 * reset-password. Reuses `apiJson` for consistent error handling; the backend
 * returns an enumeration-safe generic message for the forgot-* calls, so these
 * never reveal whether an account exists.
 */

import { apiJson } from "./api"

export interface GenericMessage {
  readonly message: string
}

/** Request a password-reset link. Always resolves (generic message) for any email. */
export async function requestPasswordReset(email: string): Promise<GenericMessage> {
  return apiJson<GenericMessage>("/api/v1/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

/** Request a username reminder. Always resolves (generic message) for any email. */
export async function requestUsername(email: string): Promise<GenericMessage> {
  return apiJson<GenericMessage>("/api/v1/auth/forgot-username", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

/**
 * Complete a password reset with the emailed token. Rejects (400) if the token
 * is missing, expired, or already used.
 */
export async function resetPassword(token: string, newPassword: string): Promise<GenericMessage> {
  return apiJson<GenericMessage>("/api/v1/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  })
}
