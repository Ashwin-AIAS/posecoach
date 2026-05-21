import { useEffect, useState } from "react"

import { CameraFeed } from "./components/CameraFeed"
import { ChatPanel } from "./components/ChatPanel"
import { CoachingCues } from "./components/CoachingCues"
import { ExerciseSelector } from "./components/ExerciseSelector"
import { HistoryPanel } from "./components/HistoryPanel"
import { PoseOverlay } from "./components/PoseOverlay"
import { UserMenu } from "./components/UserMenu"
import { useAuth } from "./hooks/useAuth"
import { useCamera } from "./hooks/useCamera"
import { usePoseStream } from "./hooks/usePoseStream"
import type { Exercise } from "./types"

export default function App(): JSX.Element {
  const [exercise, setExercise] = useState<Exercise>("squat")
  const [showHistory, setShowHistory] = useState(false)
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
    <div className="h-screen w-screen flex flex-col bg-gray-900 text-gray-100">
      <header className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">PoseCoach</h1>
        <div className="flex items-center gap-4">
          <ExerciseSelector value={exercise} onChange={setExercise} />
          <UserMenu auth={auth} onShowHistory={() => setShowHistory(true)} />
        </div>
      </header>

      {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 p-4 overflow-hidden">
        <div className="relative rounded-lg overflow-hidden bg-black flex items-center justify-center">
          <CameraFeed ref={camera.videoRef} error={camera.error} ready={camera.ready} />
          <PoseOverlay result={pose.result} />
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
