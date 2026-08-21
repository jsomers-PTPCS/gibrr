import { randomUUID } from "node:crypto";
import type { Actor, Post, Comment, Message } from "@prisma/client";
import { actorIri, localDomain, createActorObject, absoluteAssetUrl } from "./localActor.js";
import { originFor } from "./urls.js";
import { extractHashtagTokens } from "./textEntities.js";

const AP_PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
// The browsable web app's origin, not this API's — a Hashtag's `href` is
// meant for a human on the receiving end to click through to, unlike an
// actor/object id (always this API's origin; those are IRIs, not pages).
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

// Activity wrapper ids (Follow/Accept/Undo/Create/Like) only need to be
// unique IRIs — nothing dereferences them in this scope, unlike the Note
// object ids below, which double as the URL the object is actually served
// at (see the content-negotiation branch on GET /posts/:id and
// GET /comments/:id).
function activityIri(): string {
  return `${originFor(localDomain())}/activities/${randomUUID()}`;
}

// Content we cached from elsewhere (post.remoteId set — see the Post
// model's own comment) isn't ours to host at our own URL; replying to or
// liking it needs to target the real remote object, not a URL we made up
// for content we don't actually serve.
export function postObjectIri(post: Pick<Post, "id" | "remoteId">): string {
  return post.remoteId ?? `${originFor(localDomain())}/posts/${post.id}`;
}

export function commentObjectIri(comment: Pick<Comment, "id" | "remoteId">): string {
  return comment.remoteId ?? `${originFor(localDomain())}/comments/${comment.id}`;
}

// Unlike postObjectIri/commentObjectIri, this is never dereferenced by
// anyone — a DM is pushed whole via Create, exactly once, straight into
// the recipient's own DB (see the Message model's own comment). Still
// minted in the same shape for consistency and so a real AP client's
// inReplyTo chain has a stable, well-formed id to point at even though
// this app never serves a GET route for it.
export function messageObjectIri(message: Pick<Message, "id" | "remoteId">): string {
  return message.remoteId ?? `${originFor(localDomain())}/messages/${message.id}`;
}

type ActorHandle = Pick<Actor, "username" | "domain">;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Real AP viewers (Mastodon et al.) render `content` as HTML, not plain
// text — a raw string shows up as a single unbroken line with literal
// "&"/"<" wherever they occur. Blank-line-separated blocks become <p>s, a
// single newline within one becomes <br>. Still no markdown or actual
// #tag/@mention *linkification inside this HTML* — the `tag` array below
// carries the real semantic data a receiving client uses to do its own
// linkifying, matching how Mastodon's own `content` HTML doesn't
// pre-link tags either.
function toHtmlContent(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((block) => block.trim().length > 0)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// Document, not Image/Video — matches what Mastodon (the federation
// partner that matters most for real interop) actually emits and
// expects, keyed off mediaType rather than the AP `type`. At most one
// entry, matching this app's own image-xor-video content model
// (createPostSchema's existing constraint) rather than the up-to-4
// attachments a real Mastodon post can carry.
function postAttachments(post: Pick<Post, "imageUrl" | "videoUrl">): Record<string, unknown>[] {
  if (post.imageUrl) {
    return [{ type: "Document", mediaType: "image/jpeg", url: absoluteAssetUrl(post.imageUrl) }];
  }
  if (post.videoUrl) {
    return [{ type: "Document", mediaType: "video/mp4", url: absoluteAssetUrl(post.videoUrl) }];
  }
  return [];
}

// Hashtags come straight from the post's own body — pure, no I/O, safe
// to compute here. Mentions need resolving to real Actor rows first
// (webfinger for a remote handle, federation/mentions.ts), which needs
// I/O this function deliberately doesn't do — callers (routes/posts.ts)
// resolve them first and pass the results in.
function postTags(post: Pick<Post, "body">, mentionedActors: ActorHandle[]): Record<string, unknown>[] {
  const hashtags = post.body ? extractHashtagTokens(post.body) : [];
  return [
    ...hashtags.map((tag) => ({
      type: "Hashtag",
      href: `${WEB_ORIGIN}/tag/${tag}`,
      name: `#${tag}`,
    })),
    ...mentionedActors.map((actor) => ({
      type: "Mention",
      href: actorIri(actor),
      name: `@${actor.username}@${actor.domain}`,
    })),
  ];
}

// `to`/`cc` vary by a personal note's visibility (community posts are
// always "public" — see the Post.visibility schema comment) — this is
// the one place that addressing gets decided, so every visibility tier
// only needs to be gotten right here, not at every call site:
//   - public: unchanged, to: [Public], cc: [followers, mentions].
//   - followers: to: [followersIri] only — never Public anywhere, same
//     convention Mastodon uses for a followers-only post.
//   - specified: to: [...recipientActors] only, no cc — mirrors how a
//     private federated DM already addresses its Create.
//   - local_only: to: [] — it's never actually delivered anywhere (see
//     POST /posts), so this is mostly for internal consistency; no real
//     interop convention exists for "local-only" since by definition it
//     doesn't federate.
// `recipientActors` is only meaningful for "specified" and is only ever
// populated at creation time (routes/posts.ts) — re-serving an existing
// object (GET /posts/:id's content-negotiated branch, the outbox) never
// needs it because hasPostAccess already 404s an unsigned/unauthorized
// fetch of a non-public personal note before this function is reached.
export function createNoteFromPost(
  post: Post & { pollOptions?: { text: string; _count: { votes: number } }[] },
  author: ActorHandle,
  mentionedActors: ActorHandle[] = [],
  recipientActors: ActorHandle[] = [],
): Record<string, unknown> {
  const from = actorIri(author);
  const id = postObjectIri(post);
  // No title on a locally-authored post with none set, or on anything
  // we're re-serving that arrived title-less over federation.
  const titleHtml = post.title ? `<p><strong>${escapeHtml(post.title)}</strong></p>` : "";
  const attachment = postAttachments(post);
  const tag = postTags(post, mentionedActors);

  // A poll federates as a Question, not a Note — the real Mastodon/
  // Misskey wire format. oneOf (single-select) vs anyOf (multi-select)
  // is the actual AP distinction; a vote is a reply Create(Note) whose
  // `name` matches the chosen option (see voteActivity below and
  // routes/inbox.ts's processIncomingNote), not a separate activity
  // type — the spec doesn't have one.
  const pollOptions = post.pollOptions;
  const pollFields = pollOptions?.length
    ? {
        [post.pollMultiple ? "anyOf" : "oneOf"]: pollOptions.map((o) => ({
          type: "Note",
          name: o.text,
          replies: { type: "Collection", totalItems: o._count.votes },
        })),
        ...(post.pollExpiresAt ? { endTime: post.pollExpiresAt.toISOString() } : {}),
      }
    : {};

  const addressing =
    post.communityId !== null || post.visibility === "public"
      ? {
          to: [AP_PUBLIC],
          // Mentioned actors are addressed directly, not just
          // followers — a receiving Mastodon-style client uses cc/to
          // (not just the separate direct-inbox delivery) to decide
          // this is "a mention," not just an ordinary public post.
          cc: [`${from}/followers`, ...mentionedActors.map((a) => actorIri(a))],
        }
      : post.visibility === "followers"
        ? { to: [`${from}/followers`], cc: mentionedActors.map((a) => actorIri(a)) }
        : post.visibility === "specified"
          ? { to: recipientActors.map((a) => actorIri(a)), cc: [] }
          : { to: [], cc: [] }; // local_only

  return {
    id,
    type: pollOptions?.length ? "Question" : "Note",
    attributedTo: from,
    mediaType: "text/html",
    content: post.body ? titleHtml + toHtmlContent(post.body) : titleHtml || toHtmlContent(""),
    url: id,
    published: post.createdAt.toISOString(),
    ...addressing,
    // The AP `summary` field on a Note is, despite the name, the
    // content-warning text shown before the real content — real
    // Mastodon/Friendica convention, not this app inventing a field.
    ...(post.contentWarning ? { summary: post.contentWarning, sensitive: true } : {}),
    ...(attachment.length > 0 ? { attachment } : {}),
    ...(tag.length > 0 ? { tag } : {}),
    ...pollFields,
  };
}

export function createNoteFromComment(
  comment: Comment,
  author: ActorHandle,
  parentPost: Pick<Post, "id" | "remoteId">,
): Record<string, unknown> {
  const from = actorIri(author);
  const id = commentObjectIri(comment);
  return {
    id,
    type: "Note",
    attributedTo: from,
    mediaType: "text/html",
    content: toHtmlContent(comment.body),
    url: id,
    published: comment.createdAt.toISOString(),
    // Points at the real remote post if we're replying to cached
    // federated content, not a URL we invented for something we don't
    // actually host — see postObjectIri.
    inReplyTo: postObjectIri(parentPost),
    to: [AP_PUBLIC],
    cc: [`${from}/followers`],
  };
}

// A DM — the real AP shape for a direct message is just an ordinary
// Note addressed privately: `to` names the recipient only, no Public
// collection anywhere in to/cc (that absence is exactly what a
// receiving Mastodon-style server uses to classify it as a DM rather
// than a public post). previousMessageIri, when given, chains inReplyTo
// to the prior message in the same conversation — real AP DM-threading
// convention, purely for the receiving client's own display; this app's
// own conversation routing never depends on it (see routes/inbox.ts).
export function createNoteFromMessage(
  message: Pick<Message, "id" | "remoteId" | "body" | "createdAt">,
  sender: ActorHandle,
  recipientActorIri: string,
  previousMessageIri?: string,
): Record<string, unknown> {
  const from = actorIri(sender);
  const id = messageObjectIri(message);
  return {
    id,
    type: "Note",
    attributedTo: from,
    mediaType: "text/html",
    content: toHtmlContent(message.body),
    url: id,
    published: message.createdAt.toISOString(),
    to: [recipientActorIri],
    ...(previousMessageIri ? { inReplyTo: previousMessageIri } : {}),
  };
}

// Wraps a Note (from createNoteFromPost/createNoteFromComment) in the
// Create activity that actually gets delivered.
export function createActivity(note: Record<string, unknown>, author: ActorHandle): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${note.id}#create`,
    type: "Create",
    actor: actorIri(author),
    object: note,
    to: note.to,
    cc: note.cc,
    published: note.published,
  };
}

// Wraps a refreshed Note (from createNoteFromPost) the same way
// createActivity wraps a new one — sent when an author edits their own
// post. Gets its own random id (activityIri()) rather than reusing the
// note's, same as every other activity wrapper here.
export function updateActivity(note: Record<string, unknown>, author: ActorHandle): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Update",
    actor: actorIri(author),
    object: note,
    to: note.to,
    cc: note.cc,
    published: new Date().toISOString(),
  };
}

// A Tombstone object, not a bare IRI — matches how real servers send
// Delete, and parses the same way the existing
// `typeof object === "string" ? object : object.id` shape elsewhere in
// routes/inbox.ts already expects.
export function deleteActivity(actor: Actor, objectIri: string): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Delete",
    actor: actorIri(actor),
    object: { id: objectIri, type: "Tombstone" },
    to: [AP_PUBLIC],
  };
}

// Delivered on a profile or group edit (routes/profile.ts,
// routes/profileImage.ts, routes/communities.ts) — a distinct builder
// from updateActivity above rather than a reuse of it, since that one
// wraps a Note-shaped object and this wraps the actor's own full Actor
// object (createActorObject), a different AP object type entirely.
export function updateActorActivity(actor: Actor): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Update",
    actor: actorIri(actor),
    object: createActorObject(actor),
    to: [AP_PUBLIC],
    published: new Date().toISOString(),
  };
}

// A poll vote — a reply Create(Note) whose `name` matches the chosen
// option, addressed only to the poll's author. This is the actual AP
// poll-voting convention (Mastodon, Misskey, Pleroma all use it) —
// there's no separate "vote" activity type in the spec. Like
// messageObjectIri, the reply Note's own id is never dereferenced by
// anyone (routes/inbox.ts's processIncomingNote reads inReplyTo/name
// straight off the activity, not by re-fetching this id), so it just
// needs to be well-formed, not actually served.
export function voteActivity(
  actor: Actor,
  pollObjectIri: string,
  pollAuthorIri: string,
  optionText: string,
): Record<string, unknown> {
  const from = actorIri(actor);
  const noteId = `${originFor(localDomain())}/poll-votes/${randomUUID()}`;
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Create",
    actor: from,
    to: [pollAuthorIri],
    object: {
      id: noteId,
      type: "Note",
      name: optionText,
      attributedTo: from,
      inReplyTo: pollObjectIri,
      to: [pollAuthorIri],
      published: new Date().toISOString(),
    },
  };
}

export function likeActivity(actor: Actor, objectIri: string): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Like",
    actor: actorIri(actor),
    object: objectIri,
  };
}

// An emoji reaction, structurally a Like carrying `content` — the
// Mastodon/Pleroma-compatible custom-emoji-reaction convention (broadly
// interoperable), not Misskey's own proprietary EmojiReact activity
// type. `content` is either a raw unicode emoji or a ":shortcode:"; when
// it's a custom emoji, `customEmojiImageUrl` gets attached as a `tag`
// (AP `Emoji` object) so a receiving server that understands this
// convention can render the actual image, not just the shortcode text.
// A server that doesn't recognize any of this just sees an ordinary
// Like, same graceful-degradation posture as every other AP extension
// this app uses.
export function reactActivity(
  actor: Actor,
  objectIri: string,
  emoji: string,
  customEmojiImageUrl?: string,
): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Like",
    actor: actorIri(actor),
    object: objectIri,
    content: emoji,
    ...(customEmojiImageUrl
      ? { tag: [{ type: "Emoji", name: emoji, icon: { type: "Image", url: customEmojiImageUrl } }] }
      : {}),
  };
}

export function announceActivity(actor: Actor, objectIri: string): Record<string, unknown> {
  const from = actorIri(actor);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Announce",
    actor: from,
    object: objectIri,
    to: [AP_PUBLIC],
    cc: [`${from}/followers`],
    published: new Date().toISOString(),
  };
}

export function undoAnnounceActivity(actor: Actor, objectIri: string): Record<string, unknown> {
  const from = actorIri(actor);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Undo",
    actor: from,
    object: {
      type: "Announce",
      actor: from,
      object: objectIri,
    },
  };
}

export function followActivity(actor: Actor, targetIri: string): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Follow",
    actor: actorIri(actor),
    object: targetIri,
  };
}

export function acceptActivity(
  actor: Actor,
  followActivityObject: Record<string, unknown>,
): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Accept",
    actor: actorIri(actor),
    object: followActivityObject,
  };
}

export function undoFollowActivity(actor: Actor, targetIri: string): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Undo",
    actor: actorIri(actor),
    object: {
      type: "Follow",
      actor: actorIri(actor),
      object: targetIri,
    },
  };
}

// Informational — most receivers don't enforce anything from a received
// Block, but real servers do log/act on it, and sending one is correct
// AP behavior. Our own enforcement of a block is entirely local-side
// (routes/blocks.ts, routes/posts.ts's listing exclusions, routes/inbox.ts's
// per-activity blocked-sender checks) — this activity doesn't carry any
// of that, it just tells the target server what happened.
export function blockActivity(actor: Actor, targetIri: string): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Block",
    actor: actorIri(actor),
    object: targetIri,
  };
}

// The real Mastodon wire shape for a cross-instance report: `object` is
// an array — the reported actor's IRI, plus the specific content IRI
// when the report is about one post/comment rather than the actor in
// general — and `content` carries the reporter's reason text. Delivered
// to the reported actor's own inbox (routes/reports.ts), same as any
// other activity concerning them.
export function flagActivity(
  actor: Actor,
  targetActorIri: string,
  contentIri: string | null,
  reason: string,
): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityIri(),
    type: "Flag",
    actor: actorIri(actor),
    object: contentIri ? [targetActorIri, contentIri] : [targetActorIri],
    content: reason,
  };
}
