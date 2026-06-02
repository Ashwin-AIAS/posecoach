/**
 * Color helpers for the pose overlay. All inputs/outputs are `#rrggbb` hex.
 *
 * `lighten`/`darken`/`desaturate` operate in HSL so bevel shading and trail
 * fading stay perceptually even. `confColor` and the form-correctness colors
 * use the exact palette from the P03b spec.
 */

// --- Confidence palette (deliverable #1) ---
export const CONF_GREEN = "#22c55e"
export const CONF_YELLOW = "#eab308"
export const CONF_RED = "#ef4444"

// --- Form-correctness palette (deliverable #2) ---
export const FORM_IN_RANGE = "#10b981" // emerald
export const FORM_OUT_RANGE = "#f43f5e" // rose
export const FORM_UNSCORED = "#94a3b8" // slate

// A joint scores exactly 100 from the backend when in range; allow tiny slack.
export const IN_RANGE_SCORE = 99.0

/** Spotlight halo + worst-joint accent. */
export const SPOTLIGHT_RED = "#ef4444"

/** Confidence → dot color (>=0.8 green, 0.5–0.8 yellow, <0.5 red). */
export function confColor(conf: number): string {
  if (conf >= 0.8) return CONF_GREEN
  if (conf >= 0.5) return CONF_YELLOW
  return CONF_RED
}

/** Per-joint form score → bone color (in-range emerald, out-of-range rose). */
export function scoreColor(score: number | undefined): string {
  if (score === undefined) return FORM_UNSCORED
  return score >= IN_RANGE_SCORE ? FORM_IN_RANGE : FORM_OUT_RANGE
}

interface Hsl {
  readonly h: number
  readonly s: number
  readonly l: number
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "")
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ]
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h / 6, s, l }
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

function hslToHex({ h, s, l }: Hsl): string {
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  const to2 = (x: number): string =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** Increase lightness by `amount` (0–1 of full scale). */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const hsl = rgbToHsl(r, g, b)
  return hslToHex({ ...hsl, l: clamp01(hsl.l + amount) })
}

/** Decrease lightness by `amount` (0–1 of full scale). */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const hsl = rgbToHsl(r, g, b)
  return hslToHex({ ...hsl, l: clamp01(hsl.l - amount) })
}

/** Reduce saturation by `amount` (0–1) — used for muted motion trails. */
export function desaturate(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const hsl = rgbToHsl(r, g, b)
  return hslToHex({ ...hsl, s: clamp01(hsl.s - amount) })
}
