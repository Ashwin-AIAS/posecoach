# Deploy Reality — where the frontend actually lives

Short, load-bearing facts to stop wasting time on "my change isn't showing."

## The URL to hand to study participants

**`https://ashwintaibu-posecoach.hf.space`** — the Hugging Face Space. That is the
real app. Use it in the SUS study, in the thesis, everywhere.

## Vercel is redirect-only — it never serves the app

`frontend/vercel.json` 308-redirects **all** of `posecoach-rho.vercel.app/(.*)` to
`https://ashwintaibu-posecoach.hf.space/$1`. So:

- Vercel serves **no HTML, no JS, no service worker** — every request bounces.
- The frontend bundle is built inside the **root `Dockerfile`** (multi-stage:
  `frontend/dist` → `/app/static`) and served by FastAPI's StaticFiles mount
  (`app/static_spa.py`), same-origin on the Space.
- The real frontend deploy path is **`git push hf main`** → Space image rebuild.
  `git push origin main` (GitHub) does **not** deploy the frontend by itself.

## The stale-build trap (this is the one that actually bit us)

The neon overlay cutover was live on the Space, but installed PWAs / returning
browsers kept booting the old bundle. The instinct was "the HTTP cache headers are
wrong" — they weren't; `index.html`/`sw.js` were already `no-cache`.

**The real cause was clearing the service worker on the wrong origin.** The SW is
registered by whatever origin *served* it. Because Vercel only redirects, the SW
lives on **`ashwintaibu-posecoach.hf.space`**, not on `posecoach-rho.vercel.app`.
"Clear site data" / unregister-SW on the Vercel URL does nothing to the SW that is
actually running — it's on the Space origin. Do all SW/cache clearing against
`ashwintaibu-posecoach.hf.space`.

### What the code changes in this branch do (and don't do)

- **Cache headers (`app/static_spa.py`)** — entry points (`index.html`, `sw.js`,
  `registerSW.js`, `manifest`) are `no-cache, must-revalidate`; hashed `/assets/*`
  are `immutable, max-age=31536000`. This makes the *HTTP layer* correct so a
  returning browser always revalidates the shell.
- **`cleanupOutdatedCaches: true` (workbox)** — **storage hygiene only.** It purges
  superseded precache entries so they don't sit resident. It is **NOT** the reason
  stale bundles were served, and it does not change which build is served
  (`registerType: "autoUpdate"` already swaps the SW on the next load). Do not
  frame it as the fix — the fix was clearing the SW on the correct (Space) origin.

## "Which build is live?" in 2 seconds

Open **Settings → About → Build**. It shows the short commit SHA and the build date
(`__BUILD_SHA__` / `__BUILD_TIME__`, injected at build time via `vite.config.ts`).

- Inside the Space image there is no `.git`, so the **SHA reads `unknown`** unless
  `VITE_BUILD_SHA` is passed to the frontend build stage. The **build date is always
  accurate** and is the reliable stale-check: if it's older than your last
  `git push hf main`, you're looking at a cached bundle — clear the SW on the
  Space origin, not the Vercel one.
