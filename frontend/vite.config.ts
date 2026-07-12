import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
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
        // No runtimeCaching entries for /api or /ws (P29): stale data from a
        // signed-out or offline cache would silently defeat the sign-in/retry
        // gating added in Stage A. Uncached requests fall straight through to
        // the network, which is what we want for auth-gated API calls.
        navigateFallbackDenylist: [/^\/api\//]
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
