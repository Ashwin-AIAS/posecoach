import { fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// --- zxing fallback mock: capture the decode callback + expose stop() ----------
const stopSpy = vi.fn()
let decodeCallback: ((result: { getText(): string } | undefined) => void) | null = null
const decodeFromStream = vi.fn(
  async (
    _stream: unknown,
    _video: unknown,
    cb: (result: { getText(): string } | undefined) => void,
  ) => {
    decodeCallback = cb
    return { stop: stopSpy }
  },
)

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromStream = decodeFromStream
  },
}))

import { BarcodeScanner } from "../components/BarcodeScanner"

// --- Fake camera stream / track ------------------------------------------------
function makeTrack(caps: { torch?: boolean } = {}): {
  track: MediaStreamTrack
  applyConstraints: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
} {
  const applyConstraints = vi.fn(async () => undefined)
  const stop = vi.fn()
  const track = {
    stop,
    applyConstraints,
    getCapabilities: () => caps,
  } as unknown as MediaStreamTrack
  return { track, applyConstraints, stop }
}

function makeStream(track: MediaStreamTrack): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
}

let getUserMedia: ReturnType<typeof vi.fn>
// Native BarcodeDetector: latest rVFC callback captured so the test drives frames.
let rvfcCb: (() => void) | null = null

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  decodeCallback = null
  rvfcCb = null

  getUserMedia = vi.fn(async () => makeStream(makeTrack().track))
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
    writable: true,
  })

  // jsdom leaves these unimplemented — stub so the component can drive frames.
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined)
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    set() {
      /* accept the assignment */
    },
    get() {
      return null
    },
  })
  HTMLVideoElement.prototype.requestVideoFrameCallback = vi.fn((cb) => {
    rvfcCb = () => cb(0, {} as VideoFrameCallbackMetadata)
    return 1
  })
  HTMLVideoElement.prototype.cancelVideoFrameCallback = vi.fn()
})

afterEach(() => {
  delete (window as Window & { BarcodeDetector?: unknown }).BarcodeDetector
})

/** Wait out the getUserMedia + focus/detector setup promise chain. */
async function started(): Promise<void> {
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled())
  await flush()
}

describe("BarcodeScanner — hardened capture (P34)", () => {
  it("requests the back camera at HD (hardened constraints)", async () => {
    render(<BarcodeScanner onDecoded={vi.fn()} />)
    await started()
    const constraints = getUserMedia.mock.calls[0]?.[0] as {
      video: { facingMode: { ideal: string }; width: { ideal: number }; height: { ideal: number } }
    }
    expect(constraints.video.facingMode.ideal).toBe("environment")
    expect(constraints.video.width.ideal).toBe(1920)
    expect(constraints.video.height.ideal).toBe(1080)
  })

  it("surfaces camera failures through onError", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("Permission denied"))
    const onError = vi.fn()
    render(<BarcodeScanner onDecoded={vi.fn()} onError={onError} />)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Permission denied"))
  })

  it("swallows a focusMode applyConstraints rejection and still decodes", async () => {
    const { track, applyConstraints } = makeTrack()
    applyConstraints.mockRejectedValueOnce(new Error("OverconstrainedError")) // focus attempt
    getUserMedia.mockResolvedValueOnce(makeStream(track))
    const onDecoded = vi.fn()

    render(<BarcodeScanner onDecoded={onDecoded} />)
    await started()

    // Focus was attempted (and rejected) — the component didn't crash.
    expect(applyConstraints).toHaveBeenCalled()
    // zxing fallback still wired up and decoding.
    await vi.waitFor(() => expect(decodeFromStream).toHaveBeenCalled())
    decodeCallback?.({ getText: () => "3017620422003" })
    expect(onDecoded).toHaveBeenCalledWith("3017620422003")
  })

  it("renders an inline muted video (iOS Safari requirements)", async () => {
    const { getByTestId } = render(<BarcodeScanner onDecoded={vi.fn()} />)
    const video = getByTestId("barcode-video") as HTMLVideoElement
    expect(video).toHaveAttribute("playsinline")
    expect(video.muted).toBe(true)
    await started()
  })
})

describe("BarcodeScanner — native BarcodeDetector path", () => {
  class FakeDetector {
    static getSupportedFormats = vi.fn(async () => ["ean_13", "ean_8", "upc_a", "upc_e"])
    detect = vi.fn(async () => [{ rawValue: "5901234123457" }])
  }

  beforeEach(() => {
    ;(window as Window & { BarcodeDetector?: unknown }).BarcodeDetector = FakeDetector
  })

  it("uses BarcodeDetector when supported and reports decodes once per code", async () => {
    const onDecoded = vi.fn()
    render(<BarcodeScanner onDecoded={onDecoded} />)
    await started()

    // Native path chosen — zxing never imported.
    expect(decodeFromStream).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(rvfcCb).not.toBeNull())

    rvfcCb?.() // drive one video frame → detect() resolves a code
    await vi.waitFor(() => expect(onDecoded).toHaveBeenCalledWith("5901234123457"))

    rvfcCb?.() // same code next frame — deduped
    await flush()
    expect(onDecoded).toHaveBeenCalledTimes(1)
  })
})

describe("BarcodeScanner — lifecycle & torch", () => {
  it("releases the camera track on unmount", async () => {
    const { track, stop } = makeTrack()
    getUserMedia.mockResolvedValueOnce(makeStream(track))
    const { unmount } = render(<BarcodeScanner onDecoded={vi.fn()} />)
    await started()
    unmount()
    expect(stop).toHaveBeenCalled()
  })

  it("shows a torch toggle only when the track advertises torch, and applies it", async () => {
    const { track, applyConstraints } = makeTrack({ torch: true })
    getUserMedia.mockResolvedValueOnce(makeStream(track))
    const { getByTestId, queryByTestId } = render(<BarcodeScanner onDecoded={vi.fn()} />)
    await started()

    const toggle = await vi.waitFor(() => getByTestId("torch-toggle"))
    fireEvent.click(toggle)
    await vi.waitFor(() =>
      expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] }),
    )
    expect(queryByTestId("torch-toggle")).toBeInTheDocument()
  })

  it("hides the torch toggle when the track has no torch capability", async () => {
    const { queryByTestId } = render(<BarcodeScanner onDecoded={vi.fn()} />)
    await started()
    expect(queryByTestId("torch-toggle")).not.toBeInTheDocument()
  })
})
