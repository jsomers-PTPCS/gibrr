import { isDomainBlocked } from "./domainBlocks.js";
import { toPlainText } from "./plainText.js";
import { logger } from "../logger.js";
import type { ExploreStatus } from "./mastodonExplore.js";

// PeerTube's real API (confirmed live), nothing like Mastodon's REST
// shape — video-centric. Each video's `url` (the watch-page URL) is
// confirmed identical to its AP object's own `id`, so it's directly
// dereferenceable the same way every other platform's own url/uri is;
// resolveAndCacheRemotePost's Video-type handling (see remotePost.ts's
// parsePeerTubeMedia) does the rest once the sweep fetches it.
interface PeerTubeAvatar {
  fileUrl?: string;
}

interface PeerTubeAccount {
  name?: string;
  displayName?: string;
  avatars?: PeerTubeAvatar[];
}

interface PeerTubeVideo {
  url?: string;
  name?: string;
  truncatedDescription?: string;
  publishedAt?: string;
  account?: PeerTubeAccount;
}

function toExploreStatus(video: PeerTubeVideo): ExploreStatus | null {
  if (!video.url || !video.account?.name) return null;
  return {
    url: video.url,
    author: {
      username: video.account.name,
      displayName: video.account.displayName || null,
      avatarUrl: video.account.avatars?.[0]?.fileUrl || null,
    },
    contentText: toPlainText(video.truncatedDescription || video.name || ""),
    createdAt: video.publishedAt ?? new Date().toISOString(),
  };
}

export async function fetchPeertubeTimeline(domain: string, limit = 20): Promise<ExploreStatus[] | null> {
  if (await isDomainBlocked(domain)) return null;

  try {
    const response = await fetch(`https://${domain}/api/v1/videos?sort=-trending&count=${limit}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { data?: unknown };
    const videos = Array.isArray(json.data) ? (json.data as PeerTubeVideo[]) : null;
    if (!videos) return null;

    const results: ExploreStatus[] = [];
    for (const video of videos) {
      const converted = toExploreStatus(video);
      if (converted) results.push(converted);
    }
    return results;
  } catch (err) {
    logger.warn({ err, domain }, "peertube explore fetch failed");
    return null;
  }
}
