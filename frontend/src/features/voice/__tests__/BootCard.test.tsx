import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BootCard } from "../BootCard"
import { PERSONA_KEYS, PERSONAS } from "../personas"

const ALL_PERSONAS = PERSONA_KEYS.map((key) => PERSONAS[key])

describe("BootCard", () => {
  it("renders a radio chip per persona, checking the selected one", () => {
    render(
      <BootCard
        personas={ALL_PERSONAS}
        persona="forge"
        onSelectPersona={vi.fn()}
        ready
        onUnmute={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByTestId("voice-persona-atlas")).toHaveAttribute("aria-checked", "false")
    expect(screen.getByTestId("voice-persona-forge")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByTestId("voice-persona-vector")).toHaveAttribute("aria-checked", "false")
  })

  it("calls onSelectPersona with the clicked chip's key", () => {
    const onSelectPersona = vi.fn()
    render(
      <BootCard
        personas={ALL_PERSONAS}
        persona="atlas"
        onSelectPersona={onSelectPersona}
        ready
        onUnmute={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId("voice-persona-vector"))
    expect(onSelectPersona).toHaveBeenCalledWith("vector")
  })

  it("calls onUnmute when Unmute is clicked", () => {
    const onUnmute = vi.fn()
    render(
      <BootCard
        personas={ALL_PERSONAS}
        persona="atlas"
        onSelectPersona={vi.fn()}
        ready
        onUnmute={onUnmute}
        onDismiss={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId("voice-boot-unmute"))
    expect(onUnmute).toHaveBeenCalledTimes(1)
  })

  it("calls onDismiss when Stay muted is clicked, without touching mute state itself", () => {
    const onDismiss = vi.fn()
    const onUnmute = vi.fn()
    render(
      <BootCard
        personas={ALL_PERSONAS}
        persona="atlas"
        onSelectPersona={vi.fn()}
        ready
        onUnmute={onUnmute}
        onDismiss={onDismiss}
      />,
    )

    fireEvent.click(screen.getByTestId("voice-boot-stay-muted"))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onUnmute).not.toHaveBeenCalled()
  })

  it("disables Unmute while the manifest isn't ready yet", () => {
    render(
      <BootCard
        personas={ALL_PERSONAS}
        persona="atlas"
        onSelectPersona={vi.fn()}
        ready={false}
        onUnmute={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByTestId("voice-boot-unmute")).toBeDisabled()
  })
})
