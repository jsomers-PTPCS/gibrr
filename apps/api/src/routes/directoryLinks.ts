import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../auth/session.js";

export const directoryLinksRouter = Router();

// Not folded into routes/admin.ts — that router's
// `.use(requireAuth, requireAdmin)` gates its *entire* router, but this
// needs a public read (the /search page's discovery links) alongside
// admin-only writes, so auth is applied per-route here instead, same as
// routes/blocks.ts/routes/posts.ts already mix optionalAuth/requireAuth
// route-by-route.

// GET /directory-links -> public, no auth. There's no crawled index of
// the fediverse for this app to query itself (see the model's own
// schema comment) — this is what /search's empty state fetches instead
// of a hardcoded frontend list.
directoryLinksRouter.get("/directory-links", async (_req, res) => {
  const links = await prisma.fediverseDirectoryLink.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  res.json(links);
});

const directoryLinkSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  description: z.string().min(1).max(500),
  category: z.enum(["people", "servers", "developer"]),
});

directoryLinksRouter.post("/directory-links", requireAuth, requireAdmin, async (req, res) => {
  const parsed = directoryLinkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.fediverseDirectoryLink.findUnique({ where: { url: parsed.data.url } });
  if (existing) return res.status(409).json({ error: "that URL is already listed" });

  const link = await prisma.fediverseDirectoryLink.create({ data: parsed.data });
  res.status(201).json(link);
});

directoryLinksRouter.delete("/directory-links/:id", requireAuth, requireAdmin, async (req, res) => {
  await prisma.fediverseDirectoryLink.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});
