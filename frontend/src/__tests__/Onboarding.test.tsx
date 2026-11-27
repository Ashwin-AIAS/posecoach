import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { Onboarding } from "../features/onboarding/Onboarding"
import { ONBOARDING_STORAGE_KEY, readOnboarding } from "../features/onboarding/storage"

beforeEach(() => {
  window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
})

describe("Onboarding (P36 C6)", () => {
  it("walks through all 3 steps and persists goal + exercise to localStorage", () => {
    const onComplete = vi.fn()
    render(<Onboarding onComplete={onComplete} />)

    // Step 1: Goal
    expect(screen.getByTestId("onboarding-step-1")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("onboarding-goal-build_muscle"))
    fireEvent.click(screen.getByTestId("onboarding-next"))

    // Step 2: Phone setup (static illustration, no camera)
    expect(screen.getByTestId("onboarding-step-2")).toBeInTheDocument()
    expect(screen.getByTestId("onboarding-phone-illustration")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("onboarding-next"))

    // Step 3: Pick first exercise
    expect(screen.getByTestId("onboarding-step-3")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("onboarding-ex-deadlift"))
    fireEvent.click(screen.getByTestId("onboarding-finish"))

    expect(onComplete).toHaveBeenCalledTimes(1)
    const saved = readOnboarding()
    expect(saved).not.toBeNull()
    expect(saved?.completed).toBe(true)
    expect(saved?.goal).toBe("build_muscle")
    expect(saved?.firstExercise).toBe("deadlift")
  })

  it("allows skipping at any step and persists completion", () => {
    const onComplete = vi.fn()
    render(<Onboarding onComplete={onComplete} />)

    fireEvent.click(screen.getByTestId("onboarding-skip"))
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(readOnboarding()?.completed).toBe(true)
  })
})
