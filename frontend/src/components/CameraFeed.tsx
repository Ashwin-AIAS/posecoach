import { forwardRef } from "react"

interface CameraFeedProps {
  readonly error: string | null
  readonly ready: boolean
}

export const CameraFeed = forwardRef<HTMLVideoElement, CameraFeedProps>(
  function CameraFeed({ error, ready }, ref) {
    return (
      <div className="relative w-full h-full bg-black">
        <video
          ref={ref}
          className="w-full h-full object-cover"
          autoPlay
          playsInline
          muted
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300">
            <span>Starting camera…</span>
          </div>
        )}
        {error !== null && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-900 bg-opacity-90 text-white text-center p-4">
            <div>
              <p className="font-semibold">Camera unavailable</p>
              <p className="text-sm mt-2">{error}</p>
            </div>
          </div>
        )}
      </div>
    )
  },
)
