# P30 Deploy & Verification Notes

These deployment notes guide the production rollout and verification of the same-origin deploy (serving frontend and API from Hugging Face Space).

---

## 1. Pre-Deployment Configuration (Hugging Face Space)

Before pushing the frontend-integrated build to Hugging Face, update the Space variables in the Settings panel:

1. **`COOKIE_SAMESITE`**: Remove this variable or set it to `lax`. Since frontend and API now share the same origin, a `none` policy (which requires `Secure; SameSite=None`) is no longer necessary.
2. **`ALLOWED_ORIGINS`**: Change to `http://localhost:5173` (only needed for local dev). Remove any Vercel domain from the allowed origins.

---

## 2. Deploy to Hugging Face Space

Deploy the consolidated main branch to the Hugging Face Space remote:

```powershell
# From the repository root
git push hf main
```
*Note: Enter your Hugging Face credentials if prompted (Username: `Ashwintaibu`, using your Write Token).*

Monitor the build progress in the Hugging Face Space log viewer:
- Confirm that the `node:20-alpine` stage successfully runs `npm ci` and `npm run build`.
- Confirm that the final container starts cleanly with `startup_complete` logged.
- Confirm `/health/deep` returns all-clear (`{"postgres":"ok","redis":"ok","model":"ok"}`).

---

## 3. Deploy the Vercel Redirect

Deploy the updated `vercel.json` to Vercel to activate the permanent 308 redirect:
- The redirect maps all path requests (e.g. `posecoach-rho.vercel.app/workouts`) to the new canonical URL at the Space: `https://ashwintaibu-posecoach.hf.space/workouts`.

---

## 4. Run Production Smoke Tests (Stage C)

Once both deployments are live, run the browser-level Playwright smoke tests from your local machine:

```powershell
# Run the Playwright smoke spec against the live Space
cd frontend
$env:PROD_BASE_URL="https://ashwintaibu-posecoach.hf.space"
npx playwright test --config=e2e/prod-smoke.config.ts
```

This verifies that:
- Preflight `OPTIONS` requests are not triggered/blocked.
- Registration, sign-in, and account deletion function under a real browser.
- PWA static assets and index cache headers return `no-cache`.

---

## 5. Manual Verification

Perform a quick sanity check on a mobile device:
1. Navigate to `https://ashwintaibu-posecoach.hf.space`.
2. Install the PWA from the browser.
3. Sign in to your account.
4. Verify workouts can be logged and food items can be searched.
5. Check if the live Coach tab successfully upgrades the WebSocket connection.
