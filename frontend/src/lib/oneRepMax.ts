/** Epley one-rep-max estimator: 1RM = weight × (1 + reps / 30). */
export function oneRepMax(weightKg: number, reps: number): number {
  if (reps <= 0) return weightKg
  return weightKg * (1 + reps / 30)
}
