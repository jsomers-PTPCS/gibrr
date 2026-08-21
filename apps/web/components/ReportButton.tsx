"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { fileReport, ApiError } from "../lib/api";

// Small inline report form, toggled open by a ghost "Report" button —
// same pattern as PostItem's own inline edit form. Used for posts,
// comments, and actors alike (targetType/targetId chosen by the caller).
export function ReportButton({
  targetType,
  targetId,
  label = "Flag",
  iconOnly = false,
}: {
  targetType: "post" | "comment" | "actor";
  targetId: string;
  label?: ReactNode;
  // When true, styles the toggle button to match PostItem's other
  // icon-only action buttons (post-icon-btn) instead of the default
  // text-ghost-button look — used where `label` is itself an icon.
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await fileReport({ targetType, targetId, reason });
      setDone(true);
      setOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setError("could not send this flag — try again");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <span className="text-faint">Flagged</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        className={iconOnly ? "btn btn-ghost post-icon-btn" : "btn btn-ghost"}
        onClick={() => setOpen(true)}
        title={iconOnly ? "Flag" : undefined}
        style={iconOnly ? undefined : { padding: "0.15rem 0.6rem", fontSize: "0.9rem" }}
      >
        {label}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
      <input
        className="input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why are you flagging this?"
        required
        style={{ fontSize: "0.85rem", padding: "0.2rem 0.5rem" }}
      />
      <button type="submit" className="btn btn-accent" disabled={submitting} style={{ fontSize: "0.85rem" }}>
        {submitting ? "…" : "Send"}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen(false)}
        style={{ fontSize: "0.85rem" }}
      >
        Cancel
      </button>
      {error && <span className="error-text">{error}</span>}
    </form>
  );
}
