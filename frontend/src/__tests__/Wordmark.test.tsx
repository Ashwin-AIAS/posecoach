import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { BRAND } from "../features/brand/brand"
import { Wordmark } from "../features/brand/Wordmark"

describe("Wordmark (P36 C8)", () => {
  it("renders the centralized brand name without renaming the product", () => {
    render(<Wordmark />)
    const el = screen.getByTestId("brand-wordmark")
    expect(el.tagName).toBe("H1")
    expect(el).toHaveTextContent(BRAND.fullName)
    expect(BRAND.fullName).toBe("PoseCoach")
  })

  it("supports rendering as an inline span", () => {
    render(<Wordmark as="span" />)
    expect(screen.getByTestId("brand-wordmark").tagName).toBe("SPAN")
  })
})
