"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getAntennaPosts, ApiError, type Antenna, type Post } from "../../../lib/api";
import { PostItem } from "../../../components/PostItem";

// A single antenna's live view — routes/antennas.ts's GET
// /antennas/:id/posts. Same layout as app/tag/[name]/page.tsx.
export default function AntennaPage() {
  const { id } = useParams<{ id: string }>();
  const [antenna, setAntenna] = useState<Antenna | null>(null);
  const [posts, setPosts] = useState<Post[] | "loading" | "error" | "not_found">("loading");

  useEffect(() => {
    setPosts("loading");
    getAntennaPosts(id)
      .then((res) => {
        setAntenna(res.antenna);
        setPosts(res.posts);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setPosts("not_found");
          return;
        }
        setPosts("error");
      });
  }, [id]);

  return (
    <main className="page">
      <h1>{antenna ? antenna.name : "Watch"}</h1>
      {antenna && (antenna.keywords.length > 0 || antenna.watchedActors.length > 0) && (
        <p className="text-dim" style={{ marginTop: 0 }}>
          {antenna.keywords.length > 0 && <>keywords: {antenna.keywords.join(", ")} </>}
          {antenna.watchedActors.length > 0 && (
            <>users: {antenna.watchedActors.map((a) => a.username).join(", ")}</>
          )}
        </p>
      )}

      {posts === "loading" && <p className="text-dim">Loading…</p>}
      {posts === "not_found" && <p className="error-text">Watch not found.</p>}
      {posts === "error" && <p className="error-text">Could not load this watch.</p>}
      {Array.isArray(posts) && posts.length === 0 && (
        <p className="text-dim">No Gibs match this watch yet.</p>
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
