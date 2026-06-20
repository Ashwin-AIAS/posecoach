import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CollapsibleSelect } from "../components/CollapsibleSelect"

describe("CollapsibleSelect", () => {
  it("portals the open sheet to document.body, not the local DOM subtree (P23)", () => {
    const { container } = render(
      <CollapsibleSelect
        open={true}
        onToggle={vi.fn()}
        dialogLabel="Choose pose"
        triggerAriaLabel="Change pose"
        label={<span>Front Double Biceps</span>}
      >
        <div data-testid="sheet-body">content</div>
      </CollapsibleSelect>,
    )

    // Rendered in the document (so it isn't trapped under a positioned
    // ancestor's stacking context — see comment in CollapsibleSelect.tsx) but
    // not inside this component's own local subtree.
    expect(screen.getByTestId("sheet-body")).toBeInTheDocument()
    expect(container.querySelector('[data-testid="sheet-body"]')).not.toBeInTheDocument()
  })

  it("closes via the backdrop and is absent when closed", () => {
    render(
      <CollapsibleSelect
        open={false}
        onToggle={vi.fn()}
        dialogLabel="Choose pose"
        triggerAriaLabel="Change pose"
        label={<span>Front Double Biceps</span>}
      >
        <div data-testid="sheet-body">content</div>
      </CollapsibleSelect>,
    )

    expect(screen.queryByTestId("sheet-body")).not.toBeInTheDocument()
  })

  it("invokes onToggle when the trigger is clicked", () => {
    const onToggle = vi.fn()
    render(
      <CollapsibleSelect
        open={false}
        onToggle={onToggle}
        dialogLabel="Choose pose"
        triggerAriaLabel="Change pose"
        triggerTestId="change-btn"
        label={<span>Front Double Biceps</span>}
      >
        <div>content</div>
      </CollapsibleSelect>,
    )

    fireEvent.click(screen.getByTestId("change-btn"))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
