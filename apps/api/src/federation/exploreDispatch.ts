import { fetchInstanceSoftware } from "./instanceSoftware.js";
import { fetchExploreTimeline, fetchMastodonAccountStatuses, type ExploreStatus } from "./mastodonExplore.js";
import { fetchMisskeyTimeline } from "./misskeyExplore.js";
import { fetchLoopsTimeline } from "./loopsExplore.js";
import { fetchGhostTimeline } from "./ghostExplore.js";
import { fetchLemmyTimeline } from "./lemmyExplore.js";
import { fetchPeertubeTimeline } from "./peertubeExplore.js";
import { fetchMobilizonTimeline } from "./mobilizonExplore.js";
import { fetchFunkwhaleTimeline } from "./funkwhaleExplore.js";

// The single entry point every Explore call site (routes/admin.ts's
// add-server validation, routes/explore.ts's live timeline view, and
// exploreSweep.ts's sweepServer) goes through — detects which software
// a domain runs (fetchInstanceSoftware, already existed for UI labels,
// now doing double duty as a dispatch key) and routes to the fetcher
// that actually understands that software's real API. Anything not
// explicitly listed here — including Mastodon, Pleroma, Akkoma,
// Friendica, GoToSocial, or an undetectable domain — falls through to
// the original Mastodon-API-compatible fetcher unchanged, so every
// server that already worked before this file existed keeps working
// exactly the same way, through the exact same function.
export async function fetchExploreTimelineForDomain(
  domain: string,
  accessToken?: string,
  limit = 20,
): Promise<ExploreStatus[] | null> {
  const software = await fetchInstanceSoftware(domain);

  switch (software) {
    case "Misskey":
      return fetchMisskeyTimeline(domain, limit);
    case "Loops":
      return fetchLoopsTimeline(domain, limit);
    case "Ghost":
      return fetchGhostTimeline(domain, limit);
    case "Lemmy":
      return fetchLemmyTimeline(domain, limit);
    case "PeerTube":
      return fetchPeertubeTimeline(domain, limit);
    case "Mobilizon":
      return fetchMobilizonTimeline(domain, limit);
    case "Funkwhale":
      return fetchFunkwhaleTimeline(domain, limit);
    default:
      return fetchExploreTimeline(domain, accessToken, limit);
  }
}

// Like fetchExploreTimelineForDomain above, but for one specific actor's
// own posts rather than a whole domain's "what's happening" sample —
// what routes/profile.ts's backfill needs. Only Mastodon-API-compatible
// software (the default bucket above) has a real per-account endpoint to
// use here; everything else falls back to that same domain-wide fetch,
// left for the caller to filter down to this actor's entries — for a
// single-actor domain (a Ghost blog, most Loops/PeerTube instances)
// that's already equivalent to their real history, for a bigger
// multi-user one it's only whatever of theirs is in that instance's
// current public sample.
const SPECIFICALLY_DISPATCHED = new Set(["Misskey", "Loops", "Ghost", "Lemmy", "PeerTube", "Mobilizon", "Funkwhale"]);

export async function fetchActorTimelineForDomain(
  domain: string,
  username: string,
  limit = 20,
): Promise<ExploreStatus[] | null> {
  const software = await fetchInstanceSoftware(domain);
  // Same "everything unlisted is Mastodon-API-compatible" assumption
  // fetchExploreTimelineForDomain's own default case makes (including
  // when software detection itself fails, i.e. software === null) —
  // the one bucket with a real per-account endpoint to use here.
  if (!software || !SPECIFICALLY_DISPATCHED.has(software)) {
    return fetchMastodonAccountStatuses(domain, username, limit);
  }
  return fetchExploreTimelineForDomain(domain, undefined, limit);
}
