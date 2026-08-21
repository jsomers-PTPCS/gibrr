import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../auth/session.js";
import { deletePosts, deleteCommentSubtree, deleteActor } from "../deletion.js";
import { deleteActivity, postObjectIri, followActivity, undoFollowActivity } from "../federation/activities.js";
import { deliverToFollowers, deliverActivity } from "../federation/deliver.js";
import { getOrCreateInstanceActor, actorIri } from "../federation/localActor.js";
import { fetchRemoteActor, upsertRemoteActor } from "../federation/remoteActor.js";
import { searchRelayDirectory } from "../federation/relayDirectory.js";
import { normalizeDomain } from "../federation/domainBlocks.js";
import { fetchExploreTimeline } from "../federation/mastodonExplore.js";

// A real hostname shape (labels of letters/digits/hyphens joined by
// dots, at least one dot so a bare typo'd single word gets rejected
// up front) with an optional :port for local dev domains like
// "localhost:4000". This can only catch gross typos — missing dots,
// spaces, invalid characters — not a legitimate-looking misspelling of
// a real domain ("mastadon.social" is a perfectly valid hostname
// shape, just the wrong one); that class of error needs a live
// reachability check instead, which only makes sense where the
// endpoint requires the target to actually respond (Explore servers,
// relays) — not for domain blocks, where the whole point can be
// blocking something already gone or hostile enough not to answer.
const DOMAIN_SHAPE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+(:[0-9]+)?$/;
const domainShapeSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(DOMAIN_SHAPE, "doesn't look like a real domain (check for typos)");

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

// GET /admin/users -> every local account, for the admin dashboard's user
// table. Uncapped-but-reasonable (take: 200) — matches this app's existing
// "no pagination this milestone" precedent elsewhere (e.g. profile
// comments, relationships lists).
adminRouter.get("/admin/users", async (_req, res) => {
  const users = await prisma.localUser.findMany({
    select: {
      id: true,
      email: true,
      isAdmin: true,
      suspended: true,
      createdAt: true,
      actor: { select: { id: true, username: true, domain: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(users);
});

// POST /admin/users/:id/suspend -> blocks login and immediately kills any
// active session (deleted in the same transaction as the flag flip, so
// suspension takes effect right away rather than waiting for a session to
// naturally expire). Can't suspend your own account — avoids an admin
// locking themselves out.
adminRouter.post("/admin/users/:id/suspend", async (req, res) => {
  if (req.params.id === req.localUser!.id) {
    return res.status(400).json({ error: "can't suspend your own account" });
  }
  const target = await prisma.localUser.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "not found" });

  await prisma.$transaction([
    prisma.session.deleteMany({ where: { localUserId: target.id } }),
    prisma.localUser.update({ where: { id: target.id }, data: { suspended: true } }),
  ]);

  res.status(204).end();
});

adminRouter.post("/admin/users/:id/unsuspend", async (req, res) => {
  const target = await prisma.localUser.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "not found" });

  await prisma.localUser.update({ where: { id: target.id }, data: { suspended: false } });
  res.status(204).end();
});

// DELETE /admin/users/:id -> permanent removal, not just suspension.
// Same self-delete guard as suspend above. Tells current followers via
// a federated Delete(actor) before touching the DB — has to happen
// first, since deleteActor (deletion.ts) removes the Follow rows
// deliverToFollowers reads to find who to notify. Fire-and-forget, same
// posture as DELETE /admin/posts/:id below (don't block the response on
// delivery to servers that may be slow/down).
adminRouter.delete("/admin/users/:id", async (req, res) => {
  if (req.params.id === req.localUser!.id) {
    return res.status(400).json({ error: "can't delete your own account" });
  }
  const target = await prisma.localUser.findUnique({ where: { id: req.params.id }, include: { actor: true } });
  if (!target) return res.status(404).json({ error: "not found" });

  void deliverToFollowers(target.actor, deleteActivity(target.actor, actorIri(target.actor)));

  await deleteActor(target.actor.id);
  res.status(204).end();
});

// DELETE /admin/posts/:id -> moderation delete. Federates a Delete the
// same way the author's own DELETE /posts/:id does, but signed as the
// post's real author, not the admin — deliverToFollowers just needs an
// Actor row with a private key, and correct AP semantics is that a
// Delete comes from the object's own actor. Without this, every other
// server that received the original Create would keep the post forever.
adminRouter.delete("/admin/posts/:id", async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: "not found" });

  const author = await prisma.actor.findUnique({ where: { id: post.authorActorId } });
  if (author) {
    void deliverToFollowers(author, deleteActivity(author, postObjectIri(post)));
  }

  await deletePosts([post.id]);

  res.status(204).end();
});

// DELETE /admin/comments/:id -> the first comment-deletion capability in
// this app. Removes the comment and its entire reply subtree
// (src/deletion.ts's deleteCommentSubtree).
adminRouter.delete("/admin/comments/:id", async (req, res) => {
  const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
  if (!comment) return res.status(404).json({ error: "not found" });

  await deleteCommentSubtree(comment.id);

  res.status(204).end();
});

// GET /admin/reports -> the moderation queue. Same row shape whether the
// report was filed locally (routes/reports.ts) or arrived as an incoming
// ActivityPub Flag from another instance (routes/inbox.ts) — one list,
// regardless of origin. Open reports first, most recent first within
// each status.
adminRouter.get("/admin/reports", async (_req, res) => {
  const reports = await prisma.report.findMany({
    include: {
      reporter: { select: { id: true, username: true, domain: true, displayName: true } },
      target: { select: { id: true, username: true, domain: true, displayName: true } },
      post: { select: { id: true, title: true, body: true } },
      comment: { select: { id: true, body: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  res.json(reports);
});

adminRouter.post("/admin/reports/:id/resolve", async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report) return res.status(404).json({ error: "not found" });

  await prisma.report.update({ where: { id: report.id }, data: { status: "resolved" } });
  res.status(204).end();
});

// Relay subscriptions — reuse the existing Follow table, just with this
// instance's own system actor (federation/localActor.ts's
// getOrCreateInstanceActor) as the follower instead of any one person.
// A real relay's push behavior (Follow -> Accept -> it starts sending
// Announce for public posts from all its subscribers) already works
// against the existing Accept(Follow) and processIncomingAnnounce
// handlers in routes/inbox.ts unmodified — both are generic over any
// non-Group remote actor, so a relay (type Application/Service) already
// flows through the same paths a person-to-person follow does. This is
// purely the admin plumbing to establish that Follow.
const addRelaySchema = z.object({ actorUrl: z.string().url() });

// POST /admin/relays { actorUrl } -> relays are dereferenced by direct
// actor IRI, not a webfinger handle — most relay software has no
// webfinger endpoint at all, unlike every other discovery flow in this
// app (routes/follows.ts, routes/blocks.ts, routes/conversations.ts).
adminRouter.post("/admin/relays", async (req, res) => {
  const parsed = addRelaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const instanceActor = await getOrCreateInstanceActor();
  let remotePayload;
  try {
    remotePayload = await fetchRemoteActor(parsed.data.actorUrl, instanceActor);
  } catch {
    // The underlying fetch() throws on DNS/connection failures (unlike a
    // non-2xx response, which fetchRemoteActor already turns into a
    // clean null) — a relay being briefly unreachable shouldn't surface
    // as a raw 500.
    return res.status(502).json({ error: "could not reach that relay — try again in a moment" });
  }
  if (!remotePayload) return res.status(404).json({ error: "could not resolve that actor" });
  const relayActor = await upsertRemoteActor(remotePayload);

  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: instanceActor.id, followingId: relayActor.id } },
  });
  if (existing) return res.status(409).json({ error: "already subscribed, or a request is pending" });

  const follow = await prisma.follow.create({
    data: { followerId: instanceActor.id, followingId: relayActor.id, state: "pending" },
  });
  void deliverActivity(instanceActor, relayActor.inboxUrl, followActivity(instanceActor, actorIri(relayActor)));

  res.status(201).json({ state: follow.state });
});

// GET /admin/relay-directory?q=... -> instant lookup of real, live relay
// servers to subscribe to, sourced from Fediverse Observer's public
// server directory (federation/relayDirectory.ts) — not this app's own
// data, and not an account index (no such thing exists for the
// fediverse), just a list of known relay servers matching `q`.
adminRouter.get("/admin/relay-directory", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.json(await searchRelayDirectory(q));
});

adminRouter.get("/admin/relays", async (_req, res) => {
  const instanceActor = await getOrCreateInstanceActor();
  const follows = await prisma.follow.findMany({
    where: { followerId: instanceActor.id },
    include: { following: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    follows.map((f) => ({
      actorId: f.following.id,
      username: f.following.username,
      domain: f.following.domain,
      state: f.state,
      createdAt: f.createdAt,
    })),
  );
});

// DELETE /admin/relays/:actorId -> unsubscribe. Mirrors DELETE
// /follows/:actorId exactly, just for the instance actor.
adminRouter.delete("/admin/relays/:actorId", async (req, res) => {
  const instanceActor = await getOrCreateInstanceActor();
  const relayActor = await prisma.actor.findUnique({ where: { id: req.params.actorId } });

  await prisma.follow.deleteMany({
    where: { followerId: instanceActor.id, followingId: req.params.actorId },
  });

  if (relayActor) {
    void deliverActivity(instanceActor, relayActor.inboxUrl, undoFollowActivity(instanceActor, actorIri(relayActor)));
  }

  res.status(204).end();
});

// Instance-level moderation's real lever — defederating a whole remote
// server, not just one Actor (routes/blocks.ts's per-user Block).
// Enforcement lives at every "start trusting this domain" choke point
// (routes/inbox.ts, federation/remoteActor.ts's discoverActor,
// federation/deliver.ts) — see the DomainBlock model's own comment for
// the full list and its disclosed limitation.
const domainBlockSchema = z.object({
  domain: domainShapeSchema,
  reason: z.string().max(500).optional(),
});

adminRouter.get("/admin/domain-blocks", async (_req, res) => {
  const blocks = await prisma.domainBlock.findMany({ orderBy: { createdAt: "desc" } });
  res.json(blocks);
});

adminRouter.post("/admin/domain-blocks", async (req, res) => {
  const parsed = domainBlockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const domain = normalizeDomain(parsed.data.domain);
  const block = await prisma.domainBlock.upsert({
    where: { domain },
    create: { domain, reason: parsed.data.reason },
    update: { reason: parsed.data.reason },
  });
  res.status(201).json(block);
});

adminRouter.delete("/admin/domain-blocks/:domain", async (req, res) => {
  await prisma.domainBlock.deleteMany({ where: { domain: normalizeDomain(req.params.domain) } });
  res.status(204).end();
});

// Host-curated list of servers regular users can browse trending/public
// content from (routes/explore.ts serves the actual timeline fetch off
// this list) — admin-gated the same way relay subscriptions are, not an
// open "type any domain" proxy.
const exploreServerSchema = z.object({
  domain: domainShapeSchema,
  name: z.string().max(100).optional(),
});

adminRouter.get("/admin/explore-servers", async (_req, res) => {
  const servers = await prisma.exploreServer.findMany({ orderBy: { createdAt: "desc" } });
  res.json(servers);
});

adminRouter.post("/admin/explore-servers", async (req, res) => {
  const parsed = exploreServerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const domain = normalizeDomain(parsed.data.domain);

  // Catches exactly the class of error a format check can't — a
  // syntactically fine but wrong domain (a typo, a parked/for-sale
  // page, a real server that just isn't Mastodon-API-compatible) —
  // by actually trying the same live request Explore itself will make,
  // right here at add-time instead of leaving it to fail silently the
  // first time someone visits.
  const statuses = await fetchExploreTimeline(domain);
  if (!statuses) {
    return res.status(422).json({
      error: "could not verify that domain — check for typos, or it may not run Mastodon-compatible software",
    });
  }

  const server = await prisma.exploreServer.upsert({
    where: { domain },
    create: { domain, name: parsed.data.name },
    update: { name: parsed.data.name },
  });
  res.status(201).json(server);
});

adminRouter.delete("/admin/explore-servers/:domain", async (req, res) => {
  const server = await prisma.exploreServer.findUnique({
    where: { domain: normalizeDomain(req.params.domain) },
  });
  if (server) {
    // Subscriptions/cached-post links FK to this row — clear them first,
    // same "gather dependents before the parent delete" pattern
    // deletion.ts uses everywhere else. The cached Post rows themselves
    // are untouched — they're normal Gibs now, not exclusively owned by
    // this server's sweep.
    await prisma.$transaction([
      prisma.exploreSubscription.deleteMany({ where: { serverId: server.id } }),
      prisma.exploreCachedPost.deleteMany({ where: { serverId: server.id } }),
      prisma.exploreServer.delete({ where: { id: server.id } }),
    ]);
  }
  res.status(204).end();
});
