import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Dumbbell, Mic, MessageCircle, X } from "lucide-react"

import { useChat } from "../hooks/useChat"
import { useVoiceInput } from "../hooks/useVoiceInput"
import type { Exercise } from "../types"
import { ChatMessage } from "./ChatMessage"
import { Icon } from "./ui/Icon"

interface ChatPanelProps {
  readonly exercise: Exercise
  readonly videoRef: React.RefObject<HTMLVideoElement>
}

const SNAPSHOT_WIDTH = 480
const SNAPSHOT_HEIGHT = 360
const SNAPSHOT_QUALITY = 0.8

const STARTER_PROMPTS = [
  "How deep should I squat?",
  "Why do my knees cave in?",
  "What's the ideal bench grip width?",
  "Help me fix butt wink",
]

/** Always-available quick replies for common questions, shown above the input bar. */
const QUICK_REPLIES = ["How's my depth?", "Fix my back", "What muscles?"]

/** Pixels of slack from the bottom that still counts as "at the bottom". */
const NEAR_BOTTOM_PX = 48

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

function ChatPanelInner({ exercise, videoRef }: ChatPanelProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const { messages, state, error, send, regenerate, setFeedback } = useChat()
  const voice = useVoiceInput()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Only auto-scroll on new content when the user was already near the bottom —
  // otherwise a long answer would yank them back down mid-read of older messages.
  const stickToBottomRef = useRef(true)

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
      const frame = withFrame ? captureSnapshot(videoRef.current) : null
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft">
            <Icon icon={Dumbbell} size={13} className="text-accent" />
          </div>
          <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Coach</h2>
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

      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-3 overflow-y-auto pr-1"
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-4">
            {/* Welcome message */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent-soft/50">
              <Icon icon={Dumbbell} size={18} className="text-accent" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-200">
                Hey! I'm your AI coach 💪
              </p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                Ask me anything about form, programming, or technique.
                Tap "+ Frame" for visual analysis of your current pose.
              </p>
            </div>

            {/* Starter prompts */}
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void submitStarter(prompt)}
                  className="rounded-full bg-surface-base px-3 py-1.5 text-[11px] text-gray-400 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {prompt}
                </button>
              ))}
            </div>
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

      {/* Quick-reply chips — always available, not just on the empty-state welcome */}
      <div className="flex flex-wrap gap-1.5" data-testid="quick-replies">
        {QUICK_REPLIES.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => void submitStarter(prompt)}
            disabled={isBusy}
            className="rounded-full bg-surface-base px-3 py-1 text-[11px] text-gray-400 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          className="min-h-11 flex-1 rounded-lg border border-surface-hairline bg-surface-base px-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-accent"
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
              "relative flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 transition ease-spring disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
              (voice.isListening
                ? "border border-score-bad/60 bg-score-bad/15 text-score-bad"
                : "text-gray-400 shadow-elev-1 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-accent")
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
          className="flex min-h-11 items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-surface-base transition active:scale-[0.97] hover:brightness-110 disabled:cursor-not-allowed disabled:bg-surface-hairline disabled:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        >
          Send
        </button>

        {/* Send with frame */}
        <button
          type="button"
          onClick={() => void submit(true)}
          disabled={isBusy || !input.trim()}
          className="flex min-h-11 items-center justify-center rounded-lg border border-accent/40 px-3 text-xs font-medium text-accent transition active:scale-[0.97] hover:bg-accent-soft disabled:cursor-not-allowed disabled:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title="Send with a snapshot of the current frame"
        >
          + Frame
        </button>
      </div>
    </div>
  )
}

export const ChatPanel = memo(ChatPanelInner)
