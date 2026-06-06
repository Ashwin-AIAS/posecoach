# Next To-Do — Tuesday, 2 June 2026 (at uni, faster internet)

> Premium upgrade is **done, committed, and pushed** (`origin/main`, commits `42e0287..cc06822`).
> These items need either a fast/stable connection or a running full stack — do them at uni.

## 1. Get the stack building — ✅ DONE (2 June, at uni)
The full dev stack now builds and runs on the fast connection. All six services
up and green (`/health/deep` → postgres+redis+model ok, frontend 200, Prometheus,
Grafana). Confirmed torch is the **CPU build** in-container (`2.4.1+cpu`, ~190 MB).

- [x] Re-ran `docker compose up --build` — backend image built fine (CPU torch + RAG ingest), no timeout.
- [x] Dockerfile CPU-only torch fix already in place (committed `ff81f92`).
- [x] Fixed three dev-compose issues found while bringing it up:
      (a) run `alembic upgrade head` before uvicorn so a fresh volume has tables;
      (b) `PYTHONPATH: /app` so the `alembic` console script can import `app.*`;
      (c) mount the whole `./frontend` dir (not just src/public) so Vite finds index.html.
- [ ] Optional cleanup: move test/lint deps (pytest, ruff, mypy, pytest-*) out of `requirements.txt`
      into `requirements-dev.txt` so they're not baked into the runtime image.

## 2. Final manual verification (the brief's last step — needs the running stack + webcam)
Once `docker-compose up` is healthy:
- [ ] Open the app, switch through **all 15 exercises**; confirm **none return score 0** or
      "Unknown exercise" (Push-Up, Hammer Curl, Lateral Raise, Barbell Row, DB Shoulder Press,
      Diamond Push-Up, Drag Curl, One-Arm Row + the original 7).
- [ ] Confirm each exercise's **"?" how-to demo** loads its curated YouTube video.
- [ ] Watch the **live latency badge** in the header — confirm it stays **< 100 ms** (p95).
- [ ] Check the **rep counter** increments on real reps and **Finish set** shows the session summary.
- [ ] **Screenshot the redesigned UI** for the thesis (camera stage + score ring + coaching panel).

## 3. Nice-to-have while you're at it
- [ ] Run Playwright E2E (`cd frontend && npx playwright test`) — the selector specs were updated
      for the new card grid but haven't been run against a live browser here.
- [ ] Decide whether to push the Dockerfile fix or keep iterating.

---
*Context: gate is green (ruff, mypy --strict 38 files, pytest 255 / 98% analysis cov, vitest 63, build OK).
See `memory/premium_upgrade.md` for the full summary.*
