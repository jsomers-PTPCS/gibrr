"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getExploreTimeline,
  getExploreServers,
  subscribeToExploreServer,
  unsubscribeFromExploreServer,
  resolvePostByUrl,
  ApiError,
  type ExploreStatus,
} from "../../../lib/api";
import { Avatar } from "../../../components/Avatar";

// A live read of one curated server's own trending/public timeline
// (Mastodon-API-compatible REST, not federation — see api's
// mastodonExplore.ts). Clicking a post resolves+caches it via the same
// GET /posts/resolve flow search's "paste a URL" feature already uses,
// so from that point on it's a normal, fully interactive local Gib.
export default function ExploreServerPage() {
  const { domain } = useParams<{ domain: string }>();
  const router = useRouter();
  const [statuses, setStatuses] = useState<ExploreStatus[] | "loading" | "error" | "unreachable">(
    "loading",
  );
  const [openingUrl, setOpeningUrl] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | "loading">("loading");
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    setStatuses("loading");
    getExploreTimeline(domain)
      .then(setStatuses)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (err instanceof ApiError && err.status === 502) {
          setStatuses("unreachable");
          return;
        }
        setStatuses("error");
      });

    getExploreServers()
      .then((servers) => {
        const match = servers.find((s) => s.domain === domain);
        setSubscribed(match?.subscribed ?? false);
      })
      .catch(() => setSubscribed(false));
  }, [domain]);

  async function handleToggleSubscribe() {
    setSubscribing(true);
    try {
      if (subscribed) {
        await unsubscribeFromExploreServer(domain);
        setSubscribed(false);
      } else {
        await subscribeToExploreServer(domain);
        setSubscribed(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setSubscribing(false);
    }
  }

  async function handleOpen(status: ExploreStatus) {
    setOpeningUrl(status.url);
    setOpenError(null);
    try {
      const { id } = await resolvePostByUrl(status.url);
      router.push(`/posts/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setOpenError("Could not pull that post in — try again.");
    } finally {
      setOpeningUrl(null);
    }
  }

  return (
    <main className="page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{domain}</h1>
        <button
          className="btn btn-primary"
          disabled={subscribed === "loading" || subscribing}
          onClick={handleToggleSubscribe}
        >
          {subscribing ? "…" : subscribed ? "✓ Subscribed — Unsubscribe" : "Subscribe"}
        </button>
      </div>
      <p className="text-dim" style={{ marginTop: "0.3rem" }}>
        Trending, or the local public timeline if trends are off. Click a post to pull it in and
        Echo, React, or Chatter on it. Subscribing merges this server's trending posts into your
        own Home feed going forward — no need to keep checking back here.
      </p>

      {statuses === "loading" && <p className="text-dim">Loading…</p>}
      {statuses === "error" && <p className="error-text">Could not load this server's timeline.</p>}
      {statuses === "unreachable" && (
        <p className="error-text">
          Could not reach {domain}&apos;s public API — it may not run Mastodon-compatible software.
        </p>
      )}
      {openError && <p className="error-text">{openError}</p>}
      {Array.isArray(statuses) && statuses.length === 0 && (
        <p className="text-dim">Nothing to show right now.</p>
      )}
      {Array.isArray(statuses) && statuses.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {statuses.map((status) => (
            <li key={status.url} className="card">
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <Avatar
                  name={status.author.displayName ?? status.author.username}
                  size={36}
                  imageUrl={status.author.avatarUrl}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{status.author.displayName ?? status.author.username}</strong>
                  <span className="text-faint" style={{ marginLeft: "0.4rem", fontSize: "0.85rem" }}>
                    @{status.author.username}@{domain}
                  </span>
                  <p style={{ margin: "0.3rem 0", whiteSpace: "pre-wrap" }}>{status.contentText}</p>
                  <button
                    className="btn btn-ghost"
                    disabled={openingUrl === status.url}
                    onClick={() => handleOpen(status)}
                    style={{ padding: "0.15rem 0.6rem", fontSize: "0.85rem" }}
                  >
                    {openingUrl === status.url ? "Pulling in…" : "View"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
