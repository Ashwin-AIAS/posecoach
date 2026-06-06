# PoseCoach → Hugging Face Spaces Migration — Handoff

**Last updated:** 2026-05-31
**Status:** 95% complete. App is live on HF but inference returns empty keypoints. Final fix committed locally, needs push + verify.

---

## Goal
Migrate PoseCoach backend from Render (slow CPU, 50+ MB cold starts) to Hugging Face Spaces (2 vCPU / 16 GB RAM, free) so real-time inference latency drops from ~2s to ~300–500 ms on webcam frames.

Architecture after migration:
- **Frontend:** Vercel (`posecoach-ashwins-projects-8d106fa7.vercel.app`) — unchanged
- **Backend:** HF Space `Ashwintaibu/posecoach` (FastAPI + YOLO26-Pose + RAG) — NEW
- **Postgres:** Render external (`dpg-d8cke0ek1jcs739022fg-a.frankfurt-postgres.render.com`) — unchanged
- **Redis:** Upstash `included-panther-139969.upstash.io:6379` (TLS) — NEW (replaces Render internal Redis which is unreachable from HF)

---

## Completed steps

1. **HF Space created:** `Ashwintaibu/posecoach`, SDK=Docker, CPU Basic (free tier)
2. **Repo restructure:** moved all production code from `posecoach/` subfolder up to git root (HF requires Dockerfile at root). The Git repo lives at `C:\Users\mashw\OneDrive\Desktop\CollegeMaterials\GYMVISION AI`.
3. **README frontmatter** added to root README.md (title, sdk: docker, app_port: 8000)
4. **Git LFS** set up for `*.onnx` (12 MB model)
5. **`.gitignore` hardened** to exclude research artifacts (PDFs, .docx, .pptx, .xlsx, .ipynb, fit3d_template.json, archive/, papers/, posecoach_claude_rebuild/, "promone collab/", "test videos/", todo_next/, kaggle.json)
6. **Secret leak scrubbed:** `posecoach/frontend/src/hooks/render n vercel.txt` had an HF token; removed from history via `git filter-repo`. Token was rotated.
7. **HF Space secrets/variables added:**
   - Variables: `MODEL_PATH=models/yolo_posecoach_v1.onnx`, `ALLOWED_ORIGINS=https://posecoach-rho.vercel.app`, `CHROMA_PATH=data/chroma`, `ENVIRONMENT=production`
   - Secrets: `POSTGRES_URL` (postgresql+asyncpg://… external Render URL), `JWT_SECRET`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `REDIS_URL` (rediss:// with TLS)
8. **Upstash Redis** created in eu-west-1 (closest to Frankfurt Postgres)
9. **POSTGRES_URL** corrected to use `postgresql+asyncpg://` scheme (was failing as `postgresql://` because the app uses async SQLAlchemy)
10. **Vercel** redeployed with `VITE_API_URL=https://ashwintaibu-posecoach.hf.space`
11. **End-to-end smoke test:** WebSocket connects (status 101), frames flow, server responds with JSON

---

## Current blocker (1 fix away from done)

**Symptom:** API responds but keypoints array is always empty:
```json
{"keypoints":[],"confidence":[],"score":null,"cues":["Step into frame"],"latency_ms":0.0}
```

**Root cause (confirmed via HF logs):**
```
WARNING ⚠️ Unable to automatically guess model task, assuming 'task=detect'
```
Ultralytics loads `.onnx` as detection (not pose) by default, so `results[0].keypoints` is None.

**Fix applied locally (not yet pushed):**

`app/main.py` line 53:
```python
# before
application.state.model = YOLO(model_path)
# after
application.state.model = YOLO(model_path, task="pose")
```

---

## Next steps for Claude Code to finish

### 1. Push the fix
```powershell
cd "C:\Users\mashw\OneDrive\Desktop\CollegeMaterials\GYMVISION AI"
git add app/main.py
git commit -m "Fix: load ONNX as pose model (task='pose')"
git push hf main
```
Use HF Write token when prompted. Username: `Ashwintaibu`.

### 2. Wait for HF rebuild (~30 sec, layers cached)
Watch logs at https://huggingface.co/spaces/Ashwintaibu/posecoach
- Confirm the "Unable to automatically guess model task" warning is GONE
- Confirm `startup_complete` log line appears

### 3. Verify end-to-end
- Open https://posecoach-ashwins-projects-8d106fa7.vercel.app
- Log in, allow camera, pick an exercise, stand back (full body visible)
- Skeleton overlay should draw, form score should populate
- Inspect WebSocket "Messages" tab in DevTools → `keypoints` array should now have 17 pairs

### 4. If keypoints still empty after the task='pose' fix
Likely the ONNX export needs `task` metadata embedded. Workaround options:
- Re-export the ONNX in Colab using `model.export(format='onnx', task='pose', ...)`
- OR fall back to the `.pt` file: change `MODEL_PATH` env var to `models/yolo_posecoach_v1.pt` and add the .pt to git (track via LFS, file is in .gitignore currently — needs `git lfs track "*.pt"` then add)
- OR specify `data` argument: `YOLO(model_path, task="pose", data="path/to/dataset.yaml")`

### 5. Final hygiene (after success)
- **Rotate Postgres password** — was pasted in chat. Render dashboard → posecoach-db → Reset Password. Update HF secret `POSTGRES_URL` and Render web service env.
- Decommission old Render `posecoach-api` web service (or keep as backup) — it's no longer in the user flow.

---

## Reference: file structure on HF Space (post-flatten)

```
/  (HF Space root, also Git root at GYMVISION AI/)
├── Dockerfile             ← HF builds from this
├── README.md              ← has HF YAML frontmatter
├── requirements.txt
├── pyproject.toml
├── alembic/, alembic.ini
├── app/
│   ├── main.py            ← contains the YOLO(...) load
│   ├── inference/runner.py
│   ├── analysis/
│   ├── chatbot/           (RAG, Gemini, Qwen)
│   └── api/v1/
├── frontend/              (Vite/React — not used by HF, kept for repo unity)
├── models/yolo_posecoach_v1.onnx  ← LFS
├── data/knowledge_base/   (RAG markdown)
├── scripts/
├── tests/
├── deploy/, nginx/, docker-compose.yml
└── .gitignore, .gitattributes, .python-version, .env.example
```

Git remotes:
- `origin` → GitHub (`Ashwin-AIAS/posecoach.git`)
- `hf` → Hugging Face Space (`Ashwintaibu/posecoach`)

---

## Quick health-check URLs

| Endpoint | Expected |
|---|---|
| `https://ashwintaibu-posecoach.hf.space/health` | `{"status":"ok"}` |
| `https://ashwintaibu-posecoach.hf.space/health/deep` | `{"postgres":"ok","redis":"ok","model":"ok"}` |
| `https://ashwintaibu-posecoach.hf.space/docs` | FastAPI Swagger UI |

If `/health/deep` returns 503, one of the three is down — log into HF Settings and check the env var for that dependency.
