import type { Exercise } from "../types"
import { EXERCISE_META } from "../lib/exercises"

interface EmptyStageHintProps {
  readonly exercise: Exercise
  readonly onShowHowTo: (ex: Exercise) => void
}

/**
 * Onboarding / empty state shown over the live stage before a person is
 * detected — guides the user to frame themselves and offers the how-to demo.
 */
export function EmptyStageHint({ exercise, onShowHowTo }: EmptyStageHintProps): JSX.Element {
  const meta = EXERCISE_META[exercise]
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-content-center p-6 text-center">
      <div className="pointer-events-auto mx-auto max-w-xs animate-fade-in rounded-2xl border border-surface-hairline/70 bg-surface-base/70 p-5 backdrop-blur-md">
        <div className="text-3xl" aria-hidden="true">
          🏋️
        </div>
        <h2 className="mt-2 font-display text-lg font-semibold text-white">Ready when you are</h2>
        <p className="mt-1 text-sm text-gray-400">
          Step back so your whole body is in frame, then start your{" "}
          <span className="text-white">{meta.label}</span>.
        </p>
        <button
          type="button"
          onClick={() => onShowHowTo(exercise)}
          className="mt-4 rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-surface-base transition hover:brightness-110"
        >
          View form tips
        </button>
      </div>
    </div>
  )
}
