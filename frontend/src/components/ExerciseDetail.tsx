import { memo, useEffect, useMemo, useState } from "react"
import { ChevronLeft, Dumbbell, Play, Star } from "lucide-react"

import type { ExerciseDetail as ExerciseDetailType, ExerciseHistoryOut } from "../types"
import { getExerciseHistory } from "../lib/workoutsApi"
import { personalRecord, sessionSeries } from "../lib/progression"
import { useUnitPref } from "../hooks/useUnitPref"
import { Icon } from "./ui/Icon"
import { ProgressionChart } from "./ProgressionChart"

const KG_PER_LB = 0.453592

interface ExerciseDetailProps {
  readonly exercise: ExerciseDetailType
  readonly onBack: () => void
}

function ExerciseDetailInner({ exercise, onBack }: ExerciseDetailProps): JSX.Element {
  const [imgIndex, setImgIndex] = useState(0)
  const [videoLoaded, setVideoLoaded] = useState(false)
  const [history, setHistory] = useState<ExerciseHistoryOut | null>(null)
  const { unit } = useUnitPref()

  const img = exercise.image_urls[imgIndex] ?? null
  const hasImages = exercise.image_urls.length > 0
  const hasVideo = exercise.youtube_id !== null

  // Lazy-load this user's history when the detail opens; the Progress section
  // simply stays hidden for exercises never logged (or when unauthenticated).
  useEffect(() => {
    let cancelled = false
    void getExerciseHistory(exercise.slug)
      .then((h) => {
        if (!cancelled) setHistory(h)
      })
      .catch(() => {
        /* best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [exercise.slug])

  const series = useMemo(() => (history ? sessionSeries(history) : []), [history])
  const pr = useMemo(() => (history ? personalRecord(history) : null), [history])
  const fromKg = (v: number): number => (unit === "lb" ? v / KG_PER_LB : v)

  return (
    <div className="flex flex-col gap-0 overflow-y-auto" data-testid="exercise-detail">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to library"
          className="grid h-11 w-11 shrink-0 place-content-center rounded-full text-gray-400 transition hover:bg-surface-overlay hover:text-white active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="exercise-detail-back"
        >
          <Icon icon={ChevronLeft} size={16} />
        </button>
        <h2 className="min-w-0 truncate font-display text-base font-semibold text-gray-100">
          {exercise.name}
        </h2>
        {exercise.is_cv_supported && (
          <span
            className="ml-auto shrink-0 flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent"
            data-testid="cv-badge"
          >
            <Icon icon={Star} size={10} />
            Form-check
          </span>
        )}
      </div>

      {/* Image carousel */}
      {hasImages && (
        <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-black">
          <img
            src={img ?? ""}
            alt={`${exercise.name} demonstration`}
            loading="lazy"
            className="h-full w-full object-contain"
          />
          {exercise.image_urls.length > 1 && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
              {exercise.image_urls.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setImgIndex(i)}
                  aria-label={`Image ${i + 1}`}
                  className={
                    "h-1.5 w-1.5 rounded-full transition " +
                    (i === imgIndex ? "bg-accent" : "bg-gray-600")
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4 p-4">
        {/* Progress — only for exercises this user has actually logged (P26) */}
        {series.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="progress-section">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
              Progress
            </h3>
            <div className="rounded-xl bg-surface-raised p-3 shadow-elev-1">
              <ProgressionChart points={series} unit={unit} />
              {pr !== null && (
                <p className="mt-2 text-[11px] text-gray-500" data-testid="pr-line">
                  Best:{" "}
                  <span className="hud-numerals text-gray-300">
                    {Math.round(fromKg(pr.weight_kg) * 10) / 10} {unit} × {pr.reps}
                  </span>{" "}
                  — e1RM{" "}
                  <span className="hud-numerals text-accent">
                    {Math.round(fromKg(pr.est_one_rep_max) * 10) / 10} {unit}
                  </span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Meta chips */}
        <div className="flex flex-wrap gap-2">
          {exercise.equipment && (
            <span className="flex items-center gap-1 rounded-full bg-surface-raised px-2.5 py-1 text-xs text-gray-300 shadow-elev-1">
              <Icon icon={Dumbbell} size={11} />
              {exercise.equipment}
            </span>
          )}
          {exercise.category && (
            <span className="rounded-full bg-surface-raised px-2.5 py-1 text-xs text-gray-400 shadow-elev-1">
              {exercise.category}
            </span>
          )}
          {exercise.primary_muscles.map((m) => (
            <span
              key={m}
              className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
            >
              {m}
            </span>
          ))}
          {exercise.secondary_muscles.map((m) => (
            <span
              key={m}
              className="rounded-full bg-surface-overlay px-2.5 py-1 text-xs text-gray-400"
            >
              {m}
            </span>
          ))}
        </div>

        {/* YouTube demo — lite-embed pattern (same as HowToDrawer) */}
        {hasVideo && (
          <div className="overflow-hidden rounded-xl bg-black shadow-elev-2">
            <div className="relative aspect-video">
              {!videoLoaded ? (
                <button
                  type="button"
                  onClick={() => setVideoLoaded(true)}
                  className="flex h-full w-full items-center justify-center bg-surface-overlay text-gray-400 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`Play ${exercise.name} demo video`}
                >
                  <Icon icon={Play} size={32} />
                </button>
              ) : (
                <iframe
                  className="h-full w-full"
                  src={`https://www.youtube-nocookie.com/embed/${exercise.youtube_id}?autoplay=1`}
                  title={`${exercise.name} demo`}
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                />
              )}
            </div>
          </div>
        )}

        {/* Instructions */}
        {exercise.instructions.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
              Instructions
            </h3>
            <ol className="flex flex-col gap-2">
              {exercise.instructions.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-gray-300">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[11px] font-semibold text-gray-400">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

export const ExerciseDetail = memo(ExerciseDetailInner)
