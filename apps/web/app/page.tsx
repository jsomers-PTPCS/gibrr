"use client";

import { useEffect, useState } from "react";
import { getFeed, type Post } from "../lib/api";
import { PostItem } from "../components/PostItem";

export default function HomePage() {
  const [posts, setPosts] = useState<Post[] | "loading" | "error">("loading");

  useEffect(() => {
    getFeed()
      .then((res) => setPosts(res.posts))
      .catch(() => setPosts("error"));
  }, []);

  return (
    <main style={{ padding: "2rem" }}>
      <h1>Astrion</h1>
      <p>A federated social platform.</p>

      {posts === "loading" && <p>Loading feed…</p>}
      {posts === "error" && <p>Could not reach the API.</p>}
      {Array.isArray(posts) && posts.length === 0 && (
        <p>
          No posts yet. <a href="/submit">Submit the first one.</a>
        </p>
      )}
      {Array.isArray(posts) && posts.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {posts.map((post) => (
            <PostItem key={post.id} post={post} />
          ))}
        </ul>
      )}
    </main>
  );
}
