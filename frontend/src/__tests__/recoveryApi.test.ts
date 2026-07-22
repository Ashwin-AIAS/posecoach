import { afterEach, describe, expect, it, vi } from "vitest"

import { requestPasswordReset, requestUsername, resetPassword } from "../lib/recoveryApi"

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("requestPasswordReset", () => {
  it("POSTs the email to forgot-password and returns the generic message", async () => {
    const fn = mockFetch(200, { message: "If that email is registered…" })
    const result = await requestPasswordReset("a@x.com")
    expect(result.message).toContain("registered")
    const [url, init] = fn.mock.calls[0] ?? []
    expect(String(url)).toContain("/api/v1/auth/forgot-password")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ email: "a@x.com" })
  })
})

describe("requestUsername", () => {
  it("POSTs the email to forgot-username", async () => {
    const fn = mockFetch(200, { message: "ok" })
    await requestUsername("b@x.com")
    expect(String(fn.mock.calls[0]?.[0])).toContain("/api/v1/auth/forgot-username")
    expect(JSON.parse(String(fn.mock.calls[0]?.[1]?.body))).toEqual({ email: "b@x.com" })
  })
})

describe("resetPassword", () => {
  it("POSTs token + new_password (snake_case) to reset-password", async () => {
    const fn = mockFetch(200, { message: "updated" })
    await resetPassword("tok123", "newpassword2")
    const [url, init] = fn.mock.calls[0] ?? []
    expect(String(url)).toContain("/api/v1/auth/reset-password")
    expect(JSON.parse(String(init?.body))).toEqual({
      token: "tok123",
      new_password: "newpassword2",
    })
  })

  it("rejects with the backend detail on a 400 (bad/expired token)", async () => {
    mockFetch(400, { detail: "This reset link is invalid or has expired." })
    await expect(resetPassword("bad", "newpassword2")).rejects.toThrow(/invalid or has expired/)
  })
})
