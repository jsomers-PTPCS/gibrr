import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { fetchExploreTimelineForDomain } from "./exploreDispatch.js";
import { fetchInstanceSoftware } from "./instanceSoftware.js";

const SETTINGS_ID = 1;
const API_BASE = "https://api.fedidb.org/v1/servers";
// FediDB sorts by user_count descending and pages 10 at a time — a
// low-enough minUserCount could in principle mean walking thousands of
// pages before dropping below threshold. Bounded so one sync run can't
// turn into an unbounded crawl of FediDB's own API; a threshold that
// wide will just take several scheduled runs to fully catch up, same
// "make forward progress, don't try to do it all at once" posture as
// federation/remoteEngagement.ts's reply-sync budget.
const MAX_PAGES = 500;
// Every new domain gets a real live verification probe (the same one
// POST /admin/explore-servers does) before being added — capping how
// many of those a single run attempts keeps a very low threshold (lots
// of newly-crossed servers at once) from turning into hundreds of
// outbound requests, to FediDB-listed servers, back to back.
const MAX_NEW_PER_RUN = 200;

interface FediDbServer {
  domain?: string;
  stats?: { user_count?: number };
}

async function getSettings() {
  return prisma.fediDbSyncSettings.findUnique({ where: { id: SETTINGS_ID } });
}

export async function getFediDbSyncStatus() {
  const settings = await getSettings();
  return {
    enabled: settings?.enabled ?? false,
    minUserCount: settings?.minUserCount ?? 10_000,
    lastSyncAt: settings?.lastSyncAt ?? null,
  };
}

export async function setFediDbSyncSettings(enabled: boolean, minUserCount: number) {
  await prisma.fediDbSyncSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, enabled, minUserCount },
    update: { enabled, minUserCount },
  });
}

// Walks FediDB's real, keyless, cursor-paginated server list (confirmed
// live: sorted by user_count descending, ~10 per page, no API key
// needed) until a page drops below minUserCount — safe to stop there
// rather than reading every page, since nothing after can score higher.
async function fetchCandidateDomains(minUserCount: number): Promise<string[]> {
  const domains: string[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = cursor ? `${API_BASE}?cursor=${encodeURIComponent(cursor)}` : API_BASE;
    let json: { data?: FediDbServer[]; meta?: { next_cursor?: string | null } };
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) break;
      json = (await response.json()) as typeof json;
    } catch (err) {
      logger.warn({ err, page }, "fedidb servers fetch failed");
      break;
    }

    const servers = Array.isArray(json.data) ? json.data : [];
    if (servers.length === 0) break;

    let droppedBelowThreshold = false;
    for (const server of servers) {
      if (typeof server.domain !== "string") continue;
      const userCount = server.stats?.user_count ?? 0;
      if (userCount < minUserCount) {
        droppedBelowThreshold = true;
        break;
      }
      domains.push(server.domain);
    }
    if (droppedBelowThreshold) break;

    const nextCursor = json.meta?.next_cursor;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return domains;
}

// Adds whichever candidate domains aren't already known, the same
// verify-then-insert path POST /admin/explore-servers uses by hand —
// a domain FediDB lists but that doesn't actually speak a supported
// software's public API (or has gone offline since FediDB last saw it)
// is silently skipped, same as a bad domain typed into Add server is.
// `force` skips the enabled check — for the Host's "Sync now" button,
// letting them try a threshold out immediately without first saving it
// as the recurring job's setting. The scheduled interval below always
// calls this without force, so it stays a no-op until the Host opts in.
//
// Guarded against running twice at once (a real thing that happened:
// mashing "Sync now" fired several overlapping runs, which both found
// the same not-yet-added domain and raced each other into the same
// unique-constraint insert — harmless, since the loser's failed insert
// is caught and logged same as any other bad candidate, but pure waste,
// each one re-walking FediDB and re-probing the same servers).
let syncInFlight = false;
export async function runFediDbSync(force = false): Promise<void> {
  if (syncInFlight) return;
  const settings = await getSettings();
  if (!settings || (!settings.enabled && !force)) return;

  syncInFlight = true;
  try {
    await performSync(settings.minUserCount);
  } finally {
    syncInFlight = false;
  }
}

async function performSync(minUserCount: number): Promise<void> {
  const domains = await fetchCandidateDomains(minUserCount);
  const existing = await prisma.exploreServer.findMany({
    where: { domain: { in: domains } },
    select: { domain: true },
  });
  const existingDomains = new Set(existing.map((s) => s.domain));
  const newDomains = domains.filter((d) => !existingDomains.has(d)).slice(0, MAX_NEW_PER_RUN);

  for (const domain of newDomains) {
    try {
      const statuses = await fetchExploreTimelineForDomain(domain);
      if (!statuses) continue;
      const software = await fetchInstanceSoftware(domain);
      await prisma.exploreServer.create({ data: { domain, source: "fedidb", software } });
    } catch (err) {
      logger.warn({ err, domain }, "fedidb sync failed to verify/add a server");
    }
  }

  await prisma.fediDbSyncSettings.update({ where: { id: SETTINGS_ID }, data: { lastSyncAt: new Date() } });
}

export function startFediDbSync(intervalMs = 24 * 60 * 60_000): void {
  runFediDbSync().catch((err) => console.error("[fedidb] initial sync failed:", err));
  setInterval(() => {
    runFediDbSync().catch((err) => console.error("[fedidb] sync failed:", err));
  }, intervalMs);
}
