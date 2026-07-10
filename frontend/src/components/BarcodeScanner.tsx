import { memo, useEffect, useRef } from "react"
import type { IScannerControls } from "@zxing/browser"
import type { DecodeHintType as ZXingHintKey } from "@zxing/library"

interface BarcodeScannerProps {
  /** Called once per distinct decoded code with the digit string. */
  readonly onDecoded: (digits: string) => void
  /** Camera failed to start (permission denied, no device). */
  readonly onError?: (message: string) => void
}

/**
 * On-device barcode scanner (P27). Decoding happens entirely in the browser
 * via @zxing/browser — no frame ever leaves the phone; only the decoded digit
 * string is handed to `onDecoded`. The zxing modules are dynamic-imported so
 * they stay out of the main bundle until the user actually opens the scanner
 * (same lazy pattern as the reference-video panel). Manages its own camera
 * stream (back camera preferred), released on unmount and while the tab is
 * hidden. Deliberately independent of the frozen pose-camera hooks.
 */
function BarcodeScannerInner({ onDecoded, onError }: BarcodeScannerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Latest-callback refs so the effect never needs to restart the camera.
  const onDecodedRef = useRef(onDecoded)
  onDecodedRef.current = onDecoded
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let controls: IScannerControls | null = null
    let unmounted = false
    let starting = false
    let lastText = ""

    const stop = (): void => {
      controls?.stop()
      controls = null
    }

    const start = async (): Promise<void> => {
      if (unmounted || starting || controls !== null) return
      starting = true
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
          await Promise.all([import("@zxing/browser"), import("@zxing/library")])

        // Retail food barcodes only — fewer formats = faster, fewer misreads.
        const hints = new Map<ZXingHintKey, unknown>()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ])
        const reader = new BrowserMultiFormatReader(hints)

        const c = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          video,
          (result) => {
            if (!result) return // per-frame decode misses are expected noise
            const text = result.getText()
            if (text && text !== lastText) {
              lastText = text
              onDecodedRef.current(text)
            }
          },
        )
        if (unmounted || document.hidden) {
          c.stop()
        } else {
          controls = c
        }
      } catch (e) {
        onErrorRef.current?.((e as Error).message || "Camera unavailable")
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

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      className="h-full w-full object-cover"
      data-testid="barcode-video"
    />
  )
}

export const BarcodeScanner = memo(BarcodeScannerInner)
