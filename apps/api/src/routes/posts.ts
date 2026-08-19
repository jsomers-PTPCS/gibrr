import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";

export const postsRouter = Router();

const createPostSchema = z
  .object({
    communityId: z.string().uuid(),
    title: z.string().min(1).max(300),
    url: z.string().url().optional(),
    body: z.string().max(20000).optional(),
  })
  .refine((data) => Boolean(data.url) || Boolean(data.body), {
    message: "post must have a url or a body",
  });

postsRouter.post("/posts", requireAuth, async (req, res) => {
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { communityId, title, url, body } = parsed.data;

  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) return res.status(404).json({ error: "community not found" });

  const post = await prisma.post.create({
    data: { title, url, body, communityId, authorActorId: req.actor!.id },
    include: postInclude,
  });

  res.status(201).json(post);
});

export const postInclude = {
  author: { select: { username: true, domain: true, displayName: true } },
  community: { select: { title: true, actor: { select: { username: true } } } },
} as const;

export const FEED_PAGE_SIZE = 25;

postsRouter.get("/feed", async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  const posts = await prisma.post.findMany({
    take: FEED_PAGE_SIZE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: "desc" },
    include: postInclude,
  });

  const nextCursor = posts.length === FEED_PAGE_SIZE ? posts[posts.length - 1].id : null;

  res.json({ posts, nextCursor });
});
