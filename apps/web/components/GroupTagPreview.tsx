"use client";

import { useState } from "react";
import Link from "next/link";
import { getCommunity, joinCommunity, type GroupDetail } from "../lib/api";
import { GROUP_PRIVACY_LABELS } from "../lib/groupRoles";

// Wraps a post's group tag — click opens a small popover with a preview
// (fetched on first open, not eagerly) instead of navigating straight to
// the full /g/[name] page. A fixed backdrop behind the popover closes it
// on outside click; not worth a portal/floating-ui dependency for
// something this small.
export function GroupTagPreview({ username, title }: { username: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<GroupDetail | "loading" | "error" | null>(null);
  const [joinResult, setJoinResult] = useState<"accepted" | "pending" | null>(null);
  const [joining, setJoining] = useState(false);

  function toggle() {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (next && detail === null) {
        setDetail("loading");
        getCommunity(username)
          .then(setDetail)
          .catch(() => setDetail("error"));
      }
      return next;
    });
  }

  async function handleJoin() {
    if (!detail || detail === "loading" || detail === "error") return;
    setJoining(true);
    try {
      const result = await joinCommunity(detail.id);
      setJoinResult(result.state);
    } catch {
      // likely already a member/pending — nothing useful to show inline here
    } finally {
      setJoining(false);
    }
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="pill"
        onClick={toggle}
        style={{ cursor: "pointer", margin: 0 }}
      >
        {title}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
          <div
            className="card"
            style={{ position: "absolute", top: "100%", left: 0, marginTop: "0.3rem", width: 260, zIndex: 21 }}
          >
            {detail === "loading" ? (
              <p className="text-dim" style={{ margin: 0 }}>
                Loading…
              </p>
            ) : detail === "error" || !detail ? (
              <p className="text-dim" style={{ margin: 0 }}>
                Could not load this circle.
              </p>
            ) : (
              <>
                <strong>{detail.title}</strong>
                <p className="text-faint" style={{ margin: "0.2rem 0" }}>
                  {GROUP_PRIVACY_LABELS[detail.privacy]} · {detail.memberCount} member
                  {detail.memberCount === 1 ? "" : "s"}
                </p>
                {detail.description && <p style={{ margin: "0 0 0.5rem" }}>{detail.description}</p>}
                {!detail.viewerMembership && !joinResult && (
                  <button
                    className="btn btn-ghost"
                    disabled={joining}
                    onClick={handleJoin}
                    style={{ marginBottom: "0.4rem" }}
                  >
                    {joining ? "…" : detail.privacy === "public" ? "Join" : "Request to join"}
                  </button>
                )}
                {(joinResult ?? detail.viewerMembership?.state) && (
                  <p className="text-faint" style={{ margin: "0 0 0.4rem" }}>
                    {(joinResult ?? detail.viewerMembership?.state) === "accepted"
                      ? "✓ Joined"
                      : "Request pending"}
                  </p>
                )}
                <div>
                  <Link href={`/g/${username}`} className="text-faint">
                    View circle →
                  </Link>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
