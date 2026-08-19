"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  getMe,
  getCommunities,
  createCommunity,
  createPost,
  ApiError,
  type Community,
} from "../../lib/api";

export default function SubmitPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityId, setCommunityId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [newCommunityName, setNewCommunityName] = useState("");
  const [newCommunityTitle, setNewCommunityTitle] = useState("");

  useEffect(() => {
    getMe()
      .then(() => setAuthChecked(true))
      .catch(() => {
        window.location.href = "/login";
      });
    getCommunities().then(setCommunities);
  }, []);

  async function handleCreateCommunity(e: FormEvent) {
    e.preventDefault();
    const community = await createCommunity({
      name: newCommunityName,
      title: newCommunityTitle,
    });
    setCommunities((prev) => [community, ...prev]);
    setCommunityId(community.id);
    setNewCommunityName("");
    setNewCommunityTitle("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!communityId) {
      setError("choose or create a community first");
      return;
    }
    setSubmitting(true);
    try {
      await createPost({ communityId, title, url: url || undefined, body: body || undefined });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : "failed to create post");
    } finally {
      setSubmitting(false);
    }
  }

  if (!authChecked) return null;

  return (
    <main style={{ padding: "2rem", maxWidth: 500 }}>
      <h1>Submit a post</h1>

      {communities.length === 0 && (
        <section style={{ marginBottom: "2rem", border: "1px solid #ccc", padding: "1rem" }}>
          <p>No communities exist yet — create the first one.</p>
          <form
            onSubmit={handleCreateCommunity}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <label>
              Name (used in URLs)
              <input
                value={newCommunityName}
                onChange={(e) => setNewCommunityName(e.target.value)}
                required
              />
            </label>
            <label>
              Title
              <input
                value={newCommunityTitle}
                onChange={(e) => setNewCommunityTitle(e.target.value)}
                required
              />
            </label>
            <button type="submit">Create community</button>
          </form>
        </section>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <label>
          Community
          <select value={communityId} onChange={(e) => setCommunityId(e.target.value)} required>
            <option value="">Select a community</option>
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.actor.username}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          URL (optional)
          <input value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label>
          Text (optional)
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "Posting…" : "Post"}
        </button>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </form>
    </main>
  );
}
