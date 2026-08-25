"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createCommunity,
  leaveCommunity,
  getCommunityMemberships,
  getExploreServers,
  subscribeToExploreServer,
  unsubscribeFromExploreServer,
  getMe,
  getFollowGraph,
  unfollow,
  ApiError,
  type Community,
  type Me,
  type ExploreServer,
  type FollowSummary,
} from "../../lib/api";
import {
  GROUP_PRIVACY_LABELS,
  GROUP_PRIVACY_LEVELS,
  GROUP_PRIVACY_DESCRIPTIONS,
  type GroupPrivacy,
} from "../../lib/groupRoles";
import { AntennasTab } from "../../components/AntennasTab";
import { RssFeedsTab } from "../../components/RssFeedsTab";
import { StarterKitsTab } from "../../components/StarterKitsTab";
import { Avatar } from "../../components/Avatar";
import { PageInfo } from "../../components/PageInfo";

export default function GroupsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<"mine" | "explore" | "watching">("mine");

  const [exploreServers, setExploreServers] = useState<
    (ExploreServer & { subscribed: boolean })[] | "loading" | "error"
  >("loading");
  const [subscribingDomain, setSubscribingDomain] = useState<string | null>(null);

  // The viewer's real, persisted memberships — the single source of truth
  // for "✓ Joined" everywhere on this page (and for the My Groups tab),
  // rather than only reflecting whatever was clicked this session.
  const [myGroups, setMyGroups] = useState<Community[] | "loading">("loading");
  const [joining, setJoining] = useState<string | null>(null);

  // People the viewer follows ("Listening to"), shown alongside their
  // joined circles on the My Circles tab — same follow graph the
  // Relationships tab's FollowPanel already reads.
  const [following, setFollowing] = useState<FollowSummary[] | "loading">("loading");
  const [unlistening, setUnlistening] = useState<string | null>(null);
  // Filters both the circles and the people lists on My Circles — this
  // tab already has everything loaded client-side (myGroups/following),
  // so a live substring filter needs no round trip, unlike Discover's
  // query which hits the search API.
  const [myCirclesQuery, setMyCirclesQuery] = useState("");
  // Explore's own search — everything here is already loaded
  // client-side (getExploreServers fetched once up front), so this is
  // a plain substring filter, same posture as myCirclesFilter below.
  // Matters more now that FediDB auto-sync can make this list large.
  const [exploreQuery, setExploreQuery] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<GroupPrivacy>("public");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((m) => {
        setMe(m);
        getCommunityMemberships(m.actor.username).then(setMyGroups);
        // Needed for both the Explore tab and My Circles' "subscribed
        // servers" section, so fetch it once up front rather than
        // lazily per-tab.
        getExploreServers()
          .then(setExploreServers)
          .catch(() => setExploreServers("error"));
        getFollowGraph(m.actor.username)
          .then((graph) => setFollowing(graph.following.filter((f) => f.state === "accepted")))
          .catch(() => setFollowing([]));
      })
      .catch(() => {
        setMe(null);
        setMyGroups([]);
        setExploreServers([]);
        setFollowing([]);
      });
  }, []);

  // My Circles' own search — everything here is already loaded
  // client-side, so this is a plain substring filter, not a round trip
  // to GET /search the way Discover's query is.
  const myCirclesFilter = myCirclesQuery.trim().toLowerCase();
  const filteredMyGroups: Community[] = Array.isArray(myGroups)
    ? myGroups.filter(
        (c) =>
          !myCirclesFilter ||
          c.title.toLowerCase().includes(myCirclesFilter) ||
          c.actor.username.toLowerCase().includes(myCirclesFilter),
      )
    : [];
  const filteredFollowing: FollowSummary[] = Array.isArray(following)
    ? following.filter(
        (p) =>
          !myCirclesFilter ||
          (p.displayName ?? "").toLowerCase().includes(myCirclesFilter) ||
          p.username.toLowerCase().includes(myCirclesFilter),
      )
    : [];

  const exploreFilter = exploreQuery.trim().toLowerCase();
  const filteredExploreServers = Array.isArray(exploreServers)
    ? exploreServers.filter(
        (s) =>
          !exploreFilter ||
          s.domain.toLowerCase().includes(exploreFilter) ||
          (s.name ?? "").toLowerCase().includes(exploreFilter),
      )
    : exploreServers;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const community = await createCommunity({
        name,
        title,
        description: description || undefined,
        privacy,
      });
      router.push(`/g/${community.actor.username}`);
    } catch (err) {
      setError(err instanceof ApiError ? JSON.stringify(err.body) : "failed to create circle");
      setCreating(false);
    }
  }

  async function handleLeave(community: Community) {
    if (!me) return;
    setJoining(community.id);
    try {
      await leaveCommunity(community.id, me.actor.username);
      setMyGroups((prev) => (Array.isArray(prev) ? prev.filter((c) => c.id !== community.id) : prev));
    } finally {
      setJoining(null);
    }
  }

  async function handleUnlisten(person: FollowSummary) {
    setUnlistening(person.id);
    try {
      await unfollow(person.id);
      setFollowing((prev) => (Array.isArray(prev) ? prev.filter((p) => p.id !== person.id) : prev));
    } finally {
      setUnlistening(null);
    }
  }

  // Same toggle the per-server Explore page's own Subscribe button does
  // (app/explore/[domain]/page.tsx) — added here too so subscribing
  // doesn't require opening a server just to find that button.
  async function handleToggleSubscribe(server: ExploreServer & { subscribed: boolean }) {
    if (!me) {
      window.location.href = "/login";
      return;
    }
    setSubscribingDomain(server.domain);
    try {
      if (server.subscribed) {
        await unsubscribeFromExploreServer(server.domain);
      } else {
        await subscribeToExploreServer(server.domain);
      }
      setExploreServers((prev) =>
        Array.isArray(prev)
          ? prev.map((s) => (s.domain === server.domain ? { ...s, subscribed: !s.subscribed } : s))
          : prev,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) window.location.href = "/login";
    } finally {
      setSubscribingDomain(null);
    }
  }


  return (
    <main className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Circles</h1>
        {me && (
          <button className="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? "Cancel" : "Create circle"}
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="card">
          <label className="field">
            Name (used in URLs)
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            Title
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="field">
            Description (optional)
            <textarea
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <label className="field">
            Privacy
            <select
              className="input"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as GroupPrivacy)}
            >
              {GROUP_PRIVACY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {GROUP_PRIVACY_LABELS[level]}
                </option>
              ))}
            </select>
          </label>
          <p className="text-faint" style={{ marginTop: "-0.4rem" }}>
            {GROUP_PRIVACY_DESCRIPTIONS[privacy]}
          </p>
          <button type="submit" className="btn btn-accent" disabled={creating}>
            {creating ? "Creating…" : "Create circle"}
          </button>
          {error && <p className="error-text">{error}</p>}
        </form>
      )}

      <div className="circle-tabs" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "1rem 0" }}>
        <button
          className={`btn ${tab === "mine" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("mine")}
        >
          My Circles
        </button>
        <button
          className={`btn ${tab === "watching" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("watching")}
        >
          Watching
        </button>
        <button
          className={`btn ${tab === "explore" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("explore")}
        >
          Explore
        </button>
      </div>

      {tab === "mine" && !me && (
        <p className="text-dim">
          <a href="/login">Log in</a> to see the circles you&apos;ve joined.
        </p>
      )}

      {tab === "mine" && me && (
        <>
          <input
            className="input"
            value={myCirclesQuery}
            onChange={(e) => setMyCirclesQuery(e.target.value)}
            placeholder="Search your circles and the people you're listening to"
            style={{ width: "100%", marginBottom: "1rem" }}
          />

          <h2 style={{ fontSize: "1.1rem" }}>Circles</h2>
          {myGroups === "loading" ? (
            <p className="text-dim">Loading…</p>
          ) : filteredMyGroups.length === 0 ? (
            <p className="text-dim">
              {myGroups.length === 0
                ? "You haven't joined any circles yet — try Search."
                : "No circles match that search."}
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, marginBottom: "1rem" }}>
              {filteredMyGroups.map((c) => (
                <li key={c.id} className="card">
                  <div
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}
                  >
                    <div>
                      <Link
                        href={`/g/${c.actor.username}`}
                        style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--text)" }}
                      >
                        {c.title}
                      </Link>
                      <p className="text-faint" style={{ margin: "0.2rem 0" }}>
                        c/{c.actor.username} · {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <button className="btn btn-ghost" disabled={joining === c.id} onClick={() => handleLeave(c)}>
                      Leave
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ fontSize: "1.1rem" }}>People you&apos;re listening to</h2>
          {following === "loading" ? (
            <p className="text-dim">Loading…</p>
          ) : filteredFollowing.length === 0 ? (
            <p className="text-dim">
              {following.length === 0
                ? "You aren't listening to anyone yet — try Search."
                : "No one matches that search."}
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, marginBottom: "1rem" }}>
              {filteredFollowing.map((p) => (
                <li key={p.id} className="card">
                  <div
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}
                  >
                    <Link
                      href={`/u/${p.username}?domain=${encodeURIComponent(p.domain)}`}
                      style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0, color: "inherit" }}
                    >
                      <Avatar
                        name={p.displayName ?? p.username}
                        size={40}
                        imageUrl={p.avatarImageUrl}
                        preset={p.avatarPreset}
                      />
                      <div style={{ minWidth: 0 }}>
                        <strong>{p.displayName ?? p.username}</strong>
                        <p className="text-faint" style={{ margin: 0 }}>
                          @{p.username}@{p.domain}
                        </p>
                      </div>
                    </Link>
                    <button
                      className="btn btn-ghost"
                      disabled={unlistening === p.id}
                      onClick={() => handleUnlisten(p)}
                      style={{ flexShrink: 0 }}
                    >
                      Unlisten
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {Array.isArray(exploreServers) && exploreServers.some((s) => s.subscribed) && (
            <>
              <h3 style={{ fontSize: "1rem" }}>Subscribed servers</h3>
              <p className="text-faint" style={{ marginTop: 0 }}>
                Trending posts from these merge into your Home feed — see the Explore tab to
                manage them.
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {exploreServers
                  .filter((s) => s.subscribed)
                  .map((server) => (
                    <li key={server.domain} className="card">
                      <Link href={`/explore/${encodeURIComponent(server.domain)}`} style={{ fontWeight: 700, fontSize: "1.05rem" }}>
                        {server.name || server.domain}
                      </Link>
                      {server.name && (
                        <p className="text-faint" style={{ margin: "0.2rem 0 0" }}>
                          {server.domain}
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </>
      )}

      {tab === "explore" && (
        <>
          <PageInfo title="Explore" level="h2">
            Browse trending and public posts from other servers — a live look at each server&apos;s own
            feed, not something federated into Gibrr. Clicking a post pulls it in so you can Echo,
            React, or Chatter on it like any other Gib. Subscribing merges a server&apos;s trending
            posts into your own Home feed going forward.
          </PageInfo>

          {exploreServers === "loading" && <p className="text-dim">Loading…</p>}
          {exploreServers === "error" && <p className="error-text">Could not load the server list.</p>}
          {Array.isArray(exploreServers) && exploreServers.length === 0 && (
            <p className="text-dim">No servers added yet — ask your Host to add one.</p>
          )}
          {Array.isArray(exploreServers) && exploreServers.length > 0 && (
            <input
              className="input"
              value={exploreQuery}
              onChange={(e) => setExploreQuery(e.target.value)}
              placeholder="Search servers"
              style={{ width: "100%", marginBottom: "1rem" }}
            />
          )}
          {Array.isArray(exploreServers) && exploreServers.length > 0 && filteredExploreServers.length === 0 && (
            <p className="text-dim">No servers match that search.</p>
          )}
          {Array.isArray(filteredExploreServers) && filteredExploreServers.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
              {filteredExploreServers.map((server) => (
                <li
                  key={server.domain}
                  className="card"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link
                      href={`/explore/${encodeURIComponent(server.domain)}`}
                      style={{ fontWeight: 600, overflowWrap: "anywhere" }}
                    >
                      {server.name || server.domain}
                    </Link>
                    {server.name && (
                      <p className="text-faint" style={{ margin: "0.2rem 0 0", overflowWrap: "anywhere" }}>
                        {server.domain}
                      </p>
                    )}
                  </div>
                  <button
                    className={`btn ${server.subscribed ? "btn-ghost" : "btn-primary"}`}
                    style={{ flexShrink: 0 }}
                    disabled={subscribingDomain === server.domain}
                    onClick={() => handleToggleSubscribe(server)}
                  >
                    {subscribingDomain === server.domain
                      ? "…"
                      : server.subscribed
                        ? "✓ Subscribed"
                        : "Subscribe"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "watching" && !me && (
        <p className="text-dim">
          <a href="/login">Log in</a> to set up saved keyword/author watches.
        </p>
      )}
      {tab === "watching" && me && (
        <>
          <AntennasTab />
          <RssFeedsTab />
          <StarterKitsTab />
        </>
      )}
    </main>
  );
}
