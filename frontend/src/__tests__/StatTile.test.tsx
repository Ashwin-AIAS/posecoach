import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StatTile } from "../features/home/StatTile"

describe("StatTile (P36 C1)", () => {
  it.each([
    { value: 8, goal: 7, label: "Streak", ariaLabel: "8-day streak" },
    { value: 1, goal: 4, label: "Week", ariaLabel: "1 of 4 sessions this week" },
    { value: 0, goal: 4, label: "Week", ariaLabel: "0 of 4 sessions this week" },
  ])(
    "renders $ariaLabel with accent stroke (never form-score red)",
    ({ value, goal, label, ariaLabel }) => {
      const { container } = render(
        <StatTile
          value={value}
          goal={goal}
          label={label}
          ariaLabel={ariaLabel}
          testId="stat-tile"
        />,
      )

      const img = screen.getByRole("img", { name: ariaLabel })
      expect(img).toBeInTheDocument()
      expect(screen.getByTestId("stat-tile-value")).toHaveTextContent(String(value))

      // Must never use the red form-score colour (#FF4D4D) for counts.
      const circles = container.querySelectorAll("circle")
      for (const c of Array.from(circles)) {
        expect(c.getAttribute("stroke")).not.toBe("#FF4D4D")
      }
      if (value > 0) {
        expect(circles[1]?.getAttribute("stroke")).toBe("rgb(var(--accent))")
      }
    },
  )
})
