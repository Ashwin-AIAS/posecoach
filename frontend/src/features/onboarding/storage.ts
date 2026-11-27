import type { Exercise } from "../../types"

export const ONBOARDING_STORAGE_KEY = "pc.onboarding.v1"

export type OnboardingGoal =
  | "build_muscle"
  | "lose_fat"
  | "move_better"
  | "compete_posing"

export interface OnboardingState {
  readonly completed: boolean
  readonly goal: OnboardingGoal | null
  readonly firstExercise: Exercise
  readonly completedAt: string
}

export function readOnboarding(): OnboardingState | null {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OnboardingState>
    if (parsed.completed !== true) return null
    return {
      completed: true,
      goal: parsed.goal ?? null,
      firstExercise: parsed.firstExercise ?? "squat",
      completedAt: parsed.completedAt ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function writeOnboarding(state: OnboardingState): void {
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Private browsing / quota errors — ignore gracefully.
  }
}
