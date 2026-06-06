import type { Exercise } from "../types"
import { EXERCISE_META } from "../lib/exercises"

interface EmptyStageHintProps {
  readonly exercise: Exercise
}

/**
 * Minimal framing nudge shown over the live stage before a person is detected.
 * A small pill tucked under the rep counter (top-left) — deliberately
 * unobtrusive so it never covers the camera. The parent auto-hides it the
 * moment a body is detected. Form tips live on the HUD "?" button and the
 * sidebar reference panel, so this no longer carries a redundant button.
 */
export function EmptyStageHint({ exercise }: EmptyStageHintProps): JSX.Element {
  const meta = EXERCISE_META[exercise]
  return (
    <div className="pointer-events-none absolute left-3 top-[4.25rem] z-20 max-w-[15rem] animate-fade-in rounded-full border border-surface-hairline/70 bg-surface-base/65 px-3 py-1.5 backdrop-blur-md">
      <p className="text-xs leading-snug text-gray-300">
        Step back so your full body is in frame for your{" "}
        <span className="text-white">{meta.label}</span>
      </p>
    </div>
  )
}
