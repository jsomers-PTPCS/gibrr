import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";

export const notificationsRouter = Router();

const PAGE_SIZE = 30;

const NOTIFICATION_INCLUDE = {
  actor: {
    select: {
      id: true,
      username: true,
      domain: true,
      displayName: true,
      avatarImageUrl: true,
      avatarPreset: true,
    },
  },
  post: { select: { id: true, title: true, body: true } },
  comment: { select: { id: true, postId: true, body: true } },
  community: { select: { id: true, title: true, actor: { select: { username: true } } } },
} as const;

// A short excerpt is all the notification list needs — the full body
// lives on the linked post/comment page. Trimmed here rather than
// client-side so the payload stays small on a long list.
function excerpt(text: string | null, max = 140): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function serialize(n: Awaited<ReturnType<typeof loadPage>>[number]) {
  return {
    id: n.id,
    type: n.type,
    read: n.read,
    createdAt: n.createdAt,
    reaction: n.reaction,
    actor: n.actor,
    post: n.post ? { id: n.post.id, title: n.post.title, body: excerpt(n.post.body) } : null,
    comment: n.comment ? { id: n.comment.id, postId: n.comment.postId, body: excerpt(n.comment.body) } : null,
    community: n.community
      ? { id: n.community.id, title: n.community.title, name: n.community.actor.username }
      : null,
  };
}

function loadPage(recipientId: string, cursor: string | undefined) {
  return prisma.notification.findMany({
    where: { recipientId },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: NOTIFICATION_INCLUDE,
  });
}

// GET /notifications[?cursor=] -> newest first, cursor-paginated the same
// way GET /feed is. unreadCount rides along so the bell badge and the
// list come from one request on first load.
notificationsRouter.get("/notifications", requireAuth, async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const recipientId = req.actor!.id;

  const [rows, unreadCount] = await Promise.all([
    loadPage(recipientId, cursor),
    prisma.notification.count({ where: { recipientId, read: false } }),
  ]);

  const nextCursor = rows.length === PAGE_SIZE ? rows[rows.length - 1].id : null;
  res.json({ notifications: rows.map(serialize), nextCursor, unreadCount });
});

// GET /notifications/unread-count -> the one the nav polls on an
// interval. Registered before nothing dynamic, but kept above the
// mark-read routes for readability.
notificationsRouter.get("/notifications/unread-count", requireAuth, async (req, res) => {
  const count = await prisma.notification.count({
    where: { recipientId: req.actor!.id, read: false },
  });
  res.json({ count });
});

// POST /notifications/read -> mark everything read (what the list page
// calls once it's been viewed).
notificationsRouter.post("/notifications/read", requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { recipientId: req.actor!.id, read: false },
    data: { read: true },
  });
  res.status(204).end();
});

// POST /notifications/:id/read -> mark one read (tapping a single row).
notificationsRouter.post("/notifications/:id/read", requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id, recipientId: req.actor!.id },
    data: { read: true },
  });
  res.status(204).end();
});

// DELETE /notifications -> clear the whole list.
notificationsRouter.delete("/notifications", requireAuth, async (req, res) => {
  await prisma.notification.deleteMany({ where: { recipientId: req.actor!.id } });
  res.status(204).end();
});
