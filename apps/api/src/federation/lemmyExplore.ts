import { isDomainBlocked } from "./domainBlocks.js";
import { logger } from "../logger.js";
import type { ExploreStatus } from "./mastodonExplore.js";

// Lemmy's real API (confirmed live) is GET /api/v3/post/list, nothing
// like Mastodon's REST shape — community/link-post-centric, with
// title+body separate the way this app's own native posts already
// are. Each post's ap_id dereferences to a real AP `type: "Page"`
// (not Note) — resolveAndCacheRemotePost's own type-mapping handles
// that; this fetcher only needs to produce the lightweight preview
// list + URLs.
interface LemmyCreator {
  name?: string;
  actor_id?: string;
}

interface LemmyPost {
  name?: string;
  body?: string;
  ap_id?: string;
  published?: string;
}

interface LemmyListItem {
  post?: LemmyPost;
  creator?: LemmyCreator;
}

function toExploreStatus(item: LemmyListItem): ExploreStatus | null {
  if (!item.post?.ap_id || !item.creator?.name) return null;
  return {
    url: item.post.ap_id,
    author: {
      username: item.creator.name,
      // Lemmy's list response doesn't include a separate display name
      // or avatar for the creator (confirmed live) — only `name`.
      displayName: null,
      avatarUrl: null,
    },
    contentText: item.post.body ?? item.post.name ?? "",
    createdAt: item.post.published ?? new Date().toISOString(),
  };
}

export async function fetchLemmyTimeline(domain: string, limit = 20): Promise<ExploreStatus[] | null> {
  if (await isDomainBlocked(domain)) return null;

  try {
    const response = await fetch(
      `https://${domain}/api/v3/post/list?type_=Local&sort=Hot&limit=${limit}`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) return null;
    const json = (await response.json()) as { posts?: unknown };
    const items = Array.isArray(json.posts) ? (json.posts as LemmyListItem[]) : null;
    if (!items) return null;

    const results: ExploreStatus[] = [];
    for (const item of items) {
      const converted = toExploreStatus(item);
      if (converted) results.push(converted);
    }
    return results;
  } catch (err) {
    logger.warn({ err, domain }, "lemmy explore fetch failed");
    return null;
  }
}
