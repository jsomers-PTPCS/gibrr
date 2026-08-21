import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { localDomain, actorIri, isLocalActor } from "../federation/localActor.js";
import { discoverActor, upsertRemoteActor } from "../federation/remoteActor.js";
import { deliverActivity } from "../federation/deliver.js";
import { blockActivity } from "../federation/activities.js";

export const blocksRouter = Router();

const FOLLOW_SUMMARY_SELECT = {
  id: true,
  username: true,
  domain: true,
  displayName: true,
  avatarImageUrl: true,
  avatarPreset: true,
} as const;

const handleSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]+@[a-zA-Z0-9.-]+(:[0-9]+)?$/, "expected the form user@domain");

// POST /blocks { handle } -> block a local or remote actor by fediverse
// handle, same discovery shape as POST /follows. Removes any Follow row
// between the two actors in either direction — blocking implies
// unfollowing both ways, matching real Mastodon behavior — and delivers
// a Block to a remote target.
blocksRouter.post("/blocks", requireAuth, async (req, res) => {
  const parsed = z.object({ handle: handleSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [username, domain] = parsed.data.handle.split("@");

  let target = await prisma.actor.findUnique({ where: { username_domain: { username, domain } } });
  if (!target && domain !== localDomain()) {
    const remote = await discoverActor(parsed.data.handle, req.actor!);
    if (!remote) return res.status(404).json({ error: "could not resolve that handle" });
    target = await upsertRemoteActor(remote);
  }
  if (!target) return res.status(404).json({ error: "not found" });
  if (target.id === req.actor!.id) {
    return res.status(400).json({ error: "can't block yourself" });
  }

  await prisma.$transaction([
    prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: req.actor!.id, blockedId: target.id } },
      create: { blockerId: req.actor!.id, blockedId: target.id },
      update: {},
    }),
    prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: req.actor!.id, followingId: target.id },
          { followerId: target.id, followingId: req.actor!.id },
        ],
      },
    }),
  ]);

  if (!isLocalActor(target)) {
    void deliverActivity(req.actor!, target.inboxUrl, blockActivity(req.actor!, actorIri(target)));
  }

  res.status(201).json({ blocked: true });
});

// DELETE /blocks/:actorId -> unblock. Idempotent (no error if there was
// no Block row). No Undo(Block) delivered — AP has no standard Undo
// counterpart most servers act on for this, and our own enforcement is
// entirely local-side anyway (see blockActivity's comment).
blocksRouter.delete("/blocks/:actorId", requireAuth, async (req, res) => {
  await prisma.block.deleteMany({
    where: { blockerId: req.actor!.id, blockedId: req.params.actorId },
  });
  res.status(204).end();
});

// GET /blocks -> the viewer's own block list, for the settings page.
blocksRouter.get("/blocks", requireAuth, async (req, res) => {
  const blocks = await prisma.block.findMany({
    where: { blockerId: req.actor!.id },
    include: { blocked: { select: FOLLOW_SUMMARY_SELECT } },
    orderBy: { createdAt: "desc" },
  });
  res.json(blocks.map((b) => b.blocked));
});
