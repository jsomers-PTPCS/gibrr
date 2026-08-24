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
import { ShareMenu } from "../../components/ShareMenu";
import { PostComments } from "../../components/PostComments";

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
  preload,
  muted,
  slideHeight,
  onToggleMute,
  onVote,
  onBoost,
  onBookmark,
}: {
  post: Post;
  active: boolean;
  preload: "auto" | "none";
  muted: boolean;
  slideHeight: string;
  onToggleMute: () => void;
  onVote: () => void;
  onBoost: () => void;
  onBookmark: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Hidden by default so the video isn't permanently covered by caption
  // text — double-tapping/double-clicking reveals it, toggled per slide
  // rather than shared (each slide's own local state, since every slide
  // stays mounted the whole time this feed is open). A double-click also
  // fires two ordinary clicks first, which flips onToggleMute twice —
  // net no-op, so mute doesn't visibly change on a double-tap.
  const [showDescription, setShowDescription] = useState(false);
  // Slides in from the right over the video rather than navigating away
  // to /posts/:id — same "stay in the feed" reasoning ShareMenu replaced
  // the old view-original link for. Left uncovered on purpose (see the
  // drawer's own width below) so the video's onClick below has a real
  // target to dismiss it from — the exposed strip functions as this
  // slide's own backdrop, not the drawer requiring a dedicated close
  // button (though one's included too, for anyone who taps the video
  // itself expecting mute-toggle instead).
  const [commentsOpen, setCommentsOpen] = useState(false);

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
        // "auto" only for the active slide and its immediate neighbor
        // (whichever way a swipe is about to go) — every slide is
        // already mounted at once (no virtualization), so the browser's
        // own default preload behavior would otherwise start fetching
        // dozens of videos nobody's scrolled anywhere near yet. "none"
        // for the rest means the *next* swipe never has to wait for a
        // cold fetch to start, without wasting bandwidth on the ones
        // after that.
        preload={preload}
        // While comments are open, the video (now only exposed on its
        // left strip — see the drawer below) is that drawer's own
        // dismiss target instead of the usual mute toggle; tapping it
        // again to unmute is one tap away once it's closed.
        onClick={() => (commentsOpen ? setCommentsOpen(false) : onToggleMute())}
        onDoubleClick={() => setShowDescription((s) => !s)}
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
          href={`/u/${post.author.username}?domain=${encodeURIComponent(post.author.domain)}`}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#fff", pointerEvents: "auto", width: "fit-content" }}
        >
          <Avatar
            name={post.author.displayName ?? post.author.username}
            size={32}
            imageUrl={post.author.avatarImageUrl}
            preset={post.author.avatarPreset}
          />
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <strong>{post.author.displayName ?? post.author.username}</strong>
            <span style={{ opacity: 0.75, fontSize: "0.85rem" }}>@{post.author.username}@{post.author.domain}</span>
          </span>
        </Link>
        {/* Hidden until a double-click/double-tap on the video reveals
            it — see the video element's onDoubleClick above. */}
        {post.body && showDescription && <p style={{ margin: "0.5rem 0 0" }}>{post.body}</p>}
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
          {/* remoteEngagement.likes is the origin server's real total for
              this video (see GET /explore/loops/feed) — a freshly cached
              copy's own score starts at 0, which would otherwise read as
              "0 likes" on something with thousands. */}
          <span style={{ fontSize: "0.85rem" }}>{(post.remoteEngagement?.likes ?? 0) + post.score}</span>
        </button>

        <button
          onClick={() => setCommentsOpen(true)}
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
          <CommentIcon width={30} height={30} />
          <span style={{ fontSize: "0.85rem" }}>
            {(post.remoteEngagement?.comments ?? 0) + post.commentCount}
          </span>
        </button>

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

        <ShareMenu url={post.remoteId ?? `/posts/${post.id}`} />
      </div>

      {/* Slides in from the right, deliberately not full-width — the
          exposed strip of video on the left is what the onClick above
          treats as this drawer's own dismiss target, so it always has
          to leave some of the video clickable rather than covering it
          entirely. min(420px, 78%) keeps it from becoming absurdly wide
          on a desktop browser, where this feed still works the same
          way despite being designed around a phone-sized viewport. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 78%)",
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          transform: commentsOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
          boxShadow: commentsOpen ? "-4px 0 16px rgba(0,0,0,0.4)" : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.75rem 1rem",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <strong>Comments</strong>
          <button
            onClick={() => setCommentsOpen(false)}
            className="btn btn-ghost"
            style={{ padding: "0.2rem 0.5rem" }}
            title="Close"
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 1rem 1rem" }}>
          {/* Mounted only once opened — a still-mounted-but-hidden drawer
              on every one of potentially dozens of loaded slides would
              mean fetching every video's comments up front for panels
              most viewers never open. */}
          {commentsOpen && <PostComments postId={post.id} />}
        </div>
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

  // The bottom tab bar (BottomTabBar.tsx, mobile only) is `position:
  // fixed` and isn't accounted for by any page padding here (unlike
  // .page/.page-wide elsewhere) — without subtracting it too, its last
  // ~4rem sits on top of this feed's bottom slide instead of the video
  // finishing above it. Measuring it the same way as the nav above
  // means this naturally reads 0 on desktop, where it's `display: none`.
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  useEffect(() => {
    const bar = document.querySelector(".bottom-tab-bar");
    if (!bar) return;
    const observer = new ResizeObserver(() => setBottomBarHeight(bar.getBoundingClientRect().height));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const slideHeight = `calc(100dvh - ${navHeight}px - ${bottomBarHeight}px)`;

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

  // A TikTok-style feed lives on rapid, repeated taps while scrolling —
  // waiting for each one's network round trip before the heart/boost/
  // bookmark icon visibly changed (confirmed live: ~1-2s of dead air per
  // tap on the old await-then-setState order) read as sluggish in a way
  // it doesn't on a normal feed post, where a single deliberate click
  // isn't usually followed by three more a second later. All three
  // handlers below now flip the icon immediately and only reconcile
  // with the server's real response — or revert back — once it answers,
  // so the tap itself never has to wait on the network to feel like it
  // did anything.
  function updatePost(id: string, patch: Partial<Post>) {
    setPosts((prev) => (Array.isArray(prev) ? prev.map((p) => (p.id === id ? { ...p, ...patch } : p)) : prev));
  }

  async function handleVote(post: Post) {
    // Always toggles to/from 1 (a heart-tap, not up/down like the normal
    // VoteButtons) — same toggle-off-on-repeat semantics routes/posts.ts's
    // POST /posts/:id/vote already has, since PostItem's own handleVote
    // relies on exactly that.
    const wasVoted = post.myVote === 1;
    updatePost(post.id, { score: post.score + (wasVoted ? -1 : 1), myVote: wasVoted ? null : 1 });
    try {
      const { score, myVote } = await votePost(post.id, 1);
      updatePost(post.id, { score, myVote });
    } catch (err) {
      updatePost(post.id, { score: post.score, myVote: post.myVote });
      if (err instanceof ApiError && err.status === 401) window.location.href = "/login";
    }
  }

  async function handleBoost(post: Post) {
    const wasBoosted = post.boosted;
    updatePost(post.id, { boosted: !wasBoosted });
    try {
      if (wasBoosted) {
        await unboostPost(post.id);
      } else {
        await boostPost(post.id);
      }
    } catch {
      // no inline error surface here — a failed boost is low-stakes,
      // the button just quietly flips back.
      updatePost(post.id, { boosted: wasBoosted });
    }
  }

  async function handleBookmark(post: Post) {
    const wasBookmarked = post.bookmarked;
    updatePost(post.id, { bookmarked: !wasBookmarked });
    try {
      if (wasBookmarked) {
        await unbookmarkPost(post.id);
      } else {
        await bookmarkPost(post.id);
      }
    } catch {
      // same low-stakes non-surfacing as handleBoost
      updatePost(post.id, { bookmarked: wasBookmarked });
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

  const activeIndex = posts.findIndex((p) => p.id === activeId);

  return (
    <div
      ref={containerRef}
      style={{
        height: slideHeight,
        overflowY: "scroll",
        scrollSnapType: "y mandatory",
      }}
    >
      {posts.map((post, index) => (
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
            preload={Math.abs(index - activeIndex) <= 1 ? "auto" : "none"}
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
