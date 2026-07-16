/**
 * QA-only harness (§6/§7 Stage 2): mounts PoseOverlayNeon over a static dark
 * poster with a fixed fixture selected by `?state=good|fault|idle`, so
 * Playwright can snapshot it with no camera, WebSocket, or backend involved.
 * Not imported by App.tsx / main.tsx — reachable only via overlay-preview.html,
 * which vite build's default single-entry (index.html) never bundles.
 */
import { FIXTURE_ASPECT, FIXTURES } from "./fixtures"
import type { FixtureName } from "./fixtures"
import { PoseOverlayNeon } from "./PoseOverlayNeon"

function readFixtureName(): FixtureName {
  const raw = new URLSearchParams(window.location.search).get("state")
  return raw === "fault" || raw === "idle" ? raw : "good"
}

export function OverlayPreview(): JSX.Element {
  const name = readFixtureName()
  const frame = FIXTURES[name]

  return (
    <div
      data-testid="overlay-preview-stage"
      data-state={name}
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#000",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "min(90vw, 640px)",
          aspectRatio: FIXTURE_ASPECT,
          borderRadius: 16,
          overflow: "hidden",
          background:
            "radial-gradient(120% 90% at 50% 20%, #1b2436 0%, #0e1626 55%, #03060c 100%)",
        }}
      >
        <PoseOverlayNeon frame={frame} />
      </div>
    </div>
  )
}
