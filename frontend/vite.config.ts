import { execSync } from "node:child_process"

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"

/**
 * Build-time marker so a running build is identifiable at a glance (Settings tab).
 * SHA: deploy-injected VITE_BUILD_SHA wins; otherwise read local git; "unknown"
 * when neither is available (e.g. inside the Space image, which has no .git).
 * Build time is always accurate and is the reliable "is this stale?" signal.
 */
function resolveBuildSha(): string {
  const injected = process.env.VITE_BUILD_SHA?.trim()
  if (injected) return injected
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
  } catch {
    return "unknown"
  }
}

const BUILD_SHA = resolveBuildSha()
const BUILD_TIME = new Date().toISOString()

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "PoseCoach — AI Form Coach",
        short_name: "PoseCoach",
        description: "Real-time AI gym exercise form correction",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        categories: ["health", "fitness", "sports"],
        background_color: "#0A0B0D",
        theme_color: "#0A0B0D",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        // Purge precache entries from superseded builds instead of leaving them
        // resident. Storage hygiene — it does NOT change which build is served
        // (registerType "autoUpdate" already swaps the SW on the next load).
        cleanupOutdatedCaches: true,
        // No runtimeCaching entries for /api or /ws (P29): stale data from a
        // signed-out or offline cache would silently defeat the sign-in/retry
        // gating added in Stage A. Uncached requests fall straight through to
        // the network, which is what we want for auth-gated API calls.
        navigateFallbackDenylist: [/^\/api\//],
        // onnxruntime-web's wasm binary (~24MB) backs the dev-flagged on-device
        // panel (P32) only. Precaching it would push 24MB onto every real user
        // at install for a surface they never open; it is fetched on demand
        // instead. Workbox refuses >2MB entries anyway and errors the build.
        globIgnores: ["**/ort-wasm-*.wasm"]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      // REST API — backend routes are mounted under /api, no rewrite
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true
      },
      // WebSocket
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
        changeOrigin: true
      }
    }
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    // Playwright specs live in ./e2e and use @playwright/test — exclude
    // them from Vitest's discovery so they only run under `playwright test`.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: { lines: 70 }
    }
  }
})
