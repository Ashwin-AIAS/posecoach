/**
 * Resolves the VITE_OVERLAY_NEON feature flag (§4.1): default ON in dev,
 * gated (default OFF) in a production build until explicitly cut over.
 * Setting VITE_OVERLAY_NEON to anything other than the literal string
 * "false" forces it on in any environment; setting it to "false" forces it
 * off (e.g. to keep prod on the legacy overlay while dev opts in early).
 */
export function isOverlayNeonEnabled(env: ImportMetaEnv = import.meta.env): boolean {
  const raw = env.VITE_OVERLAY_NEON as string | undefined
  if (raw !== undefined) return raw !== "false"
  return env.DEV
}
