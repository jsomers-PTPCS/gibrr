import type { NotificationType } from "@prisma/client";
import { prisma } from "../db.js";
import { localDomain } from "./localActor.js";
import { logger } from "../logger.js";
import { pushConfigured, sendPushToActor } from "./webPush.js";

// Plain-text notification copy, shared by the Web Push payload here and
// mirrored by the frontend's own describe() for the in-app list. Kept
// terse — a push body is a single tray line.
function pushText(type: NotificationType, who: string, reaction: string | null): string {
  switch (type) {
    case "follow":
      return `${who} followed you`;
    case "follow_request":
      return `${who} requested to follow you`;
    case "follow_accepted":
      return `${who} accepted your follow request`;
    case "friend_request":
      return `${who} sent you a friend request`;
    case "friend_accepted":
      return `${who} accepted your friend request`;
    case "family_request":
      return `${who} tagged you as family`;
    case "family_accepted":
      return `${who} confirmed your family link`;
    case "mention":
      return `${who} mentioned you`;
    case "reply":
      return `${who} replied to you`;
    case "post_like":
      return `${who} liked your post`;
    case "comment_like":
      return `${who} liked your comment`;
    case "reaction":
      return reaction && !reaction.startsWith(":")
        ? `${who} reacted ${reaction} to your post`
        : `${who} reacted to your post`;
    case "boost":
      return `${who} boosted your post`;
    case "group_join_request":
      return `${who} asked to join a group you manage`;
    case "group_join_accepted":
      return `Your group join request was approved`;
    case "followed_post":
      return `${who} posted`;
    default:
      return "New activity on Gibrr";
  }
}

// Where a notificationclick should land — a path on the web origin, which
// is where the service worker runs (so relative paths resolve there, not
// against the API).
function pushUrl(n: {
  type: NotificationType;
  post: { id: string } | null;
  comment: { postId: string } | null;
  community: { actor: { username: string } } | null;
}): string {
  if (n.post) return `/posts/${n.post.id}`;
  if (n.comment) return `/posts/${n.comment.postId}`;
  if (n.community) return `/g/${n.community.actor.username}`;
  return "/notifications";
}

async function firePush(notificationId: string): Promise<void> {
  if (!pushConfigured()) return;
  try {
    const n = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        actor: { select: { displayName: true, username: true } },
        post: { select: { id: true } },
        comment: { select: { postId: true } },
        community: { select: { actor: { select: { username: true } } } },
      },
    });
    if (!n) return;
    const who = n.actor ? n.actor.displayName ?? n.actor.username : "Someone";
    await sendPushToActor(n.recipientId, {
      title: "Gibrr",
      body: pushText(n.type, who, n.reaction),
      url: pushUrl(n),
      // One tray slot per (type, actor) — a re-like replaces rather than
      // stacks, matching notify()'s own row-level dedupe.
      tag: `${n.type}:${n.actorId ?? "system"}`,
    });
  } catch (err) {
    logger.warn({ err, notificationId }, "web push dispatch failed");
  }
}

// The single writer for the Notification table. Call it fire-and-forget
// (`void notify({...})`) from every place a local actor should be told
// something happened — the same posture the federation-delivery calls
// next to these call sites already use, so a slow/failing insert never
// delays or breaks the action that triggered it.
//
// Enforces the invariants the Notification model's own comment describes:
//   - recipient must be a *local* actor (a remote actor's server owns its
//     own notifications) — a non-local or missing recipient is a no-op.
//   - no self-notification (you don't get told about your own like).
//   - nothing from an actor the recipient has blocked.
//   - toggle-happy interactions (like/unlike/re-like, react/re-react,
//     unfollow/re-follow) collapse to one row: an existing notification
//     with the same (recipient, actor, type, post, comment) is replaced,
//     so re-doing the action just bumps it back to unread and to the top
//     instead of stacking duplicates. "reply" and "mention" are exempt —
//     each distinct reply/mention is its own event worth keeping.
export async function notify(params: {
  recipientId: string;
  type: NotificationType;
  actorId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  communityId?: string | null;
  reaction?: string | null;
}): Promise<void> {
  const { recipientId, type, actorId = null, postId = null, commentId = null, communityId = null, reaction = null } =
    params;

  try {
    if (actorId && actorId === recipientId) return;

    const recipient = await prisma.actor.findUnique({
      where: { id: recipientId },
      select: { domain: true },
    });
    if (!recipient || recipient.domain !== localDomain()) return;

    if (actorId) {
      const blocked = await prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: recipientId, blockedId: actorId } },
      });
      if (blocked) return;
    }

    // Everything except reply/mention is a "latest state" signal, not a
    // log — dedupe on the identifying tuple so a re-do replaces rather
    // than piles up.
    const collapses = type !== "reply" && type !== "mention";
    if (collapses) {
      await prisma.notification.deleteMany({
        where: { recipientId, type, actorId, postId, commentId },
      });
    }

    const created = await prisma.notification.create({
      data: { recipientId, type, actorId, postId, commentId, communityId, reaction },
    });
    void firePush(created.id);
  } catch (err) {
    logger.warn({ err, type, recipientId }, "failed to create notification");
  }
}

// Called when `authorId` publishes a post: pings every local follower who
// turned the per-follow bell on (Follow.notifyOnPost). Fire-and-forget
// alongside the post's own follower delivery. Safe to call for any post —
// notify() itself drops self/blocked/non-local, and callers skip the
// visibilities that never reach followers ("specified").
export async function notifyBellFollowers(authorId: string, postId: string): Promise<void> {
  try {
    const follows = await prisma.follow.findMany({
      where: { followingId: authorId, state: "accepted", notifyOnPost: true },
      select: { followerId: true },
    });
    await Promise.all(
      follows.map((f) =>
        notify({ recipientId: f.followerId, actorId: authorId, type: "followed_post", postId }),
      ),
    );
  } catch (err) {
    logger.warn({ err, authorId, postId }, "failed to notify bell followers");
  }
}

// Fan-out helper for the group-join case, where "who manages this group"
// is several local actors (owner + admins + moderators). Skips the
// triggering actor automatically via notify()'s own self-check.
export async function notifyMany(
  recipientIds: string[],
  params: Omit<Parameters<typeof notify>[0], "recipientId">,
): Promise<void> {
  await Promise.all(recipientIds.map((recipientId) => notify({ ...params, recipientId })));
}
