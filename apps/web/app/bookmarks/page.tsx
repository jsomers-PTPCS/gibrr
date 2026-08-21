"use client";

import { useEffect, useState } from "react";
import { getBookmarks, ApiError, type Post } from "../../lib/api";
import { PostItem } from "../../components/PostItem";

// The logged-in actor's own bookmarked posts — routes/posts.ts's
// GET /bookmarks. No pagination, same simplicity precedent as
// app/tag/[name]/page.tsx and the main feed's first-page-only pages.
export default function BookmarksPage() {
  const [posts, setPosts] = useState<Post[] | "loading" | "error">("loading");

  useEffect(() => {
    getBookmarks()
      .then((res) => setPosts(res.posts))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        setPosts("error");
      });
  }, []);

  return (
    <main className="page">
      <h1>Keeps</h1>
      <p className="text-dim" style={{ marginTop: 0 }}>
        Gibs you've saved for later — only visible to you.
      </p>

      {posts === "loading" && <p className="text-dim">Loading…</p>}
      {posts === "error" && <p className="error-text">Could not load your Keeps.</p>}
      {Array.isArray(posts) && posts.length === 0 && (
        <p className="text-dim">No Keeps yet — tap 🔖 on a Gib to save it here.</p>
      )}
      {Array.isArray(posts) && posts.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {posts.map((post) => (
            <PostItem key={post.id} post={post} />
          ))}
        </ul>
      )}
    </main>
  );
}
