import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useCueVoice } from "../hooks/useCueVoice"

class FakeUtterance {
  rate = 1
  lang = ""
  constructor(public text: string) {}
}

const speak = vi.fn()
const cancel = vi.fn()

beforeEach(() => {
  speak.mockReset()
  cancel.mockReset()
  vi.stubGlobal("speechSynthesis", { speak, cancel })
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance)
  // jsdom window also needs the property for the `"speechSynthesis" in window` guard.
  Object.defineProperty(window, "speechSynthesis", { value: { speak, cancel }, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useCueVoice", () => {
  it("does not speak when disabled", () => {
    renderHook(({ cue, on }) => useCueVoice(cue, on), {
      initialProps: { cue: "Keep chest up", on: false },
    })
    expect(speak).not.toHaveBeenCalled()
  })

  it("speaks the cue when enabled and only re-speaks when it changes", () => {
    const { rerender } = renderHook(({ cue, on }) => useCueVoice(cue, on), {
      initialProps: { cue: "Keep chest up", on: true },
    })
    expect(speak).toHaveBeenCalledTimes(1)

    rerender({ cue: "Keep chest up", on: true }) // same cue → no repeat
    expect(speak).toHaveBeenCalledTimes(1)

    rerender({ cue: "Drive knees out", on: true }) // new cue → speaks
    expect(speak).toHaveBeenCalledTimes(2)
  })

  it("cancels speech when toggled off", () => {
    const { rerender } = renderHook(({ cue, on }) => useCueVoice(cue, on), {
      initialProps: { cue: "Keep chest up", on: true },
    })
    rerender({ cue: "Keep chest up", on: false })
    expect(cancel).toHaveBeenCalled()
  })
})
