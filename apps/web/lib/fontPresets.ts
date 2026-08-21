// Mirrors apps/api/src/federation/fontPresets.ts — kept as a small
// duplicated constant rather than a shared package, since it's 7 stable
// entries and the two apps don't share a build step.
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

export const FONT_PRESET_LABELS: Record<FontPresetKey, string> = {
  sans: "System Sans (default)",
  serif: "System Serif",
  mono: "Monospace",
  comic: "Comic Sans",
  display: "Sci-Fi Display",
  rounded: "Rounded",
  elegant: "Elegant",
};
