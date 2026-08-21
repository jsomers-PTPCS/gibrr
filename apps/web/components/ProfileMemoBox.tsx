"use client";

import { useState } from "react";
import { setProfileMemo, deleteProfileMemo } from "../lib/api";

// A private sticky note about someone else's profile — Misskey's
// "memo." Only the viewer who wrote it ever sees it; not the profile's
// owner, not any other visitor. Deliberately understated styling (looks
// like a real sticky note) so it doesn't compete with the profile
// itself for attention.
export function ProfileMemoBox({ username, initialMemo }: { username: string; initialMemo: string | null }) {
  const [editing, setEditing] = useState(false);
  const [memo, setMemo] = useState(initialMemo);
  const [draft, setDraft] = useState(initialMemo ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      if (draft.trim()) {
        const result = await setProfileMemo(username, draft);
        setMemo(result.memo);
      } else {
        await deleteProfileMemo(username);
        setMemo(null);
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div
        style={{
          margin: "0 1.5rem 1rem",
          padding: "0.75rem 1rem",
          background: "var(--surface-hover)",
          borderRadius: "var(--radius-sm)",
          borderLeft: "3px solid var(--accent)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <div style={{ minWidth: 0 }}>
            <p className="text-faint" style={{ margin: 0, fontSize: "0.75rem" }}>
              Your private memo — only you can see this
            </p>
            {memo ? (
              <p style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>{memo}</p>
            ) : (
              <p className="text-dim" style={{ margin: "0.2rem 0 0" }}>
                No memo yet.
              </p>
            )}
          </div>
          <button
            className="btn btn-ghost"
            style={{ flexShrink: 0, padding: "0.15rem 0.6rem", fontSize: "0.85rem" }}
            onClick={() => {
              setDraft(memo ?? "");
              setEditing(true);
            }}
          >
            {memo ? "Edit" : "Add memo"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        margin: "0 1.5rem 1rem",
        padding: "0.75rem 1rem",
        background: "var(--surface-hover)",
        borderRadius: "var(--radius-sm)",
        borderLeft: "3px solid var(--accent)",
      }}
    >
      <p className="text-faint" style={{ margin: "0 0 0.3rem", fontSize: "0.75rem" }}>
        Your private memo — only you can see this
      </p>
      <textarea
        className="input"
        style={{ width: "100%", minHeight: 70, resize: "vertical" }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={2000}
        autoFocus
      />
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
        <button className="btn btn-primary" disabled={saving} onClick={handleSave} style={{ padding: "0.15rem 0.6rem" }}>
          {saving ? "…" : "Save"}
        </button>
        <button
          className="btn btn-ghost"
          disabled={saving}
          onClick={() => setEditing(false)}
          style={{ padding: "0.15rem 0.6rem" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
