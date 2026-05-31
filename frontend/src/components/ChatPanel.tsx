import { memo, useCallback, useEffect, useRef, useState } from "react"

import { useChat } from "../hooks/useChat"
import type { Exercise } from "../types"

interface ChatPanelProps {
  readonly exercise: Exercise
  readonly videoRef: React.RefObject<HTMLVideoElement>
}

const SNAPSHOT_WIDTH = 480
const SNAPSHOT_HEIGHT = 360
const SNAPSHOT_QUALITY = 0.8

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
  const { messages, state, error, send } = useChat()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  const submit = useCallback(
    async (withFrame: boolean) => {
      if (!input.trim() || state === "streaming") return
      const frame = withFrame ? captureSnapshot(videoRef.current) : null
      const query = input
      setInput("")
      await send({ query, exercise, frame })
    },
    [exercise, input, send, state, videoRef],
  )

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-surface-hairline bg-surface-raised px-3 py-2.5 text-sm font-medium text-gray-200 shadow-card transition hover:border-accent/50 hover:text-white"
        data-testid="chat-open-btn"
      >
        💬 Ask the coach
      </button>
    )
  }

  return (
    <div
      className="flex max-h-[480px] min-h-[280px] flex-col gap-2 rounded-2xl border border-surface-hairline bg-surface-raised/70 p-4 shadow-card backdrop-blur-md"
      data-testid="chat-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Coach</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-xs text-gray-400 hover:bg-surface-overlay hover:text-white"
          aria-label="Collapse chat"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto pr-1" data-testid="chat-messages">
        {messages.length === 0 && (
          <p className="text-xs leading-relaxed text-gray-500">
            Ask anything about form, programming, or technique. Tap “+ Frame” to get visual analysis of
            your current pose.
          </p>
        )}
        {messages.map((m) => {
          const isUser = m.role === "user"
          const streaming = m.role === "assistant" && state === "streaming" && !m.text
          return (
            <div key={m.id} className={isUser ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm " +
                  (isUser
                    ? "rounded-br-sm bg-accent-soft text-white"
                    : "rounded-bl-sm whitespace-pre-wrap bg-surface-overlay text-gray-100")
                }
              >
                {isUser && m.hasFrame && (
                  <span className="mr-1.5 align-middle text-[10px] font-medium uppercase tracking-wide text-accent">
                    [frame]
                  </span>
                )}
                {streaming ? (
                  <span className="inline-flex gap-1 py-1" aria-label="Coach is typing">
                    <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-gray-400" />
                    <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-gray-400 [animation-delay:0.2s]" />
                    <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-gray-400 [animation-delay:0.4s]" />
                  </span>
                ) : (
                  m.text
                )}
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="text-xs text-score-bad">{error}</p>}

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
          className="flex-1 rounded-lg border border-surface-hairline bg-surface-base px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-accent"
          disabled={state === "streaming"}
          data-testid="chat-input"
        />
        <button
          type="button"
          onClick={() => void submit(false)}
          disabled={state === "streaming" || !input.trim()}
          className="rounded-lg bg-accent px-3 text-xs font-medium text-surface-base transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-surface-hairline disabled:text-gray-500"
        >
          Send
        </button>
        <button
          type="button"
          onClick={() => void submit(true)}
          disabled={state === "streaming" || !input.trim()}
          className="rounded-lg border border-accent/40 px-3 text-xs font-medium text-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:border-surface-hairline disabled:text-gray-600"
          title="Send with a snapshot of the current frame"
        >
          + Frame
        </button>
      </div>
    </div>
  )
}

export const ChatPanel = memo(ChatPanelInner)
