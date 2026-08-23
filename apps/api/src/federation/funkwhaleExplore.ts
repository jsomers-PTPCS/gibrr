import { prisma } from "../db.js";
import { fetchRemoteActor, fetchRemoteObject, upsertRemoteActor } from "./remoteActor.js";
import { toPlainText } from "./plainText.js";
import { extractHashtagTokens } from "./textEntities.js";
import { isDomainBlocked } from "./domainBlocks.js";
import { originFor } from "./urls.js";
import { logger } from "../logger.js";
import type { ExploreStatus } from "./mastodonExplore.js";
import type { Actor } from "@prisma/client";

// Funkwhale's real API (confirmed live) is versioned differently across
// deployments — /api/v2/ on some instances, /api/v1/ on older ones —
// tried in that order. `-creation_date` is the closest real ordering to
// "recent activity"; Funkwhale has no trending/popularity ordering at
// all (confirmed: both -listens and -popularity are rejected as
// invalid choices by its own API).
const API_VERSIONS = ["v2", "v1"];

interface FunkwhaleUpload {
  listen_url?: string;
}

interface FunkwhaleArtistCredit {
  artist?: { name?: string };
}

interface FunkwhaleTrack {
  fid?: string;
  title?: string;
  uploads?: FunkwhaleUpload[];
  artist_credit?: FunkwhaleArtistCredit[];
}

function toExploreStatus(track: FunkwhaleTrack, origin: string): ExploreStatus | null {
  const listenPath = track.uploads?.[0]?.listen_url;
  if (!track.fid || !listenPath) return null;
  const artistName = track.artist_credit?.[0]?.artist?.name;
  return {
    url: track.fid,
    author: {
      // The list response has no uploading-actor info at all (only
      // descriptive artist metadata, not necessarily a resolvable AP
      // actor) — the real author is resolved separately, from the
      // track's own AP object's attributedTo, in
      // resolveAndCacheFunkwhaleTrack below. This is only a display
      // placeholder for the live-preview endpoint.
      username: artistName ?? "unknown",
      displayName: artistName ?? null,
      avatarUrl: null,
    },
    contentText: track.title ?? "",
    createdAt: new Date().toISOString(),
    // listen_url is a relative path — resolved to absolute here so
    // resolveAndCacheFunkwhaleTrack doesn't need the domain again.
    funkwhaleTrack: { listenUrl: listenPath.startsWith("http") ? listenPath : `${origin}${listenPath}` },
  };
}

export async function fetchFunkwhaleTimeline(domain: string, limit = 20): Promise<ExploreStatus[] | null> {
  if (await isDomainBlocked(domain)) return null;

  const origin = originFor(domain);
  for (const version of API_VERSIONS) {
    try {
      const response = await fetch(`${origin}/api/${version}/tracks/?ordering=-creation_date&page_size=${limit}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) continue;
      const json = (await response.json()) as { results?: unknown };
      const tracks = Array.isArray(json.results) ? (json.results as FunkwhaleTrack[]) : null;
      if (!tracks) continue;

      const results: ExploreStatus[] = [];
      for (const track of tracks) {
        const converted = toExploreStatus(track, origin);
        if (converted) results.push(converted);
      }
      return results;
    } catch (err) {
      logger.warn({ err, domain, version }, "funkwhale explore fetch failed");
    }
  }
  return null;
}

// The one platform in Explore that doesn't go through
// resolveAndCacheRemotePost — a real Track's AP object (confirmed
// live) never carries a playable file URL, only the REST list response
// does, so the sweep needs the funkwhaleTrack.listenUrl it already
// fetched rather than a second, poorer dereference. Otherwise this
// mirrors resolveAndCacheRemotePost closely: idempotent upsert by
// remoteId, same fetchRemoteActor/upsertRemoteActor author resolution
// (from the track's own real attributedTo, not the descriptive
// artist_credit metadata, which isn't necessarily a resolvable actor).
export async function resolveAndCacheFunkwhaleTrack(
  status: ExploreStatus,
  signAs?: Pick<Actor, "username" | "domain" | "privateKey">,
): Promise<string | null> {
  if (!status.funkwhaleTrack) return null;

  const cached = await prisma.post.findUnique({ where: { remoteId: status.url }, select: { id: true } });
  if (cached) return cached.id;

  const fetched = await fetchRemoteObject(status.url, signAs);
  const authorIri = typeof fetched?.attributedTo === "string" ? fetched.attributedTo : undefined;
  if (!fetched || fetched.type !== "Track" || typeof fetched.id !== "string" || !authorIri) {
    return null;
  }

  const authorPayload = await fetchRemoteActor(authorIri, signAs);
  if (!authorPayload) return null;
  const author = await upsertRemoteActor(authorPayload);

  const body = toPlainText(typeof fetched.content === "string" ? fetched.content : "");
  const image = fetched.image as { url?: unknown } | undefined;

  const post = await prisma.post.upsert({
    where: { remoteId: fetched.id },
    create: {
      remoteId: fetched.id,
      title: typeof fetched.name === "string" ? fetched.name : null,
      body,
      authorActorId: author.id,
      communityId: null,
      createdAt: typeof fetched.published === "string" ? new Date(fetched.published) : new Date(),
      hashtags: extractHashtagTokens(body),
      imageUrl: typeof image?.url === "string" ? image.url : null,
      audioUrl: status.funkwhaleTrack.listenUrl,
    },
    update: {},
    select: { id: true },
  });
  return post.id;
}
