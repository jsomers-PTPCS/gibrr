import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import {
  postInclude,
  withCommentCount,
  postVisibilityWhere,
  blockedActorIds,
  FEED_PAGE_SIZE,
} from "./posts.js";
import {
  attachPostVotes,
  attachCalendarSaves,
  attachBoosted,
  attachReactions,
  attachPolls,
  attachBookmarked,
} from "../votes.js";
import { extractMentionTokens } from "../federation/textEntities.js";
import { resolveMentions } from "../federation/mentions.js";
import { toPublicActor } from "../federation/localActor.js";

export const antennasRouter = Router();

// Misskey's "antenna" — a saved keyword/author filter surfaced as its
// own live view of already-visible posts (see GET /antennas/:id/posts
// below). Deliberately not federated, same reasoning as Bookmark: a
// private lens on content this instance can already see, nothing a
// remote server needs to know about.
const antennaSchema = z.object({
  name: z.string().min(1).max(100),
  keywords: z.array(z.string().min(1).max(100)).max(20).default([]),
  // Same "@handle"/"@handle@domain" resolution createPostSchema's
  // specifiedHandles already uses — some local, some remote, doesn't
  // matter, only their actor id is kept.
  watchedHandles: z.array(z.string().min(1).max(320)).max(20).default([]),
});

async function resolveWatchedActorIds(handles: string[]): Promise<string[]> {
  if (handles.length === 0) return [];
  const tokens = extractMentionTokens(handles.map((h) => `@${h}`).join(" "));
  const actors = await resolveMentions(tokens);
  return actors.map((a) => a.id);
}

async function serializeAntenna(antenna: {
  id: string;
  name: string;
  keywords: string[];
  watchedActorIds: string[];
  createdAt: Date;
}) {
  const watchedActors =
    antenna.watchedActorIds.length > 0
      ? await prisma.actor.findMany({ where: { id: { in: antenna.watchedActorIds } } })
      : [];
  return {
    id: antenna.id,
    name: antenna.name,
    keywords: antenna.keywords,
    watchedActors: watchedActors.map(toPublicActor),
    createdAt: antenna.createdAt,
  };
}

// GET /antennas -> the viewer's own antennas.
antennasRouter.get("/antennas", requireAuth, async (req, res) => {
  const antennas = await prisma.antenna.findMany({
    where: { actorId: req.actor!.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(await Promise.all(antennas.map(serializeAntenna)));
});

antennasRouter.post("/antennas", requireAuth, async (req, res) => {
  const parsed = antennaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { name, keywords, watchedHandles } = parsed.data;
  const watchedActorIds = await resolveWatchedActorIds(watchedHandles);

  const antenna = await prisma.antenna.create({
    data: { actorId: req.actor!.id, name, keywords, watchedActorIds },
  });
  res.status(201).json(await serializeAntenna(antenna));
});

antennasRouter.patch("/antennas/:id", requireAuth, async (req, res) => {
  const parsed = antennaSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const existing = await prisma.antenna.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }

  const { name, keywords, watchedHandles } = parsed.data;
  const watchedActorIds =
    watchedHandles !== undefined ? await resolveWatchedActorIds(watchedHandles) : undefined;

  const antenna = await prisma.antenna.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(keywords !== undefined ? { keywords } : {}),
      ...(watchedActorIds !== undefined ? { watchedActorIds } : {}),
    },
  });
  res.json(await serializeAntenna(antenna));
});

antennasRouter.delete("/antennas/:id", requireAuth, async (req, res) => {
  const existing = await prisma.antenna.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }
  await prisma.antenna.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// GET /antennas/:id/posts -> posts visible to the owner that match this
// antenna's filter: any of its keywords (case-insensitive substring
// against title/body — an empty keyword list means the filter is
// disabled, not "matches nothing"), AND, if watchedActorIds is
// non-empty, authored by one of them. Same postVisibilityWhere/
// blockedActorIds gating every other post-listing endpoint uses — an
// antenna can't surface a post its owner wouldn't otherwise be allowed
// to see. No pagination, same precedent as GET /bookmarks.
antennasRouter.get("/antennas/:id/posts", requireAuth, async (req, res) => {
  const viewerId = req.actor!.id;
  const antenna = await prisma.antenna.findUnique({ where: { id: req.params.id } });
  if (!antenna || antenna.actorId !== viewerId) {
    return res.status(404).json({ error: "not found" });
  }

  const visibility = await postVisibilityWhere(viewerId);
  const blockedIds = await blockedActorIds(viewerId);

  const posts = await prisma.post.findMany({
    where: {
      ...visibility,
      ...(blockedIds.length > 0 ? { authorActorId: { notIn: blockedIds } } : {}),
      ...(antenna.keywords.length > 0
        ? {
            OR: antenna.keywords.map((k) => ({
              OR: [
                { title: { contains: k, mode: "insensitive" as const } },
                { body: { contains: k, mode: "insensitive" as const } },
              ],
            })),
          }
        : {}),
      ...(antenna.watchedActorIds.length > 0
        ? { authorActorId: { in: antenna.watchedActorIds } }
        : {}),
    },
    take: FEED_PAGE_SIZE,
    orderBy: { createdAt: "desc" },
    include: postInclude,
  });

  const withVotes = await attachPostVotes(posts, viewerId);
  const withSaves = await attachCalendarSaves(withVotes, viewerId);
  const withBoosted = await attachBoosted(withSaves, viewerId);
  const withReactions = await attachReactions(withBoosted, viewerId);
  const withPolls = await attachPolls(withReactions, viewerId);
  const withBookmarked = await attachBookmarked(withPolls, viewerId);

  res.json({
    antenna: await serializeAntenna(antenna),
    posts: withBookmarked.map((p) => ({
      ...withCommentCount(p),
      boostedBy: null,
      canEdit: p.authorActorId === viewerId,
    })),
  });
});
