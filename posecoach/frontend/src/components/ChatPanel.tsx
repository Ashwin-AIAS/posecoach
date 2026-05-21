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
        className="bg-blue-600 hover:bg-blue-500 text-white text-sm py-2 px-3 rounded-lg shadow"
        data-testid="chat-open-btn"
      >
        Ask the coach
      </button>
    )
  }

  return (
    <div
      className="bg-gray-900 bg-opacity-90 text-white p-4 rounded-lg shadow-lg flex flex-col gap-2 min-h-[280px] max-h-[480px]"
      data-testid="chat-panel"
    >
      <div className="flex justify-between items-center">
        <h2 className="text-sm uppercase tracking-wide text-gray-400">Coach</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-400 hover:text-white"
          aria-label="Collapse chat"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 pr-1" data-testid="chat-messages">
        {messages.length === 0 && (
          <p className="text-xs text-gray-500">
            Ask anything about form, programming, or technique. Tap "with frame" to get visual analysis.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "bg-blue-900 bg-opacity-40 text-sm p-2 rounded ml-6"
                : "bg-gray-800 text-sm p-2 rounded mr-6 whitespace-pre-wrap"
            }
          >
            {m.role === "user" && m.hasFrame && (
              <span className="text-[10px] uppercase text-blue-300 mr-2">[frame]</span>
            )}
            {m.text || (m.role === "assistant" && state === "streaming" ? "…" : "")}
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 items-stretch">
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
          className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded outline-none focus:ring-1 focus:ring-blue-500"
          disabled={state === "streaming"}
          data-testid="chat-input"
        />
        <button
          type="button"
          onClick={() => void submit(false)}
          disabled={state === "streaming" || !input.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-xs px-3 rounded"
        >
          Send
        </button>
        <button
          type="button"
          onClick={() => void submit(true)}
          disabled={state === "streaming" || !input.trim()}
          className="bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-xs px-3 rounded"
          title="Send with a snapshot of the current frame"
        >
          + Frame
        </button>
      </div>
    </div>
  )
}

export const ChatPanel = memo(ChatPanelInner)
