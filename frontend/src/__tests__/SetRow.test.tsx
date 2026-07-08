import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SetRow } from "../components/SetRow"
import type { LocalSet } from "../hooks/useWorkoutLog"

describe("SetRow (input mode)", () => {
  it("renders the set number input row", () => {
    render(<SetRow setNumber={1} onLog={vi.fn()} />)
    expect(screen.getByTestId("set-input-row-1")).toBeInTheDocument()
  })

  it("log button is disabled when weight or reps are empty", () => {
    render(<SetRow setNumber={1} onLog={vi.fn()} />)
    expect(screen.getByTestId("log-set-btn-1")).toBeDisabled()
  })

  it("calls onLog with canonical kg when weight and reps are filled", () => {
    const onLog = vi.fn()
    render(<SetRow setNumber={1} onLog={onLog} />)

    fireEvent.change(screen.getByTestId("weight-input-1"), { target: { value: "100" } })
    fireEvent.change(screen.getByTestId("reps-input-1"), { target: { value: "8" } })
    fireEvent.click(screen.getByTestId("log-set-btn-1"))

    expect(onLog).toHaveBeenCalledWith(100, 8, undefined)
  })

  it("passes RPE when filled in", () => {
    const onLog = vi.fn()
    render(<SetRow setNumber={1} onLog={onLog} />)

    fireEvent.change(screen.getByTestId("weight-input-1"), { target: { value: "80" } })
    fireEvent.change(screen.getByTestId("reps-input-1"), { target: { value: "5" } })
    fireEvent.change(screen.getByTestId("rpe-input-1"), { target: { value: "8" } })
    fireEvent.click(screen.getByTestId("log-set-btn-1"))

    expect(onLog).toHaveBeenCalledWith(80, 5, { rpe: 8 })
  })

  it("RPE is optional — no error when not filled in", () => {
    const onLog = vi.fn()
    render(<SetRow setNumber={1} onLog={onLog} />)

    fireEvent.change(screen.getByTestId("weight-input-1"), { target: { value: "70" } })
    fireEvent.change(screen.getByTestId("reps-input-1"), { target: { value: "10" } })
    fireEvent.click(screen.getByTestId("log-set-btn-1"))

    expect(onLog).toHaveBeenCalledWith(70, 10, undefined)
  })

  it("shows last entry hint when provided", () => {
    render(
      <SetRow
        setNumber={2}
        onLog={vi.fn()}
        lastEntry={{
          workout_id: "w1",
          performed_at: "2025-01-01T00:00:00Z",
          weight_kg: 100,
          reps: 8,
          est_one_rep_max: 133,
        }}
      />,
    )
    expect(screen.getByText(/Last:/)).toBeInTheDocument()
  })
})

describe("SetRow (P26 CV form-check)", () => {
  const COMMITTED: LocalSet = {
    id: "s1",
    set_number: 1,
    weight_kg: 100,
    reps: 8,
    rpe: null,
    is_warmup: false,
    completed: true,
    form_score: 87.4,
    source_session_id: "sess-1",
    pending: false,
    error: null,
  }

  it("pre-fills the reps input from a form-check rep count", () => {
    render(<SetRow setNumber={1} onLog={vi.fn()} cvPrefillReps={8} />)
    expect(screen.getByTestId("reps-input-1")).toHaveValue(8)
    expect(screen.getByTestId("cv-prefill-hint")).toHaveTextContent("Form-check counted 8 reps")
  })

  it("shows no prefill hint on a plain input row", () => {
    render(<SetRow setNumber={1} onLog={vi.fn()} />)
    expect(screen.queryByTestId("cv-prefill-hint")).not.toBeInTheDocument()
  })

  it("renders a form-score badge on a CV-linked committed set", () => {
    render(<SetRow setNumber={1} onLog={vi.fn()} committedSet={COMMITTED} />)
    const badge = screen.getByTestId("form-badge-s1")
    expect(badge).toHaveTextContent("87")
    expect(badge).toHaveAttribute("title", "Scored live by PoseCoach")
  })

  it("shows no badge when the committed set has no form score", () => {
    render(
      <SetRow
        setNumber={1}
        onLog={vi.fn()}
        committedSet={{ ...COMMITTED, form_score: null, source_session_id: null }}
      />,
    )
    expect(screen.queryByTestId("form-badge-s1")).not.toBeInTheDocument()
  })
})
