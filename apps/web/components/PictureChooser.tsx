"use client";

import type { ChangeEvent, CSSProperties } from "react";

interface PresetEntry {
  label: string;
  dataUri: string;
}

// A 4-tile picker: three built-in preset "pictures" plus a "choose file"
// upload tile, used identically for header/background/avatar. Exactly one
// of a preset or an uploaded image is active at a time (enforced
// server-side — see routes/profile.ts and routes/profileImage.ts).
export function PictureChooser<K extends string>({
  presets,
  selectedPreset,
  hasCustomImage,
  currentImageUrl,
  onSelectPreset,
  onUploadFile,
  uploading,
  round = false,
  tileWidth = 72,
  tileHeight = 72,
}: {
  presets: Record<K, PresetEntry>;
  selectedPreset: K | null;
  hasCustomImage: boolean;
  currentImageUrl?: string;
  onSelectPreset: (key: K) => void;
  onUploadFile: (file: File) => void;
  uploading: boolean;
  round?: boolean;
  tileWidth?: number;
  tileHeight?: number;
}) {
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onUploadFile(file);
    e.target.value = "";
  }

  const tileStyle = (active: boolean): CSSProperties => ({
    width: tileWidth,
    height: tileHeight,
    borderRadius: round ? "50%" : "var(--radius-sm)",
    border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
    backgroundSize: "cover",
    backgroundPosition: "center",
    cursor: "pointer",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-faint)",
    fontSize: "0.7rem",
    overflow: "hidden",
  });

  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {(Object.keys(presets) as K[]).map((key) => (
        <button
          key={key}
          type="button"
          title={presets[key].label}
          onClick={() => onSelectPreset(key)}
          style={{ ...tileStyle(selectedPreset === key && !hasCustomImage), backgroundImage: `url(${presets[key].dataUri})` }}
        />
      ))}
      <label
        style={{
          ...tileStyle(hasCustomImage),
          backgroundImage: hasCustomImage && currentImageUrl ? `url(${currentImageUrl})` : undefined,
        }}
      >
        {!hasCustomImage && (uploading ? "…" : "Choose file")}
        <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
      </label>
    </div>
  );
}
