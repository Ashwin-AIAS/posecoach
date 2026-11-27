import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Dumbbell, LogIn, Mic, MessageCircle, X } from "lucide-react"

import { useChat } from "../hooks/useChat"
import type { HistorySessionRow } from "../hooks/useHistorySessions"
import { useVoiceInput } from "../hooks/useVoiceInput"
import { formatExerciseName, getLastExercise, getWorstTrendingExercise } from "../lib/insights"
import type { Exercise } from "../types"
import { ChatMessage } from "./ChatMessage"
import { Icon } from "./ui/Icon"

interface ChatPanelProps {
  readonly exercise: Exercise
  /**
   * Live camera element used for "+ Frame" snapshots. Optional: the Coach AI
   * entry point on Home is text-only and never starts a camera session, so the
   * frame button is simply not offered there.
   */
  readonly videoRef?: React.RefObject<HTMLVideoElement> | null
  /** Render expanded straight away (the Coach AI sheet opens into the chat). */
  readonly startOpen?: boolean
  /** Suppress the panel's own header when the host already provides one. */
  readonly hideHeader?: boolean
  /** Optional history sessions for context-aware suggestion chips (P36 C4). */
  readonly sessions?: readonly HistorySessionRow[]
  /** Optional auth state for signed-out banner + memory chip (P36 C4/C5). */
  readonly authed?: boolean
  /** Optional sign-in deep link when signed out (P36 C5). */
  readonly onSignIn?: () => void
  /** Optional pre-filled question (e.g. from Home insight "Ask Coach", P36 C3). */
  readonly initialPrompt?: string | null
  /** Shows the "Coach knows your last 5 sessions" chip once C7 is live. */
  readonly memoryEnabled?: boolean
}

const SNAPSHOT_WIDTH = 480
const SNAPSHOT_HEIGHT = 360
const SNAPSHOT_QUALITY = 0.8

/** Fallback quick replies when no session history is available. */
const DEFAULT_SUGGESTIONS = ["How's my depth?", "Fix my back", "What muscles?"] as const

/** Pixels of slack from the bottom that still counts as "at the bottom". */
const NEAR_BOTTOM_PX = 48

function buildContextSuggestions(
  sessions?: readonly HistorySessionRow[],
): readonly string[] {
  if (!sessions || sessions.length === 0) return DEFAULT_SUGGESTIONS

  const chips: string[] = []
  const worst = getWorstTrendingExercise(sessions)
  const last = getLastExercise(sessions)

  if (worst) {
    chips.push(`Fix my ${formatExerciseName(worst).toLowerCase()} form`)
  }
  if (last && last !== worst) {
    chips.push(`Next target for ${formatExerciseName(last).toLowerCase()}?`)
  }
  for (const fallback of DEFAULT_SUGGESTIONS) {
    if (chips.length >= 3) break
    if (!chips.includes(fallback)) chips.push(fallback)
  }
  return chips.slice(0, 3)
}

function captureSnapshot(video: HTMLVideoElement | null): string | null {
  if (!video || video.readyState < 2) return null
  const canvas = document.createElement("canvas")
  canvas.width = SNAPSHOT_WIDTH
  canvas.height = SNAPSHOT_HEIGHT
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT)
  const dataUrl = canvas.toDataURL("image/jpeg", SNAPSHOT_QUALITY)
  return dataUrl.split(",", 2)[1] ?? null
}

function ChatPanelInner({
  exercise,
  videoRef,
  startOpen = false,
  hideHeader = false,
  sessions,
  authed,
  onSignIn,
  initialPrompt,
  memoryEnabled = false,
}: ChatPanelProps): JSX.Element {
  const [open, setOpen] = useState(startOpen)
  const [input, setInput] = useState(initialPrompt ?? "")
  const { messages, state, error, send, regenerate, setFeedback } = useChat()
  const voice = useVoiceInput()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Only auto-scroll on new content when the user was already near the bottom —
  // otherwise a long answer would yank them back down mid-read of older messages.
  const stickToBottomRef = useRef(true)

  const suggestions = useMemo(() => buildContextSuggestions(sessions), [sessions])

  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt)
    }
  }, [initialPrompt])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!stickToBottomRef.current || !el || typeof el.scrollTo !== "function") return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [messages])

  // Sync voice transcript → input field
  useEffect(() => {
    if (voice.transcript) {
      setInput(voice.transcript)
    }
  }, [voice.transcript])

  const submit = useCallback(
    async (withFrame: boolean) => {
      if (!input.trim() || state === "streaming" || state === "thinking") return
      voice.stop() // stop recording if active
      const frame = withFrame ? captureSnapshot(videoRef?.current ?? null) : null
      const query = input
      setInput("")
      await send({ query, exercise, frame })
    },
    [exercise, input, send, state, videoRef, voice],
  )

  const submitStarter = useCallback(
    async (prompt: string) => {
      setInput("")
      await send({ query: prompt, exercise })
    },
    [exercise, send],
  )

  const toggleVoice = useCallback(() => {
    if (voice.isListening) {
      voice.stop()
    } else {
      voice.start()
    }
  }, [voice])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center rounded-xl bg-surface-raised px-3 text-sm font-medium text-gray-200 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        data-testid="chat-open-btn"
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon icon={MessageCircle} size={16} />
          Ask the coach
        </span>
      </button>
    )
  }

  const isBusy = state === "streaming" || state === "thinking"

  return (
    <div
      className="flex max-h-[520px] min-h-[320px] flex-col gap-2 rounded-2xl bg-surface-raised/70 p-4 shadow-elev-2 backdrop-blur-md"
      data-testid="chat-panel"
    >
      {/* Header — omitted when the host (e.g. the Coach AI sheet) provides one */}
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft">
              <Icon icon={Dumbbell} size={13} className="text-accent" />
            </div>
            <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Coach</h2>
            {authed && memoryEnabled && (
              <span
                className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent"
                data-testid="coach-memory-chip"
              >
                Coach knows your last 5 sessions
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-gray-400 transition hover:bg-surface-overlay hover:text-white active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Collapse chat"
          >
            <Icon icon={X} size={16} />
          </button>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-3 overflow-y-auto pr-1"
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft">
              <Icon icon={Dumbbell} size={18} className="text-accent" />
            </div>
            <div className="text-center">
              <p className="font-display text-sm font-semibold text-gray-100">
                Hey, I&apos;m your AI coach
              </p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-gray-400">
                Ask anything about form, programming, or technique.
                {videoRef ? ' Tap "+ Frame" for visual analysis of your current pose.' : ""}
              </p>
            </div>

            {authed === false && (
              <div
                className="mt-1 flex w-full max-w-xs flex-col items-center rounded-2xl bg-surface-base/80 px-4 py-3 text-center shadow-elev-1"
                data-testid="coach-signed-out-empty"
              >
                <p className="text-xs text-gray-400">
                  Sign in so Coach AI remembers your recent sessions and tailors every answer.
                </p>
                {onSignIn && (
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="mt-3 flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-accent px-5 text-xs font-semibold text-surface-base transition ease-spring active:scale-[0.97] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    data-testid="coach-sign-in-btn"
                  >
                    <Icon icon={LogIn} size={14} />
                    Sign in
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {(() => {
          // ES2020-compatible: find the last assistant message index
          let lastAsstIdx = -1
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "assistant") { lastAsstIdx = i; break }
          }
          return messages.map((m, idx) => {
            const isLastAssistant = m.role === "assistant" && idx === lastAsstIdx
            return (
              <ChatMessage
                key={m.id}
                message={m}
                isLast={isLastAssistant}
                isStreaming={state === "streaming"}
                chatState={state}
                respondingToFrame={isLastAssistant && Boolean(messages[idx - 1]?.hasFrame)}
                onRegenerate={isLastAssistant && !isBusy ? () => void regenerate() : undefined}
                onFeedback={
                  m.role === "assistant"
                    ? (value) => setFeedback(m.id, value)
                    : undefined
                }
              />
            )
          })
        })()}
      </div>

      {/* Error display */}
      {error && <p className="text-xs text-score-bad">{error}</p>}
      {voice.error && <p className="text-xs text-score-bad">{voice.error}</p>}

      {/* Single de-duplicated, context-aware suggestion row (P36 C4) */}
      <div className="flex flex-wrap gap-1.5" data-testid="quick-replies">
        {suggestions.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => void submitStarter(prompt)}
            disabled={isBusy}
            className="min-h-11 rounded-full bg-surface-base px-3.5 text-xs text-gray-300 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="quick-reply-chip"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input bar */}
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void submit(false)
            }
          }}
          placeholder="Why are my knees caving in?"
          className="min-h-11 flex-1 rounded-full bg-surface-base px-4 text-sm text-white shadow-elev-1 outline-none placeholder:text-gray-600 focus:ring-2 focus:ring-accent"
          disabled={isBusy}
          data-testid="chat-input"
        />

        {/* Voice input button */}
        {voice.isSupported && (
          <button
            type="button"
            onClick={toggleVoice}
            disabled={isBusy}
            title={voice.isListening ? "Stop recording" : "Voice input"}
            aria-label={voice.isListening ? "Stop recording" : "Voice input"}
            className={
              "relative flex min-h-11 min-w-11 items-center justify-center rounded-full px-2.5 transition ease-spring disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
              (voice.isListening
                ? "bg-score-bad/15 text-score-bad"
                : "bg-surface-base text-gray-400 shadow-elev-1 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-accent")
            }
            data-testid="voice-btn"
          >
            <Icon icon={Mic} size={16} />
            {voice.isListening && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-score-bad/60" />
            )}
          </button>
        )}

        {/* Send button */}
        <button
          type="button"
          onClick={() => void submit(false)}
          disabled={isBusy || !input.trim()}
          className="flex min-h-11 items-center justify-center rounded-full bg-accent px-4 text-xs font-semibold text-surface-base transition active:scale-[0.97] hover:brightness-110 disabled:cursor-not-allowed disabled:bg-surface-overlay disabled:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        >
          Send
        </button>

        {/* Send with frame — only where there is a live camera to snapshot */}
        {videoRef && (
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={isBusy || !input.trim()}
            className="flex min-h-11 items-center justify-center rounded-full bg-surface-base px-3.5 text-xs font-medium text-accent shadow-elev-1 transition active:scale-[0.97] hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title="Send with a snapshot of the current frame"
            data-testid="chat-frame-btn"
          >
            + Frame
          </button>
        )}
      </div>
    </div>
  )
}

export const ChatPanel = memo(ChatPanelInner)
