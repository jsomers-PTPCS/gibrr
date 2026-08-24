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

  return (
    <main className="page">
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <PostItem post={post} detail />
      </ul>

      {/* PostItem itself now shows the origin's real like/boost counts
          (see its own remoteEngagement rendering) — this link is just the
          "view it there yourself" escape hatch. */}
      {post.remoteId && (
        <p style={{ margin: "0.5rem 0 1.5rem" }}>
          <a href={post.remoteId} target="_blank" rel="noreferrer">
            View original post on {new URL(post.remoteId).host} ↗
          </a>
        </p>
      )}

      <h2>Comments</h2>
      <PostComments postId={id} />
    </main>
  );
}
