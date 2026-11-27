/**
 * Deterministic post-set verdict & insights (P36 Lane B — B2).
 *
 * Pure functions only: no LLM, no network, no randomness. Given a finished
 * set's per-rep scores, worst joint, and prior workout history, produces:
 *   1. A short one-line verdict ("Clean set", "Good set — watch your knees",
 *      "Form broke down late").
 *   2. Up to 3 plain-English insights, each strictly <= 12 words.
 */

export interface InsightHistorySession {
  readonly id?: string
  readonly exercise?: string
  readonly avg_form_score: number
  readonly rep_count?: number
  readonly started_at: string
}

export interface SetInsightInput {
  readonly exerciseId: string
  readonly exerciseLabel: string
  readonly reps: number
  readonly avgScore: number
  readonly bestScore: number
  readonly samples: number
  readonly repScores: readonly number[]
  readonly worstJoint?: string | null
  /** Prior sessions (newest or arbitrary order); filtered by exerciseId when needed. */
  readonly history?: readonly InsightHistorySession[] | null
  /** Reference wall-clock ms for deterministic "this week" checks in tests. */
  readonly nowMs?: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const JUST_FINISHED_WINDOW_MS = 2 * 60 * 1000

const VERDICT_PART_MAP: Readonly<Record<string, string>> = {
  left_knee_angle: "knees",
  right_knee_angle: "knees",
  knee: "knees",
  knees: "knees",
  left_hip_angle: "hips",
  right_hip_angle: "hips",
  hip: "hips",
  hips: "hips",
  left_elbow_angle: "elbows",
  right_elbow_angle: "elbows",
  elbow: "elbows",
  elbows: "elbows",
  left_shoulder_angle: "shoulders",
  right_shoulder_angle: "shoulders",
  shoulder: "shoulders",
  shoulders: "shoulders",
  hip_trunk_angle: "core",
  trunk: "core",
  core: "core",
}

const DETAIL_PART_MAP: Readonly<Record<string, string>> = {
  left_knee_angle: "left knee",
  right_knee_angle: "right knee",
  knee: "knees",
  knees: "knees",
  left_hip_angle: "left hip",
  right_hip_angle: "right hip",
  hip: "hips",
  hips: "hips",
  left_elbow_angle: "left elbow",
  right_elbow_angle: "right elbow",
  elbow: "elbows",
  elbows: "elbows",
  left_shoulder_angle: "left shoulder",
  right_shoulder_angle: "right shoulder",
  shoulder: "shoulders",
  shoulders: "shoulders",
  hip_trunk_angle: "core",
  trunk: "core",
  core: "core",
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function capWords(text: string, maxWords = 12): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= maxWords) return text.trim()
  return words.slice(0, maxWords).join(" ")
}

/**
 * Excludes at most one newest row when the backend has already persisted the
 * set that just ended, so "vs your last Squat" compares against the *previous*
 * set rather than the current one.
 */
export function priorSessionsFromHistory(
  sessions: readonly InsightHistorySession[],
  exerciseId: string,
  avgScore: number,
  samples: number,
  nowMs: number = Date.now(),
): InsightHistorySession[] {
  const sorted = [...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at))
  if (samples <= 0 || sorted.length === 0) return sorted
  const idx = sorted.findIndex((s) => s.exercise === exerciseId)
  if (idx === -1) return sorted
  const candidate = sorted[idx]
  const startedMs = Date.parse(candidate.started_at)
  const recent = !Number.isNaN(startedMs) && Math.abs(nowMs - startedMs) <= JUST_FINISHED_WINDOW_MS
  const sameScore = Math.abs(candidate.avg_form_score - avgScore) <= 3
  if (recent && sameScore) {
    return sorted.filter((_, i) => i !== idx)
  }
  return sorted
}

interface FatigueDrop {
  readonly startRep: number
  readonly endRep: number
  readonly dropMean: number
}

/** Detects a contiguous late-set score drop (>= 12 pts below earlier reps and < 75). */
export function detectFatigueDrop(repScores: readonly number[]): FatigueDrop | null {
  if (repScores.length < 3) return null
  const searchStart = Math.max(1, Math.floor(repScores.length / 2))

  for (let i = searchStart; i < repScores.length; i++) {
    const baseline = mean(repScores.slice(0, i))
    if (repScores[i] <= baseline - 12 && repScores[i] < 75) {
      let end = i
      while (
        end + 1 < repScores.length &&
        repScores[end + 1] <= baseline - 12 &&
        repScores[end + 1] < 75
      ) {
        end += 1
      }
      const slice = repScores.slice(i, end + 1)
      return {
        startRep: i + 1,
        endRep: end + 1,
        dropMean: Math.round(mean(slice)),
      }
    }
  }
  return null
}

/** True when this set beat every prior recorded session for the same exercise. */
export function isPersonalBestSet(input: SetInsightInput): boolean {
  if (input.samples <= 0 || input.avgScore <= 0) return false
  const prior = (input.history ?? []).filter(
    (s) => s.exercise === input.exerciseId && s.avg_form_score > 0,
  )
  if (prior.length === 0) return false
  const prevBest = Math.max(...prior.map((s) => s.avg_form_score))
  return Math.round(input.avgScore) > Math.round(prevBest)
}

/** Short one-line verdict displayed beneath the hero rep count. */
export function computeVerdict(input: SetInsightInput): string {
  if (input.samples <= 0) {
    return "No scored reps yet"
  }

  // Late-set breakdown check on sets with at least 4 reps
  if (input.repScores.length >= 4) {
    const early = mean(input.repScores.slice(0, 2))
    const late = mean(input.repScores.slice(-2))
    if (early - late >= 15 && late < 70) {
      return "Form broke down late"
    }
  }

  const part = input.worstJoint ? VERDICT_PART_MAP[input.worstJoint] : undefined

  if (input.avgScore >= 80 && !part) {
    return "Clean set"
  }
  if (input.avgScore >= 85) {
    return "Clean set"
  }
  if (input.avgScore >= 65) {
    return part ? `Good set — watch your ${part}` : "Good set — stay controlled"
  }
  return part ? `Tough set — focus on your ${part}` : "Tough set — reset your tempo"
}

/**
 * Computes up to 3 concise, plain-English insights (each <= 12 words) from
 * `repScores`, `worstJoint`, and prior `history`.
 */
export function computeSetInsights(input: SetInsightInput): readonly string[] {
  if (input.samples <= 0) return []

  const insights: string[] = []
  const nowMs = input.nowMs ?? Date.now()
  const history = input.history ?? []

  // 1. Fatigue / rep drop insight
  const drop = detectFatigueDrop(input.repScores)
  if (drop !== null) {
    const label =
      drop.startRep === drop.endRep
        ? `Rep ${drop.startRep} dropped to ${drop.dropMean} — fatigue?`
        : `Reps ${drop.startRep}–${drop.endRep} dropped to ${drop.dropMean} — fatigue?`
    insights.push(capWords(label))
  }

  // 2. Delta vs last session of the same exercise
  const sameExercise = [...history]
    .filter((s) => s.exercise === input.exerciseId && s.avg_form_score > 0)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))

  if (sameExercise.length > 0) {
    const lastScore = Math.round(sameExercise[0].avg_form_score)
    const roundedAvg = Math.round(input.avgScore)
    const delta = roundedAvg - lastScore
    if (delta >= 2) {
      insights.push(capWords(`Avg ${roundedAvg}, +${delta} vs your last ${input.exerciseLabel}`))
    } else if (delta <= -2) {
      insights.push(capWords(`Avg ${roundedAvg}, ${delta} vs your last ${input.exerciseLabel}`))
    } else {
      insights.push(capWords(`Avg ${roundedAvg}, steady with your last ${input.exerciseLabel}`))
    }
  }

  // 3. Rep-to-rep consistency insight
  if (input.repScores.length >= 3 && drop === null) {
    const sd = stdDev(input.repScores)
    const avg = mean(input.repScores)
    if (sd <= 4.5 && avg >= 70) {
      const weekCutoff = nowMs - 7 * DAY_MS
      const weekSessions = history.filter((s) => {
        const ts = Date.parse(s.started_at)
        return !Number.isNaN(ts) && ts >= weekCutoff && ts <= nowMs + DAY_MS
      })
      if (weekSessions.length >= 1) {
        insights.push("Most consistent set this week")
      } else {
        const spread = Math.max(1, Math.round(Math.max(...input.repScores) - Math.min(...input.repScores)))
        insights.push(capWords(`Locked-in tempo — within ${spread} pts across reps`))
      }
    }
  }

  // 4. Personal best callout if room remains
  if (insights.length < 3 && isPersonalBestSet(input)) {
    insights.push(capWords(`New personal best for ${input.exerciseLabel}`))
  }

  // 5. Worst-joint cue if room remains
  const detailPart = input.worstJoint ? DETAIL_PART_MAP[input.worstJoint] : undefined
  if (insights.length < 3 && detailPart && input.avgScore < 85) {
    insights.push(capWords(`Keep your ${detailPart} steady next set`))
  }

  // 6. Strongest rep fallback so multi-rep sets without history still get an insight
  if (insights.length === 0 && input.repScores.length >= 2) {
    let bestIdx = 0
    for (let i = 1; i < input.repScores.length; i++) {
      if (input.repScores[i] > input.repScores[bestIdx]) bestIdx = i
    }
    insights.push(
      capWords(`Best form on rep ${bestIdx + 1} at ${Math.round(input.repScores[bestIdx])}`),
    )
  }

  return insights.slice(0, 3)
}
