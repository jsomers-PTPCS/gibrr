"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { getBookmarks, ApiError, type Post } from "../lib/api";
import { PostItem } from "./PostItem";

// The logged-in actor's own bookmarked posts — routes/posts.ts's
// GET /bookmarks. No pagination, same simplicity precedent as
// app/tag/[name]/page.tsx and the main feed's first-page-only pages.
// Formerly its own app/bookmarks/page.tsx — now a tab on the owner's
// own profile, since a private "only visible to you" list never made
// sense as a page a stranger could also land on.
export function KeepsTab({ contentBoxStyle }: { contentBoxStyle?: CSSProperties }) {
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

  if (posts === "loading") return <p className="text-dim">Loading…</p>;
  if (posts === "error") return <p className="error-text">Could not load your Keeps.</p>;
  if (posts.length === 0) {
    return <p className="text-dim">No Keeps yet — tap 🔖 on a Gib to save it here.</p>;
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {posts.map((post) => (
        <PostItem key={post.id} post={post} boxStyle={contentBoxStyle} />
      ))}
    </ul>
  );
}
