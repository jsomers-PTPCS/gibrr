import type { NotificationType } from "@prisma/client";
import { prisma } from "../db.js";
import { localDomain } from "./localActor.js";
import { logger } from "../logger.js";

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

    await prisma.notification.create({
      data: { recipientId, type, actorId, postId, commentId, communityId, reaction },
    });
  } catch (err) {
    logger.warn({ err, type, recipientId }, "failed to create notification");
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
