"use client";

import { useEffect, useState } from "react";
import { blockHandle, unblockActor, getBlockedActors, ApiError } from "../lib/api";
import { useConfirm } from "./ConfirmDialog";

// Cross-references the viewer's own block list (GET /blocks) rather than
// a per-target status endpoint — same small-list-no-pagination posture
// as everywhere else in this app (e.g. RelationshipsTab's joinedIds).
// Blocking removes any existing follow relationship server-side
// (routes/blocks.ts) — this button doesn't need to know or care whether
// one existed.
export function BlockButton({ username, domain, actorId }: { username: string; domain: string; actorId: string }) {
  const confirm = useConfirm();
  const [blocked, setBlocked] = useState<boolean | "loading">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBlockedActors()
      .then((blocks) => setBlocked(blocks.some((b) => b.id === actorId)))
      .catch(() => setBlocked(false));
  }, [actorId]);

  async function block() {
    if (!(await confirm(`Block @${username}? This also removes any listening relationship between you.`))) return;
    setBusy(true);
    try {
      await blockHandle(`${username}@${domain}`);
      setBlocked(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setBusy(false);
    }
  }

  async function unblock() {
    setBusy(true);
    try {
      await unblockActor(actorId);
      setBlocked(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setBusy(false);
    }
  }

  if (blocked === "loading") return null;

  return (
    <button
      className="btn btn-ghost"
      disabled={busy}
      onClick={blocked ? unblock : block}
      style={{ color: "var(--danger)" }}
    >
      {blocked ? "Unblock" : "Block"}
    </button>
  );
}
