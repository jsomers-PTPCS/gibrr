import { originFor } from "./urls.js";

// Which ActivityPub software a remote domain runs — read from its
// NodeInfo document (a standard discovery endpoint most fediverse
// software exposes, see routes/nodeinfo.ts for our own). Used to label
// remote results in the UI (e.g. "mastodon.social · Mastodon") since a
// bare domain doesn't tell a user what app they'd be joining/following
// into.

interface CacheEntry {
  software: string | null;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — instance software changes rarely
const cache = new Map<string, CacheEntry>();

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Capitalizes known names to match how they're usually written (e.g.
// "mastodon" -> "Mastodon"); anything unrecognized is passed through
// title-cased so a new/unlisted software still shows up readably.
function prettySoftwareName(name: string): string {
  const known: Record<string, string> = {
    mastodon: "Mastodon",
    pleroma: "Pleroma",
    akkoma: "Akkoma",
    misskey: "Misskey",
    firefish: "Firefish",
    calckey: "Calckey",
    sharkey: "Sharkey",
    friendica: "Friendica",
    peertube: "PeerTube",
    pixelfed: "Pixelfed",
    lemmy: "Lemmy",
    writefreely: "WriteFreely",
    gotosocial: "GoToSocial",
    gnusocial: "GNU Social",
    diaspora: "Diaspora",
    hubzilla: "Hubzilla",
    loops: "Loops",
    threads: "Threads",
    gibrr: "Gibrr",
  };
  return known[name.toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

export async function fetchInstanceSoftware(domain: string): Promise<string | null> {
  const cached = cache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.software;

  const software = await lookupInstanceSoftware(domain);
  cache.set(domain, { software, fetchedAt: Date.now() });
  return software;
}

async function lookupInstanceSoftware(domain: string): Promise<string | null> {
  const wellKnown = await fetchJson(`${originFor(domain)}/.well-known/nodeinfo`);
  const links = wellKnown?.links as { rel?: string; href?: string }[] | undefined;
  // Prefer the highest schema version offered (2.1 over 2.0) — content is
  // the same `software.name` field either way, this just avoids settling
  // for whichever happens to sort first.
  const standardMatches = links?.filter(
    (l) => typeof l.rel === "string" && l.rel.includes("nodeinfo.diaspora.software") && l.href,
  );
  const href =
    standardMatches && standardMatches.length > 0
      ? standardMatches.sort((a, b) => (b.rel! > a.rel! ? 1 : -1))[0]?.href
      : // Confirmed live: at least one real Funkwhale instance links its
        // nodeinfo document under a non-standard rel (its own docs URL,
        // not the nodeinfo.diaspora.software schema URI every other
        // platform here uses) — the whole point of this well-known
        // document is to list nodeinfo links, so a single unmatched
        // link is still overwhelmingly likely to be it. Worst case a
        // bad guess here just 404s/fails the JSON parse below, same
        // graceful null as any other lookup failure.
        links?.length === 1
        ? links[0]?.href
        : undefined;
  if (!href) return null;

  const doc = await fetchJson(href);
  const software = doc?.software as { name?: string } | undefined;
  if (!software?.name) return null;

  return prettySoftwareName(software.name);
}
