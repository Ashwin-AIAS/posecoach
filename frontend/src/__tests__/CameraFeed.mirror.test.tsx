import { createRef } from "react"
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CameraFeed } from "../components/CameraFeed"

describe("CameraFeed mirror", () => {
  it("applies the mirror class when mirrored (front camera)", () => {
    const { container } = render(
      <CameraFeed ref={createRef<HTMLVideoElement>()} error={null} ready mirrored />,
    )
    const video = container.querySelector("video")
    expect(video).not.toBeNull()
    expect(video?.classList.contains("mirror")).toBe(true)
  })

  it("omits the mirror class when not mirrored (back camera)", () => {
    const { container } = render(
      <CameraFeed ref={createRef<HTMLVideoElement>()} error={null} ready mirrored={false} />,
    )
    const video = container.querySelector("video")
    expect(video).not.toBeNull()
    expect(video?.classList.contains("mirror")).toBe(false)
  })
})
