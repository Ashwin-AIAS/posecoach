import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CameraHud } from "../../../../components/CameraHud"
import type { PoseResult } from "../../../../types"
import { FIXTURES } from "../fixtures"
import { PoseOverlayNeon } from "../PoseOverlayNeon"

describe("PoseOverlayNeon (A1: no duplicate canvas HUD chrome)", () => {
  const fillTextCalls: string[] = []
  let rafCallback: FrameRequestCallback | null = null

  beforeEach(() => {
    fillTextCalls.length = 0
    rafCallback = null

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      rafCallback = cb
      return 1
    })
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})

    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 390,
      height: 600,
      top: 0,
      left: 0,
      right: 390,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const fakeGradient = {
      addColorStop: vi.fn(),
    }

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          setTransform: vi.fn(),
          clearRect: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          beginPath: vi.fn(),
          closePath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          arc: vi.fn(),
          arcTo: vi.fn(),
          stroke: vi.fn(),
          fill: vi.fn(),
          fillRect: vi.fn(),
          createRadialGradient: vi.fn(() => fakeGradient),
          createLinearGradient: vi.fn(() => fakeGradient),
          measureText: vi.fn((t: string) => ({ width: t.length * 7 })),
          fillText: vi.fn((t: string) => {
            fillTextCalls.push(t)
          }),
        }) as unknown as CanvasRenderingContext2D,
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the DOM HUD while the canvas overlay draws no status line, legend, or cue chip", () => {
    const result: PoseResult = {
      keypoints: [],
      confidence: [],
      score: 88,
      reps: 5,
      cues: ["Keep chest tall"],
      latency_ms: 35,
    }

    render(
      <div>
        <PoseOverlayNeon frame={FIXTURES.good} />
        <CameraHud result={result} active exercise="squat" onShowHowTo={vi.fn()} />
      </div>,
    )

    expect(rafCallback).not.toBeNull()
    rafCallback?.(100)

    // DOM HUD renders rep counter, score ring, and coaching cue
    expect(screen.getByTestId("rep-counter")).toHaveTextContent("5")
    expect(screen.getByTestId("ring-score-value")).toHaveTextContent("88")
    expect(screen.getByText("Keep chest tall")).toBeInTheDocument()

    // Canvas draws joint angle degree pills, but NEVER the overlapping status line, legend, or cue text
    expect(fillTextCalls.some((t) => t.endsWith("°"))).toBe(true)
    expect(fillTextCalls).not.toContain("POSECOACH · LIVE FORM ENGINE")
    expect(fillTextCalls).not.toContain("GOOD FORM")
    expect(fillTextCalls).not.toContain("ON TARGET")
    expect(fillTextCalls).not.toContain("ADJUST")
    expect(fillTextCalls).not.toContain("CORRECT")
    expect(fillTextCalls).not.toContain(FIXTURES.good.cue)
  })
})
