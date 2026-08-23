import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { fetchExploreTimelineForDomain } from "../federation/exploreDispatch.js";
import { sweepServer } from "../federation/exploreSweep.js";
import { getOrCreateInstanceActor } from "../federation/localActor.js";
import { fetchInstanceSoftware } from "../federation/instanceSoftware.js";
import { fetchLoopsTimeline } from "../federation/loopsExplore.js";
import { resolveAndCacheRemotePost } from "../federation/remotePost.js";
import { postInclude, withCommentCount } from "./posts.js";
import { attachPostVotes, attachCalendarSaves, attachReactions, attachPolls, attachBookmarked } from "../votes.js";

export const exploreRouter = Router();

// GET /explore/loops/feed -> a live, aggregated video feed across every
// Host-curated server detected as Loops software — the TikTok-style
// scrollable "Loops" subcategory (apps/web/app/loops/page.tsx). Unlike
// a single server's own GET /explore/:domain/timeline (a raw live
// preview list with no playable media URL — see mastodonExplore.ts's
// ExploreStatus, which never carries one), an immersive video feed
// needs a real videoUrl up front for every item, not just for whichever
// one a viewer chooses to open — so each status here is resolved+cached
// the same way clicking "View" already does (idempotent: an
// already-cached post just returns its existing id, no repeat work).
exploreRouter.get("/explore/loops/feed", requireAuth, async (req, res) => {
  const servers = await prisma.exploreServer.findMany();
  const softwareByServer = await Promise.all(
    servers.map(async (server) => ({ server, software: await fetchInstanceSoftware(server.domain) })),
  );
  const loopsServers = softwareByServer
    .filter((entry) => entry.software === "Loops")
    .map((entry) => entry.server);

  if (loopsServers.length === 0) return res.json({ posts: [] });

  const instanceActor = await getOrCreateInstanceActor();
  const postIdLists = await Promise.all(
    loopsServers.map(async (server) => {
      const statuses = await fetchLoopsTimeline(server.domain, 20);
      if (!statuses) return [];
      const ids = await Promise.all(
        statuses.map((status) =>
          resolveAndCacheRemotePost(status.url, instanceActor).catch(() => null),
        ),
      );
      return ids.filter((id): id is string => id !== null);
    }),
  );

  const postIds = [...new Set(postIdLists.flat())];
  if (postIds.length === 0) return res.json({ posts: [] });

  const posts = await prisma.post.findMany({
    where: { id: { in: postIds }, videoUrl: { not: null } },
    orderBy: { createdAt: "desc" },
    include: postInclude,
    take: 60,
  });

  const postsWithVotes = await attachPostVotes(posts, req.actor!.id);
  const postsWithSaves = await attachCalendarSaves(postsWithVotes, req.actor!.id);
  const postsWithReactions = await attachReactions(postsWithSaves, req.actor!.id);
  const postsWithPolls = await attachPolls(postsWithReactions, req.actor!.id);
  const postsWithBookmarks = await attachBookmarked(postsWithPolls, req.actor!.id);

  res.json({ posts: postsWithBookmarks.map(withCommentCount) });
});

// GET /explore/servers -> the Host-curated list any logged-in user can
// pick from (routes/admin.ts owns adding/removing entries), each
// tagged with whether the viewer is subscribed (drives the
// Subscribe/Unsubscribe button in the frontend).
exploreRouter.get("/explore/servers", requireAuth, async (req, res) => {
  const servers = await prisma.exploreServer.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, domain: true, name: true, createdAt: true, oauthAccessToken: true },
  });
  const subscriptions = await prisma.exploreSubscription.findMany({
    where: { actorId: req.actor!.id, serverId: { in: servers.map((s) => s.id) } },
    select: { serverId: true },
  });
  const subscribedIds = new Set(subscriptions.map((s) => s.serverId));
  res.json(
    servers.map(({ oauthAccessToken, ...s }) => ({
      ...s,
      connected: oauthAccessToken !== null,
      subscribed: subscribedIds.has(s.id),
    })),
  );
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

  const statuses = await fetchExploreTimelineForDomain(server.domain, server.oauthAccessToken ?? undefined);
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
  void sweepServer(server, instanceActor);

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
