# deploy/ — Production Deployment Configuration

## What This Directory Is
Production-only Docker Compose and deployment configs. Development uses the root
`docker-compose.yml`. Production uses `deploy/docker-compose.prod.yml`.

## Files
```
deploy/
└── docker-compose.prod.yml    # Production multi-service orchestration
```

## Dev vs Prod Differences
| Feature | Development (root) | Production (deploy/) |
|---|---|---|
| Backend image | Built locally | Pre-built from registry |
| Frontend | Vite dev server | Vercel (external) |
| Secrets | `.env` file | Environment variables injected by Render |
| Volumes | Source code mounted | Model weights + ChromaDB mounted |
| NGINX | Not included | Included (SSL + routing) |
| Reload | `--reload` flag | No reload |

## Deployment Targets
- **Backend API** → Render.com (Python web service)
- **Frontend** → Vercel (React PWA)
- **GPU Inference** → Modal.com (serverless, optional)
- **Database** → Render Postgres
- **Cache** → Render Redis

## Environment Variables in Production
Never commit `.env.prod`. Render and Vercel inject secrets via their dashboards.
Add new env vars to both:
1. `.env.example` (for documentation)
2. Render dashboard → Environment tab
3. Vercel dashboard → Settings → Environment Variables

## GitHub Actions
CI/CD pipeline is in `.github/workflows/deploy.yml` (created in Prompt 09).
Pipeline: push to main → run tests → build Docker image → deploy to Render → deploy to Vercel.
