import type { Exercise } from "../types"
import { EXERCISE_META } from "../lib/exercises"

interface EmptyStageHintProps {
  readonly exercise: Exercise
  /**
   * Optional override copy. When set, the pill shows this message instead of the
   * default "step back" framing nudge — used for the far-subject "move closer"
   * hint (§3E/Phase 5) so both nudges share one unobtrusive channel.
   */
  readonly message?: string
}

/**
 * Minimal framing nudge shown over the live stage. A small pill tucked under the
 * rep counter (top-left) — deliberately unobtrusive so it never covers the
 * camera. Without `message` it shows the default "step back so your full body is
 * in frame" nudge before a person is detected; with `message` it shows that copy
 * (e.g. the far-subject "move closer" hint). Form tips live on the HUD "?" button
 * and the sidebar reference panel, so this carries no redundant button.
 */
export function EmptyStageHint({ exercise, message }: EmptyStageHintProps): JSX.Element {
  const meta = EXERCISE_META[exercise]
  return (
    <div className="pointer-events-none absolute left-3 top-[4.25rem] z-20 max-w-[15rem] animate-fade-in rounded-full bg-surface-base/65 px-3 py-1.5 shadow-elev-1 backdrop-blur-md">
      <p className="text-xs leading-snug text-gray-300">
        {message !== undefined ? (
          message
        ) : (
          <>
            Step back so your full body is in frame for your{" "}
            <span className="text-white">{meta.label}</span>
          </>
        )}
      </p>
    </div>
  )
}
