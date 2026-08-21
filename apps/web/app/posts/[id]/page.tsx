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

      <h2>Comments</h2>
      <PostComments postId={id} />
    </main>
  );
}
