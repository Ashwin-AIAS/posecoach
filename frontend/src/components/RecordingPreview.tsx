import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Download, Share2, X } from "lucide-react"

import type { RecordedSession } from "../hooks/useSessionRecorder"
import { canShareFiles, downloadFile, shareFile } from "../hooks/useSessionRecorder"
import { Icon } from "./ui/Icon"

interface RecordingPreviewProps {
  readonly session: RecordedSession
  readonly onClose: () => void
}

/**
 * Full-screen modal overlay for in-app playback of a recorded session.
 *
 * - `<video controls playsInline>` for iOS Safari compatibility
 * - Share button (Web Share API) on mobile, Download button on desktop
 * - Object URL is revoked on unmount and whenever the session changes
 */
function RecordingPreviewInner({ session, onClose }: RecordingPreviewProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const shareSupported = canShareFiles()

  // Create object URL from blob; revoke on unmount or session change
  useEffect(() => {
    const url = URL.createObjectURL(session.blob)
    setVideoUrl(url)
    return () => {
      URL.revokeObjectURL(url)
      setVideoUrl(null)
    }
  }, [session.blob])

  const handleShare = useCallback(async () => {
    setSharing(true)
    try {
      const file = new File([session.blob], session.fileName, { type: session.mimeType })
      await shareFile(file)
    } finally {
      setSharing(false)
    }
  }, [session])

  const handleDownload = useCallback(() => {
    const file = new File([session.blob], session.fileName, { type: session.mimeType })
    downloadFile(file)
  }, [session])

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      data-testid="recording-preview"
    >
      <div className="mx-4 flex w-full max-w-lg flex-col gap-3 rounded-2xl bg-surface-raised p-4 shadow-elev-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Session recording</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-sm text-gray-400 transition hover:bg-surface-overlay hover:text-white active:scale-90"
            aria-label="Close preview"
            data-testid="preview-close-btn"
          >
            <Icon icon={X} size={18} />
          </button>
        </div>

        {/* Video player */}
        <div className="relative overflow-hidden rounded-xl bg-black">
          {videoUrl !== null && (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
              className="w-full"
              data-testid="preview-video"
            >
              <track kind="captions" />
            </video>
          )}
        </div>

        {/* File info */}
        <p className="text-center text-[11px] text-gray-500">
          {session.fileName} · {(session.blob.size / (1024 * 1024)).toFixed(1)} MB
        </p>

        {/* Action buttons */}
        <div className="flex gap-2">
          {shareSupported && (
            <button
              type="button"
              onClick={() => void handleShare()}
              disabled={sharing}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-surface-base transition active:scale-[0.97] hover:brightness-110 disabled:opacity-50"
              data-testid="share-btn"
            >
              <Icon icon={Share2} size={16} />
              {sharing ? "Sharing…" : "Share"}
            </button>
          )}
          <button
            type="button"
            onClick={handleDownload}
            className={
              "flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white " +
              (shareSupported ? "flex-1" : "w-full")
            }
            data-testid="download-btn"
          >
            <Icon icon={Download} size={16} />
            Download
          </button>
        </div>

        {/* Dismiss hint */}
        <p className="text-center text-[10px] text-gray-600">
          Press Escape or close to dismiss
        </p>
      </div>
    </div>
  )
}

export const RecordingPreview = memo(RecordingPreviewInner)
