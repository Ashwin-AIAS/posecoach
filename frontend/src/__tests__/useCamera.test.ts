import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useCamera } from "../hooks/useCamera"

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>
}

function makeStream(): { stream: MediaStream; track: FakeTrack } {
  const track: FakeTrack = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  return { stream, track }
}

let getUserMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  getUserMedia = vi.fn(async () => makeStream().stream)
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useCamera flip", () => {
  it("starts with the requested front camera", async () => {
    const { result } = renderHook(() => useCamera({ facingMode: "user" }))
    await act(async () => {
      await result.current.start()
    })
    expect(getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ facingMode: "user" }) }),
    )
    expect(result.current.facingMode).toBe("user")
  })

  it("flip() stops the old stream and requests the back camera", async () => {
    const first = makeStream()
    getUserMedia.mockResolvedValueOnce(first.stream)

    const { result } = renderHook(() => useCamera({ facingMode: "user" }))
    await act(async () => {
      await result.current.start()
    })

    await act(async () => {
      await result.current.flip()
    })

    // Old stream's track was stopped before re-acquiring.
    expect(first.track.stop).toHaveBeenCalledTimes(1)
    // New acquisition targeted the environment (back) camera.
    expect(getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ facingMode: "environment" }) }),
    )
    await waitFor(() => expect(result.current.facingMode).toBe("environment"))
  })

  it("falls back to the previous mode when the requested camera is unavailable", async () => {
    getUserMedia.mockResolvedValueOnce(makeStream().stream) // initial start succeeds
    const { result } = renderHook(() => useCamera({ facingMode: "user" }))
    await act(async () => {
      await result.current.start()
    })

    getUserMedia.mockRejectedValueOnce(new Error("OverconstrainedError")) // flip request fails
    getUserMedia.mockResolvedValueOnce(makeStream().stream) // fallback start succeeds
    await act(async () => {
      await result.current.flip()
    })

    await waitFor(() => expect(result.current.facingMode).toBe("user"))
  })
})
