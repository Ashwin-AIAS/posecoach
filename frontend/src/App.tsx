import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, RefreshCw, Volume2, VolumeX } from "lucide-react"

import { CameraFeed } from "./components/CameraFeed"
import { CameraHud } from "./components/CameraHud"
import { ChatPanel } from "./components/ChatPanel"
import { CoachingCues } from "./components/CoachingCues"
import { EmptyStageHint } from "./components/EmptyStageHint"
import { ExerciseSelector } from "./components/ExerciseSelector"
import { HistoryPanel } from "./components/HistoryPanel"
import { Home } from "./components/Home"
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
      className="hud-numerals hidden shrink-0 items-center gap-1.5 rounded-full bg-surface-raised/70 px-2.5 py-1 text-[11px] font-medium text-gray-300 shadow-elev-1 sm:inline-flex"
      title="Live inference latency (target < 100ms)"
      data-testid="latency-badge"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {ms === null ? "— ms" : `${Math.round(ms)} ms`}
    </span>
  )
})

export default function App(): JSX.Element {
  // Home is the entry hub (UI-07); the live workout flow is unchanged — it's
  // just one tap away, and back again via the header's back button.
  const [view, setView] = useState<"home" | "live">("home")
  const [exercise, setExercise] = useState<Exercise>("squat")
  const [mode, setMode] = useState<SessionMode>("exercise")
  const [division, setDivision] = useState<Division>("open")
  const [poseName, setPoseName] = useState<PoseName>("front_double_biceps")

  // Switching division resets the pose to that division's first mandatory.
  const selectDivision = useCallback((next: Division): void => {
    setDivision(next)
    setPoseName(DIVISIONS[next].mandatories[0])
  }, [])
  const [mobileTab, setMobileTab] = useState<"cues" | "chat">("cues")
  const [showHistory, setShowHistory] = useState(false)
  const [showPrep, setShowPrep] = useState(false)
  const [howTo, setHowTo] = useState<Exercise | null>(null)
  const [summary, setSummary] = useState<SessionStats | null>(null)
  const [voice, setVoice] = useState(false)
  const auth = useAuth()
  const camera = useCamera({ width: 640, height: 480, facingMode: "user" })
  const cameraStart = camera.start
  const cameraStop = camera.stop

  // Camera only runs on the live screen — Home never touches the webcam.
  useEffect(() => {
    if (view === "live") {
      void cameraStart()
    } else {
      cameraStop()
    }
  }, [view, cameraStart, cameraStop])

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
    <div className="flex h-[100svh] min-h-[100svh] w-screen flex-col bg-surface-base font-sans text-gray-100">
      <header
        className="relative z-30 flex items-center justify-between gap-2 bg-surface-raised/40 px-3 py-1 shadow-elev-1 backdrop-blur-md sm:gap-4 sm:px-4"
        style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
      >
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          {view === "live" && (
            <button
              type="button"
              onClick={() => setView("home")}
              aria-label="Back to home"
              title="Back to home"
              className="grid h-11 w-11 shrink-0 place-content-center rounded-full text-gray-400 transition hover:bg-surface-overlay hover:text-white active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="back-home-btn"
            >
              <Icon icon={ChevronLeft} size={18} />
            </button>
          )}
          <h1 className="shrink-0 whitespace-nowrap font-display text-lg font-semibold tracking-tight">
            Pose<span className="text-accent">Coach</span>
          </h1>
          {view === "live" && <LatencyBadge ms={pose.result?.latency_ms ?? null} />}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {view === "live" && (
            <>
              {isSpeechSupported() && (
                <button
                  type="button"
                  onClick={() => setVoice((v) => !v)}
                  aria-pressed={voice}
                  aria-label={voice ? "Turn off voice cues" : "Turn on voice cues"}
                  title="Voice coaching cues"
                  className={
                    "grid h-11 w-11 shrink-0 place-content-center rounded-full transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                    (voice
                      ? "bg-accent-soft text-accent shadow-glow-sm"
                      : "bg-surface-raised text-gray-400 shadow-elev-1 hover:text-white")
                  }
                  data-testid="voice-toggle"
                >
                  <Icon icon={voice ? Volume2 : VolumeX} size={16} />
                </button>
              )}
            </>
          )}
          <UserMenu auth={auth} onShowHistory={() => setShowHistory(true)} />
        </div>
      </header>

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

      {view === "home" ? (
        <Home
          user={auth.user}
          lastExercise={exercise}
          onStart={() => setView("live")}
          onShowHistory={() => setShowHistory(true)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 animate-fade-in flex-col">
          <div className="relative z-20 flex min-w-0 items-start gap-x-2 bg-surface-base/60 px-4 py-0.5 shadow-elev-1">
            <ModeToggle value={mode} onChange={setMode} />
            {posing ? (
              <PoseSelector
                value={poseName}
                onChange={setPoseName}
                poses={DIVISIONS[division].mandatories}
                extra={<DivisionSelector value={division} onChange={selectDivision} />}
              />
            ) : (
              <ExerciseSelector value={exercise} onChange={setExercise} onShowHowTo={setHowTo} />
            )}
          </div>

          {!posing && <RecommendationCard exercise={exercise} />}

          <main className="grid flex-1 grid-cols-1 grid-rows-[minmax(180px,1fr)_auto] gap-2 overflow-hidden p-2 lg:gap-4 lg:p-4 lg:grid-cols-[1fr_360px] lg:grid-rows-1">
        <div className="relative flex items-center justify-center overflow-hidden rounded-2xl bg-black shadow-elev-3">
          <CameraFeed
            ref={camera.videoRef}
            error={camera.error}
            ready={camera.ready}
            switching={camera.switching}
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
          <button
            type="button"
            onClick={() => void camera.flip()}
            disabled={!camera.ready}
            aria-label={
              camera.facingMode === "user" ? "Switch to back camera" : "Switch to front camera"
            }
            title="Flip camera (front / back)"
            className="absolute bottom-3 right-3 z-20 grid h-11 w-11 shrink-0 place-content-center rounded-full bg-black/55 text-gray-200 shadow-elev-1 backdrop-blur-sm transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white disabled:translate-y-0 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="flip-camera"
          >
            <Icon icon={RefreshCw} size={16} />
          </button>
          {/* Score detector overlaid on the camera stage on mobile (P21) — keeps
              it directly on the camera instead of pushing the stage down, so the
              camera's own box still owns the bulk of the viewport (≥70% rule).
              Desktop keeps the non-overlaid version in the aside below. */}
          {posing && (
            <div className="absolute bottom-3 left-3 right-16 z-10 lg:hidden">
              <PosingPanel result={pose.result} pose={poseName} compact />
            </div>
          )}
        </div>

        {/* In posing mode the score detector already lives above (pinned to the
            camera); demote this tray to a thin, scrollable strip on mobile so
            it never eats the camera's share of the viewport (P21's ≥70% rule). */}
        <aside
          className={
            "flex min-h-0 flex-col gap-2 lg:gap-4 lg:overflow-y-auto " +
            (posing ? "max-h-12 overflow-y-auto lg:max-h-none" : "overflow-hidden")
          }
        >
          {/* Mobile-only tab switcher — on >=lg both panels below are always shown. */}
          <div role="tablist" aria-label="Panels" className="flex shrink-0 gap-1.5 lg:hidden">
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "cues"}
              onClick={() => setMobileTab("cues")}
              className={
                "flex min-h-11 flex-1 items-center justify-center rounded-full px-3 text-xs font-medium transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                (mobileTab === "cues"
                  ? "bg-accent-soft text-accent"
                  : "bg-surface-raised text-gray-400 shadow-elev-1")
              }
              data-testid="mobile-tab-cues"
            >
              Coaching
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileTab === "chat"}
              onClick={() => setMobileTab("chat")}
              className={
                "flex min-h-11 flex-1 items-center justify-center rounded-full px-3 text-xs font-medium transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                (mobileTab === "chat"
                  ? "bg-accent-soft text-accent"
                  : "bg-surface-raised text-gray-400 shadow-elev-1")
              }
              data-testid="mobile-tab-chat"
            >
              Chat
            </button>
          </div>

          <div
            className={
              (mobileTab === "cues" ? "flex" : "hidden") +
              " min-h-0 flex-col gap-4 overflow-y-auto lg:flex"
            }
          >
            {posing && (
              <div className="hidden lg:block">
                <PosingPanel result={pose.result} pose={poseName} />
              </div>
            )}
            <CoachingCues
              result={pose.result}
              connectionState={pose.connectionState}
              error={pose.error}
            />
            {!posing && <ReferenceVideoPanel exercise={exercise} />}
          </div>

          <div className={(mobileTab === "chat" ? "flex" : "hidden") + " min-h-0 flex-col lg:flex"}>
            <ChatPanel exercise={exercise} videoRef={camera.videoRef} />
          </div>
        </aside>
      </main>

      {/* Thumb-reachable action bar — anchored at the bottom of the viewport so
          Record/Finish (the controls used mid-set) never require a reach on phones. */}
      <div
        className="relative z-20 flex shrink-0 items-center justify-center gap-2 bg-surface-raised/60 px-4 py-1 shadow-elev-1 backdrop-blur-md"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        {posing && (
          <button
            type="button"
            onClick={() => setShowPrep(true)}
            title="Contest-prep progress — symmetry & hold trends over your prep"
            className="flex min-h-11 items-center justify-center rounded-full bg-surface-raised px-3.5 text-xs font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              "flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:translate-y-0 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
              (recorder.recording
                ? "border border-score-bad/60 bg-score-bad/15 text-score-bad"
                : "bg-surface-raised text-gray-200 shadow-elev-1 hover:text-white")
            }
            data-testid="record-btn"
          >
            <span
              className={
                "h-2 w-2 rounded-full bg-score-bad " + (recorder.recording ? "animate-pulse-dot" : "")
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
          className="flex min-h-11 items-center justify-center rounded-full bg-accent px-4 text-xs font-semibold text-surface-base shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:brightness-110 disabled:translate-y-0 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="finish-set-btn"
        >
          Finish set
        </button>
      </div>
        </div>
      )}
    </div>
  )
}
