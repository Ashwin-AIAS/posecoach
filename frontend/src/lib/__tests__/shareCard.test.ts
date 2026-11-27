import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  renderShareCardBlob,
  renderShareCardCanvas,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  shareResultCard,
} from "../shareCard"
import type { ShareCardInput } from "../shareCard"

interface MockCtx {
  fillText: ReturnType<typeof vi.fn>
  fillRect: ReturnType<typeof vi.fn>
  fill: ReturnType<typeof vi.fn>
  measureText: ReturnType<typeof vi.fn>
}

let ctx: MockCtx

function makeMockCtx(): CanvasRenderingContext2D {
  ctx = {
    fillText: vi.fn(),
    fillRect: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 24 })),
  }
  const grad = { addColorStop: vi.fn() }
  return {
    ...ctx,
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    createLinearGradient: vi.fn(() => grad),
    createRadialGradient: vi.fn(() => grad),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

const SAMPLE_INPUT: ShareCardInput = {
  exerciseId: "squat",
  exerciseLabel: "Squat",
  reps: 8,
  avgScore: 84.2,
  bestScore: 93,
  samples: 110,
  repScores: [80, 84, 88, 93, 86, 82, 79, 81],
  verdict: "Clean set",
  date: new Date("2026-11-27T12:00:00Z"),
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => makeMockCtx() as unknown as RenderingContext,
  )
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => {
    cb(new Blob(["png-bytes"], { type: "image/png" }))
  })
  URL.createObjectURL = vi.fn(() => "blob:share-card")
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (navigator as { canShare?: unknown }).canShare
  delete (navigator as { share?: unknown }).share
})

describe("shareCard (P36 Lane B — B3)", () => {
  it("renders a 1080x1920 canvas with PoseCoach wordmark, exercise, reps, avg, best, date, and bars", () => {
    const canvas = renderShareCardCanvas(SAMPLE_INPUT)
    expect(canvas.width).toBe(SHARE_CARD_WIDTH)
    expect(canvas.height).toBe(SHARE_CARD_HEIGHT)

    const drawnTexts = ctx.fillText.mock.calls.map((c) => String(c[0]))
    expect(drawnTexts).toContain("Pose")
    expect(drawnTexts).toContain("Coach")
    expect(drawnTexts).toContain("Squat")
    expect(drawnTexts).toContain("8")
    expect(drawnTexts).toContain("84")
    expect(drawnTexts).toContain("93")
    expect(drawnTexts.some((t) => t.includes("2026"))).toBe(true)
    // Hero + 2 stat tiles + bars card + 8 rep bars = 12 rounded-rect fills
    expect(ctx.fill.mock.calls.length).toBe(4 + SAMPLE_INPUT.repScores.length)
  })

  it("encodes an image/png Blob via renderShareCardBlob", async () => {
    const blob = await renderShareCardBlob(SAMPLE_INPUT)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe("image/png")
  })

  it("uses navigator.share({ files }) when supported", async () => {
    const shareSpy = vi.fn(async () => {})
    Object.assign(navigator, {
      canShare: vi.fn(() => true),
      share: shareSpy,
    })

    const outcome = await shareResultCard(SAMPLE_INPUT)
    expect(outcome).toBe("shared")
    expect(shareSpy).toHaveBeenCalledTimes(1)
    const arg = (shareSpy.mock.calls[0] as unknown as [{ files: File[] }])[0]
    expect(arg.files[0].name).toBe("posecoach-squat-2026-11-27.png")
    expect(arg.files[0].type).toBe("image/png")
  })

  it("falls back to local PNG download when navigator.share is unavailable", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const outcome = await shareResultCard(SAMPLE_INPUT)
    expect(outcome).toBe("downloaded")
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
