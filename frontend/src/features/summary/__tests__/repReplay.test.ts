import { describe, expect, it } from "vitest"

import { computeReplayWindow } from "../repReplay"

describe("computeReplayWindow (P36 Lane B — B4)", () => {
  it("seeks to repTimesMs[i] - startedAtMs - 1500ms and plays for 3s", () => {
    const win = computeReplayWindow([14_000, 18_500], 10_000, 1)
    // 18_500 - 10_000 - 1500 = 7000ms -> 7.0s .. 10.0s
    expect(win).toEqual({ startSec: 7, endSec: 10 })
  })

  it("clamps startSec to 0 when the rep finished within 1500ms of recording start", () => {
    const win = computeReplayWindow([10_800], 10_000, 0)
    // 10_800 - 10_000 - 1500 = -700ms -> clamped to 0s .. 3s
    expect(win).toEqual({ startSec: 0, endSec: 3 })
  })

  it("clamps endSec to videoDurationSec when provided and finite", () => {
    const win = computeReplayWindow([16_000], 10_000, 0, 6.2)
    // startSec = 4.5s, rawEnd = 7.5s -> clamped to 6.2s
    expect(win).toEqual({ startSec: 4.5, endSec: 6.2 })
  })

  it("returns null when rep occurred before recording started or index is out of bounds", () => {
    expect(computeReplayWindow([9_500, 13_000], 10_000, 0)).toBeNull()
    expect(computeReplayWindow([13_000], 10_000, 3)).toBeNull()
    expect(computeReplayWindow([13_000], 10_000, -1)).toBeNull()
  })
})
