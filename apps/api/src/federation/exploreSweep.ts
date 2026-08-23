import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { getOrCreateInstanceActor } from "./localActor.js";
import { fetchExploreTimelineForDomain } from "./exploreDispatch.js";
import { resolveAndCacheRemotePost } from "./remotePost.js";
import { resolveAndCacheFunkwhaleTrack } from "./funkwhaleExplore.js";

// Turns Explore from a live, uncached read into something that actually
// shows up in a viewer's own feed over time: for every server that has
// at least one subscriber, re-fetches its trending timeline and
// resolves+caches each status the same way a manual "View" click does
// (routes/posts.ts's GET /posts/resolve), signed as the instance's own
// system actor since this runs on nobody's behalf in particular. Each
// newly (or already) cached post is linked via ExploreCachedPost so
// GET /explore/feed can find "posts that came from a server I
// subscribe to" — that's not the same set as "posts authored on that
// domain" (a trending list routinely surfaces posts from other
// instances via boosts).
export async function runExploreSweep(): Promise<void> {
  const servers = await prisma.exploreServer.findMany({
    where: { subscriptions: { some: {} } },
  });
  if (servers.length === 0) return;

  const instanceActor = await getOrCreateInstanceActor();

  for (const server of servers) {
    await sweepServer(server, instanceActor);
  }
}

// Split out so POST /explore/:domain/subscribe can trigger an immediate
// one-off sweep for just the server someone subscribed to, rather than
// making them wait for the next interval tick to see anything.
export async function sweepServer(
  server: { id: string; domain: string; oauthAccessToken?: string | null },
  instanceActor: Awaited<ReturnType<typeof getOrCreateInstanceActor>>,
): Promise<void> {
  const statuses = await fetchExploreTimelineForDomain(server.domain, server.oauthAccessToken ?? undefined);
  if (!statuses) return;

  for (const status of statuses) {
    try {
      // Funkwhale's own real caching path — see funkwhaleExplore.ts's
      // own comment on why it can't reuse resolveAndCacheRemotePost.
      const postId = status.funkwhaleTrack
        ? await resolveAndCacheFunkwhaleTrack(status, instanceActor)
        : await resolveAndCacheRemotePost(status.url, instanceActor);
      if (!postId) continue;
      await prisma.exploreCachedPost.upsert({
        where: { serverId_postId: { serverId: server.id, postId } },
        create: { serverId: server.id, postId },
        update: {},
      });
    } catch (err) {
      logger.warn({ err, url: status.url, domain: server.domain }, "explore sweep failed to cache a status");
    }
  }
}

export function startExploreSweep(intervalMs = 10 * 60_000): void {
  runExploreSweep().catch((err) => console.error("[exploreSweep] initial sweep failed:", err));
  setInterval(() => {
    runExploreSweep().catch((err) => console.error("[exploreSweep] sweep failed:", err));
  }, intervalMs);
}
