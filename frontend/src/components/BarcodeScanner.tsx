import { memo, useEffect, useRef, useState } from "react"
import { Flashlight, FlashlightOff } from "lucide-react"
import type { IScannerControls } from "@zxing/browser"
import type { DecodeHintType as ZXingHintKey } from "@zxing/library"

import { Icon } from "./ui/Icon"

interface BarcodeScannerProps {
  /** Called once per distinct decoded code with the digit string. */
  readonly onDecoded: (digits: string) => void
  /** Camera failed to start (permission denied, no device). */
  readonly onError?: (message: string) => void
}

// --- Minimal typings for not-yet-standard APIs ---------------------------------
// `BarcodeDetector` (Android/Chrome) and the focusMode/torch track constraints
// aren't in lib.dom yet; declared locally + cast so we stay off `any`.
interface DetectedBarcode {
  readonly rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats(): Promise<string[]>
}
interface AdvancedTrackConstraint {
  focusMode?: string
  torch?: boolean
}

/**
 * Hardened capture constraints (P34). iOS Safari otherwise supplies a low-res
 * stream where EAN/UPC bars are too few pixels to decode, so we ask for the
 * back camera at HD. `ideal` (not `exact`) keeps it a best-effort request that
 * still starts on cameras that can't hit 1080p.
 */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
}

/** Retail food barcodes only — fewer formats = faster, fewer misreads. */
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"]

/**
 * On-device barcode scanner (P27, hardened in P34). Decoding happens entirely in
 * the browser — no frame ever leaves the phone; only the decoded digit string is
 * handed to `onDecoded`. Two decode paths over one hardened `getUserMedia`
 * stream: the native `BarcodeDetector` (Android/Chrome — fast, reliable) when
 * present, otherwise @zxing/browser (iOS Safari, where `BarcodeDetector` does
 * not exist). Best-effort continuous autofocus and an optional torch toggle are
 * applied when the track supports them. Manages its own camera stream, released
 * on unmount and while the tab is hidden. Deliberately independent of the frozen
 * pose-camera hooks.
 */
function BarcodeScannerInner({ onDecoded, onError }: BarcodeScannerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Latest-callback refs so the effect never needs to restart the camera.
  const onDecodedRef = useRef(onDecoded)
  onDecodedRef.current = onDecoded
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let unmounted = false
    let starting = false
    let stream: MediaStream | null = null
    let zxingControls: IScannerControls | null = null
    let rvfcHandle = 0
    let lastText = ""

    const emit = (text: string): void => {
      if (text && text !== lastText) {
        lastText = text
        onDecodedRef.current(text)
      }
    }

    const stop = (): void => {
      if (rvfcHandle !== 0) {
        video.cancelVideoFrameCallback(rvfcHandle)
        rvfcHandle = 0
      }
      zxingControls?.stop()
      zxingControls = null
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      trackRef.current = null
      setTorchAvailable(false)
      setTorchOn(false)
    }

    const runNative = (Detector: BarcodeDetectorCtor): void => {
      const detector = new Detector({ formats: NATIVE_FORMATS })
      const scan = (): void => {
        if (unmounted || stream === null) return
        void detector
          .detect(video)
          .then((codes) => {
            for (const code of codes) {
              if (code.rawValue) {
                emit(code.rawValue)
                break
              }
            }
          })
          .catch(() => {
            /* transient per-frame detect miss — keep looping */
          })
          .finally(() => {
            if (!unmounted && stream !== null) {
              rvfcHandle = video.requestVideoFrameCallback(() => scan())
            }
          })
      }
      rvfcHandle = video.requestVideoFrameCallback(() => scan())
    }

    const runZxing = async (activeStream: MediaStream): Promise<void> => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ])
      const hints = new Map<ZXingHintKey, unknown>()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ])
      const reader = new BrowserMultiFormatReader(hints)
      const controls = await reader.decodeFromStream(activeStream, video, (result) => {
        if (!result) return // per-frame decode misses are expected noise
        emit(result.getText())
      })
      if (unmounted || document.hidden) controls.stop()
      else zxingControls = controls
    }

    const start = async (): Promise<void> => {
      if (unmounted || starting || stream !== null) return
      starting = true
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS })
        if (unmounted || document.hidden) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        video.srcObject = s
        // iOS needs an explicit play(); muted + playsInline are set on the element.
        await video.play().catch(() => {
          /* autoplay quirks — decode still works off the live track */
        })

        const track = s.getVideoTracks()[0] ?? null
        trackRef.current = track
        if (track) {
          // Best-effort continuous autofocus — unsupported constraints throw, ignore.
          try {
            await track.applyConstraints({
              advanced: [{ focusMode: "continuous" } as AdvancedTrackConstraint],
            } as MediaTrackConstraints)
          } catch {
            /* focusMode unsupported on this device — fine, keep going */
          }
          const caps = track.getCapabilities?.() as
            | (MediaTrackCapabilities & { torch?: boolean })
            | undefined
          if (caps?.torch === true && !unmounted) setTorchAvailable(true)
        }

        const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorCtor })
          .BarcodeDetector
        let supported: string[] = []
        if (Detector) {
          try {
            supported = await Detector.getSupportedFormats()
          } catch {
            supported = []
          }
        }
        if (Detector && supported.includes("ean_13")) {
          runNative(Detector)
        } else {
          await runZxing(s)
        }
      } catch (e) {
        onErrorRef.current?.((e as Error).message || "Camera unavailable")
        stop()
      } finally {
        starting = false
      }
    }
    void start()

    const onVisibility = (): void => {
      if (document.hidden) stop()
      else void start()
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      unmounted = true
      document.removeEventListener("visibilitychange", onVisibility)
      stop()
    }
  }, [])

  const toggleTorch = (): void => {
    const track = trackRef.current
    if (!track) return
    const next = !torchOn
    void track
      .applyConstraints({ advanced: [{ torch: next } as AdvancedTrackConstraint] } as MediaTrackConstraints)
      .then(() => setTorchOn(next))
      .catch(() => {
        /* torch toggle rejected — leave the state as-is */
      })
  }

  return (
    <>
      <video
        ref={videoRef}
        playsInline
        muted
        className="h-full w-full object-cover"
        data-testid="barcode-video"
      />
      {torchAvailable && (
        <button
          type="button"
          onClick={toggleTorch}
          aria-pressed={torchOn}
          aria-label={torchOn ? "Turn off torch" : "Turn on torch"}
          title="Torch"
          className={
            "absolute right-3 top-3 z-10 grid h-11 w-11 place-content-center rounded-full backdrop-blur-sm transition ease-spring active:scale-[0.94] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none " +
            (torchOn ? "bg-accent text-gray-950" : "bg-black/55 text-gray-200 hover:text-white")
          }
          data-testid="torch-toggle"
        >
          <Icon icon={torchOn ? FlashlightOff : Flashlight} size={18} />
        </button>
      )}
    </>
  )
}

export const BarcodeScanner = memo(BarcodeScannerInner)
