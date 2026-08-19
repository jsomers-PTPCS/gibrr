"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { getMe, getProfile, updateProfile, ApiError, type Me, type Profile } from "../../../lib/api";
import { PostItem } from "../../../components/PostItem";

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<Profile | "loading" | "error">("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfile(username)
      .then(setProfile)
      .catch(() => setProfile("error"));
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, [username]);

  function startEditing() {
    if (profile === "loading" || profile === "error") return;
    setDisplayName(profile.actor.displayName ?? "");
    setSummary(profile.actor.summary ?? "");
    setEditing(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateProfile({ displayName: displayName || undefined, summary: summary || undefined });
      const refreshed = await getProfile(username);
      setProfile(refreshed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : "failed to save profile");
    }
  }

  if (profile === "loading") return <main style={{ padding: "2rem" }}>Loading…</main>;
  if (profile === "error") return <main style={{ padding: "2rem" }}>Could not load this profile.</main>;

  const isOwnProfile = me?.actor.username === profile.actor.username;

  return (
    <main style={{ padding: "2rem" }}>
      <h1>{profile.actor.displayName ?? profile.actor.username}</h1>
      <p>@{profile.actor.username}</p>

      {editing ? (
        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 400 }}>
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Bio
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} />
          </label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit">Save</button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          {error && <p style={{ color: "red" }}>{error}</p>}
        </form>
      ) : (
        <>
          {profile.actor.summary && <p>{profile.actor.summary}</p>}
          {isOwnProfile && <button onClick={startEditing}>Edit profile</button>}
        </>
      )}

      <p>
        {profile.counts.followers} followers · {profile.counts.following} following
      </p>

      <h2>Posts</h2>
      {profile.posts.length === 0 ? (
        <p>No posts yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {profile.posts.map((post) => (
            <PostItem key={post.id} post={post} />
          ))}
        </ul>
      )}
    </main>
  );
}
