/**
 * Pure seek-window maths for post-set rep replay (P36 Lane B — B4).
 *
 * Given wall-clock `repTimesMs` (one entry per counted rep) and the recording's
 * wall-clock `startedAtMs`, computes the `[startSec, endSec]` slice so tapping
 * rep `i` plays from `repTimesMs[i] - startedAtMs - 1500ms` for ~3 seconds.
 */

export const REPLAY_LEAD_MS = 1500
export const REPLAY_DURATION_MS = 3000

export interface ReplayWindow {
  readonly startSec: number
  readonly endSec: number
}

export function computeReplayWindow(
  repTimesMs: readonly number[],
  startedAtMs: number,
  repIndex: number,
  videoDurationSec?: number,
): ReplayWindow | null {
  if (repIndex < 0 || repIndex >= repTimesMs.length) return null
  const repMs = repTimesMs[repIndex]
  if (!Number.isFinite(repMs) || !Number.isFinite(startedAtMs)) return null
  // Rep occurred before the user started recording — cannot replay it.
  if (repMs < startedAtMs) return null

  const startMs = Math.max(0, repMs - startedAtMs - REPLAY_LEAD_MS)
  const startSec = startMs / 1000
  const rawEndSec = startSec + REPLAY_DURATION_MS / 1000
  const endSec =
    videoDurationSec !== undefined && Number.isFinite(videoDurationSec) && videoDurationSec > 0
      ? Math.min(videoDurationSec, rawEndSec)
      : rawEndSec

  return { startSec, endSec: Math.max(startSec, endSec) }
}
