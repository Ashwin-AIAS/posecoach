import { useEffect, useRef } from "react"

/** True when the browser exposes the Web Speech synthesis API. */
export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window
}

/**
 * Speaks the top coaching cue aloud whenever it changes, while enabled.
 * Hands-free form feedback (pure UX polish — optional, off by default).
 * Cancels any in-flight utterance so cues never pile up or lag the live coach.
 */
export function useCueVoice(cue: string | undefined, enabled: boolean): void {
  const lastSpoken = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !isSpeechSupported()) return
    if (!cue || cue === lastSpoken.current) return
    lastSpoken.current = cue
    const utterance = new SpeechSynthesisUtterance(cue)
    utterance.rate = 1.05
    utterance.lang = "en-US"
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [cue, enabled])

  // Stop speaking as soon as the feature is switched off.
  useEffect(() => {
    if (!enabled && isSpeechSupported()) {
      window.speechSynthesis.cancel()
      lastSpoken.current = null
    }
  }, [enabled])
}
