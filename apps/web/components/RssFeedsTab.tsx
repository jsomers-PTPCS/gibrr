"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  getRssSubscriptions,
  addRssSubscription,
  removeRssSubscription,
  ApiError,
  type RssSubscription,
} from "../lib/api";
import { useConfirm } from "./ConfirmDialog";
import { PageInfo } from "./PageInfo";

// Listen to an RSS/Atom feed (Reddit's own per-subreddit .rss included
// — it's really Atom, but the API's parser reads both) the same way you
// listen to a person: its items merge into Home going forward, gated to
// whoever's actually subscribed (routes/rss.ts, routes/posts.ts's GET
// /feed). Self-service, unlike Explore servers — any handle/URL you can
// paste in, no Host curation needed.
export function RssFeedsTab() {
  const confirm = useConfirm();
  const [subscriptions, setSubscriptions] = useState<RssSubscription[] | "loading" | "error">("loading");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    getRssSubscriptions()
      .then(setSubscriptions)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        setSubscriptions("error");
      });
  }

  useEffect(refresh, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addRssSubscription(url.trim());
      setUrl("");
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        setError("Already listening to that feed.");
      } else if (err instanceof ApiError && err.status === 422) {
        setError("Couldn't read that as an RSS or Atom feed — check the URL.");
      } else {
        setError("Could not add that feed — check the URL and try again.");
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(sub: RssSubscription) {
    if (!(await confirm(`Stop listening to "${sub.title ?? sub.url}"?`))) return;
    await removeRssSubscription(sub.id);
    refresh();
  }

  return (
    <div>
      <PageInfo title="RSS Feeds" level="h2">
        Listen to an RSS or Atom feed — a subreddit&apos;s (e.g.{" "}
        <code>https://www.reddit.com/r/technology/.rss</code>), a blog&apos;s, anything with a
        real feed URL. New items merge into your Home feed, same as anyone else you listen to.
      </PageInfo>

      <form onSubmit={handleAdd} className="card" style={{ display: "grid", gap: "0.6rem", marginBottom: "1.5rem" }}>
        <input
          className="input"
          placeholder="Feed URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
        />
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={adding || !url.trim()}>
          {adding ? "Listening…" : "Listen"}
        </button>
      </form>

      {subscriptions === "loading" && <p className="text-dim">Loading…</p>}
      {subscriptions === "error" && <p className="error-text">Could not load your RSS feeds.</p>}
      {Array.isArray(subscriptions) && subscriptions.length === 0 && (
        <p className="text-dim">Not listening to any feeds yet — add one above.</p>
      )}
      {Array.isArray(subscriptions) && subscriptions.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {subscriptions.map((sub) => (
            <li key={sub.id} className="card" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{sub.title ?? sub.url}</strong>
                {sub.title && (
                  <p className="text-faint" style={{ margin: "0.2rem 0 0", overflowWrap: "anywhere" }}>
                    {sub.url}
                  </p>
                )}
              </div>
              <button className="btn btn-ghost" onClick={() => handleRemove(sub)} style={{ flexShrink: 0 }}>
                Stop listening
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
