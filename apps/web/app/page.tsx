"use client";

import { useEffect, useState } from "react";
import {
  getFeed,
  getMe,
  getFederatedDomains,
  getCommunityMemberships,
  type Post,
  type Me,
  type FeedSort,
  type FeedRange,
  type Community,
} from "../lib/api";
import { PostItem } from "../components/PostItem";
import { PostComposer } from "../components/PostComposer";
import { Avatar } from "../components/Avatar";
import { FeedFilterBar } from "../components/FeedFilterBar";

export default function HomePage() {
  const [posts, setPosts] = useState<Post[] | "loading" | "error">("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");

  const [sort, setSort] = useState<FeedSort>("new");
  const [range, setRange] = useState<FeedRange>("all");
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [circles, setCircles] = useState<Community[]>([]);
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>([]);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
    getFederatedDomains()
      .then(setDomains)
      .catch(() => setDomains([]));
  }, []);

  // The circle picker needs the viewer's own username first (getMe),
  // unlike domains which don't depend on who's logged in.
  useEffect(() => {
    if (!me) return;
    getCommunityMemberships(me.actor.username)
      .then(setCircles)
      .catch(() => setCircles([]));
  }, [me]);

  useEffect(() => {
    refreshFeed();
  }, [sort, range, selectedDomains, selectedCircleIds]);

  function refreshFeed() {
    setPosts("loading");
    return getFeed(undefined, undefined, {
      sort,
      range,
      domains: selectedDomains,
      communityIds: selectedCircleIds,
    })
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
      const res = await getFeed(nextCursor, undefined, {
        sort,
        range,
        domains: selectedDomains,
        communityIds: selectedCircleIds,
      });
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
              className="input composer-title-input"
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

      <FeedFilterBar
        sort={sort}
        onSortChange={setSort}
        range={range}
        onRangeChange={setRange}
        domains={domains}
        selectedDomains={selectedDomains}
        onSelectedDomainsChange={setSelectedDomains}
        circles={circles}
        selectedCircleIds={selectedCircleIds}
        onSelectedCircleIdsChange={setSelectedCircleIds}
      />

      {posts === "loading" && <p className="text-dim">Loading conversations…</p>}
      {posts === "error" && <p className="error-text">Could not reach the API.</p>}
      {Array.isArray(posts) &&
        posts.length === 0 &&
        (sort !== "new" || range !== "all" || selectedDomains.length > 0 || selectedCircleIds.length > 0) && (
          <p className="text-dim">Nothing matches that filter.</p>
        )}
      {Array.isArray(posts) &&
        posts.length === 0 &&
        sort === "new" &&
        range === "all" &&
        selectedDomains.length === 0 &&
        selectedCircleIds.length === 0 && (
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
