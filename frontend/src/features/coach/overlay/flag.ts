/**
 * Resolves the VITE_OVERLAY_NEON feature flag (§4.1, cut over per
 * FIX_OVERLAY_NEON_CUTOVER.md option A): the neon overlay is now the
 * default in every environment. Setting VITE_OVERLAY_NEON to the literal
 * string "false" is the only-off escape hatch back to the legacy overlay
 * (instant rollback, e.g. for the e2e suite or a prod incident).
 */
export function isOverlayNeonEnabled(env: ImportMetaEnv = import.meta.env): boolean {
  return (env.VITE_OVERLAY_NEON as string | undefined) !== "false"
}
