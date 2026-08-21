"use client";

import { COLOR_PALETTE } from "../lib/colorPalette";

// A circular "current color" indicator (thin white ring, doubles as the
// trigger for a native color input so any custom hex is still reachable)
// plus a row of hexagon preset swatches for one-click picks.
export function ColorSwatchPicker({
  value,
  fallback,
  onChange,
}: {
  value: string;
  fallback: string;
  onChange: (hex: string) => void;
}) {
  const current = value || fallback;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
      <label className="swatch-current" style={{ background: current }} title="Custom color">
        <input type="color" value={current} onChange={(e) => onChange(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        {COLOR_PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            className="swatch-hex"
            title={hex}
            aria-label={`use color ${hex}`}
            onClick={() => onChange(hex)}
            style={{
              background: hex,
              borderColor: current.toLowerCase() === hex.toLowerCase() ? "#fff" : undefined,
              borderWidth: current.toLowerCase() === hex.toLowerCase() ? 2 : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}
