"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  getNotifications,
  markNotificationsRead,
  clearNotifications,
  ApiError,
  API_URL,
  type AppNotification,
} from "../../lib/api";
import { Avatar } from "../../components/Avatar";
import { emitNotificationCount } from "../../components/NotificationBell";
import { PushToggle } from "../../components/PushToggle";
import { timeAgo } from "../../lib/timeAgo";

// The actor's `domain` is the API server's domain, not the web origin —
// same comparison FollowPanel.tsx makes for its profile links.
const LOCAL_ACTOR_DOMAIN = new URL(API_URL).host;

function profileHref(actor: NonNullable<AppNotification["actor"]>) {
  return actor.domain === LOCAL_ACTOR_DOMAIN
    ? `/u/${actor.username}`
    : `/u/${actor.username}?domain=${encodeURIComponent(actor.domain)}`;
}

// The one place notification copy lives — returns the sentence and where
// tapping the row should go.
function describe(n: AppNotification): { text: ReactNode; href: string; excerpt: string | null } {
  const name = n.actor ? n.actor.displayName ?? n.actor.username : "Someone";
  const who = <strong>{name}</strong>;
  const postHref = n.post ? `/posts/${n.post.id}` : n.comment ? `/posts/${n.comment.postId}` : "/";
  const groupHref = n.community ? `/g/${n.community.name}` : "/";
  const groupName = n.community?.title ?? "a group";

  switch (n.type) {
    case "follow":
      return { text: <>{who} followed you</>, href: n.actor ? profileHref(n.actor) : "/", excerpt: null };
    case "follow_accepted":
      return {
        text: <>{who} accepted your follow request</>,
        href: n.actor ? profileHref(n.actor) : "/",
        excerpt: null,
      };
    case "follow_request":
      return {
        text: <>{who} requested to follow you</>,
        href: n.actor ? profileHref(n.actor) : "/",
        excerpt: null,
      };
    case "friend_request":
      return {
        text: <>{who} sent you a friend request</>,
        href: n.actor ? profileHref(n.actor) : "/",
        excerpt: null,
      };
    case "friend_accepted":
      return {
        text: <>{who} accepted your friend request</>,
        href: n.actor ? profileHref(n.actor) : "/",
        excerpt: null,
      };
    case "family_request":
      return {
        text: <>{who} tagged you as family — confirm it on their profile</>,
        href: n.actor ? profileHref(n.actor) : "/",
        excerpt: null,
      };
    case "family_accepted":
      return {
        text: <>{who} confirmed the family link you added</>,
        href: n.actor ? profileHref(n.actor) : "/",
        excerpt: null,
      };
    case "mention":
      return { text: <>{who} mentioned you</>, href: postHref, excerpt: n.post?.body ?? null };
    case "reply":
      return { text: <>{who} replied to you</>, href: postHref, excerpt: n.comment?.body ?? null };
    case "post_like":
      return {
        text: <>{who} liked your post</>,
        href: postHref,
        excerpt: n.post?.title ?? n.post?.body ?? null,
      };
    case "comment_like":
      return { text: <>{who} liked your comment</>, href: postHref, excerpt: n.comment?.body ?? null };
    case "reaction":
      return {
        text: (
          <>
            {who} reacted {n.reaction && !n.reaction.startsWith(":") ? n.reaction : ""} to your post
          </>
        ),
        href: postHref,
        excerpt: n.post?.title ?? n.post?.body ?? null,
      };
    case "boost":
      return {
        text: <>{who} boosted your post</>,
        href: postHref,
        excerpt: n.post?.title ?? n.post?.body ?? null,
      };
    case "followed_post":
      return {
        text: <>{who} posted</>,
        href: postHref,
        excerpt: n.post?.title ?? n.post?.body ?? null,
      };
    case "group_join_request":
      return { text: <>{who} asked to join {groupName}</>, href: groupHref, excerpt: null };
    case "group_join_accepted":
      return { text: <>Your request to join {groupName} was approved</>, href: groupHref, excerpt: null };
    default:
      return { text: <>New activity</>, href: "/", excerpt: null };
  }
}

export default function NotificationsPage() {
  const [items, setItems] = useState<AppNotification[] | "loading" | "error">("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const markedRef = useRef(false);

  const load = useCallback(() => {
    setItems("loading");
    getNotifications()
      .then((page) => {
        setItems(page.notifications);
        setNextCursor(page.nextCursor);
        // Mark read once, shortly after they've had a chance to see the
        // unread highlight — then clear the nav badge without waiting for
        // its poll.
        if (!markedRef.current && page.unreadCount > 0) {
          markedRef.current = true;
          setTimeout(() => {
            markNotificationsRead()
              .then(() => emitNotificationCount(0))
              .catch(() => {});
          }, 1200);
        } else {
          emitNotificationCount(0);
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/login";
          return;
        }
        setItems("error");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getNotifications(nextCursor);
      setItems((cur) => (Array.isArray(cur) ? [...cur, ...page.notifications] : page.notifications));
      setNextCursor(page.nextCursor);
    } catch {
      // leave the list as-is; the button stays for a retry
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleClear() {
    const snapshot = items;
    setItems([]);
    setNextCursor(null);
    try {
      await clearNotifications();
      emitNotificationCount(0);
    } catch {
      setItems(snapshot);
    }
  }

  return (
    <main className="page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
        <h1 style={{ margin: 0 }}>Notifications</h1>
        {Array.isArray(items) && items.length > 0 && (
          <button className="btn btn-ghost" onClick={handleClear} style={{ fontSize: "0.85rem" }}>
            Clear all
          </button>
        )}
      </div>

      <PushToggle />

      {items === "loading" && <p className="text-dim">Loading…</p>}
      {items === "error" && <p className="error-text">Could not load notifications.</p>}
      {Array.isArray(items) && items.length === 0 && (
        <p className="text-dim">Nothing yet — follows, replies, mentions, and reactions will show up here.</p>
      )}

      {Array.isArray(items) && items.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "1rem 0 0" }}>
          {items.map((n) => {
            const { text, href, excerpt } = describe(n);
            return (
              <li
                key={n.id}
                className={n.read ? undefined : "notif-unread"}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <Link
                  href={href}
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "flex-start",
                    padding: "0.85rem 0.75rem",
                    color: "inherit",
                  }}
                >
                  {n.actor ? (
                    <Avatar
                      name={n.actor.displayName ?? n.actor.username}
                      size={36}
                      imageUrl={n.actor.avatarImageUrl}
                      preset={n.actor.avatarPreset}
                    />
                  ) : (
                    <Avatar name="?" size={36} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "0.95rem" }}>{text}</div>
                    {excerpt && (
                      <div
                        className="text-dim"
                        style={{
                          fontSize: "0.85rem",
                          marginTop: "0.15rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {excerpt}
                      </div>
                    )}
                    <div className="text-faint" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                      {timeAgo(n.createdAt)}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && (
        <button
          className="btn btn-ghost"
          onClick={loadMore}
          disabled={loadingMore}
          style={{ marginTop: "1rem", width: "100%" }}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </main>
  );
}
