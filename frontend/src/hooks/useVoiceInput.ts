import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Minimal type declarations for the Web Speech Recognition API.
 * These are not included in the default TypeScript DOM lib.
 */
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEventLike {
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string
}

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

/**
 * Browser Speech Recognition interface — vendor-prefixed in most browsers.
 */
function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition
  return SR ?? null
}

export interface UseVoiceInputResult {
  /** True if the browser supports the Web Speech Recognition API. */
  readonly isSupported: boolean
  /** True if the mic is actively listening. */
  readonly isListening: boolean
  /** The latest recognized text (interim + final). */
  readonly transcript: string
  /** Start listening — resets the transcript. */
  readonly start: () => void
  /** Stop listening. */
  readonly stop: () => void
  /** Permission or recognition error message, or null. */
  readonly error: string | null
}

/**
 * Hook wrapping the Web Speech Recognition API for voice input.
 *
 * - Tap-to-talk model: one utterance per `start()` call.
 * - Auto-stops after the user stops speaking (browser handles silence detection).
 * - Fills `transcript` with interim results so the UI can show live text.
 * - Gracefully degrades: `isSupported = false` on unsupported browsers (Firefox).
 */
export function useVoiceInput(): UseVoiceInputResult {
  const SR = getSpeechRecognition()
  const isSupported = SR !== null

  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    if (!SR) return
    // Abort any existing session
    recognitionRef.current?.abort()

    const recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = "en-US"
    recognition.maxAlternatives = 1

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = ""
      let final = ""
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }
      setTranscript(final || interim)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const code = event.error
      if (code === "not-allowed") {
        setError("Microphone permission denied. Please allow mic access.")
      } else if (code === "no-speech") {
        // Not a real error — just no speech detected, stop silently
        setError(null)
      } else if (code === "aborted") {
        // Manual abort — not an error
        setError(null)
      } else {
        setError(`Speech recognition error: ${code}`)
      }
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    setTranscript("")
    setError(null)
    setIsListening(true)

    try {
      recognition.start()
    } catch {
      setError("Failed to start speech recognition.")
      setIsListening(false)
    }
  }, [SR])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  return { isSupported, isListening, transcript, start, stop, error }
}
