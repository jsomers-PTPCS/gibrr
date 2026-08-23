import { isDomainBlocked } from "./domainBlocks.js";
import { toPlainText } from "./plainText.js";
import { logger } from "../logger.js";
import type { ExploreStatus } from "./mastodonExplore.js";

// Mobilizon (events, not posts) is the one platform here whose real
// API is GraphQL, not REST — confirmed live against mobilizon.fr with
// this exact query. A real event's AP object is `type: "Event"`;
// resolveAndCacheRemotePost maps it onto Post's existing
// eventStart/eventEnd/eventLocation fields (already there for this
// app's own native event posts, see remotePost.ts) — no new schema.
const EVENTS_QUERY = `
  query ExploreEvents($limit: Int) {
    events(limit: $limit) {
      elements {
        id
        title
        url
        beginsOn
        description
        picture { url }
        organizerActor { preferredUsername domain }
      }
    }
  }
`;

interface MobilizonEvent {
  url?: string;
  title?: string;
  beginsOn?: string;
  description?: string;
  picture?: { url?: string } | null;
  organizerActor?: { preferredUsername?: string; domain?: string | null };
}

function toExploreStatus(event: MobilizonEvent): ExploreStatus | null {
  if (!event.url || !event.organizerActor?.preferredUsername) return null;
  return {
    url: event.url,
    author: {
      username: event.organizerActor.preferredUsername,
      displayName: null,
      avatarUrl: null,
    },
    contentText: toPlainText(event.description || event.title || ""),
    createdAt: event.beginsOn ?? new Date().toISOString(),
  };
}

export async function fetchMobilizonTimeline(domain: string, limit = 20): Promise<ExploreStatus[] | null> {
  if (await isDomainBlocked(domain)) return null;

  try {
    const response = await fetch(`https://${domain}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: EVENTS_QUERY, variables: { limit } }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { data?: { events?: { elements?: unknown } }; errors?: unknown };
    if (json.errors) return null;
    const events = Array.isArray(json.data?.events?.elements) ? (json.data!.events!.elements as MobilizonEvent[]) : null;
    if (!events) return null;

    const results: ExploreStatus[] = [];
    for (const event of events) {
      const converted = toExploreStatus(event);
      if (converted) results.push(converted);
    }
    return results;
  } catch (err) {
    logger.warn({ err, domain }, "mobilizon explore fetch failed");
    return null;
  }
}
