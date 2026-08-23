"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  getLoopsFeed,
  votePost,
  boostPost,
  unboostPost,
  bookmarkPost,
  unbookmarkPost,
  ApiError,
  API_URL,
  type Post,
} from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { HeartIcon, CommentIcon, BoostIcon, BookmarkIcon } from "../../components/icons";

function assetUrl(path: string) {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
}

// One full-viewport video slide — plays only while `active` (the
// IntersectionObserver in the parent decides that), matching the
// single-video-plays-at-a-time behavior every TikTok-style feed has.
// Tapping the video toggles mute (shared across all slides, not
// per-video, so it doesn't reset every swipe) since autoplay only
// works muted in every real browser anyway.
function LoopSlide({
  post,
  active,
  muted,
  slideHeight,
  onToggleMute,
  onVote,
  onBoost,
  onBookmark,
}: {
  post: Post;
  active: boolean;
  muted: boolean;
  slideHeight: string;
  onToggleMute: () => void;
  onVote: () => void;
  onBoost: () => void;
  onBookmark: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      video.currentTime = 0;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [active]);

  return (
    <div
      className="loop-slide"
      style={{
        position: "relative",
        height: slideHeight,
        scrollSnapAlign: "start",
        scrollSnapStop: "always",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        src={assetUrl(post.videoUrl!)}
        loop
        muted={muted}
        playsInline
        onClick={onToggleMute}
        style={{ width: "100%", height: "100%", objectFit: "contain", cursor: "pointer" }}
      />

      <div
        style={{
          position: "absolute",
          left: 0,
          right: "4.5rem",
          bottom: 0,
          padding: "1rem",
          background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
          color: "#fff",
          pointerEvents: "none",
        }}
      >
        <Link
          href={`/u/${post.author.username}`}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#fff", pointerEvents: "auto", width: "fit-content" }}
        >
          <Avatar
            name={post.author.displayName ?? post.author.username}
            size={32}
            imageUrl={post.author.avatarImageUrl}
            preset={post.author.avatarPreset}
          />
          <strong>{post.author.displayName ?? post.author.username}</strong>
          <span style={{ opacity: 0.75, fontSize: "0.85rem" }}>@{post.author.username}@{post.author.domain}</span>
        </Link>
        {post.body && <p style={{ margin: "0.5rem 0 0" }}>{post.body}</p>}
      </div>

      <div
        style={{
          position: "absolute",
          right: "0.75rem",
          // The floating chat launcher (globals.css's .chat-dock-launcher)
          // is `position: fixed; right: 1.25rem; bottom: 1.25rem;` at
          // 56px across, on every page — clearing its footprint (up to
          // ~4.75rem off the true viewport bottom) rather than sitting at
          // the same 1.25rem everything else here would put it, so it
          // never covers the lowest action icon.
          bottom: "6rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
          alignItems: "center",
          color: "#fff",
        }}
      >
        <button
          onClick={onVote}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.2rem",
            color: "#fff",
            background: "none",
            border: "none",
            padding: "0.3rem",
            cursor: "pointer",
          }}
        >
          <HeartIcon filled={post.myVote === 1} width={30} height={30} />
          <span style={{ fontSize: "0.85rem" }}>{post.score}</span>
        </button>

        <Link
          href={`/posts/${post.id}`}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.2rem",
            color: "#fff",
            padding: "0.3rem",
          }}
        >
          <CommentIcon width={30} height={30} />
          <span style={{ fontSize: "0.85rem" }}>{post.commentCount}</span>
        </Link>

        <button
          onClick={onBoost}
          style={{
            color: post.boosted ? "var(--primary)" : "#fff",
            background: "none",
            border: "none",
            padding: "0.3rem",
            cursor: "pointer",
          }}
          title={post.boosted ? "Unboost" : "Boost"}
        >
          <BoostIcon width={30} height={30} />
        </button>

        <button
          onClick={onBookmark}
          style={{ color: "#fff", background: "none", border: "none", padding: "0.3rem", cursor: "pointer" }}
          title={post.bookmarked ? "Remove from Keeps" : "Save to Keeps"}
        >
          <BookmarkIcon filled={post.bookmarked} width={30} height={30} />
        </button>

        {post.remoteId && (
          <a
            href={post.remoteId}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#fff", padding: "0.3rem", fontSize: "1.6rem", textDecoration: "none" }}
            title="View original"
          >
            ↗
          </a>
        )}
      </div>
    </div>
  );
}

// The "Loops" subcategory — a TikTok-style vertically snap-scrollable
// feed aggregating video content live from every Host-curated server
// running Loops software (routes/explore.ts's GET /explore/loops/feed).
// Reached from the main Nav, right next to Circles.
export default function LoopsPage() {
  const [posts, setPosts] = useState<Post[] | "loading" | "error">("loading");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // The sticky Nav's real height, not a guess — on a narrow phone
  // screen it wraps to two rows (the account button doesn't collapse
  // behind the hamburger toggle the way Federated/Circles/search do),
  // so a fixed pixel estimate here would either overflow the actual
  // viewport (each "full screen" slide taller than what's really left
  // below the nav) or leave a gap, depending on how wide the device is.
  const [navHeight, setNavHeight] = useState(64);
  useEffect(() => {
    const nav = document.querySelector(".nav");
    if (!nav) return;
    // A `window.resize` listener alone missed real height changes here
    // (confirmed live): the nav can reflow to its final two-row height
    // after mount — a web font swapping in, an avatar image loading —
    // with no resize event ever firing, leaving navHeight stuck at
    // whatever it measured on the first paint. ResizeObserver watches
    // the nav element's own box, not the viewport, so it catches every
    // one of those reflows too.
    // Read getBoundingClientRect() rather than the entry's own
    // contentRect — the nav has padding and a border-bottom, and
    // contentRect excludes both, which would under-measure by exactly
    // that amount.
    const observer = new ResizeObserver(() => setNavHeight(nav.getBoundingClientRect().height));
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);
  const slideHeight = `calc(100dvh - ${navHeight}px)`;

  useEffect(() => {
    getLoopsFeed()
      .then((res) => {
        setPosts(res.posts);
        if (res.posts.length > 0) setActiveId(res.posts[0].id);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        setPosts("error");
      });
  }, []);

  useEffect(() => {
    if (!Array.isArray(posts) || posts.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (mostVisible) setActiveId(mostVisible.target.getAttribute("data-post-id"));
      },
      { root: container, threshold: [0.6] },
    );

    slideRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [posts]);

  async function handleVote(post: Post) {
    try {
      // Always sends 1 (a heart-tap, not up/down like the normal
      // VoteButtons) — same toggle-off-on-repeat semantics
      // routes/posts.ts's POST /posts/:id/vote already has, since
      // PostItem's own handleVote relies on exactly that.
      const { score, myVote } = await votePost(post.id, 1);
      setPosts((prev) =>
        Array.isArray(prev) ? prev.map((p) => (p.id === post.id ? { ...p, score, myVote } : p)) : prev,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) window.location.href = "/login";
    }
  }

  async function handleBoost(post: Post) {
    try {
      if (post.boosted) {
        await unboostPost(post.id);
      } else {
        await boostPost(post.id);
      }
      setPosts((prev) =>
        Array.isArray(prev) ? prev.map((p) => (p.id === post.id ? { ...p, boosted: !p.boosted } : p)) : prev,
      );
    } catch {
      // no inline error surface here — a failed boost is low-stakes,
      // the button just doesn't visually flip.
    }
  }

  async function handleBookmark(post: Post) {
    try {
      if (post.bookmarked) {
        await unbookmarkPost(post.id);
      } else {
        await bookmarkPost(post.id);
      }
      setPosts((prev) =>
        Array.isArray(prev)
          ? prev.map((p) => (p.id === post.id ? { ...p, bookmarked: !p.bookmarked } : p))
          : prev,
      );
    } catch {
      // same low-stakes non-surfacing as handleBoost
    }
  }

  if (posts === "loading") {
    return (
      <main className="page">
        <p className="text-dim">Loading…</p>
      </main>
    );
  }

  if (posts === "error") {
    return (
      <main className="page">
        <p className="error-text">Could not load Loops right now.</p>
      </main>
    );
  }

  if (posts.length === 0) {
    return (
      <main className="page">
        <h1>Loops</h1>
        <p className="text-dim">
          No Loops content yet — ask your Host to add a Loops server under Host &gt; Explore
          servers.
        </p>
      </main>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        height: slideHeight,
        overflowY: "scroll",
        scrollSnapType: "y mandatory",
      }}
    >
      {posts.map((post) => (
        <div
          key={post.id}
          data-post-id={post.id}
          ref={(el) => {
            if (el) slideRefs.current.set(post.id, el);
            else slideRefs.current.delete(post.id);
          }}
        >
          <LoopSlide
            post={post}
            active={activeId === post.id}
            muted={muted}
            slideHeight={slideHeight}
            onToggleMute={() => setMuted((m) => !m)}
            onVote={() => handleVote(post)}
            onBoost={() => handleBoost(post)}
            onBookmark={() => handleBookmark(post)}
          />
        </div>
      ))}
    </div>
  );
}
