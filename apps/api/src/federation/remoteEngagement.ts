import type { Actor } from "@prisma/client";
import { prisma } from "../db.js";
import { fetchRemoteActor, fetchRemoteObject, upsertRemoteActor } from "./remoteActor.js";
import { toPlainText } from "./plainText.js";
import { isDomainBlocked } from "./domainBlocks.js";
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

// The real, origin-server-reported counts for a cached remote post — never
// stored (the whole point is "current", not a stale snapshot), so this is
// called fresh on every GET /posts/:id for a federated post. Mastodon-shaped
// software puts these directly on the Note object itself (confirmed live:
// likes.totalItems/shares.totalItems match the REST API's
// favourites_count/reblogs_count exactly) — same request federation already
// depends on for interop, not a bespoke REST call like mastodonExplore.ts's.
// Missing/malformed fields degrade to null per-field rather than failing
// the whole lookup — plenty of AP software doesn't populate these at all.
export async function fetchLiveCounts(
  noteIri: string,
  signAs?: SignAs,
): Promise<{ likes: number | null; shares: number | null } | null> {
  try {
    const fetched = await withTimeout(fetchRemoteObject(noteIri, signAs), FETCH_TIMEOUT_MS);
    if (!fetched) return null;
    const likes = (fetched.likes as { totalItems?: unknown } | undefined)?.totalItems;
    const shares = (fetched.shares as { totalItems?: unknown } | undefined)?.totalItems;
    return {
      likes: typeof likes === "number" ? likes : null,
      shares: typeof shares === "number" ? shares : null,
    };
  } catch (err) {
    logger.warn({ err, noteIri }, "fetching live remote engagement counts failed");
    return null;
  }
}

interface SyncBudget {
  maxReplies: number;
  maxDepth: number;
  deadlineMs: number;
}

const DEFAULT_BUDGET: SyncBudget = { maxReplies: 40, maxDepth: 4, deadlineMs: 15_000 };

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

    const repliesField = fetched.replies as { first?: { items?: unknown } } | undefined;
    const items = repliesField?.first?.items;
    const replyIris = (Array.isArray(items) ? items : []).filter(
      (item): item is string => typeof item === "string",
    );

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
