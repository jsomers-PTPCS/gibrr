import { schemeFor } from "./urls.js";
import { isDomainBlocked } from "./domainBlocks.js";
import { logger } from "../logger.js";
import type { ExploreStatus } from "./mastodonExplore.js";

// Misskey (and forks sharing its API — Firefish, Sharkey, Iceshrimp) is
// POST-based JSON-RPC-style, not Mastodon's GET+querystring REST — a
// real live probe confirmed neither /api/v1/trends/statuses nor
// /api/v1/timelines/public exist here at all. But a note's own AP
// object (dereferenced via its `uri`) is a plain `type: "Note"` with a
// plain-string attributedTo — identical to Mastodon's — so unlike
// Lemmy/PeerTube this needs no changes to resolveAndCacheRemotePost,
// only this fetcher to get the list of URLs to feed it.
interface MisskeyUser {
  username?: string;
  name?: string;
  avatarUrl?: string;
}

interface MisskeyNote {
  id: string;
  // Null for a note authored natively on this instance (no need for a
  // separate object IRI — it's already home); a real, dereferenceable
  // AP IRI for one federated in from elsewhere. Confirmed live: local
  // notes need `${origin}/notes/${id}` constructed instead.
  uri?: string | null;
  text?: string | null;
  createdAt?: string;
  user?: MisskeyUser;
}

function toExploreStatus(note: MisskeyNote, origin: string): ExploreStatus | null {
  if (!note.user?.username) return null;
  return {
    url: note.uri ?? `${origin}/notes/${note.id}`,
    author: {
      username: note.user.username,
      displayName: note.user.name || null,
      avatarUrl: note.user.avatarUrl || null,
    },
    contentText: note.text ?? "",
    createdAt: note.createdAt ?? new Date().toISOString(),
  };
}

async function fetchNotes(origin: string, endpoint: string, limit: number): Promise<MisskeyNote[] | null> {
  try {
    const response = await fetch(`${origin}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ limit }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as unknown;
    return Array.isArray(json) ? (json as MisskeyNote[]) : null;
  } catch (err) {
    logger.warn({ err, endpoint }, "misskey explore fetch failed");
    return null;
  }
}

// Featured (Misskey's real "trending") first, same fallback-to-plain-
// timeline posture as mastodonExplore.ts for an instance that doesn't
// populate it.
export async function fetchMisskeyTimeline(domain: string, limit = 20): Promise<ExploreStatus[] | null> {
  if (await isDomainBlocked(domain)) return null;

  const origin = `${schemeFor(domain)}://${domain}`;
  const featured = await fetchNotes(origin, "/api/notes/featured", limit);
  const notes =
    featured && featured.length > 0 ? featured : await fetchNotes(origin, "/api/notes/global-timeline", limit);
  if (!notes) return null;

  const results: ExploreStatus[] = [];
  for (const note of notes) {
    const converted = toExploreStatus(note, origin);
    if (converted) results.push(converted);
  }
  return results;
}
