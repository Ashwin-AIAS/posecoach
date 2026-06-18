# P15b — iOS PWA Install Support (Verify, Test, Commit)

> **Prompt for Claude Code.** The code changes described here were ALREADY made
> directly on disk (by Cowork, outside git). Your job: verify each file matches
> the spec below, fix anything missing or mangled (the repo lives in OneDrive —
> partial/truncated writes have happened before), run the quality gate, commit.
> If a file is intact, do NOT rewrite it — verify and move on.

## Background (why this exists)

iOS never fires `beforeinstallprompt` — Apple provides no PWA install API.
The only install path on iPhone/iPad is manual: Safari → Share → Add to Home
Screen. So the fix is (a) correct Apple meta tags, and (b) an in-app banner
that shows iOS users those instructions, since the browser never will.

---

## 1. Verify `frontend/index.html`

Must contain ALL of these in `<head>` (order doesn't matter):

```html
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="PoseCoach" />
<link rel="icon" type="image/png" href="/icon-192.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/icon-192.png" />
```

Notes: iOS ignores manifest icons — `apple-touch-icon` is the only home-screen
icon source. 192px scales fine; if you can generate a real 180×180 from
`frontend/public/icon-512.png` (e.g. with sharp via a one-off node script),
save it as `frontend/public/icon-180.png` and point the link at it. Optional.

## 2. Verify `frontend/src/hooks/useInstallPrompt.ts`

The hook must export `type InstallMode = "native" | "ios-manual" | null` and
return `{ installMode, canInstall, promptInstall }` where:

- `"native"` — Chromium fired `beforeinstallprompt` (existing deferred-event
  logic, unchanged).
- `"ios-manual"` — `isIos() && !isStandalone()`, evaluated once via a lazy
  `useState` initializer.
- `null` — installed already, or no install path.

Required helpers (exact behavior, names can match what's on disk):

```ts
function isStandalone(): boolean {
  // Guard matchMedia — jsdom (vitest) doesn't implement it.
  if (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) return true
  // iOS home-screen launches expose this non-standard flag.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIos(): boolean {
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return true
  // Modern iPadOS masquerades as desktop Safari ("Macintosh") but has touch.
  return ua.includes("Macintosh") && navigator.maxTouchPoints > 1
}
```

`promptInstall()` must resolve `false` in ios-manual mode (no API to call).
No `any`. Strict mode clean.

## 3. Verify `frontend/src/components/InstallBanner.tsx`

- Renders `null` when `installMode === null` or dismissed.
- `installMode === "native"` → existing branded Install button (calls
  `promptInstall`).
- `installMode === "ios-manual"` → instruction text with
  `data-testid="ios-install-hint"`: Install PoseCoach: tap [share-icon SVG]
  **Share** → **Add to Home Screen**. The share icon is an inline SVG (square
  with up-arrow, `aria-label="Share"`, `role="img"`).
- Dismissal persists to localStorage key `posecoach-install-dismissed` ("1"),
  read lazily on mount; ALL localStorage access wrapped in try/catch (Safari
  private mode throws on write). This does NOT violate the JWT-localStorage
  ban — it stores a UI flag, never a token.
- Keep the existing Tailwind classes / bottom-banner layout and the
  `data-testid="install-banner"` wrapper.

## 4. Verify `frontend/src/__tests__/InstallBanner.test.tsx`

Four tests (file should already exist):

1. Desktop browser, no `beforeinstallprompt` → banner absent.
2. iPhone UA (mock via `vi.spyOn(window.navigator, "userAgent", "get")`) →
   `ios-install-hint` visible, "Add to Home Screen" text present, and **no**
   Install button.
3. Dismiss → banner gone, AND still gone after unmount + re-render
   (persistence).
4. iPhone UA but `navigator.standalone === true` (already installed) → banner
   absent. Clean the property up after.

`afterEach`: `vi.restoreAllMocks()` + `window.localStorage.clear()`.

## 5. Quality gate

```bash
cd frontend
npx tsc --noEmit
npx vitest run
```

Both green. Backend untouched — no pytest needed, but nothing stops you
running it.

## 6. Commit

```
[P15b] feat: iOS PWA install support (A2HS hint banner + apple metas)

- ios-manual mode in useInstallPrompt (UA + standalone detection)
- InstallBanner: Share -> Add to Home Screen instructions on iOS
- persistent dismissal (localStorage, private-mode safe)
- apple-touch-icon 180 sizing + mobile-web-app-capable metas
- 4 InstallBanner tests
```

Push from Windows (LFS), redeploy HF Space as usual.

## 7. Acceptance checklist

- [ ] All 4 files match spec (or were repaired to match)
- [ ] `tsc --noEmit` and `vitest run` green
- [ ] No `any`, no unguarded `matchMedia`/`localStorage`
- [ ] Manual check after deploy: open site in iOS Safari → banner appears;
      Add to Home Screen → launches fullscreen; banner never shows in the
      installed app
