"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getMe,
  getCommunity,
  getCommunityMembers,
  getCommunityPosts,
  joinCommunity,
  leaveCommunity,
  approveGroupMember,
  removeGroupMember,
  changeGroupMemberRole,
  updateCommunity,
  deleteCommunity,
  type Me,
  type GroupDetail,
  type GroupMembersResponse,
  type Post,
} from "../../../lib/api";
import { PostItem } from "../../../components/PostItem";
import { RenderedDescription } from "../../../components/RenderedDescription";
import { useConfirm } from "../../../components/ConfirmDialog";
import {
  GROUP_ROLE_LABELS,
  GROUP_PRIVACY_LABELS,
  GROUP_PRIVACY_LEVELS,
  GROUP_PRIVACY_DESCRIPTIONS,
  type GroupRole,
  type GroupPrivacy,
} from "../../../lib/groupRoles";

const ROLE_RANK: Record<GroupRole, number> = { owner: 3, admin: 2, moderator: 1, member: 0 };
const ASSIGNABLE_ROLES: GroupRole[] = ["admin", "moderator", "member"];

export default function GroupPage() {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const confirm = useConfirm();

  const [me, setMe] = useState<Me | null>(null);
  const [group, setGroup] = useState<GroupDetail | "loading" | "error">("loading");
  const [tab, setTab] = useState<"posts" | "members" | "manage">("posts");

  const [posts, setPosts] = useState<Post[] | "loading" | "unavailable">("loading");
  const [membersData, setMembersData] = useState<GroupMembersResponse | "loading">("loading");

  const [joinBusy, setJoinBusy] = useState(false);

  const [settingsTitle, setSettingsTitle] = useState("");
  const [settingsDescription, setSettingsDescription] = useState("");
  const [settingsPrivacy, setSettingsPrivacy] = useState<GroupPrivacy>("public");
  const [savingSettings, setSavingSettings] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  // Snapshot of the fields as they were the moment a save last
  // succeeded — the "Save settings" button reads "Saved" only while
  // the live fields still match it exactly; editing any of them (even
  // back to the same value) diverges the two and the button reverts.
  // null until the first successful save this session.
  const [savedSettingsSnapshot, setSavedSettingsSnapshot] = useState<string | null>(null);
  const currentSettingsSnapshot = JSON.stringify({
    title: settingsTitle,
    description: settingsDescription,
    privacy: settingsPrivacy,
  });

  function refreshGroup() {
    return getCommunity(name).then((g) => {
      setGroup(g);
      setSettingsTitle(g.title);
      setSettingsDescription(g.description ?? "");
      setSettingsPrivacy(g.privacy);
      return g;
    });
  }

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
    refreshGroup().catch(() => setGroup("error"));
  }, [name]);

  useEffect(() => {
    if (group === "loading" || group === "error") return;
    if (tab === "posts" && posts === "loading") {
      getCommunityPosts(group.id)
        .then(setPosts)
        .catch(() => setPosts("unavailable"));
    }
    if ((tab === "members" || tab === "manage") && membersData === "loading") {
      getCommunityMembers(group.id).then(setMembersData);
    }
  }, [tab, group, posts, membersData]);

  async function refreshMembers() {
    if (group === "loading" || group === "error") return;
    const updated = await getCommunityMembers(group.id);
    setMembersData(updated);
  }

  async function handleJoin() {
    if (group === "loading" || group === "error") return;
    if (!me) {
      router.push("/login");
      return;
    }
    setJoinBusy(true);
    try {
      await joinCommunity(group.id);
      await refreshGroup();
    } finally {
      setJoinBusy(false);
    }
  }

  async function handleLeave() {
    if (group === "loading" || group === "error" || !me) return;
    setJoinBusy(true);
    try {
      await leaveCommunity(group.id, me.actor.username);
      await refreshGroup();
    } finally {
      setJoinBusy(false);
    }
  }

  async function handleApprove(username: string) {
    if (group === "loading" || group === "error") return;
    await approveGroupMember(group.id, username);
    await Promise.all([refreshMembers(), refreshGroup()]);
  }

  async function handleDeny(username: string) {
    if (group === "loading" || group === "error") return;
    await removeGroupMember(group.id, username);
    await refreshMembers();
  }

  async function handleRemoveMember(username: string) {
    if (group === "loading" || group === "error") return;
    if (!(await confirm(`Remove @${username} from this group?`))) return;
    await removeGroupMember(group.id, username);
    await Promise.all([refreshMembers(), refreshGroup()]);
  }

  async function handleRoleChange(username: string, role: GroupRole) {
    if (group === "loading" || group === "error") return;
    setManageError(null);
    try {
      await changeGroupMemberRole(group.id, username, role);
      await refreshMembers();
    } catch {
      setManageError("failed to change role");
    }
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    if (group === "loading" || group === "error") return;
    setSavingSettings(true);
    setManageError(null);
    try {
      await updateCommunity(group.id, {
        title: settingsTitle,
        description: settingsDescription || undefined,
        privacy: settingsPrivacy,
      });
      const g = await refreshGroup();
      // Snapshot what the server actually stored (its description may
      // have been re-sanitized from what was submitted), not what was
      // merely typed — that's what "still matches what I saved" needs
      // to compare against.
      setSavedSettingsSnapshot(
        JSON.stringify({ title: g.title, description: g.description ?? "", privacy: g.privacy }),
      );
    } catch {
      setManageError("failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleDeleteGroup() {
    if (group === "loading" || group === "error") return;
    if (!(await confirm(`Delete "${group.title}"? This permanently removes all its Gibs.`))) return;
    await deleteCommunity(group.id);
    router.push("/g");
  }

  if (group === "loading") return <main className="page">Loading…</main>;
  if (group === "error") return <main className="page">Could not load this circle.</main>;

  const membership = group.viewerMembership;
  const myRank = membership?.state === "accepted" ? ROLE_RANK[membership.role] : -1;
  const canManage = myRank >= 1; // moderator+
  const canEditSettings = myRank >= 2; // admin+
  const isOwner = myRank === 3;

  return (
    <main className="page">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0 }}>{group.title}</h1>
            <p className="text-faint" style={{ margin: "0.2rem 0" }}>
              c/{group.actor.username} · {GROUP_PRIVACY_LABELS[group.privacy]} · {group.memberCount} member
              {group.memberCount === 1 ? "" : "s"}
            </p>
            {group.description && (
              <RenderedDescription
                html={group.description}
                style={{ marginTop: "0.5rem" }}
                collapsedHeight={96}
              />
            )}
          </div>

          <div>
            {!me ? (
              <Link href="/login" className="btn btn-ghost">
                Log in to join
              </Link>
            ) : !membership ? (
              <button className="btn btn-primary" disabled={joinBusy} onClick={handleJoin}>
                {joinBusy ? "…" : group.privacy === "public" ? "Join" : "Request to join"}
              </button>
            ) : membership.state === "pending" ? (
              <button className="btn btn-ghost" disabled={joinBusy} onClick={handleLeave}>
                {joinBusy ? "…" : "Request pending — Cancel"}
              </button>
            ) : isOwner ? (
              <span className="pill">Owner</span>
            ) : (
              <button className="btn btn-ghost" disabled={joinBusy} onClick={handleLeave}>
                {joinBusy ? "…" : "✓ Member — Leave"}
              </button>
            )}
          </div>
        </div>

        <nav className="tabs" style={{ marginTop: "1rem" }}>
          <button className={tab === "posts" ? "active" : undefined} onClick={() => setTab("posts")}>
            Gibs
          </button>
          <button className={tab === "members" ? "active" : undefined} onClick={() => setTab("members")}>
            Members
          </button>
          {(canManage || me?.isAdmin) && (
            <button className={tab === "manage" ? "active" : undefined} onClick={() => setTab("manage")}>
              Manage
            </button>
          )}
        </nav>
      </div>

      {tab === "posts" &&
        (posts === "loading" ? (
          <p className="text-dim">Loading…</p>
        ) : posts === "unavailable" ? (
          <p className="text-dim">You don&apos;t have access to this circle&apos;s Gibs.</p>
        ) : posts.length === 0 ? (
          <p className="text-dim">No Gibs yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {posts.map((post) => (
              <PostItem key={post.id} post={post} />
            ))}
          </ul>
        ))}

      {tab === "members" && (
        <div className="card">
          {membersData === "loading" ? (
            <p className="text-dim">Loading…</p>
          ) : (
            <>
              {canManage && membersData.pending.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <h3 style={{ fontSize: "1rem" }}>Pending requests</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {membersData.pending.map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>{p.displayName ?? p.username}</span>
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button className="btn btn-accent" onClick={() => handleApprove(p.username)}>
                            Approve
                          </button>
                          <button className="btn btn-ghost" onClick={() => handleDeny(p.username)}>
                            Deny
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <h3 style={{ fontSize: "1rem" }}>Members</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {membersData.members.map((m) => {
                  const canChangeRole = canEditSettings && m.role !== "owner" && (isOwner || m.role !== "admin");
                  const canRemove =
                    m.role !== "owner" &&
                    me?.actor.username !== m.actor.username &&
                    myRank > ROLE_RANK[m.role];
                  return (
                    <div key={m.actor.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Link href={`/u/${m.actor.username}`} style={{ color: "inherit" }}>
                        {m.actor.displayName ?? m.actor.username}
                      </Link>
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        {canChangeRole ? (
                          <select
                            className="input"
                            style={{ fontSize: "0.85rem", padding: "0.2rem" }}
                            value={m.role}
                            onChange={(e) => handleRoleChange(m.actor.username, e.target.value as GroupRole)}
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {GROUP_ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-faint">{GROUP_ROLE_LABELS[m.role]}</span>
                        )}
                        {canRemove && (
                          <button className="btn btn-ghost" onClick={() => handleRemoveMember(m.actor.username)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "manage" && (canManage || me?.isAdmin) && (
        <div className="card">
          {canEditSettings ? (
            <form onSubmit={handleSaveSettings}>
              <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Circle settings</h3>
              <label className="field">
                Title
                <input
                  className="input"
                  value={settingsTitle}
                  onChange={(e) => setSettingsTitle(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                Description
                <textarea
                  className="input"
                  value={settingsDescription}
                  onChange={(e) => setSettingsDescription(e.target.value)}
                  rows={3}
                />
              </label>
              <label className="field">
                Privacy
                <select
                  className="input"
                  value={settingsPrivacy}
                  onChange={(e) => setSettingsPrivacy(e.target.value as GroupPrivacy)}
                >
                  {GROUP_PRIVACY_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {GROUP_PRIVACY_LABELS[level]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-faint" style={{ marginTop: "-0.4rem" }}>
                {GROUP_PRIVACY_DESCRIPTIONS[settingsPrivacy]}
              </p>
              <button type="submit" className="btn btn-accent" disabled={savingSettings}>
                {savingSettings
                  ? "Saving…"
                  : savedSettingsSnapshot === currentSettingsSnapshot
                    ? "Saved"
                    : "Save settings"}
              </button>
              {manageError && <p className="error-text">{manageError}</p>}
            </form>
          ) : (
            <p className="text-dim">Approve/deny requests and remove members from the Members tab.</p>
          )}

          {(isOwner || me?.isAdmin) && (
            <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <h3 style={{ fontSize: "1rem" }}>Danger zone</h3>
              <button className="btn btn-ghost" onClick={handleDeleteGroup}>
                Delete this circle
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
