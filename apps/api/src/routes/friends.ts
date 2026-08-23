import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../auth/session.js";

export const friendsRouter = Router();

const ACTOR_SUMMARY_SELECT = {
  id: true,
  username: true,
  domain: true,
  displayName: true,
  bookwyrmHandle: true,
} as const;

// Shared with routes/profile.ts's GET /profile/:username/bookwyrm —
// same "accepted Friendship in either direction" check GET
// /friends/status/:username already does inline, factored out since a
// second, unrelated feature now needs the same yes/no answer.
export async function areFriends(actorIdA: string, actorIdB: string): Promise<boolean> {
  const friendship = await prisma.friendship.findFirst({
    where: {
      state: "accepted",
      OR: [
        { requesterId: actorIdA, addresseeId: actorIdB },
        { requesterId: actorIdB, addresseeId: actorIdA },
      ],
    },
  });
  return friendship !== null;
}

// POST /friends/request/:username -> starts a pending Friendship. 409 if a
// Friendship already exists in either direction (covers both "already
// friends" and "already have a pending request").
friendsRouter.post("/friends/request/:username", requireAuth, async (req, res) => {
  const target = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!target) return res.status(404).json({ error: "not found" });
  if (target.id === req.actor!.id) {
    return res.status(400).json({ error: "can't send a friend request to yourself" });
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: req.actor!.id, addresseeId: target.id },
        { requesterId: target.id, addresseeId: req.actor!.id },
      ],
    },
  });
  if (existing) {
    return res.status(409).json({ error: "a friendship or request already exists" });
  }

  await prisma.friendship.create({
    data: { requesterId: req.actor!.id, addresseeId: target.id },
  });

  res.status(201).json({ requested: true });
});

// POST /friends/accept/:username -> caller must be the addressee of a
// pending request from that username.
friendsRouter.post("/friends/accept/:username", requireAuth, async (req, res) => {
  const requester = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!requester) return res.status(404).json({ error: "not found" });

  const friendship = await prisma.friendship.findUnique({
    where: { requesterId_addresseeId: { requesterId: requester.id, addresseeId: req.actor!.id } },
  });
  if (!friendship || friendship.state !== "pending") {
    return res.status(404).json({ error: "no pending request from that user" });
  }

  await prisma.friendship.update({ where: { id: friendship.id }, data: { state: "accepted" } });
  res.json({ accepted: true });
});

// DELETE /friends/:username -> cancels a sent request, declines a received
// one, or unfriends — one idempotent action covers all three, since a
// Friendship row is deleted regardless of its state or direction.
friendsRouter.delete("/friends/:username", requireAuth, async (req, res) => {
  const other = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!other) return res.status(404).json({ error: "not found" });

  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: req.actor!.id, addresseeId: other.id },
        { requesterId: other.id, addresseeId: req.actor!.id },
      ],
    },
  });

  res.status(204).end();
});

// GET /friends/status/:username -> drives the friend-action button on a
// profile: one of "self" | "none" | "pending_sent" | "pending_received" |
// "friends".
friendsRouter.get("/friends/status/:username", optionalAuth, async (req, res) => {
  const other = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!other) return res.status(404).json({ error: "not found" });

  if (!req.actor) return res.json({ status: "none" });
  if (req.actor.id === other.id) return res.json({ status: "self" });

  const friendship = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: req.actor.id, addresseeId: other.id },
        { requesterId: other.id, addresseeId: req.actor.id },
      ],
    },
  });

  if (!friendship) return res.json({ status: "none" });
  if (friendship.state === "accepted") return res.json({ status: "friends" });
  const status = friendship.requesterId === req.actor.id ? "pending_sent" : "pending_received";
  res.json({ status });
});

// GET /friends/requests -> caller's pending incoming requests. Registered
// before GET /friends/:username so "requests" isn't swallowed as a
// username.
friendsRouter.get("/friends/requests", requireAuth, async (req, res) => {
  const requests = await prisma.friendship.findMany({
    where: { addresseeId: req.actor!.id, state: "pending" },
    include: { requester: { select: ACTOR_SUMMARY_SELECT } },
    orderBy: { createdAt: "desc" },
  });
  res.json(requests.map((r) => r.requester));
});

// GET /friends/requests/sent -> caller's own pending outgoing requests —
// the other half of the picture GET /friends/requests only shows the
// incoming side of. Lets the Relationships tab show "Sent" alongside
// "Requests" so a sent request doesn't just disappear from view until
// the other person acts on it.
friendsRouter.get("/friends/requests/sent", requireAuth, async (req, res) => {
  const requests = await prisma.friendship.findMany({
    where: { requesterId: req.actor!.id, state: "pending" },
    include: { addressee: { select: ACTOR_SUMMARY_SELECT } },
    orderBy: { createdAt: "desc" },
  });
  res.json(requests.map((r) => r.addressee));
});

// GET /friends/:username -> that actor's accepted friends, gated by
// aboutVisibility.friendsList for non-owners (owner always sees their own).
friendsRouter.get("/friends/:username", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const isOwner = req.actor?.id === actor.id;
  if (!isOwner) {
    const visibility = (actor.aboutVisibility as Record<string, boolean> | null) ?? {};
    if (visibility.friendsList !== true) {
      return res.status(403).json({ error: "not visible" });
    }
  }

  const friendships = await prisma.friendship.findMany({
    where: {
      state: "accepted",
      OR: [{ requesterId: actor.id }, { addresseeId: actor.id }],
    },
    include: {
      requester: { select: ACTOR_SUMMARY_SELECT },
      addressee: { select: ACTOR_SUMMARY_SELECT },
    },
  });

  const friends = friendships.map((f) => (f.requesterId === actor.id ? f.addressee : f.requester));

  res.json(friends);
});
