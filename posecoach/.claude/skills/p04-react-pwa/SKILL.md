---
name: p04-react-pwa
description: PoseCoach P04 — React 18 + TypeScript + Vite PWA frontend with webcam capture, WebSocket connection, and real-time pose overlay. Auto-invoked when working on frontend, React components, camera feed, canvas overlay, or PWA setup.
allowed-tools: Read, Write, Edit, Bash
---

# P04 — React PWA Frontend

## Goal
Build the PoseCoach web app: camera capture → WebSocket stream to backend → real-time pose keypoint overlay on canvas → coaching cues display. Works as a Progressive Web App (installable).

## Key Files
- `frontend/src/` — React app source
- `frontend/src/hooks/usePoseStream.ts` — WebSocket + inference hook
- `frontend/src/components/PoseOverlay.tsx` — canvas keypoint rendering
- `frontend/src/components/CameraFeed.tsx` — webcam capture
- `frontend/src/components/CoachingCues.tsx` — score + cue display
- `frontend/vite.config.ts` — Vite + PWA config
- `frontend/public/manifest.json` — PWA manifest

## Architecture
```
CameraFeed (getUserMedia)
    ↓ frame (canvas toBlob → base64)
usePoseStream (WebSocket)
    ↓ results (keypoints, score, cues)
PoseOverlay (canvas 2D — draws skeleton)
CoachingCues (score bar, text cues)
```

## Frame Capture Loop
- Capture at 15 FPS (65ms interval) using `requestAnimationFrame`
- Send only when WebSocket is OPEN and previous frame result received (no queuing)
- Canvas → `toDataURL('image/jpeg', 0.7)` for compression

## Skeleton Drawing
- 17 keypoints (COCO) — draw circles at each joint
- 18 limb connections — draw lines between connected joints
- Color by confidence: green (>0.7), yellow (0.4–0.7), skip (<0.4)

## TypeScript Rules
- No `any` — type all WebSocket messages
- `usePoseStream` returns typed `PoseResult | null`
- Strict null checks on all keypoint accesses

## Done Criteria
- [ ] Camera feed renders in browser
- [ ] WebSocket connects to `ws://localhost:8000/ws/inference`
- [ ] Skeleton overlay renders on canvas in real-time
- [ ] Coaching cues update per frame
- [ ] PWA installable (Lighthouse PWA score > 90)
- [ ] `npx vitest run` green
- [ ] No localStorage usage anywhere

## Thesis Metric
- UI responsiveness (frame-to-cue latency perceived by user)
- PWA Lighthouse score
