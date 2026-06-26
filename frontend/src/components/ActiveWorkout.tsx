import { memo } from "react"

import type { LocalWorkout } from "../hooks/useWorkoutLog"
import type { UseWorkoutLogResult } from "../hooks/useWorkoutLog"

interface ActiveWorkoutProps {
  readonly workout: LocalWorkout
  readonly workoutLog: UseWorkoutLogResult
  readonly onFinish: () => void
}

/** Active workout logger — implemented in Stage 3 (P25). */
function ActiveWorkoutInner({ workout, onFinish }: ActiveWorkoutProps): JSX.Element {
  return (
    <div className="flex h-full flex-col" data-testid="active-workout">
      <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-4 py-3">
        <h2 className="font-display text-base font-semibold text-gray-100">
          {workout.title ?? "Workout"}
        </h2>
        <button
          type="button"
          onClick={onFinish}
          className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-surface-base focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="finish-workout-btn"
        >
          Finish
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-gray-500">
        <p className="text-sm">Active workout in progress</p>
      </div>
    </div>
  )
}

export const ActiveWorkout = memo(ActiveWorkoutInner)
