import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { extractMentionTokens } from "../federation/textEntities.js";
import { resolveMentions } from "../federation/mentions.js";
import { toPublicActor, getOrCreateInstanceActor } from "../federation/localActor.js";
import { fetchRemoteActor, upsertRemoteActor } from "../federation/remoteActor.js";
import { signedGet } from "../federation/deliver.js";
import { toPlainText } from "../federation/plainText.js";
import { followActor } from "./follows.js";

export const starterPacksRouter = Router();

// Loops (the video app)'s "starter kits" — a named, public bundle of
// accounts around a theme that anyone can browse and one-tap follow
// every member of (see StarterPack's own schema comment for how this
// deliberately simplifies the real feature: no per-member approval or
// self-removal, just a creator-curated list).
const MAX_MEMBERS = 25;
const starterPackSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  // Same "@handle"/"@handle@domain" resolution Antenna's watchedHandles
  // already uses — some local, some remote, doesn't matter, only their
  // actor id is kept.
  memberHandles: z.array(z.string().min(1).max(320)).max(MAX_MEMBERS).default([]),
});

async function resolveMemberActorIds(handles: string[]): Promise<string[]> {
  if (handles.length === 0) return [];
  const tokens = extractMentionTokens(handles.map((h) => `@${h}`).join(" "));
  const actors = await resolveMentions(tokens);
  return actors.map((a) => a.id);
}

async function serializeStarterPack(pack: {
  id: string;
  actorId: string;
  name: string;
  description: string | null;
  memberActorIds: string[];
  createdAt: Date;
}, viewerId: string) {
  const [creator, members] = await Promise.all([
    prisma.actor.findUnique({ where: { id: pack.actorId } }),
    pack.memberActorIds.length > 0
      ? prisma.actor.findMany({ where: { id: { in: pack.memberActorIds } } })
      : Promise.resolve([]),
  ]);
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    creator: creator ? toPublicActor(creator) : null,
    members: members.map(toPublicActor),
    createdAt: pack.createdAt,
    // Every list/detail response already requires auth, so this is
    // always computable — lets the frontend show edit/delete controls
    // without needing its own separate "who am I" lookup.
    isOwner: pack.actorId === viewerId,
  };
}

// GET /starter-packs -> every starter kit on this instance, newest
// first — a public discovery listing, not scoped to the viewer's own,
// same "anyone signed in can browse" posture as GET /explore/loops/feed.
starterPacksRouter.get("/starter-packs", requireAuth, async (req, res) => {
  const packs = await prisma.starterPack.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  res.json(await Promise.all(packs.map((p) => serializeStarterPack(p, req.actor!.id))));
});

starterPacksRouter.get("/starter-packs/:id", requireAuth, async (req, res) => {
  const pack = await prisma.starterPack.findUnique({ where: { id: req.params.id } });
  if (!pack) return res.status(404).json({ error: "not found" });
  res.json(await serializeStarterPack(pack, req.actor!.id));
});

starterPacksRouter.post("/starter-packs", requireAuth, async (req, res) => {
  const parsed = starterPackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, description, memberHandles } = parsed.data;
  const memberActorIds = await resolveMemberActorIds(memberHandles);

  const pack = await prisma.starterPack.create({
    data: { actorId: req.actor!.id, name, description, memberActorIds },
  });
  res.status(201).json(await serializeStarterPack(pack, req.actor!.id));
});

// POST /starter-packs/import { url } -> clone a real fediverse starter
// kit into one of ours. Both Loops (blog.joinloops.org/introducing-
// starter-kits) and Mastodon's own "Collections" implement the same
// open standard for this — FEP-7aa9's FeaturedCollection, confirmed
// live against both loops.video/starter-kits/... and mastodon.social/
// collections/...: a plain `GET` with `Accept: application/activity+json`
// (no signature required by either, but signed anyway since some AP
// servers do enforce it) returns a FeaturedCollection whose
// orderedItems are FeaturedItems, each pointing at a member's actor IRI
// via `featuredObject`. This is what a pasted starter-kit URL should
// have done from the start instead of erroring as an unrecognized
// handle.
const importSchema = z.object({ url: z.string().url() });

interface FeaturedItemLike {
  featuredObject?: unknown;
  actor?: unknown;
  href?: unknown;
  id?: unknown;
}

function memberIriFrom(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const { featuredObject, actor, href, id } = item as FeaturedItemLike;
    const candidate = featuredObject ?? actor ?? href ?? id;
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

starterPacksRouter.post("/starter-packs/import", requireAuth, async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const instanceActor = await getOrCreateInstanceActor();
  const response = await signedGet(parsed.data.url, instanceActor).catch(() => null);
  if (!response || !response.ok) {
    return res.status(404).json({ error: "could not fetch that URL" });
  }

  let doc: Record<string, unknown>;
  try {
    doc = (await response.json()) as Record<string, unknown>;
  } catch {
    return res.status(400).json({ error: "that URL didn't return a starter kit" });
  }

  const rawItems = (Array.isArray(doc.orderedItems) ? doc.orderedItems : doc.items) as unknown[] | undefined;
  if (!Array.isArray(rawItems)) {
    return res.status(400).json({ error: "that URL didn't return a starter kit" });
  }

  const name = typeof doc.name === "string" && doc.name.trim() ? doc.name.trim().slice(0, 100) : "Imported starter kit";
  const summaryMap =
    doc.summaryMap && typeof doc.summaryMap === "object" ? (doc.summaryMap as Record<string, unknown>) : null;
  const rawSummary =
    typeof doc.summary === "string" ? doc.summary : (Object.values(summaryMap ?? {})[0] as string | undefined);
  const description = rawSummary ? toPlainText(rawSummary).slice(0, 500) || undefined : undefined;

  const memberIris = rawItems.map(memberIriFrom).filter((iri): iri is string => iri !== null).slice(0, MAX_MEMBERS);

  const resolved = await Promise.all(
    memberIris.map(async (iri) => {
      const remote = await fetchRemoteActor(iri, instanceActor).catch(() => null);
      if (!remote) return null;
      return upsertRemoteActor(remote).catch(() => null);
    }),
  );
  const memberActorIds = resolved.filter((a): a is NonNullable<typeof a> => a !== null).map((a) => a.id);

  const pack = await prisma.starterPack.create({
    data: { actorId: req.actor!.id, name, description, memberActorIds },
  });
  res.status(201).json(await serializeStarterPack(pack, req.actor!.id));
});

starterPacksRouter.patch("/starter-packs/:id", requireAuth, async (req, res) => {
  const parsed = starterPackSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.starterPack.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }

  const { name, description, memberHandles } = parsed.data;
  const memberActorIds =
    memberHandles !== undefined ? await resolveMemberActorIds(memberHandles) : undefined;

  const pack = await prisma.starterPack.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(memberActorIds !== undefined ? { memberActorIds } : {}),
    },
  });
  res.json(await serializeStarterPack(pack, req.actor!.id));
});

starterPacksRouter.delete("/starter-packs/:id", requireAuth, async (req, res) => {
  const existing = await prisma.starterPack.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.actorId !== req.actor!.id) {
    return res.status(404).json({ error: "not found" });
  }
  await prisma.starterPack.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// POST /starter-packs/:id/follow-all -> the one-tap "follow every member"
// action the whole feature is for. Reuses routes/follows.ts's own
// follow-creation logic (accept immediately for a local member, send a
// signed Follow for a remote one) rather than duplicating it — a
// starter kit member is already a resolved Actor row, so there's no
// handle discovery step left to do, just the same per-target outcome
// POST /follows produces one at a time.
starterPacksRouter.post("/starter-packs/:id/follow-all", requireAuth, async (req, res) => {
  const pack = await prisma.starterPack.findUnique({ where: { id: req.params.id } });
  if (!pack) return res.status(404).json({ error: "not found" });

  const members =
    pack.memberActorIds.length > 0
      ? await prisma.actor.findMany({ where: { id: { in: pack.memberActorIds } } })
      : [];

  let followed = 0;
  let alreadyFollowing = 0;
  for (const member of members) {
    const outcome = await followActor(req.actor!, member);
    if (outcome.status === "followed") followed++;
    else if (outcome.status === "already") alreadyFollowing++;
  }

  res.json({ followed, alreadyFollowing, total: members.length });
});
