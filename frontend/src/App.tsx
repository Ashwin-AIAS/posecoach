import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshCw, Volume2, VolumeX } from "lucide-react"

import { CameraFeed } from "./components/CameraFeed"
import { CameraHud } from "./components/CameraHud"
import { ChatPanel } from "./components/ChatPanel"
import { CoachingCues } from "./components/CoachingCues"
import { EmptyStageHint } from "./components/EmptyStageHint"
import { ExerciseSelector } from "./components/ExerciseSelector"
import { HistoryPanel } from "./components/HistoryPanel"
import { HowToDrawer } from "./components/HowToDrawer"
import { DivisionSelector } from "./components/DivisionSelector"
import { InstallBanner } from "./components/InstallBanner"
import { ModeToggle } from "./components/ModeToggle"
import { PoseOverlay } from "./components/PoseOverlay"
import { PoseSelector } from "./components/PoseSelector"
import { PosingPanel } from "./components/PosingPanel"
import { PrepProgressPanel } from "./components/PrepProgressPanel"
import { RecommendationCard } from "./components/RecommendationCard"
import { RecordingPreview } from "./components/RecordingPreview"
import { ReferenceVideoPanel } from "./components/ReferenceVideoPanel"
import { SessionSummary } from "./components/SessionSummary"
import { UserMenu } from "./components/UserMenu"
import { Icon } from "./components/ui/Icon"
import { useAuth } from "./hooks/useAuth"
import { useCamera } from "./hooks/useCamera"
import { useCueVoice, isSpeechSupported } from "./hooks/useCueVoice"
import { usePoseStream } from "./hooks/usePoseStream"
import { useSessionRecorder } from "./hooks/useSessionRecorder"
import { useSessionStats } from "./hooks/useSessionStats"
import type { SessionStats } from "./hooks/useSessionStats"
import type { HudScene } from "./lib/hudRenderer"
import { renderHud } from "./lib/hudRenderer"
import { worstJoint } from "./lib/joints"
import { DIVISIONS } from "./lib/poses"
import type { Division, Exercise, PoseName, SessionMode } from "./types"

const LATENCY_BUDGET_MS = 100

/** Live inference-latency badge — proves the <100ms thesis metric on screen. */
const LatencyBadge = memo(function LatencyBadge({ ms }: { ms: number | null }): JSX.Element {
  const within = ms !== null && ms < LATENCY_BUDGET_MS
  const dot = ms === null ? "bg-gray-600" : within ? "bg-score-good" : "bg-score-mid"
  return (
    <span
      className="hud-numerals inline-flex items-center gap-1.5 rounded-full bg-surface-raised/70 px-2.5 py-1 text-[11px] font-medium text-gray-300 shadow-elev-1"
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
  const [mode, setMode] = useState<SessionMode>("exercise")
  const [division, setDivision] = useState<Division>("open")
  const [poseName, setPoseName] = useState<PoseName>("front_double_biceps")

  // Switching division resets the pose to that division's first mandatory.
  const selectDivision = useCallback((next: Division): void => {
    setDivision(next)
    setPoseName(DIVISIONS[next].mandatories[0])
  }, [])
  const [showHistory, setShowHistory] = useState(false)
  const [showPrep, setShowPrep] = useState(false)
  const [howTo, setHowTo] = useState<Exercise | null>(null)
  const [summary, setSummary] = useState<SessionStats | null>(null)
  const [voice, setVoice] = useState(false)
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
    mode,
    pose: poseName,
  })

  const posing = mode === "posing"

  const stats = useSessionStats(pose.result)
  const topCue = pose.result?.cues?.[0]
  useCueVoice(topCue, voice)

  // Lowest-scoring joint — only set when overall form is poor (no nagging on good reps).
  const worst = useMemo(
    () => worstJoint(pose.result?.joint_scores, pose.result?.score ?? null),
    [pose.result],
  )

  // --- Session recording (on-device only) ---------------------------------
  // Handle to the live pose-overlay canvas, plus the latest HUD inputs, both
  // read by the recorder's per-frame compositor (never trigger a re-render).
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const hudSceneRef = useRef<HudScene>({ result: null, exercise, worst: null, scale: 1 })
  hudSceneRef.current = { result: pose.result, exercise, worst, scale: 1 }

  const drawHud = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
      // Map on-screen px → recording px so chips land where the user saw them.
      const displayH = camera.videoRef.current?.clientHeight ?? 0
      const scale = displayH > 0 ? h / displayH : h / 480
      renderHud(ctx, w, h, { ...hudSceneRef.current, scale })
    },
    [camera.videoRef],
  )

  const recorder = useSessionRecorder({
    videoRef: camera.videoRef,
    overlayCanvas: () => overlayCanvasRef.current,
    drawHud,
    mirrored: camera.facingMode === "user",
    exercise,
  })

  // Never leave a dangling recorder when the camera releases (tab hidden / stop).
  const recorderStop = recorder.stop
  useEffect(() => {
    if (!camera.ready) recorderStop()
  }, [camera.ready, recorderStop])

  const detected = pose.result !== null && pose.result.score !== null
  const showHint = camera.ready && !detected && summary === null

  // A new exercise, pose, or mode is a new set — reset the accumulated stats.
  useEffect(() => {
    stats.reset()
  }, [exercise, mode, poseName, stats])

  const finishSet = (): void => {
    recorder.stop() // never leave a recording running past the end of a set
    setSummary(stats.snapshot())
    camera.stop()
  }

  const mmss = (ms: number): string => {
    const total = Math.floor(ms / 1000)
    const mm = Math.floor(total / 60)
    const ss = total % 60
    return `${mm}:${String(ss).padStart(2, "0")}`
  }

  const closeSummary = (): void => {
    setSummary(null)
    stats.reset()
    void camera.start()
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-surface-base font-sans text-gray-100">
      <header className="relative z-30 flex items-center justify-between gap-4 bg-surface-raised/40 px-4 py-3 shadow-elev-1 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-lg font-semibold tracking-tight">
            Pose<span className="text-accent">Coach</span>
          </h1>
          <LatencyBadge ms={pose.result?.latency_ms ?? null} />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void camera.flip()}
            disabled={!camera.ready}
            aria-label={
              camera.facingMode === "user" ? "Switch to back camera" : "Switch to front camera"
            }
            title="Flip camera (front / back)"
            className="rounded-full bg-surface-raised px-2.5 py-1 text-sm text-gray-400 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:text-white disabled:translate-y-0 disabled:opacity-40"
            data-testid="flip-camera"
          >
            <Icon icon={RefreshCw} size={16} />
          </button>
          {isSpeechSupported() && (
            <button
              type="button"
              onClick={() => setVoice((v) => !v)}
              aria-pressed={voice}
              aria-label={voice ? "Turn off voice cues" : "Turn on voice cues"}
              title="Voice coaching cues"
              className={
                "rounded-full px-2.5 py-1 text-sm transition ease-spring hover:-translate-y-0.5 " +
                (voice
                  ? "bg-accent-soft text-accent shadow-glow-sm"
                  : "bg-surface-raised text-gray-400 shadow-elev-1 hover:text-white")
              }
              data-testid="voice-toggle"
            >
              <Icon icon={voice ? Volume2 : VolumeX} size={16} />
            </button>
          )}
          <UserMenu auth={auth} onShowHistory={() => setShowHistory(true)} />
        </div>
      </header>

      <div className="relative z-20 flex items-center justify-between gap-3 bg-surface-base/60 px-4 py-2 shadow-elev-1">
        <div className="flex min-w-0 items-center gap-3">
          <ModeToggle value={mode} onChange={setMode} />
          {posing ? (
            <>
              <DivisionSelector value={division} onChange={selectDivision} />
              <PoseSelector
                value={poseName}
                onChange={setPoseName}
                poses={DIVISIONS[division].mandatories}
              />
            </>
          ) : (
            <ExerciseSelector value={exercise} onChange={setExercise} onShowHowTo={setHowTo} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {posing && (
            <button
              type="button"
              onClick={() => setShowPrep(true)}
              title="Contest-prep progress — symmetry & hold trends over your prep"
              className="rounded-full bg-surface-raised px-3.5 py-1.5 text-xs font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:text-white"
              data-testid="prep-btn"
            >
              Prep
            </button>
          )}
          {recorder.supported && (
            <button
              type="button"
              onClick={() => (recorder.recording ? recorder.stop() : recorder.start())}
              disabled={!camera.ready}
              aria-pressed={recorder.recording}
              aria-label={recorder.recording ? "Stop recording" : "Record session"}
              title="Record this set (saved on your device only)"
              className={
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ease-spring hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40 " +
                (recorder.recording
                  ? "border border-score-bad/60 bg-score-bad/15 text-score-bad"
                  : "bg-surface-raised text-gray-200 shadow-elev-1 hover:text-white")
              }
              data-testid="record-btn"
            >
              <span
                className={
                  "h-2 w-2 rounded-full bg-score-bad " +
                  (recorder.recording ? "animate-pulse-dot" : "")
                }
                aria-hidden="true"
              />
              {recorder.recording ? "Stop" : "Record"}
            </button>
          )}
          <button
            type="button"
            onClick={finishSet}
            disabled={!camera.ready}
            className="rounded-full bg-surface-raised px-3.5 py-1.5 text-xs font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 hover:text-white disabled:translate-y-0 disabled:opacity-40"
            data-testid="finish-set-btn"
          >
            Finish set
          </button>
        </div>
      </div>

      {!posing && <RecommendationCard exercise={exercise} />}

      {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}
      {showPrep && <PrepProgressPanel onClose={() => setShowPrep(false)} />}
      <HowToDrawer exercise={howTo} onClose={() => setHowTo(null)} />
      {summary !== null && (
        <SessionSummary exercise={exercise} stats={summary} onClose={closeSummary} />
      )}
      {recorder.lastRecording !== null && (
        <RecordingPreview session={recorder.lastRecording} onClose={recorder.clearRecording} />
      )}
      <InstallBanner />

      <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_360px]">
        <div className="relative flex items-center justify-center overflow-hidden rounded-2xl bg-black shadow-elev-3">
          <CameraFeed
            ref={camera.videoRef}
            error={camera.error}
            ready={camera.ready}
            mirrored={camera.facingMode === "user"}
          />
          <PoseOverlay
            result={pose.result}
            mirrored={camera.facingMode === "user"}
            worst={worst}
            onCanvasReady={(c) => {
              overlayCanvasRef.current = c
            }}
          />
          <CameraHud
            result={pose.result}
            active={camera.ready}
            exercise={exercise}
            onShowHowTo={setHowTo}
            worst={worst}
          />
          {/* Live REC indicator — chrome only, deliberately NOT drawn into the
              capture (it lives in the DOM, not in drawHud). */}
          {recorder.recording && (
            <div
              className="pointer-events-none absolute left-3 top-16 z-20 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 backdrop-blur-sm"
              data-testid="rec-indicator"
            >
              <span className="h-2 w-2 animate-pulse-dot rounded-full bg-score-bad" aria-hidden="true" />
              <span className="hud-numerals text-[11px] font-semibold tracking-wide text-score-bad">
                REC {mmss(recorder.elapsedMs)}
              </span>
            </div>
          )}
          {showHint && <EmptyStageHint exercise={exercise} />}
        </div>

        <aside className="flex flex-col gap-4 overflow-y-auto">
          {posing && <PosingPanel result={pose.result} pose={poseName} />}
          <CoachingCues
            result={pose.result}
            connectionState={pose.connectionState}
            error={pose.error}
          />
          {!posing && <ReferenceVideoPanel exercise={exercise} />}
          <ChatPanel exercise={exercise} videoRef={camera.videoRef} />
        </aside>
      </main>
    </div>
  )
}
