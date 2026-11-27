/**
 * Single source of truth for brand identity (P36 C8).
 *
 * Paired with `--accent` in `src/index.css`, swapping the brand name or accent
 * colour later is a one-file change without touching product components.
 */
export const BRAND = {
  prefix: "Pose",
  highlight: "Coach",
  fullName: "PoseCoach",
  accentCssVar: "--accent",
} as const
