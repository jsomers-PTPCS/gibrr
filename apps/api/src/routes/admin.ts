import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { UPLOADS_DIR } from "../uploads.js";
import { getLastDowntimeAt } from "../heartbeat.js";
import { logger } from "../logger.js";
import { requireAuth, requireAdmin } from "../auth/session.js";
import { deletePosts, deleteCommentSubtree, deleteActor } from "../deletion.js";
import { deleteActivity, postObjectIri, followActivity, undoFollowActivity } from "../federation/activities.js";
import { deliverToFollowers, deliverActivity } from "../federation/deliver.js";
import { getOrCreateInstanceActor, actorIri, localDomain } from "../federation/localActor.js";
import { originFor } from "../federation/urls.js";
import { fetchRemoteActor, upsertRemoteActor } from "../federation/remoteActor.js";
import { searchRelayDirectory } from "../federation/relayDirectory.js";
import { normalizeDomain } from "../federation/domainBlocks.js";
import { fetchExploreTimelineForDomain } from "../federation/exploreDispatch.js";
import { registerOAuthApp, buildAuthorizeUrl, exchangeCodeForToken } from "../federation/mastodonOAuth.js";
import { webOrigin } from "./auth.js";

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

const execFileAsync = promisify(execFile);

// Bytes used by this instance's own data on the server's disk — the
// uploads directory (photos, avatars, custom emoji, etc: everything
// under uploads.ts's UPLOADS_DIR) via `du`, since that's the correct
// tool for "real bytes on disk" (accounts for sparse files/holes,
// unlike summing st_size over a manual directory walk). Returns null
// rather than throwing if `du` isn't available or the directory can't
// be read yet (e.g. a brand new instance with no uploads directory on
// disk at all) — this is diagnostic info, not something that should
// ever break the page it's on.
async function getUploadsSizeBytes(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("du", ["-sb", UPLOADS_DIR]);
    const bytes = parseInt(stdout.split(/\s+/)[0], 10);
    return Number.isFinite(bytes) ? bytes : null;
  } catch (err) {
    logger.warn({ err }, "server health: du failed for uploads directory");
    return null;
  }
}

// Total/used/available space on whatever disk actually backs the uploads
// directory — in this app's own single-VPS deployment model (see
// DEPLOY.md), that's the same disk everything else lives on, so this
// doubles as "the server's disk" rather than needing a separate host-
// level check the API container has no access to anyway. `df -P -B1`
// forces POSIX single-line output with byte-exact (not human-rounded)
// figures, so this doesn't depend on parsing `df`'s locale/unit
// formatting.
async function getDiskSpace(): Promise<{ totalBytes: number; usedBytes: number; availableBytes: number } | null> {
  try {
    const { stdout } = await execFileAsync("df", ["-P", "-B1", UPLOADS_DIR]);
    const dataLine = stdout.trim().split("\n")[1];
    const columns = dataLine?.split(/\s+/) ?? [];
    const [, totalBytes, usedBytes, availableBytes] = columns.map((c) => parseInt(c, 10));
    if (![totalBytes, usedBytes, availableBytes].every(Number.isFinite)) return null;
    return { totalBytes, usedBytes, availableBytes };
  } catch (err) {
    logger.warn({ err }, "server health: df failed for uploads directory");
    return null;
  }
}

// GET /admin/server-health -> the Host dashboard's at-a-glance operational
// panel: is the database actually reachable right now (not just "did the
// API process start"), how much of the server's disk this instance's own
// data (database + uploads) is actually using, and how much room is left
// on that disk. All best-effort — a failed sub-check degrades that one
// field to null/false rather than 500ing the whole panel, since this is
// read-only diagnostics an admin is checking, not something that should
// ever itself become the thing that's broken.
adminRouter.get("/admin/server-health", async (_req, res) => {
  let databaseConnected = true;
  let databaseSizeBytes: number | null = null;
  try {
    const rows = await prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
    databaseSizeBytes = Number(rows[0].size);
  } catch (err) {
    databaseConnected = false;
    logger.warn({ err }, "server health: database size query failed");
  }

  // A brand new instance with no uploads yet has no uploads directory on
  // disk at all (it's only ever created lazily, on the first actual
  // upload — see uploads.ts) — df/du both need a real path to target, so
  // make sure one exists rather than the whole disk section going null
  // just because nobody's uploaded anything.
  await mkdir(UPLOADS_DIR, { recursive: true }).catch((err) => {
    logger.warn({ err }, "server health: could not ensure uploads directory exists");
  });

  const [uploadsSizeBytes, disk, lastDowntimeAt] = await Promise.all([
    getUploadsSizeBytes(),
    getDiskSpace(),
    getLastDowntimeAt(),
  ]);

  res.json({
    active: databaseConnected,
    uptimeSeconds: Math.floor(process.uptime()),
    lastDowntimeAt: lastDowntimeAt?.toISOString() ?? null,
    database: { connected: databaseConnected, sizeBytes: databaseSizeBytes },
    uploads: { sizeBytes: uploadsSizeBytes },
    usedByInstanceBytes:
      databaseSizeBytes !== null && uploadsSizeBytes !== null ? databaseSizeBytes + uploadsSizeBytes : null,
    disk,
  });
});

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

// Selected explicitly (never a bare findMany/upsert) so the OAuth
// columns added alongside the Connect-via-OAuth flow below can never
// end up in a JSON response — oauthAccessToken is only ever read back
// as the boolean "connected", never the token itself.
const EXPLORE_SERVER_SELECT = {
  id: true,
  domain: true,
  name: true,
  createdAt: true,
  oauthAccessToken: true,
} as const;

function toPublicExploreServer<T extends { oauthAccessToken: string | null }>(server: T) {
  const { oauthAccessToken, ...rest } = server;
  return { ...rest, connected: oauthAccessToken !== null };
}

adminRouter.get("/admin/explore-servers", async (_req, res) => {
  const servers = await prisma.exploreServer.findMany({
    orderBy: { createdAt: "desc" },
    select: EXPLORE_SERVER_SELECT,
  });
  res.json(servers.map(toPublicExploreServer));
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
  // first time someone visits. Servers that need a login (Pixelfed and
  // friends) will fail this the same way an unreachable domain does —
  // that's expected, and is exactly what the Connect-via-OAuth flow
  // below is for.
  const statuses = await fetchExploreTimelineForDomain(domain);
  if (!statuses) {
    return res.status(422).json({
      error:
        "could not verify that domain — check for typos, or it may require Connect via OAuth instead of Add server",
    });
  }

  const server = await prisma.exploreServer.upsert({
    where: { domain },
    create: { domain, name: parsed.data.name },
    update: { name: parsed.data.name },
    select: EXPLORE_SERVER_SELECT,
  });
  res.status(201).json(toPublicExploreServer(server));
});

// Connect-via-OAuth: for servers whose public timeline requires a
// logged-in user (e.g. Pixelfed 0.12+ — see federation/mastodonOAuth.ts's
// own comment on why a plain client_credentials token isn't enough).
// Step 1 registers a throwaway OAuth app with the target server and
// sends the admin's browser there to log in and authorize it; step 2
// (the callback below) is where that server redirects back to once
// they do, with a code this exchanges for a user-scoped access token.
adminRouter.post("/admin/explore-servers/:domain/oauth/start", async (req, res) => {
  const domain = normalizeDomain(req.params.domain);
  if (!domainShapeSchema.safeParse(domain).success) {
    return res.status(400).json({ error: "doesn't look like a real domain (check for typos)" });
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 100) || undefined : undefined;

  const redirectUri = `${originFor(localDomain())}/admin/explore-servers/oauth/callback`;
  const app = await registerOAuthApp(domain, redirectUri);
  if (!app) {
    return res.status(422).json({
      error: "could not register with that server — check for typos, or it may not support Mastodon-API OAuth",
    });
  }

  const state = crypto.randomBytes(32).toString("hex");
  await prisma.exploreServer.upsert({
    where: { domain },
    create: { domain, name, oauthClientId: app.clientId, oauthClientSecret: app.clientSecret, oauthPendingState: state },
    update: { oauthClientId: app.clientId, oauthClientSecret: app.clientSecret, oauthPendingState: state },
  });

  res.status(201).json({ authorizeUrl: buildAuthorizeUrl(domain, app.clientId, redirectUri, state) });
});

// Hit directly by the admin's browser being redirected here from the
// target server's own /oauth/authorize page — not called from the SPA,
// so this responds with a redirect back into the Host UI rather than
// JSON. Same-site-lax session cookie still rides along on this
// top-level cross-site redirect, so requireAuth/requireAdmin above
// still identify the admin normally.
adminRouter.get("/admin/explore-servers/oauth/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";

  const server = state ? await prisma.exploreServer.findUnique({ where: { oauthPendingState: state } }) : null;
  if (!server || !code || !server.oauthClientId || !server.oauthClientSecret) {
    return res.redirect(`${webOrigin()}/settings?tab=host&exploreOauth=error`);
  }

  const redirectUri = `${originFor(localDomain())}/admin/explore-servers/oauth/callback`;
  const accessToken = await exchangeCodeForToken(
    server.domain,
    server.oauthClientId,
    server.oauthClientSecret,
    redirectUri,
    code,
  );
  if (!accessToken) {
    await prisma.exploreServer.update({ where: { id: server.id }, data: { oauthPendingState: null } });
    return res.redirect(
      `${webOrigin()}/settings?tab=host&exploreOauth=error&domain=${encodeURIComponent(server.domain)}`,
    );
  }

  await prisma.exploreServer.update({
    where: { id: server.id },
    data: { oauthAccessToken: accessToken, oauthPendingState: null },
  });
  res.redirect(`${webOrigin()}/settings?tab=host&exploreOauth=success&domain=${encodeURIComponent(server.domain)}`);
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
