"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getTagPosts, type Post } from "../../../lib/api";
import { PostItem } from "../../../components/PostItem";

// Local hashtag browse — routes/posts.ts's GET /tags/:name, same
// visibility rule as the main feed's community-scoped posts (public
// communities, plus ones the viewer has joined). Federated timeline
// posts (no community) aren't included here — see that route's own
// comment for why.
export default function TagPage() {
  const { name } = useParams<{ name: string }>();
  const [posts, setPosts] = useState<Post[] | "loading" | "error">("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setPosts("loading");
    getTagPosts(name)
      .then((res) => {
        setPosts(res.posts);
        setNextCursor(res.nextCursor);
      })
      .catch(() => setPosts("error"));
  }, [name]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await getTagPosts(name, nextCursor);
      setPosts((prev) => (Array.isArray(prev) ? [...prev, ...res.posts] : prev));
      setNextCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="page">
      <h1>#{name}</h1>

      {posts === "loading" && <p className="text-dim">Loading…</p>}
      {posts === "error" && <p className="error-text">Could not load this topic.</p>}
      {Array.isArray(posts) && posts.length === 0 && (
        <p className="text-dim">No Gibs tagged #{name} yet.</p>
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
