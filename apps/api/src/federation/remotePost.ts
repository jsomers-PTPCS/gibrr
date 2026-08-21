import type { Actor } from "@prisma/client";
import { prisma } from "../db.js";
import { localDomain } from "./localActor.js";
import { fetchRemoteActor, fetchRemoteObject, upsertRemoteActor } from "./remoteActor.js";
import { toPlainText } from "./plainText.js";
import { extractHashtagTokens } from "./textEntities.js";
import { isDomainBlocked } from "./domainBlocks.js";

// The AP `summary` field on a Note is, despite the name, the content-
// warning text — see federation/activities.ts's createNoteFromPost,
// which is the outgoing half of this same convention.
export function parseContentWarning(note: Record<string, unknown>): string | null {
  return typeof note.summary === "string" && note.summary.trim().length > 0 ? note.summary : null;
}

// Parses an incoming Note's `attachment` field into imageUrl/videoUrl —
// tolerant of both shapes real servers send (a single object, or the
// array Mastodon actually uses). Takes the first entry whose mediaType
// is an image or video and drops the rest — this app's own posts can
// only ever have one or the other (createPostSchema's existing
// image-xor-video constraint), so there's nothing useful to do with a
// real Mastodon post's up-to-4 attachments beyond picking the first.
export function parseAttachmentMedia(
  note: Record<string, unknown>,
): { imageUrl: string | null; videoUrl: string | null } {
  const raw = note.attachment;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { mediaType, url } = item as { mediaType?: unknown; url?: unknown };
    if (typeof url !== "string" || typeof mediaType !== "string") continue;
    if (mediaType.startsWith("image/")) return { imageUrl: url, videoUrl: null };
    if (mediaType.startsWith("video/")) return { imageUrl: null, videoUrl: url };
  }
  return { imageUrl: null, videoUrl: null };
}

// Resolves any post IRI — ours or a remote server's — to a local Post
// id, fetching and caching it if we don't already have it. Originally
// written for routes/inbox.ts's processIncomingAnnounce (an Announce's
// object is often something we've never seen), now shared with
// routes/posts.ts's GET /posts/resolve (a user pasting a remote post's
// URL to view/reply/like it) — same "fetch once, cache under remoteId,
// reuse forever" logic either way.
//
// Three cases: (1) iri is one of our own /posts/:id URLs — no network
// fetch, just the row itself; (2) already cached (Post.remoteId match)
// — reuse it; (3) genuinely new — fetchRemoteObject, resolve/cache the
// author via fetchRemoteActor+upsertRemoteActor, cache the post. Returns
// null if the IRI doesn't resolve to a real Note (or resolves to
// nothing at all — a dead link, a deleted post, an unreachable server).
export async function resolveAndCacheRemotePost(
  iri: string,
  signAs?: Pick<Actor, "username" | "domain" | "privateKey">,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(iri);
  } catch {
    return null;
  }

  if (url.host === localDomain()) {
    const [kind, id] = url.pathname.split("/").filter(Boolean);
    if (kind !== "posts" || !id) return null;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
    return post?.id ?? null;
  }

  const cached = await prisma.post.findUnique({ where: { remoteId: iri }, select: { id: true } });
  if (cached) return cached.id;

  // A blocked domain can't be freshly *pulled* from either — "paste a
  // URL to view it" is otherwise a backdoor around inbox rejection
  // (routes/inbox.ts) for the exact same content. Already-cached posts
  // from a domain blocked after the fact aren't purged (see
  // DomainBlock's own comment), same disclosed limitation everywhere
  // else this block is enforced.
  if (await isDomainBlocked(url.host)) return null;

  const fetched = await fetchRemoteObject(iri, signAs);
  const authorIri = typeof fetched?.attributedTo === "string" ? fetched.attributedTo : undefined;
  if (!fetched || fetched.type !== "Note" || typeof fetched.id !== "string" || !authorIri) {
    return null;
  }

  const authorPayload = await fetchRemoteActor(authorIri, signAs);
  if (!authorPayload) return null;
  const author = await upsertRemoteActor(authorPayload);

  const body = toPlainText(typeof fetched.content === "string" ? fetched.content : "");
  const post = await prisma.post.upsert({
    where: { remoteId: fetched.id },
    create: {
      remoteId: fetched.id,
      title: null,
      body,
      authorActorId: author.id,
      communityId: null,
      createdAt: typeof fetched.published === "string" ? new Date(fetched.published) : new Date(),
      hashtags: extractHashtagTokens(body),
      contentWarning: parseContentWarning(fetched),
      ...parseAttachmentMedia(fetched),
    },
    update: {},
    select: { id: true },
  });
  return post.id;
}
