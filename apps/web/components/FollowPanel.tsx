"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  API_URL,
  getFollowGraph,
  getFollowPreview,
  followHandle,
  unfollow,
  ApiError,
  type FollowSummary,
  type FollowPreview,
} from "../lib/api";
import { Avatar } from "./Avatar";

// The actor's `domain` field is the *API* server's domain (e.g.
// localhost:4000), not the web app's own origin — compare against that,
// not window.location.
const LOCAL_ACTOR_DOMAIN = new URL(API_URL).host;

// A remote actor has no profile page in this app (see the federation
// plan's scope notes), so a followed/follower row only links out when
// it's local — everyone else renders as a plain (non-clickable) row.
function FollowRow({ person }: { person: FollowSummary }) {
  const label = person.displayName ?? person.username;
  const handle = `@${person.username}@${person.domain}`;
  const inner = (
    <>
      <Avatar name={label} size={32} />
      <span>
        {label}
        <span className="text-faint" style={{ display: "block", fontSize: "0.8rem" }}>
          {handle}
        </span>
      </span>
    </>
  );

  if (person.domain === LOCAL_ACTOR_DOMAIN) {
    return (
      <Link
        href={`/u/${person.username}`}
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "inherit" }}
      >
        {inner}
      </Link>
    );
  }
  return <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>{inner}</div>;
}

export function FollowPanel({
  username,
  isOwnProfile,
  contentBoxStyle,
}: {
  username: string;
  isOwnProfile: boolean;
  contentBoxStyle?: CSSProperties;
}) {
  const [following, setFollowing] = useState<FollowSummary[] | "loading">("loading");
  const [followers, setFollowers] = useState<FollowSummary[] | "loading">("loading");
  const [handle, setHandle] = useState("");
  const [preview, setPreview] = useState<FollowPreview | "loading" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    getFollowGraph(username).then((graph) => {
      setFollowing(graph.following);
      setFollowers(graph.followers);
    });
  }

  useEffect(refresh, [username]);

  // Live lookup as you type, debounced — not a fuzzy suggestions list (no
  // server can offer one for the whole fediverse), just a preview of the
  // exact handle once you pause, so you can see who you're about to
  // follow before committing. Most keystrokes won't resolve to anything
  // yet, which is expected — those just clear the preview silently.
  useEffect(() => {
    if (!handle.trim()) {
      setPreview(null);
      return;
    }
    setPreview("loading");
    const requestedFor = handle;
    const timer = setTimeout(() => {
      getFollowPreview(requestedFor.trim())
        .then((result) => setPreview((current) => (handle === requestedFor ? result : current)))
        .catch(() => setPreview((current) => (handle === requestedFor ? null : current)));
    }, 500);
    return () => clearTimeout(timer);
  }, [handle]);

  async function handleFollow() {
    setError(null);
    if (!handle.trim()) return;
    try {
      await followHandle(handle.trim());
      setHandle("");
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setError("could not listen to that handle — check it and try again");
    }
  }

  async function handleUnfollow(person: FollowSummary) {
    setBusyId(person.id);
    try {
      await unfollow(person.id);
      setFollowing((prev) => (Array.isArray(prev) ? prev.filter((p) => p.id !== person.id) : prev));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card" style={contentBoxStyle}>
      <h3 style={{ marginTop: 0, fontSize: "1.05rem" }}>Fediverse</h3>

      {isOwnProfile && (
        <div style={{ marginBottom: "1rem" }}>
          <p className="text-faint" style={{ margin: "0 0 0.5rem" }}>
            Listen to anyone on this room or another, by handle.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              className="input"
              placeholder="user@domain"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <button className="btn btn-primary" onClick={handleFollow}>
              Listen
            </button>
          </div>
          {preview === "loading" ? (
            <p className="text-faint" style={{ margin: "0.5rem 0 0" }}>
              Looking up…
            </p>
          ) : preview ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginTop: "0.5rem",
                padding: "0.4rem 0.6rem",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface-hover)",
              }}
            >
              <Avatar name={preview.displayName ?? preview.username} size={28} />
              <span>
                {preview.displayName ?? preview.username}
                <span className="text-faint" style={{ display: "block", fontSize: "0.8rem" }}>
                  @{preview.username}@{preview.domain}
                </span>
              </span>
            </div>
          ) : null}
          {error && <p className="error-text" style={{ marginTop: "0.5rem" }}>{error}</p>}
        </div>
      )}

      <p className="text-faint" style={{ margin: "0 0 0.5rem" }}>
        Listening to
      </p>
      {following === "loading" ? (
        <p className="text-dim">Loading…</p>
      ) : following.length === 0 ? (
        <p className="text-dim">Not listening to anyone yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
          {following.map((person) => (
            <div
              key={person.id}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}
            >
              <FollowRow person={person} />
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {person.state === "pending" && <span className="text-faint">pending</span>}
                {isOwnProfile && (
                  <button
                    className="btn btn-ghost"
                    disabled={busyId === person.id}
                    onClick={() => handleUnfollow(person)}
                  >
                    Unlisten
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-faint" style={{ margin: "0 0 0.5rem" }}>
        Listeners
      </p>
      {followers === "loading" ? (
        <p className="text-dim">Loading…</p>
      ) : followers.length === 0 ? (
        <p className="text-dim">No listeners yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {followers.map((person) => (
            <FollowRow key={person.id} person={person} />
          ))}
        </div>
      )}
    </div>
  );
}
