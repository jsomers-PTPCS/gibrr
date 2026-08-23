import { schemeFor } from "./urls.js";
import { toPlainText } from "./plainText.js";
import { isDomainBlocked } from "./domainBlocks.js";
import { logger } from "../logger.js";

// This is deliberately NOT ActivityPub federation — there's no single
// AP object behind a "trending timeline," it's each server's own
// bespoke aggregation. Mastodon (and API-compatible forks: Glitch,
// Hometown, Pleroma/Akkoma, Friendica) expose it as a plain,
// unauthenticated REST API, which is what this fetches directly — a
// real, documented, public endpoint, not a hack. Software with its own
// different API shape (Lemmy, Misskey, PeerTube, Ghost, Mobilizon,
// Funkwhale, Loops) is handled by its own fetcher instead — see
// federation/exploreDispatch.ts, the actual entry point every caller
// goes through now.
export interface ExploreStatus {
  url: string;
  author: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  contentText: string;
  createdAt: string;
  // Set only by funkwhaleExplore.ts — Funkwhale is the one platform
  // where the playable file only exists in this same list response,
  // not in the track's own AP object (confirmed live), so its caching
  // step reads this directly instead of doing a second AP dereference
  // the way every other fetcher's results do.
  funkwhaleTrack?: { listenUrl: string };
}

interface MastodonAccount {
  username?: string;
  display_name?: string;
  avatar?: string;
}

interface MastodonStatus {
  url?: string;
  uri?: string;
  content?: string;
  created_at?: string;
  account?: MastodonAccount;
  reblog?: MastodonStatus | null;
}

function toExploreStatus(status: MastodonStatus): ExploreStatus | null {
  // A boost/reblog in Mastodon's own timeline shape wraps the original
  // under `reblog` — surface the original post, same as how this app's
  // own federation treats an Announce (the boosted content is what
  // matters, not the wrapper).
  const real = status.reblog ?? status;
  const url = real.url ?? real.uri;
  if (!url || !real.account?.username) return null;

  return {
    url,
    author: {
      username: real.account.username,
      displayName: real.account.display_name || null,
      avatarUrl: real.account.avatar || null,
    },
    contentText: toPlainText(real.content ?? ""),
    createdAt: real.created_at ?? new Date().toISOString(),
  };
}

async function fetchStatuses(url: string, accessToken?: string): Promise<MastodonStatus[] | null> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    const json = (await response.json()) as unknown;
    return Array.isArray(json) ? (json as MastodonStatus[]) : null;
  } catch (err) {
    logger.warn({ err, url }, "explore timeline fetch failed");
    return null;
  }
}

// Trending statuses first (genuinely "what's hot right now" — the
// actual point of an explore page); falls back to the plain local
// public timeline for servers that disable trends (a real, common
// admin setting), so a curated server still shows *something* rather
// than an empty page.
export async function fetchExploreTimeline(
  domain: string,
  accessToken?: string,
  limit = 20,
): Promise<ExploreStatus[] | null> {
  if (await isDomainBlocked(domain)) return null;

  const origin = `${schemeFor(domain)}://${domain}`;
  const trending = await fetchStatuses(`${origin}/api/v1/trends/statuses?limit=${limit}`, accessToken);
  const statuses = trending && trending.length > 0
    ? trending
    : await fetchStatuses(`${origin}/api/v1/timelines/public?local=true&limit=${limit}`, accessToken);

  if (!statuses) return null;

  const results: ExploreStatus[] = [];
  for (const status of statuses) {
    const converted = toExploreStatus(status);
    if (converted) results.push(converted);
  }
  return results;
}
