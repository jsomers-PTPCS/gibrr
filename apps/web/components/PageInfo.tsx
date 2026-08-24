"use client";

import { useState } from "react";
import { InfoIcon } from "./icons";

// Renders the section's own title (h1 for a whole page, h2 for a
// sub-section like RSS Feeds within Circles) with a small circled-i
// beside it — replaces what used to be an always-visible description
// paragraph underneath. The explanation only takes up space once
// someone actually asks for it, instead of sitting there for every
// visit regardless of whether it's still needed.
export function PageInfo({
  title,
  level = "h1",
  children,
}: {
  title: string;
  level?: "h1" | "h2";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Title = level;

  return (
    <div style={{ margin: "0 0 0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <Title style={level === "h1" ? { margin: 0 } : { margin: 0, fontSize: "1.1rem" }}>{title}</Title>
        <button
          type="button"
          className="btn btn-ghost post-icon-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Hide info" : "About this"}
          title={open ? "Hide info" : "About this"}
          style={{ width: "1.5rem", height: "1.5rem" }}
        >
          <InfoIcon width={15} height={15} />
        </button>
      </div>
      {open && (
        <p className="text-dim" style={{ margin: "0.3rem 0 0" }}>
          {children}
        </p>
      )}
    </div>
  );
}
