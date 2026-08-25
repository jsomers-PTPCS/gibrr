"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getStarterPack, followAllInStarterPack, ApiError, type StarterPack } from "../../../lib/api";
import { Avatar } from "../../../components/Avatar";
import { FollowButton } from "../../../components/FollowButton";
import { ShareMenu } from "../../../components/ShareMenu";

// A single starter kit's full member list — routes/starterPacks.ts's
// GET /starter-packs/:id. Same list+detail split as
// AntennasTab/app/antennas/[id]/page.tsx: browsing and creating live in
// StarterKitsTab (the /g "Starter Kits" tab), this is just for viewing
// one kit's members and following them, individually or all at once.
export default function StarterKitPage() {
  const { id } = useParams<{ id: string }>();
  const [pack, setPack] = useState<StarterPack | "loading" | "error" | "not_found">("loading");
  const [followingAll, setFollowingAll] = useState(false);
  const [followAllResult, setFollowAllResult] = useState<string | null>(null);
  // Bumped after "Follow all" completes to force every FollowButton
  // below to remount and refetch its own status — each one only checks
  // once on mount, so nothing else would notice a status that changed
  // out from under it via the bulk endpoint instead of its own click.
  const [followRefreshKey, setFollowRefreshKey] = useState(0);

  function refresh() {
    getStarterPack(id)
      .then(setPack)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setPack("not_found");
          return;
        }
        setPack("error");
      });
  }

  useEffect(refresh, [id]);

  async function handleFollowAll() {
    setFollowingAll(true);
    setFollowAllResult(null);
    try {
      const { followed, alreadyFollowing, total } = await followAllInStarterPack(id);
      setFollowAllResult(
        total === 0
          ? "This kit has no members yet."
          : `Followed ${followed} of ${total}${alreadyFollowing > 0 ? ` (already following ${alreadyFollowing})` : ""}.`,
      );
      setFollowRefreshKey((k) => k + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setFollowAllResult("Could not follow everyone — try again.");
    } finally {
      setFollowingAll(false);
    }
  }

  if (pack === "loading") return <main className="page"><p className="text-dim">Loading…</p></main>;
  if (pack === "not_found") {
    return <main className="page"><p className="error-text">Starter kit not found.</p></main>;
  }
  if (pack === "error") {
    return <main className="page"><p className="error-text">Could not load this starter kit.</p></main>;
  }

  return (
    <main className="page">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
        <h1 style={{ margin: 0 }}>{pack.name}</h1>
        <ShareMenu url={`/starter-kits/${pack.id}`} triggerStyle={{ color: "var(--text)" }} iconSize={22} />
      </div>
      {pack.description && <p className="text-dim" style={{ marginTop: "0.5rem" }}>{pack.description}</p>}
      {pack.creator && (
        <p className="text-dim" style={{ marginTop: 0, fontSize: "0.85rem" }}>
          by @{pack.creator.username}@{pack.creator.domain}
        </p>
      )}

      <button className="btn btn-primary" disabled={followingAll} onClick={handleFollowAll} style={{ margin: "0.5rem 0 1rem" }}>
        {followingAll ? "Following…" : "Follow all"}
      </button>
      {followAllResult && <p className="text-dim" style={{ marginTop: 0 }}>{followAllResult}</p>}

      {pack.members.length === 0 && <p className="text-dim">This kit has no members yet.</p>}
      {pack.members.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {pack.members.map((member) => (
            <li
              key={member.id}
              className="card"
              style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}
            >
              <Avatar
                name={member.displayName ?? member.username}
                size={40}
                imageUrl={member.avatarImageUrl}
                preset={member.avatarPreset}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong
                  style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {member.displayName ?? member.username}
                </strong>
                <div
                  className="text-dim"
                  style={{
                    fontSize: "0.85rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  @{member.username}@{member.domain}
                </div>
              </div>
              <FollowButton
                key={`${member.id}-${followRefreshKey}`}
                username={member.username}
                domain={member.domain}
                actorId={member.id}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
