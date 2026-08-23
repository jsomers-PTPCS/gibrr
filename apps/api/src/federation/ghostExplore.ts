import { isDomainBlocked } from "./domainBlocks.js";
import { toPlainText } from "./plainText.js";
import { logger } from "../logger.js";
import type { ExploreStatus } from "./mastodonExplore.js";

// Ghost's ActivityPub support (opt-in per site — most real Ghost blogs
// won't have this at all, which is expected, not a bug: "Add server"
// correctly 422s the same way it does for any domain that doesn't
// speak Explore's requirements) exposes a genuinely paginated public
// outbox — confirmed live against activitypub.ghost.org. Unlike every
// other fetcher here, list items are the real activities themselves
// (Create wrapping an embedded Article or Note object; Announce for
// boosts, filtered out below) rather than a bespoke REST list shape,
// so this reads more like a miniature inbox processor than a
// Mastodon-status-list parser.
interface GhostActivity {
  type?: string;
  object?: {
    id?: string;
    url?: string;
    name?: string | null;
    content?: string | null;
    published?: string;
    attributedTo?: string;
  };
}

interface GhostActor {
  preferredUsername?: string;
  name?: string;
  icon?: { url?: string };
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/activity+json" } });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err, url }, "ghost explore fetch failed");
    return null;
  }
}

export async function fetchGhostTimeline(domain: string, limit = 20): Promise<ExploreStatus[] | null> {
  if (await isDomainBlocked(domain)) return null;

  const outbox = await fetchJson(`https://${domain}/.ghost/activitypub/outbox/index`);
  const firstPageUrl = typeof outbox?.first === "string" ? outbox.first : null;
  if (!firstPageUrl) return null;

  const page = await fetchJson(firstPageUrl);
  const items = Array.isArray(page?.orderedItems) ? (page!.orderedItems as GhostActivity[]) : null;
  if (!items) return null;

  // attributedTo is a bare actor IRI, not embedded account info the way
  // Mastodon/Misskey/Loops inline it — resolved once per unique actor
  // (almost always exactly one, the site itself) rather than per post.
  const actorCache = new Map<string, GhostActor | null>();
  async function resolveActor(actorIri: string): Promise<GhostActor | null> {
    if (!actorCache.has(actorIri)) {
      actorCache.set(actorIri, (await fetchJson(actorIri)) as GhostActor | null);
    }
    return actorCache.get(actorIri) ?? null;
  }

  const results: ExploreStatus[] = [];
  for (const activity of items) {
    if (results.length >= limit) break;
    if (activity.type !== "Create" || !activity.object) continue;

    // Deliberately `id`, not `url` — confirmed live that a real
    // Article's `url` is the human-facing blog permalink, served by
    // Ghost's CMS itself with a plain HTML content-type regardless of
    // Accept header (no real content negotiation there), while `id` is
    // the actual dereferenceable AP object every other platform's own
    // `url` field would have been. Using `url` here 500s the whole
    // resolve step on a JSON-parse of an HTML page.
    const obj = activity.object;
    const url = obj.id;
    if (!url || !obj.attributedTo) continue;

    const actor = await resolveActor(obj.attributedTo);
    if (!actor?.preferredUsername) continue;

    results.push({
      url,
      author: {
        username: actor.preferredUsername,
        displayName: actor.name || null,
        avatarUrl: actor.icon?.url || null,
      },
      contentText: toPlainText(obj.name || obj.content || ""),
      createdAt: obj.published ?? new Date().toISOString(),
    });
  }
  return results;
}
