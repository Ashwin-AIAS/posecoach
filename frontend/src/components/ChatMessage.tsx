import { memo, useCallback, useMemo, useState } from "react"
import { Camera, Check, Copy, RefreshCw, ThumbsDown, ThumbsUp, Volume2, VolumeX } from "lucide-react"

import type { ChatMessage as ChatMessageType, ChatState } from "../hooks/useChat"
import { Icon } from "./ui/Icon"

interface ChatMessageProps {
  readonly message: ChatMessageType
  readonly isLast: boolean
  readonly isStreaming: boolean
  readonly chatState: ChatState
  /** True when this is the pending assistant reply to a query sent with a frame. */
  readonly respondingToFrame?: boolean
  readonly onRegenerate?: () => void
  readonly onFeedback?: (value: "up" | "down" | null) => void
  readonly onFollowUp?: (question: string) => void
}

/** Message ids are minted as `${Date.now()}-${rand}` — recover a display time without touching useChat. */
function timeFromId(id: string): string {
  const ms = Number(id.split("-")[0])
  if (!Number.isFinite(ms)) return ""
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

// ---------------------------------------------------------------------------
// Lightweight markdown renderer (no external deps)
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): JSX.Element {
  // Split sources into a separate block
  const sourceSplit = text.split(/\n\nSources:\n/i)
  const body = sourceSplit[0]
  const sourcesRaw = sourceSplit.length > 1 ? sourceSplit[1] : null

  const lines = body.split("\n")
  const elements: JSX.Element[] = []
  let listItems: string[] = []
  let key = 0

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} className="my-1.5 ml-4 list-disc space-y-0.5 text-gray-200">
          {listItems.map((item, i) => (
            <li key={i}>{inlineMarkdown(item)}</li>
          ))}
        </ul>,
      )
      listItems = []
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Bullet list items
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ") || trimmed.startsWith("* ")) {
      listItems.push(trimmed.slice(2))
      continue
    }

    // Numbered list items
    const numberedMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    if (numberedMatch) {
      listItems.push(numberedMatch[1])
      continue
    }

    flushList()

    // Empty line → spacer
    if (trimmed === "") {
      elements.push(<div key={key++} className="h-1.5" />)
      continue
    }

    // Blockquote (used for follow-up suggestions: > 💡 **Want to go deeper?** ...)
    if (trimmed.startsWith(">")) {
      const content = trimmed.replace(/^>\s*/, "")
      elements.push(
        <div
          key={key++}
          className="my-2 rounded-lg border-l-2 border-accent/50 bg-accent-soft/10 px-3 py-2 text-[13px] text-gray-200"
        >
          {inlineMarkdown(content)}
        </div>,
      )
      continue
    }

    // Regular paragraph
    elements.push(
      <p key={key++} className="leading-relaxed text-gray-100">
        {inlineMarkdown(trimmed)}
      </p>,
    )
  }
  flushList()

  return (
    <>
      {elements}
      {sourcesRaw && <SourcesSection raw={sourcesRaw} />}
    </>
  )
}

/** Inline markdown: **bold**, *italic*, `code` */
function inlineMarkdown(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  // Combined regex for bold, italic, and code
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      // Bold
      parts.push(
        <strong key={key++} className="font-semibold text-white">
          {match[2]}
        </strong>,
      )
    } else if (match[4]) {
      // Italic
      parts.push(
        <em key={key++} className="italic text-gray-300">
          {match[4]}
        </em>,
      )
    } else if (match[6]) {
      // Inline code
      parts.push(
        <code
          key={key++}
          className="rounded bg-surface-overlay px-1 py-0.5 font-mono text-[12px] text-accent"
        >
          {match[6]}
        </code>,
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length > 0 ? parts : [text]
}

// ---------------------------------------------------------------------------
// Collapsible sources
// ---------------------------------------------------------------------------

function SourcesSection({ raw }: { raw: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const sources = raw
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean)

  if (sources.length === 0) return <></>

  return (
    <div className="mt-2 border-t border-surface-hairline pt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded text-[11px] font-medium text-gray-500 transition hover:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          className="inline-block transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▸
        </span>
        Sources ({sources.length})
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-gray-500">
          {sources.map((s, i) => {
            const urlMatch = s.match(/\((.+?)\)\s*$/)
            const title = urlMatch ? s.slice(0, s.lastIndexOf("(")).trim() : s
            const url = urlMatch ? urlMatch[1] : null
            return (
              <li key={i} className="truncate">
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent hover:underline"
                  >
                    {title}
                  </a>
                ) : (
                  title
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action buttons (copy, TTS, feedback, regenerate)
// ---------------------------------------------------------------------------

function MessageActions({
  message,
  isLast,
  onRegenerate,
  onFeedback,
}: {
  message: ChatMessageType
  isLast: boolean
  onRegenerate?: () => void
  onFeedback?: (value: "up" | "down" | null) => void
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may not be available
    }
  }, [message.text])

  const handleSpeak = useCallback(() => {
    if (!("speechSynthesis" in window)) return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const utterance = new SpeechSynthesisUtterance(message.text)
    utterance.rate = 1.0
    utterance.lang = "en-US"
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }, [message.text, speaking])

  const handleFeedback = useCallback(
    (value: "up" | "down") => {
      if (!onFeedback) return
      // Toggle off if already selected
      onFeedback(message.feedback === value ? null : value)
    },
    [message.feedback, onFeedback],
  )

  return (
    <div className="mt-1 flex items-center gap-1">
      {/* Copy */}
      <button
        type="button"
        onClick={() => void handleCopy()}
        title={copied ? "Copied!" : "Copy message"}
        aria-label={copied ? "Copied!" : "Copy message"}
        className="rounded p-1 text-gray-500 transition hover:bg-surface-overlay hover:text-gray-300 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon icon={copied ? Check : Copy} size={14} />
      </button>

      {/* Read aloud */}
      {"speechSynthesis" in window && (
        <button
          type="button"
          onClick={handleSpeak}
          title={speaking ? "Stop reading" : "Read aloud"}
          aria-label={speaking ? "Stop reading" : "Read aloud"}
          className={
            "rounded p-1 transition active:scale-90 hover:bg-surface-overlay focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
            (speaking ? "text-accent" : "text-gray-500 hover:text-gray-300")
          }
        >
          <Icon icon={speaking ? Volume2 : VolumeX} size={14} />
        </button>
      )}

      {/* Thumbs up */}
      <button
        type="button"
        onClick={() => handleFeedback("up")}
        title="Good response"
        aria-label="Good response"
        aria-pressed={message.feedback === "up"}
        className={
          "rounded p-1 transition active:scale-90 hover:bg-surface-overlay focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          (message.feedback === "up"
            ? "text-score-good"
            : "text-gray-500 hover:text-gray-300")
        }
      >
        <Icon icon={ThumbsUp} size={14} />
      </button>

      {/* Thumbs down */}
      <button
        type="button"
        onClick={() => handleFeedback("down")}
        title="Poor response"
        aria-label="Poor response"
        aria-pressed={message.feedback === "down"}
        className={
          "rounded p-1 transition active:scale-90 hover:bg-surface-overlay focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          (message.feedback === "down"
            ? "text-score-bad"
            : "text-gray-500 hover:text-gray-300")
        }
      >
        <Icon icon={ThumbsDown} size={14} />
      </button>

      {/* Regenerate — only on the last assistant message */}
      {isLast && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          title="Regenerate response"
          aria-label="Regenerate response"
          className="rounded p-1 text-gray-500 transition hover:bg-surface-overlay hover:text-gray-300 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon icon={RefreshCw} size={14} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Thinking indicator
// ---------------------------------------------------------------------------

function ThinkingIndicator({ respondingToFrame = false }: { respondingToFrame?: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-2 py-1" data-testid="thinking-indicator">
      <div className="flex gap-0.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/60 [animation-delay:0s]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/60 [animation-delay:0.2s]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/60 [animation-delay:0.4s]" />
      </div>
      <span className="text-[11px] font-medium text-gray-500">
        {respondingToFrame ? (
          <span className="inline-flex items-center gap-1">
            <Icon icon={Camera} size={11} />
            Looking at your form…
          </span>
        ) : (
          "Coach is thinking…"
        )}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ChatMessage component
// ---------------------------------------------------------------------------

function ChatMessageInner({
  message,
  isLast,
  isStreaming,
  chatState,
  respondingToFrame = false,
  onRegenerate,
  onFeedback,
}: ChatMessageProps): JSX.Element {
  const isUser = message.role === "user"
  const isThinking =
    message.role === "assistant" && chatState === "thinking" && !message.text
  const showStreaming =
    message.role === "assistant" && isStreaming && !message.text && !isThinking
  const timestamp = useMemo(() => timeFromId(message.id), [message.id])

  // Parse follow-up questions from blockquotes (> 💡 ...) for potential chip rendering
  const followUpQuestions = useMemo(() => {
    if (isUser || !message.text) return []
    const matches = message.text.match(/>\s*💡\s*\*\*[^*]+\*\*\s*(.+)/g)
    return matches || []
  }, [isUser, message.text])

  void followUpQuestions // reserved for future chip rendering

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className="max-w-[85%]">
        {isUser && message.hasFrame && (
          <div className="mb-1 flex items-center justify-end gap-1 text-[10px] font-medium uppercase tracking-wide text-accent">
            <Icon icon={Camera} size={11} />
            Looking at your form
          </div>
        )}

        <div
          className={
            "animate-bubble-in rounded-2xl px-3.5 py-2.5 text-sm shadow-elev-1 " +
            (isUser
              ? "rounded-br-sm bg-accent-soft text-white"
              : "rounded-bl-sm bg-surface-overlay text-gray-100")
          }
        >
          {isThinking ? (
            <ThinkingIndicator respondingToFrame={respondingToFrame} />
          ) : showStreaming ? (
            <span className="inline-flex gap-1 py-1" aria-label="Coach is typing">
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-gray-400" />
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-gray-400 [animation-delay:0.2s]" />
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-gray-400 [animation-delay:0.4s]" />
            </span>
          ) : isUser ? (
            message.text
          ) : (
            renderMarkdown(message.text)
          )}
        </div>

        <div className={"mt-1 flex items-center gap-2 " + (isUser ? "justify-end" : "justify-start")}>
          {/* Action buttons — only for assistant messages with content */}
          {!isUser && message.text && !isThinking && !showStreaming && (
            <MessageActions
              message={message}
              isLast={isLast}
              onRegenerate={onRegenerate}
              onFeedback={onFeedback}
            />
          )}
          {timestamp && !isThinking && !showStreaming && (
            <span className="text-[10px] text-gray-500" data-testid="message-timestamp">
              {timestamp}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export const ChatMessage = memo(ChatMessageInner)
