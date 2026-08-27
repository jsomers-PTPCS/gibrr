import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { fetchExploreTimelineForDomain } from "../federation/exploreDispatch.js";
import { sweepServer } from "../federation/exploreSweep.js";
import { getOrCreateInstanceActor } from "../federation/localActor.js";
import { fetchInstanceSoftware } from "../federation/instanceSoftware.js";
import { mapWithConcurrency } from "../federation/concurrency.js";
import { fetchGhostTimeline } from "../federation/ghostExplore.js";
import { resolveAndCacheRemotePost } from "../federation/remotePost.js";
import { postInclude, withCommentCount } from "./posts.js";
import {
  attachPostVotes,
  attachCalendarSaves,
  attachBoosted,
  attachReactions,
  attachPolls,
  attachBookmarked,
} from "../votes.js";

export const exploreRouter = Router();

// How many not-yet-detected ExploreServer rows to probe per feed
// request — see federation/concurrency.ts's own comment for the
// slowdown this avoids repeating. ExploreServer.software is set at
// add-time going forward (both the manual Add-server route and
// fedidb.ts's sync), so this only ever has work to do for rows that
// predate that column; capping it keeps one feed request from
// re-triggering the same slowdown, self-healing the backlog a small
// batch at a time across however many requests it takes instead.
const SOFTWARE_BACKFILL_BATCH = 30;
const SOFTWARE_BACKFILL_CONCURRENCY = 10;

// Every known ExploreServer already tagged with the given software,
// plus a small batch of not-yet-tagged ones detected (and persisted)
// right now — see the constants above for why this is a bounded batch
// rather than every untagged row at once.
async function findServersBySoftware(software: string) {
  const [tagged, untagged] = await Promise.all([
    prisma.exploreServer.findMany({ where: { software } }),
    prisma.exploreServer.findMany({ where: { software: null }, take: SOFTWARE_BACKFILL_BATCH }),
  ]);

  const detected = await mapWithConcurrency(untagged, SOFTWARE_BACKFILL_CONCURRENCY, async (server) => {
    const detectedSoftware = await fetchInstanceSoftware(server.domain);
    await prisma.exploreServer.update({ where: { id: server.id }, data: { software: detectedSoftware } });
    return { server, detectedSoftware };
  });

  return [...tagged, ...detected.filter((d) => d.detectedSoftware === software).map((d) => d.server)];
}

// GET /explore/loops/feed -> an aggregated video feed across every
// Host-curated server detected as Loops software, PLUS any video the
// viewer's own follows have posted (even from a server never curated
// into Explore) — the TikTok-style scrollable "Loops" subcategory
// (apps/web/app/loops/page.tsx). The curated half reads from
// federation/loopsSweep.ts's own periodic cache rather than checking
// every Loops server live on each request — confirmed live that live
// version cost 800ms-2s+ per load (bounded by whichever server answered
// slowest) and hit every Loops server on every single page view; this
// is a plain DB query instead, same "sweep on a schedule, serve from
// cache" shape federation/exploreSweep.ts already uses for regular
// Explore content. Content is only as fresh as the last sweep (5
// minutes by default), not live-checked per request — the same
// tradeoff Explore's own feed already makes. The follows half needs no
// sweep at all — a followed account's posts already arrive locally via
// ordinary inbox delivery, same as anywhere else in the app.
exploreRouter.get("/explore/loops/feed", requireAuth, async (req, res) => {
  // "new" (default, createdAt desc — unchanged from before this param
  // existed) plus sorts the cache already has real data for at no extra
  // query cost: each ExploreCachedPost row already carries the origin
  // server's own like/comment totals as of the last sweep (see that
  // model's own schema comment), so ranking by them — or by "rising"'s
  // likes/age velocity, same formula as posts.ts's own rising sort — is
  // just an in-memory sort of what was already being fetched, not a
  // second round trip anywhere.
  const sort =
    req.query.sort === "likes" || req.query.sort === "comments" || req.query.sort === "rising"
      ? req.query.sort
      : "new";
  // "Show only these" allow-list, same shape/semantics as Home/
  // Federated's own server filter (FeedFilterBar.tsx) — empty means no
  // narrowing, same as today.
  const domainFilter =
    typeof req.query.domain === "string"
      ? req.query.domain.split(",").map((d) => d.trim()).filter(Boolean)
      : [];

  // ?following=1 -> drop the curated-server half below and serve only
  // videos from accounts this viewer actually follows. The Loops page's
  // filter drawer exposes it as an "Only accounts I follow" toggle, for
  // someone who's built up their own follows and doesn't want the
  // Host's hand-picked server list mixed in.
  const followingOnly = req.query.following === "1" || req.query.following === "true";

  // Every account the viewer follows who's posted a video — a followed
  // Loops account's own videos belong in the feed regardless of whether
  // their server has ever been curated into Explore (most won't be:
  // Explore only tracks a small hand-picked list, but a follow is a much
  // stronger, individually-chosen signal than that list). Not gated on
  // remoteId/domain at all, so a followed *local* video counts too.
  const followingIds = (
    await prisma.follow.findMany({
      where: { followerId: req.actor!.id, state: "accepted" },
      select: { followingId: true },
    })
  ).map((f) => f.followingId);

  const followedVideoPostIds =
    followingIds.length > 0
      ? (
          await prisma.post.findMany({
            where: {
              authorActorId: { in: followingIds },
              videoUrl: { not: null },
              ...(domainFilter.length > 0 ? { author: { domain: { in: domainFilter } } } : {}),
            },
            select: { id: true },
            take: 60,
          })
        ).map((p) => p.id)
      : [];

  // The curated half — every Host-curated Loops server's cached
  // timeline. Skipped for ?following=1; otherwise it's the bulk of the
  // feed. Each row also carries the origin server's own like/comment
  // totals as of the last sweep, reused for the "Most liked"/"Most
  // commented"/"rising" sorts and the baseline counts on each slide, so
  // in follows-only mode we still look those up — just narrowed to the
  // followed videos that happen to sit on a curated server too.
  const cached = await prisma.exploreCachedPost.findMany({
    where: followingOnly
      ? { postId: { in: followedVideoPostIds }, server: { software: "Loops" } }
      : {
          server: { software: "Loops", ...(domainFilter.length > 0 ? { domain: { in: domainFilter } } : {}) },
        },
    select: { postId: true, remoteLikes: true, remoteComments: true },
  });

  // Keyed by postId, not by cached row — the same video can in
  // principle turn up in more than one Loops server's own timeline (a
  // cross-post, a boost), each with its own cached row.
  const remoteCountsByPostId = new Map<string, { likes: number | null; comments: number | null }>();
  for (const entry of cached) {
    remoteCountsByPostId.set(entry.postId, { likes: entry.remoteLikes, comments: entry.remoteComments });
  }

  const postIds = new Set(followingOnly ? [] : remoteCountsByPostId.keys());
  for (const id of followedVideoPostIds) postIds.add(id);
  if (postIds.size === 0) return res.json({ posts: [] });

  const posts = await prisma.post.findMany({
    where: { id: { in: [...postIds] }, videoUrl: { not: null } },
    orderBy: { createdAt: "desc" },
    include: postInclude,
    take: 90,
  });

  const postsWithVotes = await attachPostVotes(posts, req.actor!.id);
  const postsWithSaves = await attachCalendarSaves(postsWithVotes, req.actor!.id);
  const postsWithBoosted = await attachBoosted(postsWithSaves, req.actor!.id);
  const postsWithReactions = await attachReactions(postsWithBoosted, req.actor!.id);
  const postsWithPolls = await attachPolls(postsWithReactions, req.actor!.id);
  const postsWithBookmarks = await attachBookmarked(postsWithPolls, req.actor!.id);

  // A freshly resolved+cached copy's own score/commentCount start at zero
  // (nobody here has voted/commented on it yet) — showing that instead of
  // the video's actual popularity on its home server would read as
  // "0 likes" on something with thousands. Sent as remoteEngagement (the
  // same field GET /posts/:id uses for a live-fetched single post) rather
  // than folded into score/commentCount directly, so voting — which
  // replaces score with the fresh *local-only* count from POST
  // /posts/:id/vote — can't stomp the baseline back down to near-zero;
  // the frontend always displays remoteEngagement + the local number.
  const resultPosts = postsWithBookmarks.map(withCommentCount).map((post) => {
    const remote = remoteCountsByPostId.get(post.id);
    return {
      ...post,
      remoteEngagement: remote ? { likes: remote.likes, shares: null, comments: remote.comments } : null,
    };
  });

  if (sort === "likes") {
    resultPosts.sort((a, b) => (b.remoteEngagement?.likes ?? 0) - (a.remoteEngagement?.likes ?? 0));
  } else if (sort === "comments") {
    resultPosts.sort((a, b) => (b.remoteEngagement?.comments ?? 0) - (a.remoteEngagement?.comments ?? 0));
  } else if (sort === "rising") {
    // Velocity, not raw likes — a brand-new video with a handful of
    // likes can outrank one that's merely accumulated more over a much
    // longer time. Floored at 1 hour so a video from the last few
    // minutes doesn't get an extreme, noisy likes/age ratio.
    const now = Date.now();
    const velocity = (post: (typeof resultPosts)[number]) =>
      (post.remoteEngagement?.likes ?? 0) / Math.max(1, (now - post.createdAt.getTime()) / 3_600_000);
    resultPosts.sort((a, b) => velocity(b) - velocity(a));
  }

  res.json({ posts: resultPosts });
});

// GET /explore/loops/servers -> every Loops-tagged server's domain —
// populates the server filter in the Loops page's own filter drawer
// (apps/web/app/loops/page.tsx). Every Loops server, not just ones with
// currently-cached content, unlike deriving this list from whatever's
// on screen — a server the sweep hasn't reached yet (or that's
// temporarily empty) should still be choosable to filter down to.
exploreRouter.get("/explore/loops/servers", requireAuth, async (_req, res) => {
  const servers = await prisma.exploreServer.findMany({
    where: { software: "Loops" },
    select: { domain: true },
    orderBy: { domain: "asc" },
  });
  res.json(servers.map((s) => s.domain));
});

// GET /explore/longform/feed -> a live, aggregated article feed across
// every Host-curated server detected as Ghost software, PLUS whatever
// Ghost blogs this particular viewer has personally added (see
// GhostBlog/GhostSubscription's own schema comments, and POST
// /ghost-blogs/subscriptions below) — the Longform tab on the Federated
// page (app/federated/page.tsx), kept separate from the ordinary
// short-post feed since a card built for a blog post (title, excerpt,
// "read full article" out to the origin) reads completely differently
// from a Note row. Same "resolve each into a real Post" approach as the
// Loops feed above, so titles/bodies come from the same cache
// remotePost.ts already fills in for any other Ghost article (clicking
// "View" on one, an inbox delivery, etc.) — just aggregated live across
// every domain instead of waiting on one. Unlike Loops, there's no
// remoteCounts to attach: confirmed live (see
// federation/remoteEngagement.ts) that Ghost's AP objects carry no
// likes/shares/comments at all, so remoteEngagement is just left unset
// here, same as any ordinary post.
exploreRouter.get("/explore/longform/feed", requireAuth, async (req, res) => {
  const ghostServers = await findServersBySoftware("Ghost");
  const personalBlogs = await prisma.ghostBlog.findMany({
    where: { subscriptions: { some: { actorId: req.actor!.id } } },
  });

  // Deduped by domain — a viewer might personally add a blog the Host
  // has also already curated into Explore; no reason to fetch it twice.
  const domains = new Set<string>();
  for (const server of ghostServers) domains.add(server.domain);
  for (const blog of personalBlogs) domains.add(blog.domain);

  if (domains.size === 0) return res.json({ posts: [] });

  const instanceActor = await getOrCreateInstanceActor();
  const postIdLists = await Promise.all(
    [...domains].map(async (domain) => {
      const statuses = await fetchGhostTimeline(domain, 20);
      if (!statuses) return [];
      const ids = await Promise.all(
        statuses.map((status) => resolveAndCacheRemotePost(status.url, instanceActor).catch(() => null)),
      );
      return ids.filter((id): id is string => id !== null);
    }),
  );

  const postIds = [...new Set(postIdLists.flat())];
  if (postIds.length === 0) return res.json({ posts: [] });

  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
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
