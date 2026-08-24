import type { Actor } from "@prisma/client";
import { prisma } from "../db.js";
import { fetchRemoteActor, fetchRemoteObject, upsertRemoteActor, discoverActor } from "./remoteActor.js";
import { toPlainText } from "./plainText.js";
import { isDomainBlocked } from "./domainBlocks.js";
import { schemeFor } from "./urls.js";
import { fetchInstanceSoftware } from "./instanceSoftware.js";
import { logger } from "../logger.js";

type SignAs = Pick<Actor, "username" | "domain" | "privateKey">;

// fetchRemoteObject/fetchRemoteActor (and signedGet underneath them) have no
// built-in timeout — an unresponsive remote server could otherwise stall a
// single await well past this module's own deadlineMs budget, which is only
// checked between iterations, not during one. This doesn't cancel the
// underlying request, just stops waiting on it, which is enough to keep the
// walk moving.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const FETCH_TIMEOUT_MS = 8_000;

// Falls back to a Host-configured OAuth connection to this domain
// (routes/admin.ts's Explore-server OAuth flow — ExploreServer.
// oauthAccessToken) when the AP object itself had nothing usable —
// confirmed live: Pixelfed's Note omits likes/shares/replies entirely
// (no collection, not even an empty one), but its own Mastodon-
// compatible REST status endpoint returns real favourites_count/
// reblogs_count/replies_count once authenticated (also confirmed live:
// that same endpoint 302s to /login for an anonymous request, so this
// only works for a domain the Host has actually connected — not
// something that can kick in for an arbitrary followed account on a
// Pixelfed server nobody's registered an app on).
async function fetchViaAuthenticatedApi(
  domain: string,
  statusId: string,
  accessToken: string,
): Promise<{ likes: number | null; shares: number | null; comments: number | null } | null> {
  try {
    const response = await withTimeout(
      fetch(`${schemeFor(domain)}://${domain}/api/v1/statuses/${encodeURIComponent(statusId)}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      }),
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const json = (await response.json()) as {
      favourites_count?: unknown;
      reblogs_count?: unknown;
      replies_count?: unknown;
    };
    return {
      likes: typeof json.favourites_count === "number" ? json.favourites_count : null,
      shares: typeof json.reblogs_count === "number" ? json.reblogs_count : null,
      comments: typeof json.replies_count === "number" ? json.replies_count : null,
    };
  } catch (err) {
    logger.warn({ err, domain, statusId }, "authenticated status API fetch failed");
    return null;
  }
}

// Lemmy's own real API, unlike Pixelfed's, needs no authentication at
// all for public post data (confirmed live) — its federated Page object
// carries no counts whatsoever (no likes/shares/replies fields, not
// even empty ones), but GET /api/v3/post?id= returns real upvotes/
// score/comments for any public post, keyless. "likes" here is Lemmy's
// raw upvote count, not score (upvotes minus downvotes) — score can be
// negative or small even on a popular post, which would read strangely
// next to "favourite(s)" in the UI; upvotes is the closer match to what
// every other source's "likes" actually means. No "shares" — Lemmy has
// no repost/boost concept.
async function fetchLemmyCounts(
  domain: string,
  postId: string,
): Promise<{ likes: number | null; shares: number | null; comments: number | null } | null> {
  try {
    const response = await withTimeout(
      fetch(`${schemeFor(domain)}://${domain}/api/v3/post?id=${encodeURIComponent(postId)}`, {
        headers: { Accept: "application/json" },
      }),
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const json = (await response.json()) as {
      post_view?: { counts?: { upvotes?: unknown; comments?: unknown } };
    };
    const counts = json.post_view?.counts;
    if (!counts) return null;
    return {
      likes: typeof counts.upvotes === "number" ? counts.upvotes : null,
      shares: null,
      comments: typeof counts.comments === "number" ? counts.comments : null,
    };
  } catch (err) {
    logger.warn({ err, domain, postId }, "lemmy post API fetch failed");
    return null;
  }
}

// PieFed is a separate Lemmy-alike codebase, not Lemmy itself — same
// federated Page-with-no-counts shape, but a different (also keyless)
// REST API: GET /api/alpha/post?id= instead of Lemmy's /api/v3/post?id=,
// confirmed live to return the identical post_view.counts.{upvotes,
// comments} shape. Its AP object's own `id` is a slugged URL
// (/c/<community>/p/<id>/<slug>), not a bare numeric path like Lemmy's,
// so the numeric post id has to be pulled out of the middle of the path
// rather than taken as the IRI's last segment the way every other
// fallback here does.
async function fetchPiefedCounts(
  domain: string,
  noteIri: string,
): Promise<{ likes: number | null; shares: number | null; comments: number | null } | null> {
  const match = noteIri.match(/\/p\/(\d+)(?:\/|$)/);
  if (!match) return null;
  try {
    const response = await withTimeout(
      fetch(`${schemeFor(domain)}://${domain}/api/alpha/post?id=${encodeURIComponent(match[1])}`, {
        headers: { Accept: "application/json" },
      }),
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const json = (await response.json()) as {
      post_view?: { counts?: { upvotes?: unknown; comments?: unknown } };
    };
    const counts = json.post_view?.counts;
    if (!counts) return null;
    return {
      likes: typeof counts.upvotes === "number" ? counts.upvotes : null,
      shares: null,
      comments: typeof counts.comments === "number" ? counts.comments : null,
    };
  } catch (err) {
    logger.warn({ err, domain, noteIri }, "piefed post API fetch failed");
    return null;
  }
}

// Misskey's federated Note also carries no counts (confirmed live), but
// its "likes" concept is really per-emoji reactions rather than a single
// favourite — POST /api/notes/show (keyless for a public note) returns
// both the reactions breakdown and its own pre-summed reactionCount, so
// this uses that total rather than re-summing the breakdown itself.
// renoteCount/repliesCount map directly to shares/comments.
async function fetchMisskeyCounts(
  domain: string,
  noteId: string,
): Promise<{ likes: number | null; shares: number | null; comments: number | null } | null> {
  try {
    const response = await withTimeout(
      fetch(`${schemeFor(domain)}://${domain}/api/notes/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ noteId }),
      }),
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const json = (await response.json()) as {
      reactionCount?: unknown;
      renoteCount?: unknown;
      repliesCount?: unknown;
    };
    return {
      likes: typeof json.reactionCount === "number" ? json.reactionCount : null,
      shares: typeof json.renoteCount === "number" ? json.renoteCount : null,
      comments: typeof json.repliesCount === "number" ? json.repliesCount : null,
    };
  } catch (err) {
    logger.warn({ err, domain, noteId }, "misskey notes/show API fetch failed");
    return null;
  }
}

// PeerTube's federated Video *does* carry likes/shares/comments — but as
// dereferenceable Collection IRIs (strings), not inline totalItems
// objects the way Mastodon-shaped software does, so the generic inline
// check below silently finds nothing (a string has no .totalItems).
// Rather than dereferencing three separate collections, its own keyless
// REST endpoint (GET /api/v1/videos/:id) already returns all three as
// plain numbers in one call. No "shares": PeerTube has no repost/boost
// concept, same as Lemmy/PieFed.
async function fetchPeertubeCounts(
  domain: string,
  videoId: string,
): Promise<{ likes: number | null; shares: number | null; comments: number | null } | null> {
  try {
    const response = await withTimeout(
      fetch(`${schemeFor(domain)}://${domain}/api/v1/videos/${encodeURIComponent(videoId)}`, {
        headers: { Accept: "application/json" },
      }),
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const json = (await response.json()) as { likes?: unknown; comments?: unknown };
    return {
      likes: typeof json.likes === "number" ? json.likes : null,
      shares: null,
      comments: typeof json.comments === "number" ? json.comments : null,
    };
  } catch (err) {
    logger.warn({ err, domain, videoId }, "peertube video API fetch failed");
    return null;
  }
}

// The real, origin-server-reported counts for a cached remote post — never
// stored (the whole point is "current", not a stale snapshot), so this is
// called fresh on every GET /posts/:id for a federated post. Mastodon-shaped
// software puts these directly on the Note object itself (confirmed live:
// likes.totalItems/shares.totalItems match the REST API's
// favourites_count/reblogs_count exactly) — same request federation already
// depends on for interop, not a bespoke REST call like mastodonExplore.ts's.
// Missing/malformed fields degrade to null per-field rather than failing
// the whole lookup — plenty of AP software doesn't populate these at all,
// in which case the software-specific fallbacks below get a second try.
export async function fetchLiveCounts(
  noteIri: string,
  signAs?: SignAs,
): Promise<{ likes: number | null; shares: number | null; comments?: number | null } | null> {
  try {
    const fetched = await withTimeout(fetchRemoteObject(noteIri, signAs), FETCH_TIMEOUT_MS);
    if (!fetched) return null;
    const likes = (fetched.likes as { totalItems?: unknown } | undefined)?.totalItems;
    const shares = (fetched.shares as { totalItems?: unknown } | undefined)?.totalItems;
    // Friendica publishes totalItems directly on its inline replies
    // collection (confirmed live) — Mastodon's own replies collection
    // has no such field, so this is a bonus most software won't have,
    // not something that needs a software check to gate it. Only reads
    // the object case: several other platforms put a bare Collection
    // *IRI* here instead (a string), which has no totalItems to read
    // and is left to each platform's own REST fallback below.
    const inlineReplies = fetched.replies;
    const inlineComments =
      typeof inlineReplies === "object" && inlineReplies !== null
        ? (inlineReplies as { totalItems?: unknown }).totalItems
        : undefined;
    const result = {
      likes: typeof likes === "number" ? likes : null,
      shares: typeof shares === "number" ? shares : null,
      comments: typeof inlineComments === "number" ? inlineComments : null,
    };

    if (result.likes === null && result.shares === null) {
      const domain = new URL(noteIri).host;
      const statusId = noteIri.split("/").filter(Boolean).pop();

      const software = await fetchInstanceSoftware(domain);
      if (software === "Lemmy" && statusId) {
        const viaLemmy = await fetchLemmyCounts(domain, statusId);
        if (viaLemmy) return viaLemmy;
      } else if (software === "Piefed") {
        const viaPiefed = await fetchPiefedCounts(domain, noteIri);
        if (viaPiefed) return viaPiefed;
      } else if (software === "Misskey" && statusId) {
        const viaMisskey = await fetchMisskeyCounts(domain, statusId);
        if (viaMisskey) return viaMisskey;
      } else if (software === "PeerTube" && statusId) {
        const viaPeertube = await fetchPeertubeCounts(domain, statusId);
        if (viaPeertube) return viaPeertube;
      }

      const server = await prisma.exploreServer.findUnique({
        where: { domain },
        select: { oauthAccessToken: true },
      });
      if (server?.oauthAccessToken && statusId) {
        const viaApi = await fetchViaAuthenticatedApi(domain, statusId, server.oauthAccessToken);
        if (viaApi) return viaApi;
      }
    }

    return result;
  } catch (err) {
    logger.warn({ err, noteIri }, "fetching live remote engagement counts failed");
    return null;
  }
}

// Mastodon's inline replies.first.items only ever holds replies from
// viewers on the *same instance* as the post's author (confirmed live:
// a post with 31 real replies came back with first.items: [] and a
// first.next link gated behind ?only_other_accounts=true) — every
// cross-instance reply, which in practice is most of them, only shows
// up by following that pagination chain. Bounded independently of
// budget.maxReplies (a page can come back mostly-empty or duplicate a
// prior page) — this just caps how many *page fetches* one node's
// replies collection can cost, separate from how many comments end up
// resolved from what they return.
const MAX_REPLY_PAGES = 10;
async function collectReplyIris(
  firstPage: { items?: unknown; next?: unknown } | undefined,
  signAs: SignAs | undefined,
  deadline: number,
): Promise<string[]> {
  const iris = new Set<string>();
  const initialItems = firstPage?.items;
  if (Array.isArray(initialItems)) {
    for (const item of initialItems) if (typeof item === "string") iris.add(item);
  }

  let nextUrl = typeof firstPage?.next === "string" ? firstPage.next : undefined;
  for (let page = 0; nextUrl && page < MAX_REPLY_PAGES && Date.now() < deadline; page++) {
    let pageObj: Record<string, unknown> | null;
    try {
      pageObj = await withTimeout(fetchRemoteObject(nextUrl, signAs), FETCH_TIMEOUT_MS);
    } catch (err) {
      logger.warn({ err, nextUrl }, "remote reply sync: paginated replies page fetch failed");
      break;
    }
    if (!pageObj) break;
    const pageItems = pageObj.items;
    if (Array.isArray(pageItems)) {
      for (const item of pageItems) if (typeof item === "string") iris.add(item);
    }
    nextUrl = typeof pageObj.next === "string" ? pageObj.next : undefined;
  }

  return [...iris];
}

interface SyncBudget {
  maxReplies: number;
  maxDepth: number;
  deadlineMs: number;
}

const DEFAULT_BUDGET: SyncBudget = { maxReplies: 40, maxDepth: 4, deadlineMs: 15_000 };

// Shared by every non-Mastodon-shaped reply sync below (Lemmy/PieFed's
// REST comment list, PeerTube's flat comments collection, Pixelfed's
// authenticated status context) — each of those discovers a comment's
// remoteId/author/body/parent through a completely different API shape,
// but resolving that into a real Comment row is identical work either
// way, so it's factored out once instead of four times. Short-circuits
// on an already-cached remoteId before touching the network: this runs
// on every GET /posts/:id view, so a comment seen on a prior view must
// not re-fetch its author from the origin server every single time.
async function upsertResolvedComment(params: {
  postId: string;
  remoteId: string;
  authorActorIri: string;
  body: string;
  publishedAt: Date;
  parentCommentId: string | null;
  signAs?: SignAs;
}): Promise<string | null> {
  let remoteUrl: URL;
  try {
    remoteUrl = new URL(params.remoteId);
  } catch {
    return null;
  }
  if (await isDomainBlocked(remoteUrl.host)) return null;

  const cached = await prisma.comment.findUnique({ where: { remoteId: params.remoteId }, select: { id: true } });
  if (cached) return cached.id;

  let authorPayload;
  try {
    authorPayload = await withTimeout(fetchRemoteActor(params.authorActorIri, params.signAs), FETCH_TIMEOUT_MS);
  } catch (err) {
    logger.warn({ err, authorActorIri: params.authorActorIri }, "remote reply sync: fetching a reply's author failed");
    return null;
  }
  if (!authorPayload) return null;
  const author = await upsertRemoteActor(authorPayload);

  const comment = await prisma.comment.upsert({
    where: { remoteId: params.remoteId },
    create: {
      remoteId: params.remoteId,
      postId: params.postId,
      parentId: params.parentCommentId,
      body: params.body,
      authorActorId: author.id,
      createdAt: params.publishedAt,
    },
    update: { body: params.body },
    select: { id: true },
  });
  return comment.id;
}

interface LemmyCommentRow {
  comment?: { ap_id?: unknown; path?: unknown; published?: unknown; content?: unknown; body?: unknown };
  creator?: { actor_id?: unknown };
}

// Lemmy and PieFed both expose a keyless REST endpoint that returns the
// *entire* comment tree for a post in one call, each row carrying a
// dot-separated `path` of internal comment ids ("0.<id>" for top-level,
// "0.<parent>.<id>" for a reply to that parent) — sorting by path length
// guarantees every parent is resolved before the child that references
// it, so no iterative/orphan-fallback logic is needed the way PeerTube's
// flat-but-unordered collection below requires. The only difference
// between the two platforms is the endpoint path and which field name
// holds the comment text (Lemmy: "content", PieFed: "body").
async function syncLemmyFamilyReplies(
  post: { id: string; remoteId: string },
  domain: string,
  postId: string,
  apiPath: "/api/v3/comment/list" | "/api/alpha/comment/list",
  contentField: "content" | "body",
  signAs: SignAs | undefined,
  budget: SyncBudget,
): Promise<void> {
  let json: { comments?: LemmyCommentRow[] };
  try {
    const response = await withTimeout(
      fetch(
        `${schemeFor(domain)}://${domain}${apiPath}?post_id=${encodeURIComponent(postId)}&sort=Old&limit=${budget.maxReplies}`,
        { headers: { Accept: "application/json" } },
      ),
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return;
    json = (await response.json()) as typeof json;
  } catch (err) {
    logger.warn({ err, domain, postId, apiPath }, "lemmy-family comment list fetch failed");
    return;
  }

  const rows = Array.isArray(json.comments) ? json.comments : [];
  const sorted = [...rows].sort(
    (a, b) => String(a.comment?.path ?? "").length - String(b.comment?.path ?? "").length,
  );

  const idToCommentDbId = new Map<string, string>();
  const deadline = Date.now() + budget.deadlineMs;
  let resolved = 0;

  for (const row of sorted) {
    if (resolved >= budget.maxReplies || Date.now() >= deadline) break;

    const apId = row.comment?.ap_id;
    const authorIri = row.creator?.actor_id;
    const content = row.comment?.[contentField];
    const path = String(row.comment?.path ?? "");
    if (typeof apId !== "string" || typeof authorIri !== "string" || typeof content !== "string") continue;

    const segments = path.split(".").filter(Boolean);
    const selfSegment = segments[segments.length - 1];
    const parentSegment = segments.length > 2 ? segments[segments.length - 2] : undefined;
    const parentCommentId = parentSegment ? (idToCommentDbId.get(parentSegment) ?? null) : null;

    const publishedAt = typeof row.comment?.published === "string" ? new Date(row.comment.published) : new Date();
    const commentId = await upsertResolvedComment({
      postId: post.id,
      remoteId: apId,
      authorActorIri: authorIri,
      body: toPlainText(content),
      publishedAt,
      parentCommentId,
      signAs,
    });
    if (commentId) {
      idToCommentDbId.set(selfSegment, commentId);
      resolved += 1;
    }
  }
}

// PeerTube's `comments` collection lists every comment on the video
// flatly (not just direct replies to the video itself, confirmed live:
// totalItems on it matches the video's own total comment count) as bare
// IRIs, needing its own dereference per item — but unlike Lemmy/PieFed's
// REST list, nothing here guarantees a parent comment appears before its
// child in the array, so parent linkage is resolved in rounds: each
// round places whatever's newly resolvable (its inReplyTo is the post
// itself or an already-resolved comment) and leaves the rest for the
// next round. Anything still unresolved after a few rounds (a parent
// that itself didn't parse, e.g.) is attached as top-level rather than
// dropped — a comment showing up flattened beats it not showing up.
// PeerTube also omits the standard collection `first` link on the bare
// collection URL (confirmed live) — its own convention is to require
// `?page=1` to get an actual OrderedCollectionPage with items.
async function syncPeertubeReplies(
  post: { id: string; remoteId: string },
  commentsUrl: string,
  signAs: SignAs | undefined,
  budget: SyncBudget,
): Promise<void> {
  const pageUrl = `${commentsUrl}${commentsUrl.includes("?") ? "&" : "?"}page=1`;
  let collection: Record<string, unknown> | null;
  try {
    collection = await withTimeout(fetchRemoteObject(pageUrl, signAs), FETCH_TIMEOUT_MS);
  } catch (err) {
    logger.warn({ err, commentsUrl }, "peertube comments collection fetch failed");
    return;
  }
  const items = Array.isArray(collection?.orderedItems) ? (collection.orderedItems as unknown[]) : [];

  const deadline = Date.now() + budget.deadlineMs;
  const noteEntries: { note: Record<string, unknown> }[] = [];
  for (const item of items) {
    if (typeof item !== "string" || Date.now() >= deadline) continue;
    let note: Record<string, unknown> | null;
    try {
      note = await withTimeout(fetchRemoteObject(item, signAs), FETCH_TIMEOUT_MS);
    } catch (err) {
      logger.warn({ err, iri: item }, "peertube comment fetch failed");
      continue;
    }
    if (note && note.type === "Note" && typeof note.id === "string") noteEntries.push({ note });
  }

  const idToCommentDbId = new Map<string, string>();
  let resolved = 0;
  const pending = [...noteEntries];
  for (let round = 0; round < 4 && pending.length > 0; round++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (resolved >= budget.maxReplies || Date.now() >= deadline) {
        pending.length = 0;
        break;
      }
      const { note } = pending[i];
      const inReplyTo = typeof note.inReplyTo === "string" ? note.inReplyTo : undefined;
      let parentCommentId: string | null | undefined;
      if (!inReplyTo || inReplyTo === post.remoteId) parentCommentId = null;
      else if (idToCommentDbId.has(inReplyTo)) parentCommentId = idToCommentDbId.get(inReplyTo)!;
      else continue; // parent not resolved yet — retry next round

      pending.splice(i, 1);
      const authorIri = typeof note.attributedTo === "string" ? note.attributedTo : undefined;
      if (!authorIri) continue;

      const commentId = await upsertResolvedComment({
        postId: post.id,
        remoteId: note.id as string,
        authorActorIri: authorIri,
        body: toPlainText(typeof note.content === "string" ? note.content : ""),
        publishedAt: typeof note.published === "string" ? new Date(note.published) : new Date(),
        parentCommentId,
        signAs,
      });
      if (commentId) {
        idToCommentDbId.set(note.id as string, commentId);
        resolved += 1;
      }
    }
  }
  // Orphan fallback: whatever never found its parent within the rounds
  // above still gets synced in, just flattened to top-level.
  for (const { note } of pending) {
    if (resolved >= budget.maxReplies || Date.now() >= deadline) break;
    const authorIri = typeof note.attributedTo === "string" ? note.attributedTo : undefined;
    if (!authorIri) continue;
    const commentId = await upsertResolvedComment({
      postId: post.id,
      remoteId: note.id as string,
      authorActorIri: authorIri,
      body: toPlainText(typeof note.content === "string" ? note.content : ""),
      publishedAt: typeof note.published === "string" ? new Date(note.published) : new Date(),
      parentCommentId: null,
      signAs,
    });
    if (commentId) resolved += 1;
  }
}

// Pixelfed's own object exposes no reply data at all (confirmed live,
// same as its likes/shares gap in fetchLiveCounts above) — its
// authenticated Mastodon-compatible status context endpoint is the only
// source, so this only ever runs for a domain the Host has already
// OAuth-connected via the Explore-server flow, same restriction as
// fetchViaAuthenticatedApi. `in_reply_to_id` is that platform's own
// internal status id (not an IRI), so parent linkage is keyed by that
// id rather than by remoteId the way every other path here does.
async function syncPixelfedReplies(
  post: { id: string; remoteId: string },
  domain: string,
  statusId: string,
  accessToken: string,
  signAs: SignAs | undefined,
  budget: SyncBudget,
): Promise<void> {
  interface PixelfedStatus {
    id?: unknown;
    uri?: unknown;
    in_reply_to_id?: unknown;
    content?: unknown;
    created_at?: unknown;
    account?: { url?: unknown };
  }
  let json: { descendants?: PixelfedStatus[] };
  try {
    const response = await withTimeout(
      fetch(`${schemeFor(domain)}://${domain}/api/v1/statuses/${encodeURIComponent(statusId)}/context`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      }),
      FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return;
    json = (await response.json()) as typeof json;
  } catch (err) {
    logger.warn({ err, domain, statusId }, "pixelfed status context fetch failed");
    return;
  }

  // The context endpoint returns descendants in thread order (parents
  // before their children) per Mastodon-API convention, so — unlike
  // PeerTube's collection above — a single pass is enough.
  const descendants = Array.isArray(json.descendants) ? json.descendants : [];
  const idToCommentDbId = new Map<string, string>();
  const deadline = Date.now() + budget.deadlineMs;
  let resolved = 0;

  for (const status of descendants) {
    if (resolved >= budget.maxReplies || Date.now() >= deadline) break;

    const remoteId = typeof status.uri === "string" ? status.uri : undefined;
    const internalId = typeof status.id === "string" ? status.id : undefined;
    const authorIri = typeof status.account?.url === "string" ? status.account.url : undefined;
    const inReplyToId = typeof status.in_reply_to_id === "string" ? status.in_reply_to_id : undefined;
    if (!remoteId || !internalId || !authorIri) continue;

    const parentCommentId = !inReplyToId || inReplyToId === statusId ? null : (idToCommentDbId.get(inReplyToId) ?? null);

    const commentId = await upsertResolvedComment({
      postId: post.id,
      remoteId,
      authorActorIri: authorIri,
      body: toPlainText(typeof status.content === "string" ? status.content : ""),
      publishedAt: typeof status.created_at === "string" ? new Date(status.created_at) : new Date(),
      parentCommentId,
      signAs,
    });
    if (commentId) {
      idToCommentDbId.set(internalId, commentId);
      resolved += 1;
    }
  }
}

interface LoopsCommentRow {
  id?: unknown;
  account?: { username?: unknown };
  caption?: unknown;
  replies?: unknown;
  remote_url?: unknown;
  url?: unknown;
  created_at?: unknown;
}

// Loops' AP video object carries no replies field at all (same gap as
// Pixelfed/Lemmy) — its real comments live behind its own keyless REST
// API (GET /api/v1/video/comments/:videoId, nested replies behind a
// second endpoint keyed by parent comment id), reverse-engineered from
// its own public JS bundle since it isn't documented anywhere. Genuinely
// federated comments (the common case — Loops comments arrive from
// wherever the commenter actually lives) carry their real origin AP IRI
// directly as `remote_url`; a comment posted by a user native to this
// same Loops instance has no `remote_url`; its own `url` (a permalink
// with a ?cid= query identifying that one comment) is used instead as a
// stable remoteId for dedup purposes even though it isn't a
// dereferenceable AP object the way every other remoteId here is.
// `account.username` is "name@domain" for a federated commenter but a
// bare "name" for a same-instance one — appending this domain in the
// bare case and webfinger-discovering either way avoids needing to
// guess at Loops' own actor-IRI URL shape.
async function syncLoopsReplies(
  post: { id: string; remoteId: string },
  domain: string,
  videoId: string,
  budget: SyncBudget,
): Promise<void> {
  async function fetchPage(path: string): Promise<LoopsCommentRow[]> {
    try {
      const response = await withTimeout(
        fetch(`${schemeFor(domain)}://${domain}${path}`, { headers: { Accept: "application/json" } }),
        FETCH_TIMEOUT_MS,
      );
      if (!response.ok) return [];
      const json = (await response.json()) as { data?: LoopsCommentRow[] };
      return Array.isArray(json.data) ? json.data : [];
    } catch (err) {
      logger.warn({ err, domain, path }, "loops comments fetch failed");
      return [];
    }
  }

  async function resolveAccountIri(account: LoopsCommentRow["account"]): Promise<string | null> {
    const username = typeof account?.username === "string" ? account.username : undefined;
    if (!username) return null;
    const handle = username.includes("@") ? username : `${username}@${domain}`;
    const actor = await discoverActor(handle).catch(() => null);
    return actor?.id ?? null;
  }

  async function upsertLoopsComment(
    row: LoopsCommentRow,
    parentCommentId: string | null,
  ): Promise<string | null> {
    const caption = typeof row.caption === "string" ? row.caption : undefined;
    const remoteId = typeof row.remote_url === "string" ? row.remote_url : typeof row.url === "string" ? row.url : undefined;
    if (!caption || !remoteId) return null;
    const authorIri = await resolveAccountIri(row.account);
    if (!authorIri) return null;

    return upsertResolvedComment({
      postId: post.id,
      remoteId,
      authorActorIri: authorIri,
      body: toPlainText(caption),
      publishedAt: typeof row.created_at === "string" ? new Date(row.created_at) : new Date(),
      parentCommentId,
    });
  }

  const deadline = Date.now() + budget.deadlineMs;
  let resolved = 0;

  const topLevel = await fetchPage(`/api/v1/video/comments/${encodeURIComponent(videoId)}?cursor=&limit=${budget.maxReplies}`);

  for (const row of topLevel) {
    if (resolved >= budget.maxReplies || Date.now() >= deadline) break;
    const parentDbId = await upsertLoopsComment(row, null);
    if (!parentDbId) continue;
    resolved += 1;

    const replyCount = typeof row.replies === "number" ? row.replies : 0;
    if (replyCount === 0 || resolved >= budget.maxReplies || Date.now() >= deadline) continue;

    const nested = await fetchPage(
      `/api/v1/video/comments/${encodeURIComponent(videoId)}/replies?cr=${encodeURIComponent(String(row.id))}&limit=${Math.min(replyCount, budget.maxReplies - resolved)}`,
    );
    for (const reply of nested) {
      if (resolved >= budget.maxReplies || Date.now() >= deadline) break;
      const childId = await upsertLoopsComment(reply, parentDbId);
      if (childId) resolved += 1;
    }
  }
}

// Walks a cached remote post's own `replies` collection (and each reply's,
// recursively) and resolves every reply it finds into a real Comment row —
// same idempotent upsert-by-remoteId pattern routes/inbox.ts's incoming-
// reply handling and remotePost.ts's resolveAndCacheRemotePost already use,
// so concurrent callers (two people opening the same post at once) can't
// race into a unique-constraint error, and repeat calls are cheap for
// already-seen branches. Because these land as ordinary Comment rows, they
// render through the existing comment-thread UI and are repliable/votable
// like any other comment — no separate "remote thread" rendering needed.
//
// Deliberately bounded (see DEFAULT_BUDGET): fetchRemoteObject/signedGet
// have no built-in timeout, and a post's reply tree has no natural size
// limit, so a wide/deep/slow thread stops at maxReplies/maxDepth/deadlineMs
// rather than hanging the request or hammering a remote server — the first
// ~40 replies, breadth-first, not the full thread. Only the first page of
// each node's replies collection is walked, not further pagination within
// one node.
export async function syncRemoteReplies(
  post: { id: string; remoteId: string },
  signAs?: SignAs,
  budget: SyncBudget = DEFAULT_BUDGET,
): Promise<void> {
  // Confirmed live: Lemmy/PieFed/PeerTube/Pixelfed publish nothing this
  // walk's replies.first.items check can find (see the dedicated sync
  // functions above for exactly what each one has instead) — dispatched
  // here so the walk below stays exactly as it was for the software it
  // already handles correctly (Mastodon-family), rather than growing a
  // software check into its own body.
  let domain: string;
  try {
    domain = new URL(post.remoteId).host;
  } catch {
    return;
  }
  const software = await fetchInstanceSoftware(domain);

  if (software === "Lemmy") {
    const postId = post.remoteId.split("/").filter(Boolean).pop();
    if (postId) await syncLemmyFamilyReplies(post, domain, postId, "/api/v3/comment/list", "content", signAs, budget);
    return;
  }
  if (software === "Piefed") {
    const match = post.remoteId.match(/\/p\/(\d+)(?:\/|$)/);
    if (match) await syncLemmyFamilyReplies(post, domain, match[1], "/api/alpha/comment/list", "body", signAs, budget);
    return;
  }
  if (software === "PeerTube") {
    const fetched = await withTimeout(fetchRemoteObject(post.remoteId, signAs), FETCH_TIMEOUT_MS).catch(() => null);
    const commentsUrl = typeof fetched?.comments === "string" ? fetched.comments : undefined;
    if (commentsUrl) await syncPeertubeReplies(post, commentsUrl, signAs, budget);
    return;
  }
  if (software === "Pixelfed") {
    const server = await prisma.exploreServer.findUnique({ where: { domain }, select: { oauthAccessToken: true } });
    const statusId = post.remoteId.split("/").filter(Boolean).pop();
    if (server?.oauthAccessToken && statusId) {
      await syncPixelfedReplies(post, domain, statusId, server.oauthAccessToken, signAs, budget);
    }
    return;
  }
  if (software === "Loops") {
    const videoId = post.remoteId.split("/").filter(Boolean).pop();
    if (videoId) await syncLoopsReplies(post, domain, videoId, budget);
    return;
  }

  const deadline = Date.now() + budget.deadlineMs;
  const queue: { iri: string; parentCommentId: string | null; depth: number }[] = [
    { iri: post.remoteId, parentCommentId: null, depth: 0 },
  ];
  let resolved = 0;

  while (queue.length > 0 && resolved < budget.maxReplies && Date.now() < deadline) {
    const node = queue.shift()!;
    if (node.depth > budget.maxDepth) continue;

    let fetched: Record<string, unknown> | null;
    try {
      fetched = await withTimeout(fetchRemoteObject(node.iri, signAs), FETCH_TIMEOUT_MS);
    } catch (err) {
      logger.warn({ err, iri: node.iri }, "remote reply sync: fetching a node failed");
      continue;
    }
    if (!fetched) continue;

    const repliesField = fetched.replies as { first?: { items?: unknown; next?: unknown } } | undefined;
    const replyIris = await collectReplyIris(repliesField?.first, signAs, deadline);

    for (const replyIri of replyIris) {
      if (resolved >= budget.maxReplies || Date.now() >= deadline) break;

      const cached = await prisma.comment.findUnique({ where: { remoteId: replyIri }, select: { id: true } });
      if (cached) {
        queue.push({ iri: replyIri, parentCommentId: cached.id, depth: node.depth + 1 });
        continue;
      }

      let replyUrl: URL;
      try {
        replyUrl = new URL(replyIri);
      } catch {
        continue;
      }
      if (await isDomainBlocked(replyUrl.host)) continue;

      let replyNote: Record<string, unknown> | null;
      try {
        replyNote = await withTimeout(fetchRemoteObject(replyIri, signAs), FETCH_TIMEOUT_MS);
      } catch (err) {
        logger.warn({ err, replyIri }, "remote reply sync: fetching a reply failed");
        continue;
      }
      const authorIri = typeof replyNote?.attributedTo === "string" ? replyNote.attributedTo : undefined;
      if (!replyNote || replyNote.type !== "Note" || typeof replyNote.id !== "string" || !authorIri) {
        continue;
      }

      let authorPayload;
      try {
        authorPayload = await withTimeout(fetchRemoteActor(authorIri, signAs), FETCH_TIMEOUT_MS);
      } catch (err) {
        logger.warn({ err, authorIri }, "remote reply sync: fetching the reply's author failed");
        continue;
      }
      if (!authorPayload) continue;
      const author = await upsertRemoteActor(authorPayload);

      const body = toPlainText(typeof replyNote.content === "string" ? replyNote.content : "");
      const comment = await prisma.comment.upsert({
        where: { remoteId: replyNote.id },
        create: {
          remoteId: replyNote.id,
          postId: post.id,
          parentId: node.parentCommentId,
          body,
          authorActorId: author.id,
          createdAt: typeof replyNote.published === "string" ? new Date(replyNote.published) : new Date(),
        },
        update: { body },
        select: { id: true },
      });

      resolved += 1;
      queue.push({ iri: replyIri, parentCommentId: comment.id, depth: node.depth + 1 });
    }
  }
}
