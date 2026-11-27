import { memo, useState } from "react"
import {
  Activity,
  Award,
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  Smartphone,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { exerciseLabel } from "../../lib/exercises"
import type { Exercise } from "../../types"
import { Icon } from "../../components/ui/Icon"
import {
  writeOnboarding,
  type OnboardingGoal,
  type OnboardingState,
} from "./storage"

interface OnboardingProps {
  /** Called once the user completes or skips onboarding. */
  readonly onComplete: (state: OnboardingState) => void
  /** Optional default exercise selection. */
  readonly defaultExercise?: Exercise
}

interface GoalOption {
  readonly id: OnboardingGoal
  readonly label: string
  readonly description: string
  readonly icon: LucideIcon
}

const GOALS: readonly GoalOption[] = [
  {
    id: "build_muscle",
    label: "Build muscle",
    description: "Clean reps, progressive overload, and hypertrophy focus.",
    icon: Dumbbell,
  },
  {
    id: "lose_fat",
    label: "Lose fat",
    description: "Consistent sessions paired with daily calorie tracking.",
    icon: Flame,
  },
  {
    id: "move_better",
    label: "Move better",
    description: "Joint alignment, depth, and pain-free movement quality.",
    icon: Activity,
  },
  {
    id: "compete_posing",
    label: "Compete — posing",
    description: "Mandatory pose symmetry, hold steadiness, and prep tracking.",
    icon: Award,
  },
]

const STARTER_EXERCISES: readonly Exercise[] = [
  "squat",
  "deadlift",
  "bench",
  "curl",
  "ohp",
  "lunge",
  "plank",
]

/** Static phone-setup illustration — deliberately never opens the camera (P36 C6). */
function PhoneSetupIllustration(): JSX.Element {
  return (
    <div
      className="flex flex-col items-center rounded-2xl bg-surface-base p-5 shadow-elev-1"
      data-testid="onboarding-phone-illustration"
    >
      <svg
        viewBox="0 0 280 150"
        className="h-36 w-full max-w-[280px]"
        role="img"
        aria-label="Place your phone upright about 2 metres away so your full body fits in frame"
      >
        {/* Floor line */}
        <line x1="20" y1="132" x2="260" y2="132" stroke="#23262D" strokeWidth="2" />

        {/* Phone propped at waist/chest height on the left */}
        <rect
          x="32"
          y="76"
          width="18"
          height="32"
          rx="4"
          fill="#15171C"
          stroke="rgb(var(--accent))"
          strokeWidth="2"
        />
        <circle cx="41" cy="83" r="2" fill="rgb(var(--accent))" />
        {/* Stand */}
        <line x1="41" y1="108" x2="41" y2="132" stroke="#374151" strokeWidth="2" />
        <line x1="33" y1="132" x2="49" y2="132" stroke="#374151" strokeWidth="2" />

        {/* Field of view cone */}
        <polygon
          points="50,84 195,24 195,132 50,100"
          fill="rgb(var(--accent))"
          fillOpacity="0.09"
        />

        {/* Distance arrow */}
        <line
          x1="58"
          y1="122"
          x2="188"
          y2="122"
          stroke="#6B7280"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <text
          x="123"
          y="116"
          textAnchor="middle"
          fill="#9CA3AF"
          fontSize="10"
          fontFamily="Inter, system-ui, sans-serif"
        >
          ~2 metres
        </text>

        {/* Full-body silhouette guide on the right */}
        <circle cx="215" cy="36" r="9" fill="none" stroke="rgb(var(--accent))" strokeWidth="2" />
        <line x1="215" y1="45" x2="215" y2="84" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" />
        <line x1="198" y1="58" x2="232" y2="58" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" />
        <line x1="215" y1="84" x2="203" y2="128" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" />
        <line x1="215" y1="84" x2="227" y2="128" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" />
      </svg>

      <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
        <Icon icon={Smartphone} size={14} className="shrink-0 text-accent" />
        <span>Prop upright at waist height · full body head to toe</span>
      </div>
    </div>
  )
}

/**
 * Three-step skippable first-run onboarding (P36 C6).
 * Persists completion and chosen goal to `localStorage` (`pc.onboarding.v1`).
 */
function OnboardingInner({
  onComplete,
  defaultExercise = "squat",
}: OnboardingProps): JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [goal, setGoal] = useState<OnboardingGoal | null>(null)
  const [firstExercise, setFirstExercise] = useState<Exercise>(defaultExercise)

  const finish = (chosenGoal: OnboardingGoal | null, exercise: Exercise): void => {
    const state: OnboardingState = {
      completed: true,
      goal: chosenGoal,
      firstExercise: exercise,
      completedAt: new Date().toISOString(),
    }
    writeOnboarding(state)
    onComplete(state)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-base/95 p-4 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to PoseCoach"
      data-testid="onboarding-flow"
    >
      <div className="flex w-full max-w-md flex-col rounded-2xl bg-surface-raised p-6 shadow-elev-3 animate-scale-in">
        {/* Progress & Skip */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={
                  "h-1.5 rounded-full transition-all " +
                  (n === step
                    ? "w-6 bg-accent"
                    : n < step
                      ? "w-3 bg-accent/50"
                      : "w-3 bg-surface-overlay")
                }
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => finish(goal, firstExercise)}
            className="min-h-11 rounded-full px-3 text-xs font-medium text-gray-400 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            data-testid="onboarding-skip"
          >
            Skip
          </button>
        </div>

        {/* Step 1: Goal */}
        {step === 1 && (
          <div className="mt-4" data-testid="onboarding-step-1">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Step 1 of 3</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-white">
              What&apos;s your main goal?
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              We&apos;ll tailor your daily focus and coaching cues.
            </p>

            <div className="mt-5 grid gap-2.5">
              {GOALS.map((opt) => {
                const selected = goal === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setGoal(opt.id)}
                    aria-pressed={selected}
                    className={
                      "flex min-h-12 items-center gap-3 rounded-2xl p-3.5 text-left transition ease-spring active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                      (selected
                        ? "bg-accent-soft shadow-glow-sm"
                        : "bg-surface-base shadow-elev-1 hover:bg-surface-overlay")
                    }
                    data-testid={`onboarding-goal-${opt.id}`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-raised">
                      <Icon
                        icon={opt.icon}
                        size={18}
                        className={selected ? "text-accent" : "text-gray-400"}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white">{opt.label}</span>
                      <span className="block text-xs text-gray-400">{opt.description}</span>
                    </span>
                    {selected && <Icon icon={Check} size={16} className="shrink-0 text-accent" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 2: Set up your phone */}
        {step === 2 && (
          <div className="mt-4" data-testid="onboarding-step-2">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Step 2 of 3</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-white">
              Set up your phone
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              Good framing gives accurate angles and automatic rep counting from your first rep.
            </p>

            <div className="mt-5">
              <PhoneSetupIllustration />
            </div>

            <ul className="mt-4 space-y-1.5 text-xs text-gray-400">
              <li>• Keep your full body visible from head to ankles.</li>
              <li>• Face the camera or stand at a 45° angle for squats and deadlifts.</li>
              <li>• Bright, even lighting helps joint tracking stay locked in.</li>
            </ul>
          </div>
        )}

        {/* Step 3: Pick a first exercise */}
        {step === 3 && (
          <div className="mt-4" data-testid="onboarding-step-3">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Step 3 of 3</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-white">
              Pick your first exercise
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              You can switch movements any time before or between sets.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {STARTER_EXERCISES.map((ex) => {
                const selected = firstExercise === ex
                return (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setFirstExercise(ex)}
                    aria-pressed={selected}
                    className={
                      "min-h-11 rounded-full px-4 text-sm font-medium transition ease-spring active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                      (selected
                        ? "bg-accent text-surface-base font-semibold"
                        : "bg-surface-base text-gray-300 shadow-elev-1 hover:text-white")
                    }
                    data-testid={`onboarding-ex-${ex}`}
                  >
                    {exerciseLabel(ex)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer navigation */}
        <div className="mt-6 flex items-center gap-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              className="flex min-h-11 items-center justify-center gap-1 rounded-full bg-surface-base px-4 text-sm font-medium text-gray-200 shadow-elev-1 transition ease-spring active:scale-[0.97] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-testid="onboarding-back"
            >
              <Icon icon={ChevronLeft} size={16} />
              Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
              className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-6 text-sm font-semibold text-surface-base transition ease-spring active:scale-[0.97] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              data-testid="onboarding-next"
            >
              Continue
              <Icon icon={ChevronRight} size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => finish(goal, firstExercise)}
              className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-6 text-sm font-semibold text-surface-base transition ease-spring active:scale-[0.97] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              data-testid="onboarding-finish"
            >
              Get started
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export const Onboarding = memo(OnboardingInner)
