import { z } from "zod";

// A fixed preset list, not free-text font names or @font-face uploads —
// deliberately closed vocabulary, validated server-side. Every value is
// either a font this app already loads (Inter/Orbitron) or a universal
// web-safe font, so there's no new font loading involved either.
export const FONT_PRESETS = {
  sans: "var(--font-body)",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Courier New', monospace",
  comic: "'Comic Sans MS', 'Comic Sans', cursive",
  display: "var(--font-display)",
  rounded: "Verdana, sans-serif",
  elegant: "'Trebuchet MS', sans-serif",
} as const;

export type FontPresetKey = keyof typeof FONT_PRESETS;

export const fontPresetKeySchema = z.enum(
  Object.keys(FONT_PRESETS) as [FontPresetKey, ...FontPresetKey[]],
);
