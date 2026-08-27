import { prisma } from "../db.js";
import { fetchGhostTimeline } from "./ghostExplore.js";

// A viewer's own addition to the Longform tab — self-service, same
// "any user, not just the Host" posture as federation/rssFeeds.ts's
// findOrCreateRssFeed, but simpler: a Ghost blog already speaks
// ActivityPub, so there's no local pseudo-actor to create and nothing
// to sweep into a background cache. GET /explore/longform/feed
// (routes/explore.ts) fetches this domain's timeline live on every
// request, the same way it already does for every Host-curated
// ExploreServer("Ghost") — this function's only job is to validate the
// domain actually is a reachable Ghost blog before remembering it.
export async function findOrCreateGhostBlog(domain: string) {
  const existing = await prisma.ghostBlog.findUnique({ where: { domain } });
  if (existing) return existing;

  const timeline = await fetchGhostTimeline(domain, 1);
  if (timeline === null) throw new Error("not a reachable Ghost blog");

  return prisma.ghostBlog.create({ data: { domain } });
}
