import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { getOrCreateInstanceActor } from "./localActor.js";
import { fetchLoopsTimeline } from "./loopsExplore.js";
import { resolveAndCacheRemotePost } from "./remotePost.js";

// Same "live, uncached read" problem federation/exploreSweep.ts already
// solved for regular Explore content — confirmed live: GET
// /explore/loops/feed doing this same live timeline-fetch-then-resolve
// work synchronously, inside the request, cost 800ms-2s+ per load
// (bounded by whichever subscribed server answered slowest), on top of
// hammering every Loops server on every single page view. This sweep
// does that same work on its own schedule instead, so the feed route
// only has to read what's already cached — a plain DB query, no network
// wait.
//
// Unlike exploreSweep.ts (only servers with at least one subscriber),
// every Loops-tagged server gets swept unconditionally: the Loops tab
// has no per-server subscription concept — it's the same aggregated
// feed for every viewer, so there's no "nobody asked for this one" case
// to skip the way there is for regular Explore.
export async function runLoopsSweep(): Promise<void> {
  const servers = await prisma.exploreServer.findMany({ where: { software: "Loops" } });
  if (servers.length === 0) return;

  const instanceActor = await getOrCreateInstanceActor();

  for (const server of servers) {
    await sweepLoopsServer(server, instanceActor);
  }
}

// Split out for the same reason exploreSweep.ts's sweepServer is — a
// natural seam for an on-demand one-off sweep later (e.g. right after a
// new Loops server is added), even though nothing calls it that way yet.
export async function sweepLoopsServer(
  server: { id: string; domain: string },
  instanceActor: Awaited<ReturnType<typeof getOrCreateInstanceActor>>,
): Promise<void> {
  const statuses = await fetchLoopsTimeline(server.domain, 20);
  if (!statuses) return;

  for (const status of statuses) {
    try {
      const postId = await resolveAndCacheRemotePost(status.url, instanceActor);
      if (!postId) continue;
      await prisma.exploreCachedPost.upsert({
        where: { serverId_postId: { serverId: server.id, postId } },
        create: {
          serverId: server.id,
          postId,
          remoteLikes: status.remoteCounts?.likes ?? null,
          remoteComments: status.remoteCounts?.comments ?? null,
        },
        // A later sweep's counts replace the earlier ones — this row is
        // "this video's real numbers as of the last sweep," not a
        // historical record.
        update: {
          remoteLikes: status.remoteCounts?.likes ?? null,
          remoteComments: status.remoteCounts?.comments ?? null,
        },
      });
    } catch (err) {
      logger.warn({ err, url: status.url, domain: server.domain }, "loops sweep failed to cache a video");
    }
  }
}

// Shorter interval than exploreSweep.ts's 10 minutes — a short-video
// feed reads as "trending now," and there are only ever a handful of
// Loops servers to check (4 at last count), so a tighter loop doesn't
// meaningfully add to what's already a light sweep.
export function startLoopsSweep(intervalMs = 5 * 60_000): void {
  runLoopsSweep().catch((err) => console.error("[loopsSweep] initial sweep failed:", err));
  setInterval(() => {
    runLoopsSweep().catch((err) => console.error("[loopsSweep] sweep failed:", err));
  }, intervalMs);
}
