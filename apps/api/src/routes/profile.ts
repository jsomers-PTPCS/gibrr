import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { toPublicActor } from "../federation/localActor.js";
import { requireAuth } from "../auth/session.js";
import { postInclude, FEED_PAGE_SIZE } from "./posts.js";

export const profileRouter = Router();

// GET /profile/:username -> public profile: actor info, follower/following/post
// counts, and their recent posts. Distinct from GET /users/:username (the
// canonical ActivityPub actor IRI, serving JSON-LD) so the web app has a
// plain-JSON shape to consume without content negotiation.
profileRouter.get("/profile/:username", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const [followerCount, followingCount, posts] = await Promise.all([
    prisma.follow.count({ where: { followingId: actor.id, state: "accepted" } }),
    prisma.follow.count({ where: { followerId: actor.id, state: "accepted" } }),
    prisma.post.findMany({
      where: { authorActorId: actor.id },
      take: FEED_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: "desc" },
      include: postInclude,
    }),
  ]);

  const nextCursor = posts.length === FEED_PAGE_SIZE ? posts[posts.length - 1].id : null;

  res.json({
    actor: toPublicActor(actor),
    counts: { followers: followerCount, following: followingCount },
    posts,
    nextCursor,
  });
});

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  summary: z.string().max(2000).optional(),
});

// PATCH /profile -> update the logged-in user's own displayName/summary.
profileRouter.patch("/profile", requireAuth, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const actor = await prisma.actor.update({
    where: { id: req.actor!.id },
    data: parsed.data,
  });

  res.json({ actor: toPublicActor(actor) });
});
