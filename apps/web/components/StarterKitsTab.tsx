"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  getStarterPacks,
  createStarterPack,
  importStarterPack,
  deleteStarterPack,
  followAllInStarterPack,
  ApiError,
  type StarterPack,
  type StarterPackSort,
} from "../lib/api";
import { useConfirm } from "./ConfirmDialog";
import { Avatar } from "./Avatar";
import { PageInfo } from "./PageInfo";
import { ShareMenu } from "./ShareMenu";

// Loops (the video app)'s "starter kits" — a named, public bundle of up
// to 25 accounts around a theme, browsable by anyone and one-tap
// followable all at once. This is the list+create half, same split as
// AntennasTab/app/antennas/[id]/page.tsx: the full member list with
// individual follow buttons lives at app/starter-kits/[id]/page.tsx,
// which stays a standalone route.
const MAX_MEMBER_STACK = 6;

const SORT_OPTIONS: { value: StarterPackSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "members", label: "Most members" },
  { value: "name", label: "Name (A–Z)" },
];

export function StarterKitsTab() {
  const confirm = useConfirm();
  const [packs, setPacks] = useState<StarterPack[] | "loading" | "error">("loading");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberHandles, setMemberHandles] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [followingId, setFollowingId] = useState<string | null>(null);
  const [followResult, setFollowResult] = useState<{ id: string; text: string } | null>(null);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<StarterPackSort>("newest");
  const [mineOnly, setMineOnly] = useState(false);
  const hasActiveFilter = q.trim() !== "" || sort !== "newest" || mineOnly;

  function refresh() {
    getStarterPacks({ q: q.trim() || undefined, sort, mine: mineOnly || undefined })
      .then(setPacks)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        setPacks("error");
      });
  }

  // Debounced the same 400ms way AdminTab's relay directory search is —
  // covers sort/mine changes too (not just typing), so a click doesn't
  // race a still-in-flight request from the previous one.
  useEffect(() => {
    const timer = setTimeout(refresh, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, mineOnly]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createStarterPack({
        name: name.trim(),
        description: description.trim() || undefined,
        memberHandles: memberHandles
          .split(",")
          .map((h) => h.trim().replace(/^@/, ""))
          .filter(Boolean),
      });
      setName("");
      setDescription("");
      setMemberHandles("");
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setError("Could not create starter kit — check your input (up to 25 members) and try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      await importStarterPack(importUrl.trim());
      setImportUrl("");
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setImportError("Could not import that link — paste a Loops starter kit or Mastodon Collection URL.");
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(pack: StarterPack) {
    if (!(await confirm(`Delete the "${pack.name}" starter kit?`))) return;
    await deleteStarterPack(pack.id);
    refresh();
  }

  async function handleFollowAll(pack: StarterPack) {
    setFollowingId(pack.id);
    setFollowResult(null);
    try {
      const { followed, alreadyFollowing, total } = await followAllInStarterPack(pack.id);
      setFollowResult({
        id: pack.id,
        text:
          total === 0
            ? "This kit has no members yet."
            : `Followed ${followed} of ${total}${alreadyFollowing > 0 ? ` (already following ${alreadyFollowing})` : ""}.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setFollowResult({ id: pack.id, text: "Could not follow everyone — try again." });
    } finally {
      setFollowingId(null);
    }
  }

  return (
    <div>
      <PageInfo title="Starter Kits" level="h2">
        Curated bundles of accounts around a theme — one tap follows every member at once.
      </PageInfo>

      <form
        onSubmit={handleCreate}
        className="card"
        style={{ display: "grid", gap: "0.6rem", marginBottom: "1.5rem" }}
      >
        <input
          className="input"
          placeholder="Kit name — e.g. 3D printing"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
        <input
          className="input"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
        <input
          className="input"
          placeholder="Members, comma-separated — e.g. alice, bob@example.social (up to 25)"
          value={memberHandles}
          onChange={(e) => setMemberHandles(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={creating || !name.trim()}>
          {creating ? "Creating…" : "Create starter kit"}
        </button>
      </form>

      <form
        onSubmit={handleImport}
        className="card"
        style={{ display: "grid", gap: "0.6rem", marginBottom: "1.5rem" }}
      >
        <label className="text-dim" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
          Or import one by link
        </label>
        <input
          className="input"
          placeholder="https://loops.video/starter-kits/... or a Mastodon Collection URL"
          value={importUrl}
          onChange={(e) => setImportUrl(e.target.value)}
        />
        {importError && <p className="error-text">{importError}</p>}
        <button className="btn btn-ghost" type="submit" disabled={importing || !importUrl.trim()}>
          {importing ? "Importing…" : "Import"}
        </button>
      </form>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        <input
          className="input"
          placeholder="Search starter kits…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 12rem", minWidth: 0 }}
        />
        <select
          className="input"
          value={sort}
          onChange={(e) => setSort(e.target.value as StarterPackSort)}
          style={{ flex: "0 0 auto" }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          My kits only
        </label>
        {hasActiveFilter && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setQ("");
              setSort("newest");
              setMineOnly(false);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {packs === "loading" && <p className="text-dim">Loading…</p>}
      {packs === "error" && <p className="error-text">Could not load starter kits.</p>}
      {Array.isArray(packs) && packs.length === 0 && (
        <p className="text-dim">
          {hasActiveFilter ? "No starter kits match this search/filter." : "No starter kits yet — create one above."}
        </p>
      )}
      {Array.isArray(packs) && packs.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {packs.map((pack) => (
            <li key={pack.id} className="card" style={{ display: "grid", gap: "0.5rem", minWidth: 0 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
                <div style={{ flex: "1 1 12rem", minWidth: 0 }}>
                  <Link href={`/starter-kits/${pack.id}`} style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                    {pack.name}
                  </Link>
                  {pack.description && (
                    <div className="text-dim starter-kit-description" style={{ fontSize: "0.85rem" }}>
                      {pack.description}
                    </div>
                  )}
                </div>
                {/* Grouped (rather than three loose flex siblings) so the
                    whole action row wraps to its own line as one unit on
                    a narrow screen — marginLeft: auto then pushes that
                    wrapped line flush to the right edge, same as the
                    create/import boxes' full-width buttons above,
                    instead of trailing off wherever the name column
                    happened to leave room. */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}>
                  <button
                    className="btn btn-ghost"
                    disabled={followingId === pack.id}
                    onClick={() => handleFollowAll(pack)}
                  >
                    {followingId === pack.id ? "Following…" : "Follow all"}
                  </button>
                  {pack.isOwner && (
                    <button className="btn btn-ghost" onClick={() => handleDelete(pack)}>
                      Delete
                    </button>
                  )}
                  <ShareMenu url={`/starter-kits/${pack.id}`} triggerStyle={{ color: "var(--text)" }} iconSize={20} />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <div style={{ display: "flex" }}>
                  {pack.members.slice(0, MAX_MEMBER_STACK).map((member, i) => (
                    <span
                      key={member.id}
                      style={{
                        marginLeft: i === 0 ? 0 : "-0.5rem",
                        border: "2px solid var(--bg)",
                        borderRadius: "50%",
                        display: "block",
                      }}
                    >
                      <Avatar
                        name={member.displayName ?? member.username}
                        size={28}
                        imageUrl={member.avatarImageUrl}
                        preset={member.avatarPreset}
                      />
                    </span>
                  ))}
                </div>
                <span className="text-dim" style={{ fontSize: "0.85rem" }}>
                  {pack.members.length} member{pack.members.length === 1 ? "" : "s"}
                </span>
              </div>

              {followResult?.id === pack.id && (
                <p className="text-dim" style={{ margin: 0, fontSize: "0.85rem" }}>{followResult.text}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
