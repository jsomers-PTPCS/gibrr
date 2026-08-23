import { fetchInstanceSoftware } from "./instanceSoftware.js";
import { fetchExploreTimeline, type ExploreStatus } from "./mastodonExplore.js";
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
