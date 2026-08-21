import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { fetchExploreTimeline } from "../federation/mastodonExplore.js";
import { sweepServer } from "../federation/exploreSweep.js";
import { getOrCreateInstanceActor } from "../federation/localActor.js";

export const exploreRouter = Router();

// GET /explore/servers -> the Host-curated list any logged-in user can
// pick from (routes/admin.ts owns adding/removing entries), each
// tagged with whether the viewer is subscribed (drives the
// Subscribe/Unsubscribe button in the frontend).
exploreRouter.get("/explore/servers", requireAuth, async (req, res) => {
  const servers = await prisma.exploreServer.findMany({ orderBy: { createdAt: "desc" } });
  const subscriptions = await prisma.exploreSubscription.findMany({
    where: { actorId: req.actor!.id, serverId: { in: servers.map((s) => s.id) } },
    select: { serverId: true },
  });
  const subscribedIds = new Set(subscriptions.map((s) => s.serverId));
  res.json(servers.map((s) => ({ ...s, subscribed: subscribedIds.has(s.id) })));
});

// GET /explore/:domain/timeline -> that server's trending (falling back
// to local public) statuses, fetched live via its own Mastodon-API-
// compatible REST endpoint — not ActivityPub, see mastodonExplore.ts's
// own comment. Only serves domains already on the curated list — this
// is an unauthenticated outbound request made on the viewer's behalf,
// so which domains it can target is admin-gated, not a free-for-all
// keyed on whatever a logged-in user passes in the URL.
exploreRouter.get("/explore/:domain/timeline", requireAuth, async (req, res) => {
  const server = await prisma.exploreServer.findUnique({ where: { domain: req.params.domain } });
  if (!server) return res.status(404).json({ error: "not found" });

  const statuses = await fetchExploreTimeline(server.domain);
  if (!statuses) {
    return res
      .status(502)
      .json({ error: "could not reach that server's public API — it may not run Mastodon-compatible software" });
  }
  res.json(statuses);
});

// POST /explore/:domain/subscribe -> opts this server's trending
// timeline into background polling (federation/exploreSweep.ts), which
// is what actually makes its posts show up in the viewer's own
// GET /feed going forward (see that route's own comment on the merge).
// Kicks off one immediate sweep so the subscriber doesn't have to wait
// for the next scheduled tick to see anything.
exploreRouter.post("/explore/:domain/subscribe", requireAuth, async (req, res) => {
  const server = await prisma.exploreServer.findUnique({ where: { domain: req.params.domain } });
  if (!server) return res.status(404).json({ error: "not found" });

  await prisma.exploreSubscription.upsert({
    where: { actorId_serverId: { actorId: req.actor!.id, serverId: server.id } },
    create: { actorId: req.actor!.id, serverId: server.id },
    update: {},
  });

  const instanceActor = await getOrCreateInstanceActor();
  void sweepServer(server.id, server.domain, instanceActor);

  res.status(201).json({ subscribed: true });
});

exploreRouter.delete("/explore/:domain/subscribe", requireAuth, async (req, res) => {
  const server = await prisma.exploreServer.findUnique({ where: { domain: req.params.domain } });
  if (!server) return res.status(404).json({ error: "not found" });

  await prisma.exploreSubscription.deleteMany({
    where: { actorId: req.actor!.id, serverId: server.id },
  });
  res.status(204).end();
});
