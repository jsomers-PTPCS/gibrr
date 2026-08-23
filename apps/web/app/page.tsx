"use client";

import { useEffect, useState } from "react";
import { getFeed, getMe, type Post, type Me } from "../lib/api";
import { PostItem } from "../components/PostItem";
import { PostComposer } from "../components/PostComposer";
import { Avatar } from "../components/Avatar";

export default function HomePage() {
  const [posts, setPosts] = useState<Post[] | "loading" | "error">("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
    refreshFeed();
  }, []);

  function refreshFeed() {
    setPosts("loading");
    return getFeed()
      .then((res) => {
        setPosts(res.posts);
        setNextCursor(res.nextCursor);
      })
      .catch(() => setPosts("error"));
  }

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await getFeed(nextCursor);
      setPosts((prev) => (Array.isArray(prev) ? [...prev, ...res.posts] : prev));
      setNextCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="page">
      {me && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <Avatar
              name={me.actor.displayName ?? me.actor.username}
              size={40}
              imageUrl={me.actor.avatarImageUrl}
              preset={me.actor.avatarPreset}
            />
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => setComposerOpen(true)}
              placeholder={`What's on your mind, ${me.actor.displayName ?? me.actor.username}?`}
              // A single-line input, not the textarea the open composer
              // uses below (which needs to wrap a long typed title) —
              // this field is just a clickable affordance that opens
              // that composer on focus, so its own value is never
              // really seen being typed into. text-overflow: ellipsis
              // doesn't apply to <textarea> in any browser, so a long
              // placeholder (name included) either got clipped hard mid-
              // character or, wrapped, had its second line sliced off by
              // the fixed single-row height — an <input> truncates with
              // an actual "…" instead.
              style={{
                flex: 1,
                minWidth: 0,
                borderRadius: "1.25rem",
                textOverflow: "ellipsis",
              }}
            />
          </div>
        </div>
      )}

      {composerOpen && (
        <div
          onClick={() => setComposerOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            zIndex: 50,
            display: "flex",
            justifyContent: "center",
            padding: "3rem 1rem",
            overflowY: "auto",
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, width: "100%", height: "fit-content" }}
          >
            <PostComposer
              title={title}
              onTitleChange={setTitle}
              onPosted={() => {
                setComposerOpen(false);
                setTitle("");
                refreshFeed();
              }}
              onCancel={() => {
                setComposerOpen(false);
                setTitle("");
              }}
            />
          </div>
        </div>
      )}

      {posts === "loading" && <p className="text-dim">Loading conversations…</p>}
      {posts === "error" && <p className="error-text">Could not reach the API.</p>}
      {Array.isArray(posts) && posts.length === 0 && (
        <p className="text-dim">
          No Gibs yet.{" "}
          {me ? (
            <button
              onClick={() => setComposerOpen(true)}
              className="btn btn-ghost"
              style={{ padding: "0.1rem 0.5rem" }}
            >
              Gib the first one.
            </button>
          ) : (
            <a href="/login">Log in to Gib the first one.</a>
          )}
        </p>
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
