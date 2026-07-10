import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Capture the decode callback and expose spy-able controls.
const stopSpy = vi.fn()
let decodeCallback: ((result: { getText(): string } | undefined) => void) | null = null
const decodeFromConstraints = vi.fn(
  async (
    _constraints: unknown,
    _video: unknown,
    cb: (result: { getText(): string } | undefined) => void,
  ) => {
    decodeCallback = cb
    return { stop: stopSpy }
  },
)

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints = decodeFromConstraints
  },
}))

import { BarcodeScanner } from "../components/BarcodeScanner"

/** Wait out the dynamic zxing import + camera-start promise chain. */
async function scannerStarted(): Promise<void> {
  await vi.waitFor(() => expect(decodeFromConstraints).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 0)) // let controls assignment settle
}

beforeEach(() => {
  vi.clearAllMocks()
  decodeCallback = null
})

describe("BarcodeScanner", () => {
  it("starts decoding with the back camera and reports decodes once per code", async () => {
    const onDecoded = vi.fn()
    render(<BarcodeScanner onDecoded={onDecoded} />)
    await scannerStarted()

    expect(decodeFromConstraints).toHaveBeenCalledTimes(1)
    const constraints = decodeFromConstraints.mock.calls[0]?.[0] as {
      video: { facingMode: string }
    }
    expect(constraints.video.facingMode).toBe("environment")

    decodeCallback?.({ getText: () => "3017620422003" })
    decodeCallback?.({ getText: () => "3017620422003" }) // same frame twice — deduped
    expect(onDecoded).toHaveBeenCalledTimes(1)
    expect(onDecoded).toHaveBeenCalledWith("3017620422003")

    decodeCallback?.(undefined) // per-frame miss — ignored
    expect(onDecoded).toHaveBeenCalledTimes(1)
  })

  it("releases the camera on unmount", async () => {
    const { unmount } = render(<BarcodeScanner onDecoded={vi.fn()} />)
    await scannerStarted()
    unmount()
    expect(stopSpy).toHaveBeenCalled()
  })

  it("surfaces camera failures through onError", async () => {
    decodeFromConstraints.mockRejectedValueOnce(new Error("Permission denied"))
    const onError = vi.fn()
    render(<BarcodeScanner onDecoded={vi.fn()} onError={onError} />)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Permission denied"))
  })

  it("renders an inline muted video (iOS Safari requirements)", async () => {
    const { getByTestId } = render(<BarcodeScanner onDecoded={vi.fn()} />)
    const video = getByTestId("barcode-video") as HTMLVideoElement
    expect(video).toHaveAttribute("playsinline")
    expect(video.muted).toBe(true)
    await scannerStarted()
  })
})
