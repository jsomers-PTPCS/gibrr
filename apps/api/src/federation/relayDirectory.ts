import { logger } from "../logger.js";

// Instant relay-server lookup for the admin panel, backed by Fediverse
// Observer's public GraphQL API (https://api.fediverse.observer, no key
// required for reads — confirmed live). It's a server/instance directory,
// not an account index, so this only helps with "what relays exist to
// subscribe to" — the same structural gap search.ts's remote-person/group
// lookup covers for individual accounts doesn't have an equivalent here,
// since there's no fediverse-wide account index anywhere.
//
// The two software identifiers below cover the overwhelming majority of
// public relay servers (~170 combined, vs a handful for anything else) —
// confirmed via that API's own `softwares` aggregate. Both reliably serve
// their ActivityPub actor at GET /actor (confirmed by hand against live
// instances of each), which is what POST /admin/relays actually needs.
const KNOWN_RELAY_SOFTWARE = ["activityrelay", "aoderelay"];

const FEDIVERSE_OBSERVER_API = "https://api.fediverse.observer";
const CACHE_TTL_MS = 30 * 60 * 1000; // this list changes slowly — cache generously

export interface RelayDirectoryEntry {
  domain: string;
  name: string | null;
  softwareName: string;
  actorUrl: string;
}

interface CacheEntry {
  entries: RelayDirectoryEntry[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

interface NodesResponse {
  data?: { nodes: { domain: string; name: string | null; status: number }[] };
}

async function fetchSoftware(softwareName: string): Promise<RelayDirectoryEntry[]> {
  try {
    const response = await fetch(FEDIVERSE_OBSERVER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{ nodes(softwarename: "${softwareName}", ignoreblacklist: true) { domain name status } }`,
      }),
    });
    if (!response.ok) return [];
    const json = (await response.json()) as NodesResponse;
    const nodes = json.data?.nodes ?? [];
    return nodes
      .filter((n) => n.status === 1 && n.domain)
      .map((n) => ({
        domain: n.domain,
        name: n.name,
        softwareName,
        actorUrl: `https://${n.domain}/actor`,
      }));
  } catch (err) {
    logger.warn({ err, softwareName }, "relay directory fetch failed");
    return [];
  }
}

async function refreshCache(): Promise<RelayDirectoryEntry[]> {
  const lists = await Promise.all(KNOWN_RELAY_SOFTWARE.map(fetchSoftware));
  const entries = lists.flat();
  if (entries.length > 0) cache = { entries, fetchedAt: Date.now() };
  return entries;
}

// Public, admin-only (see routes/admin.ts) — returns up to `limit` cached
// relay servers whose domain matches `q` (case-insensitive substring; a
// blank query returns the first `limit` cached entries, unfiltered).
export async function searchRelayDirectory(q: string, limit = 20): Promise<RelayDirectoryEntry[]> {
  const stale = !cache || Date.now() - cache.fetchedAt > CACHE_TTL_MS;
  const entries = stale ? await refreshCache() : cache!.entries;

  const needle = q.trim().toLowerCase();
  const matches = needle ? entries.filter((e) => e.domain.toLowerCase().includes(needle)) : entries;
  return matches.slice(0, limit);
}
