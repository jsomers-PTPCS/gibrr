import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { domainShapeSchema, normalizeDomain } from "../federation/domainBlocks.js";
import { findOrCreateGhostBlog } from "../federation/ghostBlogs.js";

export const ghostRouter = Router();

const subscribeSchema = z.object({ domain: domainShapeSchema });

function serializeSubscription(sub: { id: string; blog: { id: string; domain: string; name: string | null } }) {
  return { id: sub.id, blogId: sub.blog.id, domain: sub.blog.domain, name: sub.blog.name };
}

// GET /ghost-blogs/subscriptions -> the viewer's own personally-added
// Ghost blogs (on top of whatever the Host has already curated into
// Explore — see GET /explore/longform/feed, which merges both).
ghostRouter.get("/ghost-blogs/subscriptions", requireAuth, async (req, res) => {
  const subs = await prisma.ghostSubscription.findMany({
    where: { actorId: req.actor!.id },
    include: { blog: { select: { id: true, domain: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(subs.map(serializeSubscription));
});

// POST /ghost-blogs/subscriptions { domain } -> self-service (any user,
// not just the Host — see GhostBlog's own schema comment). Find-or-create
// the shared blog resource (validated live against its real outbox),
// then this viewer's own subscription to it.
ghostRouter.post("/ghost-blogs/subscriptions", requireAuth, async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const domain = normalizeDomain(parsed.data.domain);

  let blog;
  try {
    blog = await findOrCreateGhostBlog(domain);
  } catch {
    return res.status(422).json({ error: "could not verify that domain as a reachable Ghost blog" });
  }

  const existing = await prisma.ghostSubscription.findUnique({
    where: { actorId_blogId: { actorId: req.actor!.id, blogId: blog.id } },
  });
  if (existing) return res.status(409).json({ error: "already added to your Longform tab" });

  const subscription = await prisma.ghostSubscription.create({
    data: { actorId: req.actor!.id, blogId: blog.id },
  });

  res.status(201).json(serializeSubscription({ id: subscription.id, blog }));
});

// DELETE /ghost-blogs/subscriptions/:id -> stop showing this blog in
// your own Longform tab. Only removes the viewer's own subscription row
// — the shared GhostBlog stays in place for any other subscriber.
ghostRouter.delete("/ghost-blogs/subscriptions/:id", requireAuth, async (req, res) => {
  const existing = await prisma.ghostSubscription.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }
  await prisma.ghostSubscription.delete({ where: { id: existing.id } });
  res.status(204).end();
});
