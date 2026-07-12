import { afterEach, describe, expect, it, vi } from "vitest"

import { apiJson, friendlyMessage, isNetworkError, UnauthenticatedError } from "../lib/api"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("UnauthenticatedError", () => {
  it("is an Error subclass so untouched .message call sites keep working", () => {
    const e = new UnauthenticatedError("Sign in required")
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(UnauthenticatedError)
    expect(e.message).toBe("Sign in required")
    expect(e.name).toBe("UnauthenticatedError")
  })

  it("defaults to a sensible message", () => {
    expect(new UnauthenticatedError().message).toBe("Sign in required")
  })
})

describe("isNetworkError", () => {
  it("is true for a fetch-style TypeError", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true)
  })

  it("is false for a plain Error or a non-error value", () => {
    expect(isNetworkError(new Error("Request failed (500)"))).toBe(false)
    expect(isNetworkError("not an error")).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })
})

describe("friendlyMessage", () => {
  it("gives an offline-specific message for a network error", () => {
    expect(friendlyMessage(new TypeError("Failed to fetch"))).toMatch(/offline/i)
  })

  it("passes through an Error's own message otherwise", () => {
    expect(friendlyMessage(new UnauthenticatedError("Sign in required"))).toBe("Sign in required")
    expect(friendlyMessage(new Error("food not found"))).toBe("food not found")
  })

  it("falls back to a generic message for a non-Error throw", () => {
    expect(friendlyMessage("boom")).toBe("Something went wrong.")
  })
})

describe("apiJson 401 handling", () => {
  it("throws UnauthenticatedError (not a plain Error) when a 401 survives the refresh attempt", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/v1/auth/refresh")) {
        return new Response(null, { status: 401 })
      }
      return new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(apiJson("/api/v1/workouts/workouts")).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(apiJson("/api/v1/workouts/workouts")).rejects.toThrow("Not authenticated")
  })

  it("throws a plain Error (not UnauthenticatedError) for a non-401 failure", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "boom" }), { status: 500 }))
    vi.stubGlobal("fetch", fetchMock)

    const err = await apiJson("/api/v1/workouts/workouts").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(UnauthenticatedError)
  })
})
