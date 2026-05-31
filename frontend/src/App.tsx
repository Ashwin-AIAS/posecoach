import { memo, useEffect, useState } from "react"

import { CameraFeed } from "./components/CameraFeed"
import { CameraHud } from "./components/CameraHud"
import { ChatPanel } from "./components/ChatPanel"
import { CoachingCues } from "./components/CoachingCues"
import { ExerciseSelector } from "./components/ExerciseSelector"
import { HistoryPanel } from "./components/HistoryPanel"
import { HowToDrawer } from "./components/HowToDrawer"
import { InstallBanner } from "./components/InstallBanner"
import { PoseOverlay } from "./components/PoseOverlay"
import { UserMenu } from "./components/UserMenu"
import { useAuth } from "./hooks/useAuth"
import { useCamera } from "./hooks/useCamera"
import { usePoseStream } from "./hooks/usePoseStream"
import type { Exercise } from "./types"

const LATENCY_BUDGET_MS = 100

/** Live inference-latency badge — proves the <100ms thesis metric on screen. */
const LatencyBadge = memo(function LatencyBadge({ ms }: { ms: number | null }): JSX.Element {
  const within = ms !== null && ms < LATENCY_BUDGET_MS
  const dot = ms === null ? "bg-gray-600" : within ? "bg-score-good" : "bg-score-mid"
  return (
    <span
      className="hud-numerals inline-flex items-center gap-1.5 rounded-full border border-surface-hairline bg-surface-raised/70 px-2.5 py-1 text-[11px] font-medium text-gray-300"
      title="Live inference latency (target < 100ms)"
      data-testid="latency-badge"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {ms === null ? "— ms" : `${Math.round(ms)} ms`}
    </span>
  )
})

export default function App(): JSX.Element {
  const [exercise, setExercise] = useState<Exercise>("squat")
  const [showHistory, setShowHistory] = useState(false)
  const [howTo, setHowTo] = useState<Exercise | null>(null)
  const auth = useAuth()
  const camera = useCamera({ width: 640, height: 480, facingMode: "user" })

  useEffect(() => {
    void camera.start()
    // start() is stable; intentionally empty deps to run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pose = usePoseStream({
    videoRef: camera.videoRef,
    exercise,
    active: camera.ready,
  })

  return (
    <div className="flex h-screen w-screen flex-col bg-surface-base font-sans text-gray-100">
      <header className="flex items-center justify-between gap-4 border-b border-surface-hairline bg-surface-raised/40 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg font-semibold tracking-tight">
            Pose<span className="text-accent">Coach</span>
          </h1>
          <LatencyBadge ms={pose.result?.latency_ms ?? null} />
        </div>
        <UserMenu auth={auth} onShowHistory={() => setShowHistory(true)} />
      </header>

      <div className="relative z-20 border-b border-surface-hairline bg-surface-base/60 px-4 py-2">
        <ExerciseSelector value={exercise} onChange={setExercise} onShowHowTo={setHowTo} />
      </div>

      {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}
      <HowToDrawer exercise={howTo} onClose={() => setHowTo(null)} />
      <InstallBanner />

      <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_360px]">
        <div className="relative flex items-center justify-center overflow-hidden rounded-2xl border border-surface-hairline bg-black shadow-card">
          <CameraFeed ref={camera.videoRef} error={camera.error} ready={camera.ready} />
          <PoseOverlay result={pose.result} />
          <CameraHud
            result={pose.result}
            active={camera.ready}
            exercise={exercise}
            onShowHowTo={setHowTo}
          />
        </div>

        <aside className="flex flex-col gap-4 overflow-y-auto">
          <CoachingCues
            result={pose.result}
            connectionState={pose.connectionState}
            error={pose.error}
          />
          <ChatPanel exercise={exercise} videoRef={camera.videoRef} />
        </aside>
      </main>
    </div>
  )
}
