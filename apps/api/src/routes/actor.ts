import { Router } from "express";
import { prisma } from "../db.js";
import { actorIri, createActorObject } from "../federation/localActor.js";
import {
  createNoteFromPost,
  createNoteFromComment,
  createActivity,
  announceActivity,
  postObjectIri,
} from "../federation/activities.js";

export const actorRouter = Router();

// GET /users/:username -> ActivityPub Actor object
actorRouter.get("/users/:username", async (req, res) => {
  const domain = req.hostname === "localhost" ? req.get("host") : req.hostname;
  const actor = await prisma.actor.findFirst({
    where: { username: req.params.username, domain: domain ?? undefined },
  });
  if (!actor) return res.status(404).json({ error: "not found" });

  res.set("Content-Type", "application/activity+json");
  res.json(createActorObject(actor));
});

// GET /users/:username/followers, /following -> paged OrderedCollections
// of actor IRIs, the standard AP shape (what Mastodon itself emits) —
// some servers check these resolve before treating an actor as a
// legitimate federation participant, and some page through them for a
// real follower/following count, even though nothing in this app
// dereferences them itself yet (the frontend's own follower/following
// UI is a completely separate, unpaginated app-level API —
// routes/follows.ts's GET /follows/:username — untouched by this).
//
// No `page` query param -> a bare OrderedCollection with just
// totalItems + a `first` link, no items inlined. `?page=<n>` (1-indexed,
// matching Mastodon's own convention) -> an OrderedCollectionPage with
// that page's items, `partOf` pointing back at the bare collection, and
// `next`/`prev` present only when there's actually another page in that
// direction.
const COLLECTION_PAGE_SIZE = 20;

function pagedCollectionResponse(
  collectionId: string,
  totalItems: number,
  page: number | null,
  items: string[],
): Record<string, unknown> {
  if (page === null) {
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: collectionId,
      type: "OrderedCollection",
      totalItems,
      first: `${collectionId}?page=1`,
    };
  }

  const hasNext = page * COLLECTION_PAGE_SIZE < totalItems;
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${collectionId}?page=${page}`,
    type: "OrderedCollectionPage",
    partOf: collectionId,
    totalItems,
    orderedItems: items,
    ...(hasNext ? { next: `${collectionId}?page=${page + 1}` } : {}),
    ...(page > 1 ? { prev: `${collectionId}?page=${page - 1}` } : {}),
  };
}

function parsePage(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

actorRouter.get("/users/:username/followers", async (req, res) => {
  const domain = req.hostname === "localhost" ? req.get("host") : req.hostname;
  const actor = await prisma.actor.findFirst({
    where: { username: req.params.username, domain: domain ?? undefined },
  });
  if (!actor) return res.status(404).json({ error: "not found" });

  const page = parsePage(req.query.page);
  const collectionId = `${actorIri(actor)}/followers`;

  const totalItems = await prisma.follow.count({ where: { followingId: actor.id, state: "accepted" } });
  const items =
    page === null
      ? []
      : (
          await prisma.follow.findMany({
            where: { followingId: actor.id, state: "accepted" },
            include: { follower: { select: { username: true, domain: true } } },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * COLLECTION_PAGE_SIZE,
            take: COLLECTION_PAGE_SIZE,
          })
        ).map((f) => actorIri(f.follower));

  res.set("Content-Type", "application/activity+json");
  res.json(pagedCollectionResponse(collectionId, totalItems, page, items));
});

actorRouter.get("/users/:username/following", async (req, res) => {
  const domain = req.hostname === "localhost" ? req.get("host") : req.hostname;
  const actor = await prisma.actor.findFirst({
    where: { username: req.params.username, domain: domain ?? undefined },
  });
  if (!actor) return res.status(404).json({ error: "not found" });

  const page = parsePage(req.query.page);
  const collectionId = `${actorIri(actor)}/following`;

  const totalItems = await prisma.follow.count({ where: { followerId: actor.id, state: "accepted" } });
  const items =
    page === null
      ? []
      : (
          await prisma.follow.findMany({
            where: { followerId: actor.id, state: "accepted" },
            include: { following: { select: { username: true, domain: true } } },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * COLLECTION_PAGE_SIZE,
            take: COLLECTION_PAGE_SIZE,
          })
        ).map((f) => actorIri(f.following));

  res.set("Content-Type", "application/activity+json");
  res.json(pagedCollectionResponse(collectionId, totalItems, page, items));
});

// GET /users/:username/outbox -> this actor's public activity history:
// their own posts and replies (Create), and their boosts (Announce),
// most recent first. Flat, unpaged OrderedCollection with everything
// directly in orderedItems — same convention already established by
// /followers and /following above, capped at OUTBOX_LIMIT rather than
// building real OrderedCollectionPage pagination, matching this app's
// existing "no pagination this milestone" posture elsewhere (e.g.
// GET /admin/users). Only ever populated for a local actor — a cached
// remote actor's row has no posts/comments/boosts attributed to it here
// (those live on the origin server), so this naturally comes back empty
// for one, same as it always has.
const OUTBOX_LIMIT = 50;

actorRouter.get("/users/:username/outbox", async (req, res) => {
  const domain = req.hostname === "localhost" ? req.get("host") : req.hostname;
  const actor = await prisma.actor.findFirst({
    where: { username: req.params.username, domain: domain ?? undefined },
  });
  if (!actor) return res.status(404).json({ error: "not found" });

  const [posts, comments, boosts] = await Promise.all([
    prisma.post.findMany({
      // Only "public" personal notes belong in a publicly-fetchable
      // outbox — community posts are always "public" already (see the
      // Post.visibility schema comment), but a followers-only/
      // specified/local-only note must never be exposed here to an
      // arbitrary unauthenticated fetch.
      where: { authorActorId: actor.id, remoteId: null, visibility: "public" },
      orderBy: { createdAt: "desc" },
      take: OUTBOX_LIMIT,
    }),
    prisma.comment.findMany({
      where: { authorActorId: actor.id, remoteId: null },
      orderBy: { createdAt: "desc" },
      take: OUTBOX_LIMIT,
      include: { post: { select: { id: true, remoteId: true } } },
    }),
    prisma.postBoost.findMany({
      where: { actorId: actor.id },
      orderBy: { createdAt: "desc" },
      take: OUTBOX_LIMIT,
      include: { post: true },
    }),
  ]);

  const entries = [
    ...posts.map((post) => ({
      createdAt: post.createdAt,
      activity: createActivity(createNoteFromPost(post, actor), actor),
    })),
    ...comments.map((comment) => ({
      createdAt: comment.createdAt,
      activity: createActivity(createNoteFromComment(comment, actor, comment.post), actor),
    })),
    ...boosts.map((boost) => ({
      createdAt: boost.createdAt,
      activity: announceActivity(actor, postObjectIri(boost.post)),
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, OUTBOX_LIMIT);

  res.set("Content-Type", "application/activity+json");
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: actor.outboxUrl,
    type: "OrderedCollection",
    totalItems: entries.length,
    orderedItems: entries.map((e) => e.activity),
  });
});
