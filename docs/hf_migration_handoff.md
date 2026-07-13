# PoseCoach → Hugging Face Spaces Migration — Handoff

**Last updated:** 2026-07-13 (P30 — same-origin deploy)
**Status:** Complete. Frontend and backend both served from the HF Space.

---

## Goal
Migrate PoseCoach backend from Render (slow CPU, 50+ MB cold starts) to Hugging Face Spaces (2 vCPU / 16 GB RAM, free) so real-time inference latency drops from ~2s to ~300–500 ms on webcam frames.

Architecture after P30 (same-origin):
- **Frontend + Backend:** HF Space `Ashwintaibu/posecoach` (FastAPI + YOLO26-Pose + RAG + built React SPA) — **single origin**
- **Postgres:** Render external (`dpg-d8cke0ek1jcs739022fg-a.frankfurt-postgres.render.com`) — unchanged
- **Redis:** Upstash `included-panther-139969.upstash.io:6379` (TLS) — unchanged
- **Vercel:** Retired to a 308 redirect → `https://ashwintaibu-posecoach.hf.space` (old links / installed PWAs don't strand)

> **P30 context:** The cross-origin Vercel→HF path was abandoned because
> Hugging Face's edge proxy answers CORS preflight OPTIONS requests itself
> (bare 200, no `allow-credentials`/`allow-headers`) before they reach the
> app. This broke every preflighted request (POST/PATCH/DELETE with JSON,
> credentialed) from external origins. Same-origin eliminates CORS entirely.

---

## Completed steps

1. **HF Space created:** `Ashwintaibu/posecoach`, SDK=Docker, CPU Basic (free tier)
2. **Repo restructure:** moved all production code from `posecoach/` subfolder up to git root (HF requires Dockerfile at root). The Git repo lives at `C:\Users\mashw\OneDrive\Desktop\CollegeMaterials\GYMVISION AI`.
3. **README frontmatter** added to root README.md (title, sdk: docker, app_port: 8000)
4. **Git LFS** set up for `*.onnx` (12 MB model)
5. **`.gitignore` hardened** to exclude research artifacts (PDFs, .docx, .pptx, .xlsx, .ipynb, fit3d_template.json, archive/, papers/, posecoach_claude_rebuild/, "promone collab/", "test videos/", todo_next/, kaggle.json)
6. **Secret leak scrubbed:** `posecoach/frontend/src/hooks/render n vercel.txt` had an HF token; removed from history via `git filter-repo`. Token was rotated.
7. **HF Space secrets/variables added:**
   - Variables: `MODEL_PATH=models/yolo_posecoach_v1.onnx`, `CHROMA_PATH=data/chroma`, `ENVIRONMENT=production`
   - Secrets: `POSTGRES_URL` (postgresql+asyncpg://… external Render URL), `JWT_SECRET`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `REDIS_URL` (rediss:// with TLS)
8. **Upstash Redis** created in eu-west-1 (closest to Frankfurt Postgres)
9. **POSTGRES_URL** corrected to use `postgresql+asyncpg://` scheme (was failing as `postgresql://` because the app uses async SQLAlchemy)
10. **End-to-end smoke test:** WebSocket connects (status 101), frames flow, server responds with JSON
11. **P30 — Same-origin deploy:** Dockerfile now has a multi-stage build (Node 20 → `npm run build` → copy `dist` to `/app/static`). `app/main.py` mounts the SPA when the static dir is present. Vercel redirects all traffic to the Space.

---

## Environment variables (post-P30)

### ALLOWED_ORIGINS
Now only needs `http://localhost:5173` (local dev). The production frontend is
served from the same origin as the API, so CORS does not apply. Remove any
Vercel domains from this variable on the Space.

### COOKIE_SAMESITE
Should be **unset** in production (defaults to `lax`, which is correct for
same-origin). The `none` value was only needed for the now-retired cross-origin
Vercel→HF path. The env-driven plumbing from P29 stays (useful for local dev
where frontend and backend may run on different ports).

---

## Reference: file structure on HF Space (post-P30)

```
/  (HF Space root, also Git root at GYMVISION AI/)
├── Dockerfile             ← Multi-stage: Node build + Python runtime
├── README.md              ← has HF YAML frontmatter
├── requirements.txt
├── pyproject.toml
├── alembic/, alembic.ini
├── app/
│   ├── main.py            ← YOLO load + SPA static mount (conditional)
│   ├── static_spa.py      ← SPA serving logic (P30)
│   ├── inference/runner.py
│   ├── analysis/
│   ├── chatbot/           (RAG, Gemini, Qwen)
│   └── api/v1/
├── frontend/              (Source — built at Docker build time)
│   ├── vercel.json        ← 308 redirect to Space (Vercel retired)
│   └── ...
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
| `https://ashwintaibu-posecoach.hf.space/` | React SPA shell (app) |
| `https://ashwintaibu-posecoach.hf.space/health` | `{"status":"ok"}` |
| `https://ashwintaibu-posecoach.hf.space/health/deep` | `{"postgres":"ok","redis":"ok","model":"ok"}` |
| `https://ashwintaibu-posecoach.hf.space/docs` | FastAPI Swagger UI |

If `/health/deep` returns 503, one of the three is down — log into HF Settings and check the env var for that dependency.
