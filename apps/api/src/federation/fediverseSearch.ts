import { prisma } from "../db.js";
import { schemeFor } from "./urls.js";
import { toPlainText } from "./plainText.js";
import { isDomainBlocked } from "./domainBlocks.js";
import { mapWithConcurrency } from "./concurrency.js";
import { logger } from "../logger.js";

// A live keyword search across the Host-curated Explore servers — the
// closest thing to "search the fediverse" that actually works without a
// crawled global index (no server has one). Two real, public endpoints:
//
//   - Mastodon family: GET /api/v1/timelines/tag/:tag — the query,
//     reduced to a hashtag slug, against each server's public tag
//     timeline. Unauthenticated everywhere; adds the stored OAuth token
//     if the server has one.
//   - Misskey family: POST /api/notes/search { query } — genuine
//     full-text, where the instance leaves it enabled.
//
// Results are lightweight previews (no AP dereference / caching) — the
// frontend resolves one on demand via the existing /posts/resolve path
// when the user opens it, same as the "Look up this Gib" URL flow.

export interface FediverseSearchResult {
  url: string;
  domain: string;
  software: string;
  author: { username: string; displayName: string | null; avatarUrl: string | null };
  contentText: string;
  createdAt: string;
}

const MISSKEY_FAMILY = new Set(["Misskey", "Firefish", "Sharkey", "Calckey", "Iceshrimp", "CherryPick"]);
const MASTODON_FAMILY = new Set([
  "Mastodon",
  "Pleroma",
  "Akkoma",
  "GoToSocial",
  "Friendica",
  "Hometown",
]);

const PER_SERVER_LIMIT = 8;
const PER_SERVER_TIMEOUT_MS = 4500;
const CONCURRENCY = 10;
const TOTAL_CAP = 25;
// A curated/synced Explore list can run to thousands of servers (the
// FediDB sync alone adds every instance over a size threshold). Fanning
// a live search out across all of them would take minutes — so the sweep
// is capped: the viewer's own subscribed servers first, then a stable
// fill from the rest, up to this many.
const MAX_SERVERS = 24;

// Short cache so a re-render, a "search" re-fire on the same query, or
// two people searching the same term don't re-fan the whole request.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; results: FediverseSearchResult[] }>();

// Hashtags carry no spaces or punctuation — collapse the query the same
// way Mastodon/Misskey do when a user writes "#web dev" and means
// "#webdev". Keeps unicode letters/digits (real fediverse tags are
// frequently non-Latin).
function hashtagSlug(query: string): string {
  return query
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PER_SERVER_TIMEOUT_MS),
      headers: { Accept: "application/json", ...init?.headers },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface MastodonStatus {
  url?: string;
  uri?: string;
  content?: string;
  created_at?: string;
  account?: { username?: string; display_name?: string; avatar?: string };
  reblog?: MastodonStatus | null;
}

function fromMastodon(status: MastodonStatus, domain: string, software: string): FediverseSearchResult | null {
  const real = status.reblog ?? status;
  const url = real.url ?? real.uri;
  if (!url || !real.account?.username) return null;
  return {
    url,
    domain,
    software,
    author: {
      username: real.account.username,
      displayName: real.account.display_name || null,
      avatarUrl: real.account.avatar || null,
    },
    contentText: toPlainText(real.content ?? ""),
    createdAt: real.created_at ?? new Date().toISOString(),
  };
}

interface MisskeyNote {
  id: string;
  uri?: string | null;
  text?: string | null;
  createdAt?: string;
  user?: { username?: string; name?: string; avatarUrl?: string; host?: string | null };
}

function fromMisskey(note: MisskeyNote, origin: string, domain: string, software: string): FediverseSearchResult | null {
  if (!note.user?.username || !note.text) return null;
  return {
    url: note.uri ?? `${origin}/notes/${note.id}`,
    domain,
    software,
    author: {
      username: note.user.host ? `${note.user.username}@${note.user.host}` : note.user.username,
      displayName: note.user.name || null,
      avatarUrl: note.user.avatarUrl || null,
    },
    contentText: note.text,
    createdAt: note.createdAt ?? new Date().toISOString(),
  };
}

async function searchOneServer(
  server: { domain: string; software: string | null; oauthAccessToken: string | null },
  query: string,
  slug: string,
): Promise<FediverseSearchResult[]> {
  const { domain } = server;
  const software = server.software ?? "";
  if (await isDomainBlocked(domain)) return [];

  const origin = `${schemeFor(domain)}://${domain}`;

  if (MISSKEY_FAMILY.has(software)) {
    const json = await fetchJson(`${origin}/api/notes/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: PER_SERVER_LIMIT }),
    });
    if (!Array.isArray(json)) return [];
    return (json as MisskeyNote[])
      .map((n) => fromMisskey(n, origin, domain, software))
      .filter((r): r is FediverseSearchResult => r !== null);
  }

  if (MASTODON_FAMILY.has(software)) {
    if (!slug) return [];
    const auth = server.oauthAccessToken ? { Authorization: `Bearer ${server.oauthAccessToken}` } : undefined;
    const json = await fetchJson(
      `${origin}/api/v1/timelines/tag/${encodeURIComponent(slug)}?limit=${PER_SERVER_LIMIT}`,
      auth ? { headers: auth } : undefined,
    );
    if (!Array.isArray(json)) return [];
    return (json as MastodonStatus[])
      .map((s) => fromMastodon(s, domain, software))
      .filter((r): r is FediverseSearchResult => r !== null);
  }

  return [];
}

export async function searchFediverse(
  rawQuery: string,
  viewerId?: string,
): Promise<FediverseSearchResult[]> {
  const query = rawQuery.trim().replace(/^[#@]/, "");
  if (query.length < 2) return [];

  // Cache key folds in the viewer's server set (a logged-in viewer whose
  // subscriptions differ gets their own entry) via viewerId — cheap and
  // avoids one viewer's results leaking into another's smaller sweep.
  const key = `${viewerId ?? "anon"}:${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

  const softwareFilter = {
    OR: [{ software: { in: [...MASTODON_FAMILY] } }, { software: { in: [...MISSKEY_FAMILY] } }],
  };
  const SERVER_SELECT = { domain: true, software: true, oauthAccessToken: true } as const;

  // The viewer's own subscribed servers come first — those are the ones
  // they actually chose to follow — then a stable fill from the rest.
  const subscribed = viewerId
    ? (
        await prisma.exploreServer.findMany({
          where: { AND: [softwareFilter, { subscriptions: { some: { actorId: viewerId } } }] },
          select: SERVER_SELECT,
          take: MAX_SERVERS,
        })
      )
    : [];

  const chosen = new Map(subscribed.map((s) => [s.domain, s]));
  if (chosen.size < MAX_SERVERS) {
    const fill = await prisma.exploreServer.findMany({
      where: softwareFilter,
      select: SERVER_SELECT,
      orderBy: { createdAt: "asc" },
      take: MAX_SERVERS,
    });
    for (const s of fill) {
      if (chosen.size >= MAX_SERVERS) break;
      if (!chosen.has(s.domain)) chosen.set(s.domain, s);
    }
  }
  const servers = [...chosen.values()];
  if (servers.length === 0) return [];

  const slug = hashtagSlug(query);

  const perServer = await mapWithConcurrency(servers, CONCURRENCY, (server) =>
    searchOneServer(server, query, slug).catch((err) => {
      logger.warn({ err, domain: server.domain }, "fediverse search: server failed");
      return [] as FediverseSearchResult[];
    }),
  );

  const seen = new Set<string>();
  const merged: FediverseSearchResult[] = [];
  for (const result of perServer.flat()) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    merged.push(result);
  }
  merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const results = merged.slice(0, TOTAL_CAP);

  cache.set(key, { at: Date.now(), results });
  return results;
}
