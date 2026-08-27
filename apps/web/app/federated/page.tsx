"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  getFeed,
  getFederatedDomains,
  getLongformFeed,
  getGhostBlogSubscriptions,
  addGhostBlogSubscription,
  removeGhostBlogSubscription,
  ApiError,
  type Post,
  type FeedSort,
  type FeedRange,
  type GhostBlogSubscription,
} from "../../lib/api";
import { PostItem } from "../../components/PostItem";
import { Avatar } from "../../components/Avatar";
import { FeedFilterBar } from "../../components/FeedFilterBar";
import { PageInfo } from "../../components/PageInfo";
import { ExternalLinkIcon, MailIcon } from "../../components/icons";
import { useConfirm } from "../../components/ConfirmDialog";

// One Ghost article, styled as a card rather than a feed row — a title,
// an excerpt, and a link out to the real article, not vote buttons and
// the rest of PostItem's short-post chrome. The byline links to the
// in-app profile (where the existing FollowButton already works) rather
// than duplicating follow-state logic here; `?domain=` is required, not
// optional, since most Ghost sites reuse "index" as their one actor's
// username — without it every blog in the feed would resolve to the
// same profile.
function LongformCard({ post }: { post: Post }) {
  const domain = post.author.domain;
  const [expanded, setExpanded] = useState(false);
  const excerpt = (post.body ?? "").slice(0, 320);
  const truncated = (post.body?.length ?? 0) > excerpt.length;
  // post.url (federation/remotePost.ts) is the article's own real
  // webpage when Ghost published one separately from remoteId —
  // confirmed live: remoteId here is an AP object id
  // (.ghost/activitypub/article/{uuid}) that always answers raw
  // JSON-LD regardless of Accept header, never an HTML page a reader
  // could actually open, unlike every other platform's "view original"
  // link. Falls back to remoteId for a post cached before this field
  // was captured.
  const articleUrl = post.url ?? post.remoteId;
  // Ghost's standard portal URL — the site's own paid-signup page.
  // There's no federated/API equivalent (each blog is its own
  // independently Stripe-connected site, and Ghost Explore itself
  // exposes no API for this either — confirmed live, its only public
  // endpoint is an analytics beacon, not a directory/checkout API), so
  // this just opens the real thing in a new tab rather than faking an
  // in-app checkout.
  const portalUrl = `https://${domain}/#/portal/signup`;

  return (
    <li className="card" style={{ display: "flex", flexDirection: "column", gap: "0.6rem", listStyle: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Avatar
          name={post.author.displayName ?? post.author.username}
          size={28}
          imageUrl={post.author.avatarImageUrl}
          preset={post.author.avatarPreset}
        />
        <Link href={`/u/${post.author.username}?domain=${encodeURIComponent(domain)}`} style={{ fontWeight: 600 }}>
          {post.author.displayName ?? post.author.username}
        </Link>
        <span className="text-faint" style={{ fontSize: "0.85rem" }}>· {domain}</span>
      </div>
      {post.title && <h3 style={{ margin: 0 }}>{post.title}</h3>}
      {/* Plain-text, not the article's real HTML/formatting — post.body
          is already the plain-text conversion remotePost.ts does for
          every cached post (toPlainText(content)), not a separate fetch
          of anything richer. Good enough for reading the piece without
          leaving Gibrr; the "Read full article" link is still there for
          the real, fully-formatted version. */}
      {excerpt && (
        <p className="text-dim" style={{ margin: 0, whiteSpace: expanded ? "pre-wrap" : undefined }}>
          {expanded ? post.body : excerpt}
          {!expanded && truncated ? "…" : ""}
        </p>
      )}
      {truncated && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setExpanded((e) => !e)}
          style={{ alignSelf: "flex-start" }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        {articleUrl && (
          <a
            className="btn btn-ghost post-icon-btn"
            href={articleUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Read full article on the origin site"
          >
            <ExternalLinkIcon />
          </a>
        )}
        <a
          className="btn btn-ghost post-icon-btn"
          href={portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Subscribe"
        >
          <MailIcon />
        </a>
      </div>
    </li>
  );
}

// Every federated post this instance has ever cached — from a relay
// subscription, a follow, or a resolved URL — not scoped to the
// viewer's own follow graph. See routes/posts.ts's GET /feed?scope=federated.
// Filterable by author domain and/or a keyword — this is the one feed
// broad enough to actually need narrowing down; Home is already scoped
// to your own follows/circles/explore subscriptions.
export default function FederatedPage() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<"all" | "longform">("all");
  const [posts, setPosts] = useState<Post[] | "loading" | "error">("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [sort, setSort] = useState<FeedSort>("new");
  const [range, setRange] = useState<FeedRange>("all");
  const [q, setQ] = useState("");
  // Debounced separately from the live `q` input so every keystroke
  // doesn't refetch — same pattern search-as-you-type elsewhere in this
  // app (FollowPanel's handle preview) already uses.
  const [appliedQ, setAppliedQ] = useState("");

  const [longformPosts, setLongformPosts] = useState<Post[] | "loading" | "error">("loading");
  // Filters the already-loaded Longform feed by blog/author name or
  // domain — there's no cross-Ghost-network search to call out to (see
  // LongformCard's own comment on explore.ghost.org's lack of an API),
  // so this only ever narrows down blogs Gibrr already knows about, not
  // a broader directory. Finding a blog Gibrr doesn't have yet means
  // either browsing Ghost's own directory (the link below) and adding it
  // yourself right there (see myGhostBlogs below — no Host needed), or,
  // for a blog you'd rather everyone on this instance see by default,
  // handing its domain to the Host to add under Host > Explore servers.
  const [longformQuery, setLongformQuery] = useState("");

  // The viewer's own personally-added blogs — layered on top of
  // whatever the Host has already curated (routes/ghost.ts, GET
  // /explore/longform/feed merges both server-side; this list is just
  // what powers the "your blogs" section and its Remove buttons).
  const [myGhostBlogs, setMyGhostBlogs] = useState<GhostBlogSubscription[] | "loading" | "error">("loading");
  const [newGhostDomain, setNewGhostDomain] = useState("");
  const [addingGhostBlog, setAddingGhostBlog] = useState(false);
  const [addGhostBlogError, setAddGhostBlogError] = useState<string | null>(null);

  function refreshLongform() {
    setLongformPosts("loading");
    getLongformFeed()
      .then((res) => setLongformPosts(res.posts))
      .catch(() => setLongformPosts("error"));
  }

  function refreshMyGhostBlogs() {
    getGhostBlogSubscriptions()
      .then(setMyGhostBlogs)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        setMyGhostBlogs("error");
      });
  }

  useEffect(() => {
    if (tab !== "longform") return;
    refreshLongform();
    refreshMyGhostBlogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function handleAddGhostBlog(e: FormEvent) {
    e.preventDefault();
    if (!newGhostDomain.trim()) return;
    setAddingGhostBlog(true);
    setAddGhostBlogError(null);
    try {
      await addGhostBlogSubscription(newGhostDomain.trim());
      setNewGhostDomain("");
      refreshMyGhostBlogs();
      refreshLongform();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        setAddGhostBlogError("You've already added that blog.");
      } else if (err instanceof ApiError && err.status === 422) {
        setAddGhostBlogError("Could not verify that as a reachable Ghost blog — check the domain.");
      } else {
        setAddGhostBlogError("Could not add that blog — check the domain and try again.");
      }
    } finally {
      setAddingGhostBlog(false);
    }
  }

  async function handleRemoveGhostBlog(blog: GhostBlogSubscription) {
    if (!(await confirm(`Remove "${blog.name ?? blog.domain}" from your Longform tab?`))) return;
    await removeGhostBlogSubscription(blog.id);
    refreshMyGhostBlogs();
    refreshLongform();
  }

  const filteredLongformPosts = useMemo(() => {
    if (!Array.isArray(longformPosts)) return longformPosts;
    const needle = longformQuery.trim().toLowerCase();
    if (!needle) return longformPosts;
    return longformPosts.filter((post) => {
      const haystack = [post.author.displayName, post.author.username, post.author.domain, post.title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [longformPosts, longformQuery]);

  useEffect(() => {
    getFederatedDomains("federated")
      .then(setDomains)
      .catch(() => setDomains([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedQ(q.trim()), 400);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setPosts("loading");
    getFeed(undefined, "federated", { domains: selectedDomains, q: appliedQ || undefined, sort, range })
      .then((res) => {
        setPosts(res.posts);
        setNextCursor(res.nextCursor);
      })
      .catch(() => setPosts("error"));
  }, [selectedDomains, appliedQ, sort, range]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await getFeed(nextCursor, "federated", {
        domains: selectedDomains,
        q: appliedQ || undefined,
        sort,
        range,
      });
      setPosts((prev) => (Array.isArray(prev) ? [...prev, ...res.posts] : prev));
      setNextCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="page">
      <PageInfo title="Fediverse">
        Every federated Gib this room knows about, not just from people you&apos;re listening to.
      </PageInfo>

      <div style={{ display: "flex", gap: "0.5rem", margin: "0.75rem 0 1rem" }}>
        <button className={`btn ${tab === "all" ? "" : "btn-ghost"}`} onClick={() => setTab("all")}>
          All
        </button>
        <button className={`btn ${tab === "longform" ? "" : "btn-ghost"}`} onClick={() => setTab("longform")}>
          Longform
        </button>
      </div>

      {tab === "all" && (
        <>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0 0 0.5rem" }}>
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by keyword…"
              style={{ flex: 1, minWidth: 200 }}
            />
            {q && (
              <button className="btn btn-ghost" onClick={() => setQ("")}>
                Clear keyword
              </button>
            )}
          </div>
          {/* No circles prop here — federated posts are always
              communityId: null (see routes/posts.ts's scope split), so a
              circle filter on this tab could only ever produce zero
              results. */}
          <FeedFilterBar
            sort={sort}
            onSortChange={setSort}
            range={range}
            onRangeChange={setRange}
            domains={domains}
            selectedDomains={selectedDomains}
            onSelectedDomainsChange={setSelectedDomains}
          />

          {posts === "loading" && <p className="text-dim">Loading…</p>}
          {posts === "error" && <p className="error-text">Could not reach the API.</p>}
          {Array.isArray(posts) && posts.length === 0 && (
            <p className="text-dim">
              {selectedDomains.length > 0 || appliedQ || sort !== "new" || range !== "all"
                ? "Nothing matches that filter."
                : "Nothing here yet."}
            </p>
          )}
          {Array.isArray(posts) && posts.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {posts.map((post) => (
                <PostItem key={post.id} post={post} />
              ))}
            </ul>
          )}

          {Array.isArray(posts) && nextCursor && (
            <button
              className="btn btn-ghost"
              onClick={handleLoadMore}
              disabled={loadingMore}
              style={{ display: "block", margin: "1rem auto" }}
            >
              {loadingMore ? "Loading…" : "See more"}
            </button>
          )}
        </>
      )}

      {tab === "longform" && (
        <>
          <form
            onSubmit={handleAddGhostBlog}
            className="card"
            style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "1rem" }}
          >
            <input
              className="input"
              value={newGhostDomain}
              onChange={(e) => setNewGhostDomain(e.target.value)}
              placeholder="Add a Ghost blog by domain — e.g. blog.example.com"
              style={{ flex: 1, minWidth: 200 }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={addingGhostBlog || !newGhostDomain.trim()}
            >
              {addingGhostBlog ? "Adding…" : "Add blog"}
            </button>
            {addGhostBlogError && (
              <p className="error-text" style={{ margin: 0, width: "100%" }}>
                {addGhostBlogError}
              </p>
            )}
          </form>

          {Array.isArray(myGhostBlogs) && myGhostBlogs.length > 0 && (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "0 0 1rem",
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              {myGhostBlogs.map((blog) => (
                <li key={blog.id} className="pill" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  {blog.name ?? blog.domain}
                  <button
                    onClick={() => handleRemoveGhostBlog(blog)}
                    aria-label={`Remove ${blog.name ?? blog.domain}`}
                    title="Remove"
                    style={{
                      background: "none",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      padding: 0,
                      lineHeight: 1,
                      fontSize: "1rem",
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0 0 1rem", alignItems: "center" }}>
            <input
              className="input"
              value={longformQuery}
              onChange={(e) => setLongformQuery(e.target.value)}
              placeholder="Search blogs Gibrr already knows…"
              style={{ flex: 1, minWidth: 200 }}
            />
            {/* Ghost Explore has no public search/directory API to call
                out to (confirmed live — see LongformCard's comment), so
                finding a blog not yet in the feed above means browsing
                Ghost's own directory here, then adding it yourself with
                the form above (no Host needed) — or, to make a blog show
                up for everyone on this instance by default, handing its
                domain to the Host to add under Host > Explore servers. */}
            <a
              className="btn btn-ghost"
              href="https://explore.ghost.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Discover more on Ghost Explore ↗
            </a>
          </div>

          {longformPosts === "loading" && <p className="text-dim">Loading…</p>}
          {longformPosts === "error" && <p className="error-text">Could not reach the API.</p>}
          {Array.isArray(filteredLongformPosts) && filteredLongformPosts.length === 0 && (
            <p className="text-dim">
              {longformQuery
                ? "No known blog matches that search."
                : "No Ghost blogs yet — add one above, or ask your Host to add one under Host > Explore servers."}
            </p>
          )}
          {Array.isArray(filteredLongformPosts) && filteredLongformPosts.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>
              {filteredLongformPosts.map((post) => (
                <LongformCard key={post.id} post={post} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
