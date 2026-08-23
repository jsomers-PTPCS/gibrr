"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  search,
  lookupRemoteGroup,
  joinRemoteGroup,
  getFollowPreview,
  getFollowPreviewByUrl,
  followHandle,
  followUrl,
  resolvePostByUrl,
  getMe,
  getCommunityMemberships,
  getDirectoryLinks,
  ApiError,
  type SearchResults,
  type RemoteGroupPreview,
  type FollowPreview,
  type Community,
} from "../../lib/api";
import { PostItem } from "../../components/PostItem";
import { Avatar } from "../../components/Avatar";
import { RenderedDescription } from "../../components/RenderedDescription";
import { ABOUT_FIELD_LABELS } from "../../lib/aboutFields";
import { dedupeDirectoriesByUrl, type FediverseDirectoryLink } from "../../lib/fediverseDirectories";

// There's no crawled index of the fediverse to fuzzy-search against (no
// server has one) — a remote-group lookup only makes sense for a query
// that's already a complete handle, not an arbitrary search term.
const HANDLE_PATTERN = /^[a-zA-Z0-9_]+@[a-zA-Z0-9.-]+(:[0-9]+)?$/;
// A pasted post URL — local or remote, ours or another instance's —
// never matches HANDLE_PATTERN (no "@"), so the two lookups are mutually
// exclusive on the same query.
const URL_PATTERN = /^https?:\/\//i;

function SearchResultsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get("q") ?? "";
  const [results, setResults] = useState<SearchResults | "loading" | "error">("loading");
  const [remoteGroup, setRemoteGroup] = useState<RemoteGroupPreview | "loading" | null>(null);
  const [joinState, setJoinState] = useState<"idle" | "joining" | "requested" | "error">("idle");
  const [personPreview, setPersonPreview] = useState<FollowPreview | "loading" | null>(null);
  const [followState, setFollowState] = useState<"idle" | "following" | "sent" | "error">("idle");
  const [myGroups, setMyGroups] = useState<Community[]>([]);
  const [postLookupState, setPostLookupState] = useState<"idle" | "loading" | "error">("idle");
  const [directoryLinks, setDirectoryLinks] = useState<FediverseDirectoryLink[]>([]);

  useEffect(() => {
    getMe()
      .then((me) => getCommunityMemberships(me.actor.username))
      .then(setMyGroups)
      .catch(() => setMyGroups([]));
    getDirectoryLinks()
      .then(setDirectoryLinks)
      .catch(() => setDirectoryLinks([]));
  }, []);

  // A handle typed the way every fediverse client actually displays one
  // (@alice@example.social) still needs to resolve — strip a leading
  // "@" before it ever reaches HANDLE_PATTERN or a lookup call, so
  // "alice@example.social" and "@alice@example.social" behave
  // identically. Left out of q itself (used as-is for the plain-text
  // search box below) since a leading "@" there is fine either way —
  // this only matters for the exact-handle lookup paths.
  const handleQuery = q.trim().replace(/^@/, "");

  useEffect(() => {
    if (!q) {
      setResults({ posts: [], actors: [], groups: [] });
      return;
    }
    setResults("loading");
    search(q)
      .then(setResults)
      .catch(() => setResults("error"));

    setJoinState("idle");
    setFollowState("idle");
    setPostLookupState("idle");
    if (HANDLE_PATTERN.test(handleQuery)) {
      // Both fire together: a handle is either a Group or a Person, never
      // both, so exactly one of these ever resolves to something — the
      // other silently 404s and stays null. This is cold, exact-handle
      // resolution (real webfinger lookup against that instance), not a
      // fuzzy suggestions index — no server has one of those for the
      // whole fediverse.
      setRemoteGroup("loading");
      lookupRemoteGroup(handleQuery)
        .then(setRemoteGroup)
        .catch(() => setRemoteGroup(null));
      setPersonPreview("loading");
      getFollowPreview(handleQuery)
        .then(setPersonPreview)
        .catch(() => setPersonPreview(null));
    } else if (URL_PATTERN.test(q.trim())) {
      // A pasted link could be either a post or a profile — try it as a
      // profile too (in parallel with the "View Gib" post-lookup button
      // below, which only fires on click). If it resolves, the person
      // card takes priority in the render below; if not (it really was a
      // post, or neither), personPreview quietly stays null and the
      // "Look up this Gib" card is what shows.
      setRemoteGroup(null);
      setPersonPreview("loading");
      getFollowPreviewByUrl(q.trim())
        .then(setPersonPreview)
        .catch(() => setPersonPreview(null));
    } else {
      setRemoteGroup(null);
      setPersonPreview(null);
    }
  }, [q]);

  async function handleLookupPost() {
    setPostLookupState("loading");
    try {
      const { id } = await resolvePostByUrl(q.trim());
      router.push(`/posts/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setPostLookupState("error");
    }
  }

  const alreadyJoined =
    typeof remoteGroup === "object" &&
    remoteGroup !== null &&
    myGroups.some((g) => g.actor.username === remoteGroup.username && g.actor.domain === remoteGroup.domain);

  async function handleJoinRemoteGroup() {
    setJoinState("joining");
    try {
      await joinRemoteGroup(handleQuery);
      setJoinState("requested");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setJoinState("error");
    }
  }

  async function handleFollowPerson() {
    setFollowState("following");
    try {
      if (URL_PATTERN.test(q.trim())) {
        await followUrl(q.trim());
      } else {
        await followHandle(handleQuery);
      }
      setFollowState("sent");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      setFollowState("error");
    }
  }

  const dedupedLinks = dedupeDirectoriesByUrl(directoryLinks);
  const peopleLinks = dedupedLinks.filter((l) => l.category === "people");
  const serverLinks = dedupedLinks.filter((l) => l.category === "servers");

  if (!q) {
    return (
      <main className="page">
        <h1>Search</h1>
        <p className="text-dim" style={{ marginTop: 0 }}>
          Search Gibrr by name, handle, or a pasted Gib URL — or browse the wider fediverse
          below. There's no crawled index of the fediverse (no server has one), so these are
          independent, third-party directories, not a Gibrr search.
        </p>

        <h2 style={{ fontSize: "1.1rem" }}>Find people</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
          {peopleLinks.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="card"
              style={{ display: "block", color: "inherit" }}
            >
              <strong>{link.name} ↗</strong>
              <p className="text-faint" style={{ margin: "0.2rem 0 0" }}>
                {link.description}
              </p>
            </a>
          ))}
        </div>

        <h2 style={{ fontSize: "1.1rem" }}>Find servers</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {serverLinks.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="card"
              style={{ display: "block", color: "inherit" }}
            >
              <strong>{link.name} ↗</strong>
              <p className="text-faint" style={{ margin: "0.2rem 0 0" }}>
                {link.description}
              </p>
            </a>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Search results for &ldquo;{q}&rdquo;</h1>

      {remoteGroup === "loading" ? (
        <p className="text-faint">Looking up {q} on the fediverse…</p>
      ) : remoteGroup ? (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Avatar name={remoteGroup.title} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <strong>{remoteGroup.title}</strong>
              {remoteGroup.software && <span className="pill">{remoteGroup.software}</span>}
            </div>
            <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
              @{remoteGroup.username}@{remoteGroup.domain}
            </p>
            {remoteGroup.description && (
              <RenderedDescription html={remoteGroup.description} style={{ marginTop: "0.3rem" }} collapsedHeight={96} />
            )}
          </div>
          {alreadyJoined ? (
            <span className="text-faint">✓ Joined</span>
          ) : joinState === "requested" ? (
            <span className="text-faint">Request sent</span>
          ) : (
            <button
              className="btn btn-primary"
              disabled={joinState === "joining"}
              onClick={handleJoinRemoteGroup}
            >
              {joinState === "joining" ? "…" : "Join"}
            </button>
          )}
          {joinState === "error" && <p className="error-text">Couldn&apos;t send that request.</p>}
        </div>
      ) : personPreview === "loading" ? (
        <p className="text-faint">Looking up {q} on the fediverse…</p>
      ) : personPreview ? (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {personPreview.url ? (
            <a
              href={personPreview.url}
              target="_blank"
              rel="noreferrer"
              style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0, color: "inherit" }}
            >
              <Avatar name={personPreview.displayName ?? personPreview.username} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{personPreview.displayName ?? personPreview.username}</strong>
                <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
                  @{personPreview.username}@{personPreview.domain} ↗
                </p>
              </div>
            </a>
          ) : (
            <Link
              href={`/u/${personPreview.username}`}
              style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0, color: "inherit" }}
            >
              <Avatar name={personPreview.displayName ?? personPreview.username} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{personPreview.displayName ?? personPreview.username}</strong>
                <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
                  @{personPreview.username}@{personPreview.domain}
                </p>
              </div>
            </Link>
          )}
          {followState === "sent" ? (
            <span className="text-faint">Request sent</span>
          ) : (
            <button
              className="btn btn-primary"
              disabled={followState === "following"}
              onClick={handleFollowPerson}
            >
              {followState === "following" ? "…" : "Listen"}
            </button>
          )}
          {followState === "error" && <p className="error-text">Couldn&apos;t send that request.</p>}
        </div>
      ) : URL_PATTERN.test(q.trim()) ? (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Look up this Gib</strong>
            <p className="text-faint" style={{ margin: "0.1rem 0 0" }}>
              {q}
            </p>
          </div>
          <button
            className="btn btn-primary"
            disabled={postLookupState === "loading"}
            onClick={handleLookupPost}
          >
            {postLookupState === "loading" ? "…" : "View Gib"}
          </button>
          {postLookupState === "error" && (
            <p className="error-text" style={{ margin: 0 }}>
              Couldn&apos;t resolve that URL to a Gib.
            </p>
          )}
        </div>
      ) : null}

      {results === "loading" && <p className="text-dim">Searching…</p>}
      {results === "error" && <p className="error-text">Search failed.</p>}

      {typeof results === "object" && (
        <>
          <h2 style={{ fontSize: "1.1rem" }}>People</h2>
          {results.actors.length === 0 ? (
            <>
              <p className="text-dim">No people found.</p>
              {!HANDLE_PATTERN.test(handleQuery) && !URL_PATTERN.test(q.trim()) && (
                <p className="text-faint" style={{ marginTop: "-0.5rem", marginBottom: "1.5rem" }}>
                  This only searches people this room already knows about — not the whole
                  fediverse (no server can crawl that). If you know their handle, try typing
                  it as <code>name@domain</code> instead to look them up and listen directly.
                </p>
              )}
            </>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem" }}>
              {results.actors.map((actor) => (
                <li key={actor.id}>
                  <Link
                    href={`/u/${actor.username}`}
                    className="conversation-row"
                    style={{ color: "inherit" }}
                  >
                    <Avatar name={actor.displayName ?? actor.username} size={40} />
                    <div>
                      <strong>{actor.displayName ?? actor.username}</strong>
                      <p className="text-faint" style={{ margin: 0 }}>
                        @{actor.username}@{actor.domain}
                      </p>
                      {actor.aboutMatches.length > 0 && (
                        <p className="text-faint" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
                          {actor.aboutMatches
                            .map((m) => `${ABOUT_FIELD_LABELS[m.field]}: ${m.value}`)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ fontSize: "1.1rem" }}>Circles</h2>
          {results.groups.length === 0 ? (
            <p className="text-dim">No circles found.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem" }}>
              {results.groups.map((group) => (
                <li key={group.id}>
                  <Link
                    href={`/g/${group.actor.username}`}
                    className="conversation-row"
                    style={{ color: "inherit" }}
                  >
                    <Avatar name={group.title} size={40} />
                    <div>
                      <strong>{group.title}</strong>
                      <p className="text-faint" style={{ margin: 0 }}>
                        {group.memberCount} members
                        {group.privacy !== "public" ? ` · ${group.privacy}` : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ fontSize: "1.1rem" }}>Gibs</h2>
          {results.posts.length === 0 ? (
            <p className="text-dim">No Gibs found.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {results.posts.map((post) => (
                <PostItem key={post.id} post={post} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<main className="page">Loading…</main>}>
      <SearchResultsInner />
    </Suspense>
  );
}
