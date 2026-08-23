"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getCommunities,
  createCommunity,
  joinCommunity,
  leaveCommunity,
  search,
  lookupRemoteGroup,
  joinRemoteGroup,
  getCommunityMemberships,
  getExploreServers,
  subscribeToExploreServer,
  unsubscribeFromExploreServer,
  getMe,
  ApiError,
  type Community,
  type Me,
  type RemoteGroupPreview,
  type ExploreServer,
} from "../../lib/api";
import {
  GROUP_PRIVACY_LABELS,
  GROUP_PRIVACY_LEVELS,
  GROUP_PRIVACY_DESCRIPTIONS,
  type GroupPrivacy,
} from "../../lib/groupRoles";
import { RenderedDescription } from "../../components/RenderedDescription";
import { AntennasTab } from "../../components/AntennasTab";

// Same constraint as /search's remote lookup: no crawled index of the
// fediverse exists to fuzzy-search against (no server has one) — a
// remote-group lookup only makes sense once the query is already a
// complete handle, not an arbitrary search term.
const HANDLE_PATTERN = /^[a-zA-Z0-9_]+@[a-zA-Z0-9.-]+(:[0-9]+)?$/;

// A plain-text, single-line teaser derived from an already-sanitized
// description (see api's descriptionHtml.ts) — purely for this compact
// list row's truncated display, not re-rendered as HTML, so there's no
// security concern in a quick regex strip here.
function descriptionTeaser(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export default function GroupsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<"discover" | "mine" | "explore" | "watching">("mine");

  const [exploreServers, setExploreServers] = useState<
    (ExploreServer & { subscribed: boolean })[] | "loading" | "error"
  >("loading");
  const [subscribingDomain, setSubscribingDomain] = useState<string | null>(null);

  // Discover: browse-all when query is empty, GET /search's group results
  // otherwise — one state, one effect, so there's never a stale mix of
  // the two on screen.
  const [query, setQuery] = useState("");
  const [discoverResults, setDiscoverResults] = useState<Community[] | "loading">("loading");
  const [remoteGroup, setRemoteGroup] = useState<RemoteGroupPreview | "loading" | null>(null);
  const [remoteJoinState, setRemoteJoinState] = useState<"idle" | "joining" | "requested" | "error">(
    "idle",
  );

  // The viewer's real, persisted memberships — the single source of truth
  // for "Join" vs "✓ Joined" everywhere on this page (and for the My
  // Groups tab), rather than only reflecting whatever was clicked this
  // session.
  const [myGroups, setMyGroups] = useState<Community[] | "loading">("loading");
  const [pendingRequests, setPendingRequests] = useState<Set<string>>(new Set());
  const [joining, setJoining] = useState<string | null>(null);

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
      })
      .catch(() => {
        setMe(null);
        setMyGroups([]);
        setExploreServers([]);
      });
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setDiscoverResults("loading");
      getCommunities().then(setDiscoverResults);
      setRemoteGroup(null);
      return;
    }

    setDiscoverResults("loading");
    search(q)
      .then((res) => setDiscoverResults(res.groups))
      .catch(() => setDiscoverResults([]));

    setRemoteJoinState("idle");
    if (HANDLE_PATTERN.test(q)) {
      setRemoteGroup("loading");
      lookupRemoteGroup(q)
        .then(setRemoteGroup)
        .catch(() => setRemoteGroup(null));
    } else {
      setRemoteGroup(null);
    }
  }, [query]);


  const joinedIds = new Set(Array.isArray(myGroups) ? myGroups.map((c) => c.id) : []);
  const remoteAlreadyJoined =
    typeof remoteGroup === "object" &&
    remoteGroup !== null &&
    Array.isArray(myGroups) &&
    myGroups.some((g) => g.actor.username === remoteGroup.username && g.actor.domain === remoteGroup.domain);

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

  async function handleJoin(community: Community) {
    if (!me) {
      window.location.href = "/login";
      return;
    }
    setJoining(community.id);
    try {
      const result = await joinCommunity(community.id);
      if (result.state === "accepted") {
        setMyGroups((prev) => (Array.isArray(prev) ? [...prev, community] : prev));
      } else {
        setPendingRequests((prev) => new Set(prev).add(community.id));
      }
    } catch {
      // already a member/pending — nothing useful to show inline here
    } finally {
      setJoining(null);
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

  async function handleJoinRemoteGroup() {
    setRemoteJoinState("joining");
    try {
      await joinRemoteGroup(query.trim());
      setRemoteJoinState("requested");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setRemoteJoinState("error");
    }
  }

  function groupStatus(c: Community): "accepted" | "pending" | null {
    if (joinedIds.has(c.id)) return "accepted";
    if (pendingRequests.has(c.id)) return "pending";
    return null;
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
          className={`btn ${tab === "discover" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("discover")}
        >
          Discover
        </button>
        <button
          className={`btn ${tab === "mine" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("mine")}
        >
          My Circles
        </button>
        <button
          className={`btn ${tab === "explore" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("explore")}
        >
          Explore
        </button>
        <button
          className={`btn ${tab === "watching" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("watching")}
        >
          Watching
        </button>
      </div>

      {tab === "discover" && (
        <>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search circles, or enter a fediverse handle (circle@domain)"
            style={{ width: "100%", marginBottom: "1rem" }}
          />

          {remoteGroup === "loading" ? (
            <p className="text-faint">Looking up {query.trim()} on the fediverse…</p>
          ) : remoteGroup ? (
            <div
              className="card"
              style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{remoteGroup.title}</strong>
                <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
                  @{remoteGroup.username}@{remoteGroup.domain}
                </p>
                {remoteGroup.description && (
                  <RenderedDescription
                    html={remoteGroup.description}
                    style={{ marginTop: "0.3rem" }}
                    collapsedHeight={96}
                  />
                )}
              </div>
              {remoteAlreadyJoined ? (
                <span className="text-faint">✓ Joined</span>
              ) : remoteJoinState === "requested" ? (
                <span className="text-faint">Request sent</span>
              ) : (
                <button
                  className="btn btn-primary"
                  disabled={remoteJoinState === "joining"}
                  onClick={handleJoinRemoteGroup}
                >
                  {remoteJoinState === "joining" ? "…" : "Join"}
                </button>
              )}
              {remoteJoinState === "error" && <p className="error-text">Couldn&apos;t send that request.</p>}
            </div>
          ) : null}

          {discoverResults === "loading" ? (
            <p className="text-dim">Loading…</p>
          ) : discoverResults.length === 0 ? (
            <p className="text-dim">{query.trim() ? "No circles found." : "No circles yet."}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {discoverResults.map((c) => {
                const status = groupStatus(c);
                return (
                  <li key={c.id} className="card">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "1rem",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Link
                          href={`/g/${c.actor.username}`}
                          style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--text)" }}
                        >
                          {c.title}
                        </Link>
                        {c.privacy !== "public" && (
                          <span className="pill" style={{ marginLeft: "0.5rem" }}>
                            {GROUP_PRIVACY_LABELS[c.privacy]}
                          </span>
                        )}
                        <p className="text-faint" style={{ margin: "0.2rem 0" }}>
                          c/{c.actor.username} · {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                        </p>
                        {c.description && (
                          <p
                            style={{
                              margin: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {descriptionTeaser(c.description)}
                          </p>
                        )}
                      </div>
                      {status === "accepted" ? (
                        <span className="text-faint">✓ Joined</span>
                      ) : status === "pending" ? (
                        <span className="text-faint">Requested</span>
                      ) : (
                        <button className="btn btn-ghost" disabled={joining === c.id} onClick={() => handleJoin(c)}>
                          {c.privacy === "public" ? "Join" : "Request to join"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {tab === "mine" && !me && (
        <p className="text-dim">
          <a href="/login">Log in</a> to see the circles you&apos;ve joined.
        </p>
      )}

      {tab === "mine" && me && (
        <>
          {myGroups === "loading" ? (
            <p className="text-dim">Loading…</p>
          ) : myGroups.length === 0 ? (
            <p className="text-dim">You haven&apos;t joined any circles yet — try Discover.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, marginBottom: "1rem" }}>
              {myGroups.map((c) => (
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
          <p className="text-dim" style={{ marginTop: 0 }}>
            Browse trending and public posts from other servers — a live look at each server's own
            feed, not something federated into Gibrr. Clicking a post pulls it in so you can Echo,
            React, or Chatter on it like any other Gib. Subscribing merges a server's trending
            posts into your own Home feed going forward.
          </p>

          {exploreServers === "loading" && <p className="text-dim">Loading…</p>}
          {exploreServers === "error" && <p className="error-text">Could not load the server list.</p>}
          {Array.isArray(exploreServers) && exploreServers.length === 0 && (
            <p className="text-dim">No servers added yet — ask your Host to add one.</p>
          )}
          {Array.isArray(exploreServers) && exploreServers.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
              {exploreServers.map((server) => (
                <li
                  key={server.domain}
                  className="card"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}
                >
                  <div>
                    <Link href={`/explore/${encodeURIComponent(server.domain)}`} style={{ fontWeight: 600 }}>
                      {server.name || server.domain}
                    </Link>
                    {server.name && (
                      <p className="text-faint" style={{ margin: "0.2rem 0 0" }}>
                        {server.domain}
                      </p>
                    )}
                  </div>
                  <button
                    className={`btn ${server.subscribed ? "btn-ghost" : "btn-primary"}`}
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
      {tab === "watching" && me && <AntennasTab />}
    </main>
  );
}
