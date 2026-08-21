import type { CSSProperties } from "react";
import type { Theme } from "./theme";

// Literal values of the --bg/--surface variables in globals.css. Contrast
// math needs actual RGB, not a CSS var reference, so these are duplicated
// here — keep in sync with the :root / [data-theme="light"] blocks there.
export const THEME_SURFACE_COLORS: Record<Theme, { page: string; card: string }> = {
  dark: { page: "#0a0710", card: "#170f26" },
  light: { page: "#f4f1fa", card: "#ffffff" },
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// WCAG contrast ratio (1–21). Returns null if either color isn't a hex
// string we can parse (named colors, rgb(), an image — can't be scored).
export function contrastRatio(hexA: string, hexB: string): number | null {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return null;
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function hexToHsl(hex: string): [number, number, number] | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r1, g1, b1] = [0, 0, 0];
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const rgb = [r1 + m, g1 + m, b1 + m].map((v) => Math.round(v * 255));
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Nudges `preferred` lighter or darker (keeping its hue/saturation) until it
// clears `targetRatio` against `background` — lightening over a dark
// background, darkening over a light one. Preserves the user's chosen color
// exactly when it's already legible, and preserves its *character* (not
// just swapping to flat black/white) when it needs adjusting. Walking a
// color's own lightness to the extreme (0 or 1) always converges on
// black/white, so this is guaranteed to find a legible result whenever
// `background` and `preferred` are both parseable hex colors.
function legibleVariant(background: string, preferred: string, targetRatio: number): string | null {
  const hsl = hexToHsl(preferred);
  const bgRgb = hexToRgb(background);
  if (!hsl || !bgRgb) return null;
  const [h, s, l] = hsl;
  const startRatio = contrastRatio(background, preferred);
  if (startRatio !== null && startRatio >= targetRatio) return preferred;

  const direction = relativeLuminance(bgRgb) < 0.5 ? 1 : -1;
  for (let step = 1; step <= 100; step++) {
    const newL = Math.max(0, Math.min(1, l + direction * (step / 100)));
    const candidate = hslToHex(h, s, newL);
    const ratio = contrastRatio(background, candidate);
    if (ratio !== null && ratio >= targetRatio) return candidate;
    if (newL <= 0 || newL >= 1) break;
  }
  return null;
}

// Picks a text color guaranteed to read against `background`: the caller's
// preferred color, lightened or darkened just enough to clear WCAG AA
// (4.5:1) if it doesn't already — so the result still looks like the color
// the user chose instead of jumping straight to flat black/white. Falls
// back to whichever of black/white contrasts better when there's no
// preferred color, or `preferred` couldn't be adjusted (e.g. background
// isn't a scorable hex color).
export function readableTextColor(
  background: string | null | undefined,
  preferred?: string | null,
): string | undefined {
  if (!background) return preferred ?? undefined;
  if (preferred) {
    const variant = legibleVariant(background, preferred, 4.5);
    if (variant) return variant;
    if (contrastRatio(background, preferred) === null) return preferred; // unscorable background
  }
  const whiteRatio = contrastRatio(background, "#ffffff");
  const blackRatio = contrastRatio(background, "#000000");
  if (whiteRatio === null || blackRatio === null) return preferred ?? undefined;
  return whiteRatio >= blackRatio ? "#ffffff" : "#000000";
}

function blend(fgHex: string, bgHex: string, alpha: number): string | null {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return null;
  const mixed = fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// A de-emphasized variant of `safeColor` (for .text-dim/.text-faint) that
// still clears a relaxed 3:1 contrast bar against `background`; falls back
// to the full-strength safe color if blending would drop below that.
function dimVariant(background: string, safeColor: string, alpha: number): string {
  const blended = blend(safeColor, background, alpha);
  if (!blended) return safeColor;
  const ratio = contrastRatio(background, blended);
  return ratio !== null && ratio >= 3 ? blended : safeColor;
}

// Style for a box whose background and/or text color may be user-customized.
// Returns {} (no override at all) when neither is customized, so a fully
// default profile renders pixel-identical to before — theme CSS variables
// already guarantee contrast for that case. Otherwise computes a
// contrast-safe `color` against whatever this box's background actually is
// (custom, or the theme's own default for `surfaceKind`), plus matching
// `--text`/`--text-dim`/`--text-faint` overrides so any CSS inside this box
// that reads those variables directly (e.g. `.tabs button:hover`,
// `.text-faint`) inherits safe colors too, instead of the theme's own
// (potentially clashing) values.
export function boxStyle(
  customBackground: string | null | undefined,
  surfaceKind: "page" | "card",
  theme: Theme,
  preferredTextColor?: string | null,
): CSSProperties {
  if (!customBackground && !preferredTextColor) return {};
  const effectiveBackground = customBackground || THEME_SURFACE_COLORS[theme][surfaceKind];
  const color = readableTextColor(effectiveBackground, preferredTextColor);
  const style: Record<string, string> = {};
  if (customBackground) style.backgroundColor = customBackground;
  if (color) {
    style.color = color;
    style["--text"] = color;
    style["--text-dim"] = dimVariant(effectiveBackground, color, 0.82);
    style["--text-faint"] = dimVariant(effectiveBackground, color, 0.62);
  }
  return style as CSSProperties;
}
