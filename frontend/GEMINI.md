# frontend/ — React 18 PWA

## What This Directory Is
The entire browser-side application. Vite + React 18 + TypeScript strict + Tailwind CSS.
Built as a Progressive Web App — installable on mobile.

## Directory Map
```
frontend/
├── src/
│   ├── main.tsx              # React entry point, renders <App />
│   ├── App.tsx               # Root component — layout, routing
│   ├── hooks/                # ALL WebSocket, camera, SSE, and data hooks live here
│   │   ├── useCamera.ts      # requestAnimationFrame camera capture (NOT setInterval)
│   │   ├── useWebSocket.ts   # WS connection with exponential backoff reconnect
│   │   └── useChat.ts        # SSE EventSource for streaming chatbot
│   └── components/           # Pure UI components — no WS or camera logic inline
│       └── FormScoreDisplay.tsx
├── public/
│   ├── icon-192.png          # PWA icon (required)
│   └── icon-512.png          # PWA icon (required)
├── vite.config.ts            # Vite + PWA plugin config
├── tsconfig.json             # TypeScript strict mode
├── tailwind.config.js        # Content paths only — no custom theme needed
├── package.json
└── Dockerfile.dev
```

## Non-Negotiable Rules
- Camera MUST use `requestAnimationFrame` — NEVER `setInterval`
- `<video>` element MUST have `playsInline` attribute (iOS Safari requirement)
- WebSocket logic MUST live in `src/hooks/useWebSocket.ts` — not inline in components
- Camera logic MUST live in `src/hooks/useCamera.ts` — not inline in components
- SSE chat MUST live in `src/hooks/useChat.ts` — not inline in components
- Styling: Tailwind utility classes ONLY — no third-party UI libraries
- `React.memo` on components that receive WebSocket data but don't re-trigger effects
- No `localStorage` for JWT or session data — cookies only (set by backend)
- No `any` TypeScript type — use proper types or `unknown` with guards

## Camera Capture Pattern (Always)
```typescript
// Cap at 15 FPS — 66ms minimum between frames
const MIN_INTERVAL_MS = 66

let lastFrameTime = 0
const loop = () => {
  const now = Date.now()
  if (now - lastFrameTime >= MIN_INTERVAL_MS) {
    lastFrameTime = now
    captureAndSend()
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
```

## visibilitychange — Always Implement
```typescript
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera()
  else startCamera()
})
```

## Dev Server
```bash
cd frontend && npm run dev   # http://localhost:5173
```
API calls proxy to `http://localhost:8000` (configured in vite.config.ts).

## What Does NOT Go Here
- Python code → `app/`
- NGINX config → `nginx/`
- E2E tests → `e2e/`
