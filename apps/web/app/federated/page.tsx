"use client";

import { useEffect, useState } from "react";
import { getFeed, getFederatedDomains, type Post } from "../../lib/api";
import { PostItem } from "../../components/PostItem";

// Every federated post this instance has ever cached — from a relay
// subscription, a follow, or a resolved URL — not scoped to the
// viewer's own follow graph. See routes/posts.ts's GET /feed?scope=federated.
// Filterable by author domain and/or a keyword — this is the one feed
// broad enough to actually need narrowing down; Home is already scoped
// to your own follows/circles/explore subscriptions.
export default function FederatedPage() {
  const [posts, setPosts] = useState<Post[] | "loading" | "error">("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [domains, setDomains] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const [q, setQ] = useState("");
  // Debounced separately from the live `q` input so every keystroke
  // doesn't refetch — same pattern search-as-you-type elsewhere in this
  // app (FollowPanel's handle preview) already uses.
  const [appliedQ, setAppliedQ] = useState("");

  useEffect(() => {
    getFederatedDomains()
      .then(setDomains)
      .catch(() => setDomains([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedQ(q.trim()), 400);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setPosts("loading");
    getFeed(undefined, "federated", { domain: domain || undefined, q: appliedQ || undefined })
      .then((res) => {
        setPosts(res.posts);
        setNextCursor(res.nextCursor);
      })
      .catch(() => setPosts("error"));
  }, [domain, appliedQ]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await getFeed(nextCursor, "federated", { domain: domain || undefined, q: appliedQ || undefined });
      setPosts((prev) => (Array.isArray(prev) ? [...prev, ...res.posts] : prev));
      setNextCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="page">
      <h1>Federated</h1>
      <p className="text-dim" style={{ marginTop: 0 }}>
        Every federated Gib this room knows about, not just from people you're listening to.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.75rem 0 1rem" }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by keyword…"
          style={{ flex: 1, minWidth: 200 }}
        />
        <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)} style={{ minWidth: 180 }}>
          <option value="">All domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {(domain || q) && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setDomain("");
              setQ("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {posts === "loading" && <p className="text-dim">Loading…</p>}
      {posts === "error" && <p className="error-text">Could not reach the API.</p>}
      {Array.isArray(posts) && posts.length === 0 && (
        <p className="text-dim">{domain || appliedQ ? "Nothing matches that filter." : "Nothing here yet."}</p>
      )}
      {Array.isArray(posts) && posts.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {posts.map((post) => (
            <PostItem key={post.id} post={post} />
          ))}
        </ul>
      )}

      {Array.isArray(posts) && nextCursor && (
        <button
          className="btn btn-ghost"
          onClick={handleLoadMore}
          disabled={loadingMore}
          style={{ display: "block", margin: "1rem auto" }}
        >
          {loadingMore ? "Loading…" : "See more"}
        </button>
      )}
    </main>
  );
}
