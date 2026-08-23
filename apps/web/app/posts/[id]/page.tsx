"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getPost, type Post } from "../../../lib/api";
import { PostItem } from "../../../components/PostItem";
import { PostComments } from "../../../components/PostComments";

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<Post | "loading" | "error">("loading");

  useEffect(() => {
    getPost(id)
      .then(setPost)
      .catch(() => setPost("error"));
  }, [id]);

  if (post === "loading") return <main className="page">Loading…</main>;
  if (post === "error") return <main className="page">Could not load this post.</main>;

  // The origin server's own real numbers, fetched live by GET /posts/:id —
  // distinct wording from Gibrr's own vote arrows/Echo button (which count
  // only this instance's local activity) so the two are never confused.
  const engagement = post.remoteId ? post.remoteEngagement : null;
  const engagementParts = engagement
    ? [
        engagement.likes !== null ? `${engagement.likes} favourite${engagement.likes === 1 ? "" : "s"}` : null,
        engagement.shares !== null ? `${engagement.shares} boost${engagement.shares === 1 ? "" : "s"}` : null,
      ].filter((part): part is string => part !== null)
    : [];

  return (
    <main className="page">
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <PostItem post={post} detail />
      </ul>

      {post.remoteId && (
        <p style={{ margin: "0.5rem 0 1.5rem" }}>
          <a href={post.remoteId} target="_blank" rel="noreferrer">
            View original post on {new URL(post.remoteId).host} ↗
          </a>
          {engagementParts.length > 0 && (
            <span className="text-faint"> — {engagementParts.join(" · ")}</span>
          )}
        </p>
      )}

      <h2>Comments</h2>
      <PostComments postId={id} />
    </main>
  );
}
