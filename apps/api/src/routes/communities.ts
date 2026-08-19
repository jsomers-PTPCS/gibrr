import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { createLocalActor, toPublicActor } from "../federation/localActor.js";
import { requireAuth } from "../auth/session.js";

export const communitiesRouter = Router();

const createCommunitySchema = z.object({
  name: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "name may only contain letters, numbers, and underscores"),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

communitiesRouter.post("/communities", requireAuth, async (req, res) => {
  const parsed = createCommunitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { name, title, description } = parsed.data;

  const existing = await prisma.actor.findFirst({ where: { username: name } });
  if (existing) return res.status(409).json({ error: "community name taken" });

  const community = await prisma.$transaction(async (tx) => {
    const actor = await createLocalActor(tx, {
      username: name,
      type: "Group",
      displayName: title,
      summary: description,
    });
    return tx.community.create({
      data: { actorId: actor.id, title, description },
      include: { actor: true },
    });
  });

  res.status(201).json({ ...community, actor: toPublicActor(community.actor) });
});

communitiesRouter.get("/communities", async (_req, res) => {
  const communities = await prisma.community.findMany({
    include: { actor: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(communities.map((c) => ({ ...c, actor: toPublicActor(c.actor) })));
});
