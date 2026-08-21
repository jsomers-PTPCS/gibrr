import { schemeFor } from "./urls.js";
import { toPlainText } from "./plainText.js";
import { isDomainBlocked } from "./domainBlocks.js";
import { logger } from "../logger.js";

// This is deliberately NOT ActivityPub federation — there's no single
// AP object behind a "trending timeline," it's each server's own
// bespoke aggregation. Mastodon (and API-compatible forks: Glitch,
// Hometown, etc.) expose it as a plain, unauthenticated REST API, which
// is what this fetches directly — a real, documented, public endpoint,
// not a hack. Non-Mastodon-API software (Lemmy, Misskey, GoToSocial's
// own shape, etc.) isn't supported by this endpoint shape at all; a
// disclosed limitation, same posture as federation/relayDirectory.ts's
// software-list restriction.
export interface ExploreStatus {
  url: string;
  author: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  contentText: string;
  createdAt: string;
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

async function fetchStatuses(url: string): Promise<MastodonStatus[] | null> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
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
export async function fetchExploreTimeline(domain: string, limit = 20): Promise<ExploreStatus[] | null> {
  if (await isDomainBlocked(domain)) return null;

  const origin = `${schemeFor(domain)}://${domain}`;
  const trending = await fetchStatuses(`${origin}/api/v1/trends/statuses?limit=${limit}`);
  const statuses = trending && trending.length > 0
    ? trending
    : await fetchStatuses(`${origin}/api/v1/timelines/public?local=true&limit=${limit}`);

  if (!statuses) return null;

  const results: ExploreStatus[] = [];
  for (const status of statuses) {
    const converted = toExploreStatus(status);
    if (converted) results.push(converted);
  }
  return results;
}
