"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { getAntennas, createAntenna, deleteAntenna, ApiError, type Antenna } from "../lib/api";
import { useConfirm } from "./ConfirmDialog";

// Misskey-style "antennas": saved keyword/author filters, each its own
// live view of already-visible posts (see app/antennas/[id]/page.tsx,
// which stays a standalone route for viewing one watch's matches — only
// this list+create half moved here, formerly its own app/antennas/page.tsx).
// Never federated — a private lens, same as Keeps/KeepsTab.
export function AntennasTab() {
  const confirm = useConfirm();
  const [antennas, setAntennas] = useState<Antenna[] | "loading" | "error">("loading");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [watchedHandles, setWatchedHandles] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    getAntennas()
      .then(setAntennas)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        setAntennas("error");
      });
  }

  useEffect(refresh, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createAntenna({
        name: name.trim(),
        keywords: keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        watchedHandles: watchedHandles
          .split(",")
          .map((h) => h.trim().replace(/^@/, ""))
          .filter(Boolean),
      });
      setName("");
      setKeywords("");
      setWatchedHandles("");
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setError("Could not create watch — check your input and try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(antenna: Antenna) {
    if (!(await confirm(`Delete the "${antenna.name}" watch?`))) return;
    await deleteAntenna(antenna.id);
    refresh();
  }

  return (
    <div>
      <p className="text-dim" style={{ marginTop: 0 }}>
        Saved keyword/author filters — each one is its own live view of posts you can already
        see, matching whatever you set below.
      </p>

      <form onSubmit={handleCreate} className="card" style={{ display: "grid", gap: "0.6rem", marginBottom: "1.5rem" }}>
        <input
          className="input"
          placeholder="Watch name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
        <input
          className="input"
          placeholder="Keywords, comma-separated (optional)"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
        <input
          className="input"
          placeholder="Watched users, comma-separated — e.g. alice, bob@example.social (optional)"
          value={watchedHandles}
          onChange={(e) => setWatchedHandles(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={creating || !name.trim()}>
          {creating ? "Creating…" : "Create watch"}
        </button>
      </form>

      {antennas === "loading" && <p className="text-dim">Loading…</p>}
      {antennas === "error" && <p className="error-text">Could not load your Watching list.</p>}
      {Array.isArray(antennas) && antennas.length === 0 && (
        <p className="text-dim">Nothing in Watching yet — create one above.</p>
      )}
      {Array.isArray(antennas) && antennas.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {antennas.map((antenna) => (
            <li key={antenna.id} className="card" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/antennas/${antenna.id}`} style={{ fontWeight: 600 }}>
                  {antenna.name}
                </Link>
                <div className="text-dim" style={{ fontSize: "0.85rem" }}>
                  {antenna.keywords.length > 0 && <span>keywords: {antenna.keywords.join(", ")}</span>}
                  {antenna.keywords.length > 0 && antenna.watchedActors.length > 0 && " · "}
                  {antenna.watchedActors.length > 0 && (
                    <span>users: {antenna.watchedActors.map((a) => a.username).join(", ")}</span>
                  )}
                  {antenna.keywords.length === 0 && antenna.watchedActors.length === 0 && (
                    <span>matches every Gib you can see</span>
                  )}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => handleDelete(antenna)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
