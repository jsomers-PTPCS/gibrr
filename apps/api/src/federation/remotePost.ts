import type { Actor } from "@prisma/client";
import { prisma } from "../db.js";
import { localDomain } from "./localActor.js";
import { fetchRemoteActor, fetchRemoteObject, upsertRemoteActor } from "./remoteActor.js";
import { toPlainText } from "./plainText.js";
import { extractHashtagTokens } from "./textEntities.js";
import { isDomainBlocked } from "./domainBlocks.js";

// The AP `summary` field on a Note is, despite the name, the content-
// warning text — see federation/activities.ts's createNoteFromPost,
// which is the outgoing half of this same convention. That's a
// Mastodon-family convention, not a universal AP one — the base AS2
// spec defines `summary` as a plain natural-language summary of the
// object, and confirmed live that both Ghost's Article.summary (its
// post excerpt) and Mobilizon's Event.summary (an auto-generated
// date/venue blurb) always populate it that way, unrelated to
// sensitivity. Callers must not apply this to Article/Event objects,
// or every Ghost post and Mobilizon event gets wrongly hidden behind a
// spoiler. PeerTube's Video and Lemmy's Page were also checked live and
// leave `summary` unset, so they're unaffected either way.
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
    const { mediaType, type, url } = item as { mediaType?: unknown; type?: unknown; url?: unknown };
    if (typeof url !== "string") continue;
    // Mastodon/Loops/etc. give a real MIME type (image/jpeg,
    // video/mp4); Lemmy's own attachment shape (confirmed live) omits
    // mediaType entirely and only has the plain AS2 object `type`
    // (Image/Video/Document) instead — check both rather than assuming
    // either one is always present.
    const kind = typeof mediaType === "string" ? mediaType : typeof type === "string" ? type : "";
    if (kind.toLowerCase().startsWith("image")) return { imageUrl: url, videoUrl: null };
    if (kind.toLowerCase().startsWith("video")) return { imageUrl: null, videoUrl: url };
  }
  return { imageUrl: null, videoUrl: null };
}

// PeerTube's Video object doesn't fit parseAttachmentMedia's shape at
// all — confirmed live: the playable file lives in a `url` array of
// Link objects (keyed `href`, not `url`) alongside torrent/HLS/metadata
// variants for the same video, and the thumbnail is a *separate* `icon`
// array of Image objects (keyed `url` there, unlike its sibling
// `attachment` field elsewhere in this app). Picks the first plain
// video/mp4 Link — good enough for playback, not an attempt at
// resolution/bitrate selection — and the first icon for the thumbnail.
function parsePeerTubeMedia(fetched: Record<string, unknown>): { imageUrl: string | null; videoUrl: string | null } {
  const links = Array.isArray(fetched.url) ? fetched.url : [];
  const videoLink = links.find(
    (link) =>
      typeof link === "object" &&
      link !== null &&
      (link as { mediaType?: unknown }).mediaType === "video/mp4" &&
      typeof (link as { href?: unknown }).href === "string",
  ) as { href: string } | undefined;

  const icons = Array.isArray(fetched.icon) ? fetched.icon : fetched.icon ? [fetched.icon] : [];
  const icon = icons.find(
    (item) => typeof item === "object" && item !== null && typeof (item as { url?: unknown }).url === "string",
  ) as { url: string } | undefined;

  return { imageUrl: icon?.url ?? null, videoUrl: videoLink?.href ?? null };
}

// Every AP object type this app can turn into a cached Post — a plain
// microblog Note (Mastodon/Misskey/Loops/Pleroma/etc, all identical
// shape) plus, since the Explore feature grew software-specific
// fetchers, a few real content types confirmed live against real
// servers: Lemmy's Page (link/community posts), PeerTube's Video,
// Ghost's Article (long-form posts), and Mobilizon's Event. Each gets a
// small type-specific field mapping below rather than a parallel
// resolver per type, so every caller (inbox processing, GET
// /posts/resolve, the Explore sweep) keeps going through this one
// "fetch once, cache under remoteId, reuse forever" entry point
// regardless of which software the content came from.
const SUPPORTED_OBJECT_TYPES = new Set(["Note", "Page", "Video", "Article", "Event"]);

// Almost every platform's attributedTo is a plain actor IRI string —
// PeerTube is the one confirmed exception, an array mixing the actual
// uploader (type: "Person") with the channel/Group they posted through;
// this picks the Person, never the channel.
function resolveAuthorIri(attributedTo: unknown): string | undefined {
  if (typeof attributedTo === "string") return attributedTo;
  if (Array.isArray(attributedTo)) {
    const person = attributedTo.find(
      (entry) => typeof entry === "object" && entry !== null && (entry as { type?: unknown }).type === "Person",
    ) as { id?: unknown } | undefined;
    return typeof person?.id === "string" ? person.id : undefined;
  }
  return undefined;
}

// Resolves any post IRI — ours or a remote server's — to a local Post
// id, fetching and caching it if we don't already have it. Originally
// written for routes/inbox.ts's processIncomingAnnounce (an Announce's
// object is often something we've never seen), now shared with
// routes/posts.ts's GET /posts/resolve (a user pasting a remote post's
// URL to view/reply/like it) and federation/exploreSweep.ts — same
// "fetch once, cache under remoteId, reuse forever" logic either way.
//
// Three cases: (1) iri is one of our own /posts/:id URLs — no network
// fetch, just the row itself; (2) already cached (Post.remoteId match)
// — reuse it; (3) genuinely new — fetchRemoteObject, resolve/cache the
// author via fetchRemoteActor+upsertRemoteActor, cache the post. Returns
// null if the IRI doesn't resolve to a real, supported object type (or
// resolves to nothing at all — a dead link, a deleted post, an
// unreachable server).
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
  const type = typeof fetched?.type === "string" ? fetched.type : undefined;
  const authorIri = fetched ? resolveAuthorIri(fetched.attributedTo) : undefined;
  if (!fetched || !type || !SUPPORTED_OBJECT_TYPES.has(type) || typeof fetched.id !== "string" || !authorIri) {
    return null;
  }

  const authorPayload = await fetchRemoteActor(authorIri, signAs);
  if (!authorPayload) return null;
  const author = await upsertRemoteActor(authorPayload);

  const body = toPlainText(typeof fetched.content === "string" ? fetched.content : "");
  // A plain Note (Mastodon-family, Misskey, Loops) never has a title —
  // everything else does (name), same field every one of these
  // software's own real objects was confirmed to use.
  const title = type !== "Note" && typeof fetched.name === "string" ? fetched.name : null;

  // Ghost's Article carries its image as a bare string, not the
  // attachment-array shape every other platform here uses — confirmed
  // live. parseAttachmentMedia already handles Note/Page's real shape
  // unchanged.
  const media =
    type === "Article"
      ? { imageUrl: typeof fetched.image === "string" ? fetched.image : null, videoUrl: null }
      : type === "Video"
        ? parsePeerTubeMedia(fetched)
        : parseAttachmentMedia(fetched);

  // Mobilizon's Event maps directly onto the same eventStart/eventEnd/
  // eventLocation fields this app already has for its own native event
  // posts — confirmed live shape: startTime/endTime as plain ISO
  // strings, location as a nested Place object whose own `name` is the
  // human-readable venue (a full postal address is also there, under
  // location.address, but the venue name is the honest match for this
  // app's single free-text eventLocation field).
  const eventFields =
    type === "Event"
      ? {
          eventStart: typeof fetched.startTime === "string" ? new Date(fetched.startTime) : null,
          eventEnd: typeof fetched.endTime === "string" ? new Date(fetched.endTime) : null,
          eventLocation:
            typeof (fetched.location as { name?: unknown } | undefined)?.name === "string"
              ? (fetched.location as { name: string }).name
              : null,
        }
      : {};

  const post = await prisma.post.upsert({
    where: { remoteId: fetched.id },
    create: {
      remoteId: fetched.id,
      title,
      body,
      authorActorId: author.id,
      communityId: null,
      createdAt: typeof fetched.published === "string" ? new Date(fetched.published) : new Date(),
      hashtags: extractHashtagTokens(body),
      ...eventFields,
      contentWarning: type === "Event" || type === "Article" ? null : parseContentWarning(fetched),
      ...media,
    },
    update: {},
    select: { id: true },
  });
  return post.id;
}
