import { isDomainBlocked } from "./domainBlocks.js";
import { logger } from "../logger.js";
import type { ExploreStatus } from "./mastodonExplore.js";

// Loops (short-video fediverse software) isn't Mastodon-API-compatible
// (a real probe confirmed /api/v1/timelines/public 404s) but has its
// own public, unauthenticated feed endpoint. Each item's own AP object
// (dereferenced via its `url`) is confirmed live to be a plain
// `type: "Note"` with a plain-string attributedTo and the video itself
// under `attachment` in the exact shape parseAttachmentMedia already
// parses — so, like Misskey, this needs no changes to
// resolveAndCacheRemotePost at all, only this fetcher.
interface LoopsAccount {
  username?: string;
  display_name?: string;
  avatar?: string;
}

interface LoopsItem {
  url?: string;
  caption?: string;
  created_at?: string;
  account?: LoopsAccount;
}

function toExploreStatus(item: LoopsItem): ExploreStatus | null {
  if (!item.url || !item.account?.username) return null;
  return {
    url: item.url,
    author: {
      username: item.account.username,
      displayName: item.account.display_name || null,
      avatarUrl: item.account.avatar || null,
    },
    contentText: item.caption ?? "",
    createdAt: item.created_at ?? new Date().toISOString(),
  };
}

export async function fetchLoopsTimeline(domain: string, limit = 20): Promise<ExploreStatus[] | null> {
  if (await isDomainBlocked(domain)) return null;

  try {
    const response = await fetch(`https://${domain}/api/web/feed`, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const json = (await response.json()) as { data?: unknown };
    const items = Array.isArray(json.data) ? (json.data as LoopsItem[]) : null;
    if (!items) return null;

    const results: ExploreStatus[] = [];
    for (const item of items.slice(0, limit)) {
      const converted = toExploreStatus(item);
      if (converted) results.push(converted);
    }
    return results;
  } catch (err) {
    logger.warn({ err, domain }, "loops explore fetch failed");
    return null;
  }
}
