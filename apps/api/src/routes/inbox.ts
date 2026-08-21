import { Router } from "express";
import type { Request, Response } from "express";
import type { Actor } from "@prisma/client";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../db.js";
import { verifySignedRequest } from "../federation/httpSignature.js";
import { fetchRemoteActor, upsertRemoteActor } from "../federation/remoteActor.js";
import { deliverActivity } from "../federation/deliver.js";
import { acceptActivity } from "../federation/activities.js";
import { localDomain } from "../federation/localActor.js";
import { toPlainText } from "../federation/plainText.js";
import { extractHashtagTokens } from "../federation/textEntities.js";
import { parseContentWarning, parseAttachmentMedia, resolveAndCacheRemotePost } from "../federation/remotePost.js";
import { deletePosts, deleteCommentSubtree } from "../deletion.js";
import { isDomainBlocked } from "../federation/domainBlocks.js";

export const inboxRouter = Router();

// IP-keyed (the library's default) rather than actor-keyed — HTTP
// signature verification inside each handler already establishes sender
// *identity*; this is about request *volume*, which is inherently a
// network-level concern a flood can generate before a signature is even
// checked (each request still costs a DB lookup + crypto verification
// regardless of outcome). 120/minute is well above legitimate delivery
// volume for a demo-scale instance — this exists to blunt a flood, not
// to throttle real federation traffic.
const inboxRateLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });

interface InboxResult {
  status: number;
  body?: unknown;
}

type LocalObjectRef =
  | { kind: "post"; postId: string }
  | { kind: "comment"; postId: string; commentId: string };

// Resolves an object IRI to something we actually host — used for both
// incoming replies (inReplyTo) and incoming likes (object). An IRI that
// doesn't point at our own domain, or points at something we don't have,
// resolves to null; there's nothing to attach the activity to.
async function resolveLocalObject(iri: string): Promise<LocalObjectRef | null> {
  let url: URL;
  try {
    url = new URL(iri);
  } catch {
    return null;
  }
  if (url.host !== localDomain()) return null;

  const [kind, id] = url.pathname.split("/").filter(Boolean);
  if (kind === "posts" && id) {
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
    return post ? { kind: "post", postId: post.id } : null;
  }
  if (kind === "comments" && id) {
    const comment = await prisma.comment.findUnique({ where: { id }, select: { id: true, postId: true } });
    return comment ? { kind: "comment", postId: comment.postId, commentId: comment.id } : null;
  }
  return null;
}

// Local actor ids mentioned in the Note's `tag` array — a targeted
// @mention is self-limiting the same way a reply's inReplyTo is (it
// names a specific recipient that either exists on this instance or
// doesn't), so it's exempt from the top-level-post follow-gate below the
// same way a reply already is. Without this, a mention from someone the
// mentioned user doesn't yet follow would be silently dropped, which
// defeats the entire point of federation/activities.ts's
// createNoteFromPost addressing mentioned actors directly via cc.
async function mentionedLocalActorIds(note: Record<string, unknown>): Promise<string[]> {
  const raw = note.tag;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const ids: string[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { type, href } = item as { type?: unknown; href?: unknown };
    if (type !== "Mention" || typeof href !== "string") continue;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.host !== localDomain()) continue;
    const [kind, username] = url.pathname.split("/").filter(Boolean);
    if (kind !== "users" || !username) continue;
    const actor = await prisma.actor.findFirst({
      where: { username, domain: localDomain() },
      select: { id: true },
    });
    if (actor) ids.push(actor.id);
  }
  return ids;
}

const AP_PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function addressedIris(note: Record<string, unknown>): string[] {
  const merge = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
  return [...merge(note.to), ...merge(note.cc)];
}

// A Note with no Public collection anywhere in to/cc is exactly how a
// real AP client (and this app's own federation/activities.ts's
// createNoteFromMessage) marks something as privately addressed rather
// than a public post — the same absence Mastodon uses to classify a DM.
function isPubliclyAddressed(note: Record<string, unknown>): boolean {
  return addressedIris(note).some((iri) => iri === AP_PUBLIC || iri === "Public" || iri === "as:Public");
}

// Local actor ids named directly in the Note's `to` — the DM
// counterpart to mentionedLocalActorIds below, which reads `tag`
// instead. A note addressing more than one local actor (unusual, but
// possible) resolves all of them; the caller picks the first as the
// recipient, matching this app's Conversation model, which is strictly
// 1:1 everywhere (no group DMs).
async function directMessageRecipientLocalActorIds(note: Record<string, unknown>): Promise<string[]> {
  const toIris = Array.isArray(note.to)
    ? note.to.filter((x): x is string => typeof x === "string")
    : typeof note.to === "string"
      ? [note.to]
      : [];
  const ids: string[] = [];
  for (const iri of toIris) {
    let url: URL;
    try {
      url = new URL(iri);
    } catch {
      continue;
    }
    if (url.host !== localDomain()) continue;
    const [kind, username] = url.pathname.split("/").filter(Boolean);
    if (kind !== "users" || !username) continue;
    const actor = await prisma.actor.findFirst({ where: { username, domain: localDomain() }, select: { id: true } });
    if (actor) ids.push(actor.id);
  }
  return ids;
}

// The receiving half of a federated DM (routes/conversations.ts's
// outgoing delivery). No follow-gate — same reasoning as a reply or a
// mention: a message addressed to a specific known recipient is
// self-limiting, not unsolicited broadcast. Routes purely by the
// (local actor, remote sender) participant pair — this app's
// Conversation model is already strictly 1:1 everywhere (POST
// /conversations's own existing-conversation check enforces
// participants.length === 2), so this is fully correct without ever
// needing to resolve inReplyTo for conversation matching, unlike a
// reply to a post/comment.
async function processIncomingDirectMessage(
  remote: Actor,
  recipientLocalActorId: string,
  remoteId: string,
  body: string,
  createdAt: Date,
): Promise<void> {
  if (await isBlockedBy(recipientLocalActorId, remote.id)) {
    console.log(`[inbox] dropped a DM from ${remote.username}@${remote.domain} (blocked)`);
    return;
  }

  const existing = await prisma.conversation.findFirst({
    where: {
      participants: { some: { actorId: recipientLocalActorId } },
      AND: { participants: { some: { actorId: remote.id } } },
    },
    include: { participants: true },
  });

  const conversation =
    existing && existing.participants.length === 2
      ? existing
      : await prisma.$transaction(async (tx) => {
          const conv = await tx.conversation.create({ data: {} });
          await tx.conversationParticipant.createMany({
            data: [
              { conversationId: conv.id, actorId: recipientLocalActorId },
              { conversationId: conv.id, actorId: remote.id },
            ],
          });
          return conv;
        });

  await prisma.message.upsert({
    where: { remoteId },
    create: { remoteId, conversationId: conversation.id, senderActorId: remote.id, body, createdAt },
    update: { body },
  });
  console.log(`[inbox] ${remote.username}@${remote.domain} sent a DM`);
}

// True if `local` (a local actor id) has blocked `remoteId` — checked
// alongside the existing follow-gate/author-match checks in
// processIncomingNote/Like so a blocked sender's Follow/reply/Like/
// mention doesn't reach the person who blocked them, even though
// blocking already removes any Follow row between the two (see
// routes/blocks.ts).
async function isBlockedBy(local: string, remoteId: string): Promise<boolean> {
  const block = await prisma.block.findUnique({
    where: { blockerId_blockedId: { blockerId: local, blockedId: remoteId } },
  });
  return block !== null;
}

// A reply is self-limiting (its inReplyTo has to resolve to something we
// actually host — nobody can forge one into existence) so it's accepted
// regardless of the follow graph, matching how public replies work
// everywhere. A top-level note has no such natural limit, so it's only
// accepted from someone at least one local actor actually follows —
// without this, anyone on the fediverse could push arbitrary posts into a
// stranger's home timeline. Not tied to a specific `targetActor`: once
// cached, the post is visible to *every* local follower of its author via
// GET /home, not just whoever the delivery happened to be addressed to —
// which also means this works correctly however the activity arrives
// (per-actor inbox or shared).
async function processIncomingNote(remote: Actor, note: Record<string, unknown>): Promise<void> {
  const remoteId = typeof note.id === "string" ? note.id : undefined;
  if (!remoteId) return;
  const body = toPlainText(typeof note.content === "string" ? note.content : "");
  const createdAt = typeof note.published === "string" ? new Date(note.published) : new Date();
  const inReplyTo = typeof note.inReplyTo === "string" ? note.inReplyTo : undefined;

  // Resolved first, ahead of the DM check below: a real reply to one of
  // our posts/comments takes priority regardless of its addressing
  // privacy (a followers-only reply still has inReplyTo pointing at
  // real content we host) — only once inReplyTo fails to resolve to
  // anything we host do we consider this might be a DM instead.
  const parent = inReplyTo ? await resolveLocalObject(inReplyTo) : null;

  if (inReplyTo && parent) {
    const parentAuthorId =
      parent.kind === "post"
        ? (await prisma.post.findUnique({ where: { id: parent.postId }, select: { authorActorId: true } }))
            ?.authorActorId
        : (await prisma.comment.findUnique({ where: { id: parent.commentId }, select: { authorActorId: true } }))
            ?.authorActorId;
    if (parentAuthorId && (await isBlockedBy(parentAuthorId, remote.id))) {
      console.log(`[inbox] dropped a reply from ${remote.username}@${remote.domain} (blocked)`);
      return;
    }

    // A poll vote is itself a reply Create(Note) whose `name` matches
    // one of the poll's option texts (federation/activities.ts's
    // voteActivity) — has to be checked here, before this reply falls
    // through to the generic Comment path below, or every incoming vote
    // would get cached as a junk reply comment instead of a PollVote.
    if (parent.kind === "post" && typeof note.name === "string") {
      const pollPost = await prisma.post.findUnique({
        where: { id: parent.postId },
        select: { pollMultiple: true, pollOptions: { select: { id: true, text: true } } },
      });
      const option = pollPost?.pollOptions.find((o) => o.text === note.name);
      if (pollPost && option) {
        if (!pollPost.pollMultiple) {
          // Single-select: a vote replaces any previous one, same rule
          // POST /posts/:id/poll-votes enforces for a local voter.
          await prisma.pollVote.deleteMany({
            where: { actorId: remote.id, optionId: { in: pollPost.pollOptions.map((o) => o.id) } },
          });
        }
        await prisma.pollVote.upsert({
          where: { optionId_actorId: { optionId: option.id, actorId: remote.id } },
          create: { optionId: option.id, actorId: remote.id },
          update: {},
        });
        console.log(`[inbox] ${remote.username}@${remote.domain} voted on one of our polls`);
        return;
      }
    }

    await prisma.comment.upsert({
      where: { remoteId },
      create: {
        remoteId,
        postId: parent.postId,
        parentId: parent.kind === "comment" ? parent.commentId : null,
        body,
        authorActorId: remote.id,
        createdAt,
      },
      update: { body },
    });
    console.log(`[inbox] ${remote.username}@${remote.domain} replied to one of our ${parent.kind}s`);
    return;
  }

  // Not a reply to anything we host — check whether it's a DM instead
  // (a first message has no inReplyTo at all; a DM *reply* has one, but
  // it points at a previous message's opaque, undereferencable IRI —
  // federation/activities.ts's messageObjectIri — which never resolves
  // via resolveLocalObject above, so it correctly falls through to here).
  if (!isPubliclyAddressed(note)) {
    const recipientIds = await directMessageRecipientLocalActorIds(note);
    if (recipientIds.length > 0) {
      await processIncomingDirectMessage(remote, recipientIds[0], remoteId, body, createdAt);
      return;
    }
  }

  if (inReplyTo) {
    console.log(`[inbox] dropped a reply to something we don't host: ${inReplyTo}`);
    return;
  }

  const followedByAnyone = await prisma.follow.findFirst({
    where: { followingId: remote.id, state: "accepted", follower: { domain: localDomain() } },
  });
  // A mention bypasses the follow-gate (it's targeted correspondence,
  // not unsolicited broadcast) unless every mentioned local actor has
  // actually blocked the sender — a block should still win over a
  // mention aimed at the very person who blocked them.
  const mentionedIds = await mentionedLocalActorIds(note);
  const unblockedMention = (
    await Promise.all(mentionedIds.map((id) => isBlockedBy(id, remote.id)))
  ).some((blocked) => !blocked);
  if (!followedByAnyone && !(mentionedIds.length > 0 && unblockedMention)) {
    console.log(`[inbox] dropped an unsolicited post from ${remote.username}@${remote.domain} (not followed)`);
    return;
  }

  const media = parseAttachmentMedia(note);
  // Extracted from the flattened plain-text body ourselves, same as any
  // local post — not trusting the sender's `tag` array structure, one
  // code path for local and federated content either way.
  const hashtags = extractHashtagTokens(body);
  const contentWarning = parseContentWarning(note);

  // A poll arrives as a Question (federation/activities.ts's
  // createNoteFromPost) — oneOf (single-select) or anyOf (multi-select),
  // each entry `{ type: "Note", name }`. Only ever set on first caching
  // (the `create` branch) — a redelivery of the same Create activity
  // hits `update` instead and shouldn't try to re-create poll options.
  const pollEntries = (
    Array.isArray(note.oneOf) ? note.oneOf : Array.isArray(note.anyOf) ? note.anyOf : []
  ) as unknown[];
  const pollOptionTexts = pollEntries
    .map((e) => (e as { name?: unknown } | null)?.name)
    .filter((name): name is string => typeof name === "string");
  const pollMultiple = Array.isArray(note.anyOf);
  const pollExpiresAt = typeof note.endTime === "string" ? new Date(note.endTime) : null;

  await prisma.post.upsert({
    where: { remoteId },
    create: {
      remoteId,
      title: null,
      body,
      authorActorId: remote.id,
      communityId: null,
      createdAt,
      hashtags,
      contentWarning,
      ...media,
      ...(pollOptionTexts.length > 0
        ? {
            pollMultiple,
            pollExpiresAt,
            pollOptions: { create: pollOptionTexts.map((text, position) => ({ text, position })) },
          }
        : {}),
    },
    update: { body, hashtags, contentWarning, ...media },
  });
  console.log(`[inbox] cached a post from ${remote.username}@${remote.domain}`);
}

// The receiving half of the Like delivery already built — same
// no-target-needed reasoning as processIncomingNote: `object` already
// tells us exactly what was liked. `content`, when present, means this
// Like is actually an emoji reaction (federation/activities.ts's
// reactActivity) rather than a plain upvote — reactions are posts-only
// (matches how boosts are already post-only, not comments), so a
// reaction on a comment silently falls back to a plain vote instead of
// being dropped. A remote custom emoji's own image isn't fetched/cached
// in this pass, even if the activity's `tag` array carries one — the
// stored emoji string (a raw unicode character or ":shortcode:") is
// rendered as-is, which for an unrecognized shortcode just means plain
// text instead of an image, not an error.
async function processIncomingLike(remote: Actor, object: unknown, content?: string): Promise<void> {
  const objectIri = typeof object === "string" ? object : (object as { id?: string } | undefined)?.id;
  if (!objectIri) return;

  const target = await resolveLocalObject(objectIri);
  if (!target) {
    console.log(`[inbox] like target not found: ${objectIri}`);
    return;
  }

  const targetAuthorId =
    target.kind === "post"
      ? (await prisma.post.findUnique({ where: { id: target.postId }, select: { authorActorId: true } }))
          ?.authorActorId
      : (await prisma.comment.findUnique({ where: { id: target.commentId }, select: { authorActorId: true } }))
          ?.authorActorId;
  if (targetAuthorId && (await isBlockedBy(targetAuthorId, remote.id))) {
    console.log(`[inbox] dropped a like from ${remote.username}@${remote.domain} (blocked)`);
    return;
  }

  if (target.kind === "post" && content) {
    await prisma.reaction.upsert({
      where: { postId_actorId: { postId: target.postId, actorId: remote.id } },
      create: { postId: target.postId, actorId: remote.id, emoji: content },
      update: { emoji: content },
    });
    console.log(`[inbox] ${remote.username}@${remote.domain} reacted to one of our posts`);
    return;
  }

  if (target.kind === "post") {
    await prisma.postVote.upsert({
      where: { postId_actorId: { postId: target.postId, actorId: remote.id } },
      create: { postId: target.postId, actorId: remote.id, value: 1 },
      update: { value: 1 },
    });
  } else {
    await prisma.commentVote.upsert({
      where: { commentId_actorId: { commentId: target.commentId, actorId: remote.id } },
      create: { commentId: target.commentId, actorId: remote.id, value: 1 },
      update: { value: 1 },
    });
  }
  console.log(`[inbox] ${remote.username}@${remote.domain} liked one of our ${target.kind}s`);
}

// The receiving half of the boost feature (routes/posts.ts's POST
// /posts/:id/boost). Same anti-spam follow-gate as a top-level note —
// only from someone we follow. Unlike Create/Like, the boosted object is
// often something we don't already host or cache; unlike a Note pushed
// to us directly, a real Announce's `object` is typically just an IRI
// (Mastodon's convention), so it may need dereferencing — `signAs` (the
// per-actor inbox's targetActor, when available) signs that fetch the
// same way actor lookups already do, falling back to unsigned when
// there's no specific local actor on hand (the shared inbox case).
async function processIncomingAnnounce(remote: Actor, object: unknown, signAs: Actor | null): Promise<void> {
  const followedByAnyone = await prisma.follow.findFirst({
    where: { followingId: remote.id, state: "accepted", follower: { domain: localDomain() } },
  });
  if (!followedByAnyone) {
    console.log(`[inbox] dropped a boost from ${remote.username}@${remote.domain} (not followed)`);
    return;
  }

  const objectIri = typeof object === "string" ? object : (object as { id?: string } | undefined)?.id;
  if (!objectIri) return;

  const postId = await resolveAndCacheRemotePost(objectIri, signAs ?? undefined);
  if (!postId) {
    console.log(`[inbox] could not resolve boosted object: ${objectIri}`);
    return;
  }

  await prisma.postBoost.upsert({
    where: { actorId_postId: { actorId: remote.id, postId } },
    create: { actorId: remote.id, postId },
    update: {},
  });
  console.log(`[inbox] ${remote.username}@${remote.domain} boosted a post`);
}

// Undo(Announce)'s receiving half — deletes the matching PostBoost.
// Doesn't need signAs (nothing to fetch, only ever un-boosting something
// we already resolved when the original Announce arrived).
async function processIncomingUndoAnnounce(remote: Actor, object: unknown): Promise<void> {
  const objectIri = typeof object === "string" ? object : (object as { id?: string } | undefined)?.id;
  if (!objectIri) return;

  const local = await resolveLocalObject(objectIri);
  const post =
    local?.kind === "post"
      ? { id: local.postId }
      : await prisma.post.findUnique({ where: { remoteId: objectIri }, select: { id: true } });
  if (!post) return;

  await prisma.postBoost.deleteMany({ where: { actorId: remote.id, postId: post.id } });
  console.log(`[inbox] ${remote.username}@${remote.domain} un-boosted a post`);
}

// Update's receiving half — only ever reacts to content we already cache
// (found by remoteId), same "never a backdoor Create" rule Like/Announce
// processing already follow: if we've never seen the object, there's
// nothing to update, full stop. authorActorId === remote.id is required
// before applying anything — without it a compromised/malicious remote
// actor could edit content that isn't theirs.
async function processIncomingUpdate(remote: Actor, object: unknown): Promise<void> {
  if (typeof object !== "object" || object === null) return;
  const obj = object as Record<string, unknown>;
  if (obj.type !== "Note" || typeof obj.id !== "string") return;
  const body = toPlainText(typeof obj.content === "string" ? obj.content : "");

  const post = await prisma.post.findUnique({ where: { remoteId: obj.id } });
  if (post) {
    if (post.authorActorId !== remote.id) {
      console.log(`[inbox] dropped an Update: ${remote.username}@${remote.domain} isn't the author`);
      return;
    }
    // An Update carries the object's full current state, not a partial
    // patch — so a missing attachment or CW here means it was actually
    // removed, not "leave it alone" (parseAttachmentMedia/
    // parseContentWarning already return explicit nulls for that reason).
    await prisma.post.update({
      where: { id: post.id },
      data: {
        body,
        updatedAt: new Date(),
        hashtags: extractHashtagTokens(body),
        contentWarning: parseContentWarning(obj),
        ...parseAttachmentMedia(obj),
      },
    });
    console.log(`[inbox] updated cached post from ${remote.username}@${remote.domain}`);
    return;
  }

  const comment = await prisma.comment.findUnique({ where: { remoteId: obj.id } });
  if (comment) {
    if (comment.authorActorId !== remote.id) {
      console.log(`[inbox] dropped an Update: ${remote.username}@${remote.domain} isn't the author`);
      return;
    }
    await prisma.comment.update({ where: { id: comment.id }, data: { body } });
    console.log(`[inbox] updated cached reply from ${remote.username}@${remote.domain}`);
  }
}

// Delete's receiving half. object is usually a Tombstone ({id, type}) or
// a bare IRI (federation/activities.ts's deleteActivity sends a
// Tombstone; either shape parses the same way processIncomingUndoAnnounce
// already does it above). A bare account-deletion Delete (object equal to
// the actor's own IRI, which real servers send when an account is
// removed) matches neither lookup below and is a clean no-op — no
// special-casing needed.
async function processIncomingDelete(remote: Actor, object: unknown): Promise<void> {
  const objectIri = typeof object === "string" ? object : (object as { id?: string } | undefined)?.id;
  if (!objectIri) return;

  const post = await prisma.post.findUnique({ where: { remoteId: objectIri } });
  if (post) {
    if (post.authorActorId !== remote.id) {
      console.log(`[inbox] dropped a Delete: ${remote.username}@${remote.domain} isn't the author`);
      return;
    }
    await deletePosts([post.id]);
    console.log(`[inbox] deleted cached post from ${remote.username}@${remote.domain}`);
    return;
  }

  const comment = await prisma.comment.findUnique({ where: { remoteId: objectIri } });
  if (comment) {
    if (comment.authorActorId !== remote.id) {
      console.log(`[inbox] dropped a Delete: ${remote.username}@${remote.domain} isn't the author`);
      return;
    }
    await deleteCommentSubtree(comment.id);
    console.log(`[inbox] deleted cached reply from ${remote.username}@${remote.domain}`);
  }
}

// The receiving half of routes/reports.ts's outgoing Flag delivery — a
// report from another instance's user about one of our local actors (or
// their content) lands in the same admin queue (GET /admin/reports) as a
// local report, one code path either way. `object` is an array per the
// real Mastodon wire shape (federation/activities.ts's flagActivity):
// the reported actor's IRI, optionally followed by the specific content
// IRI. Only ever creates a Report against a *local* actor — a Flag whose
// object doesn't resolve to one of our own actors is silently dropped,
// same "never a backdoor" posture as every other incoming handler here.
async function processIncomingFlag(remote: Actor, activity: Record<string, unknown>): Promise<void> {
  const raw = activity.object;
  const iris = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((v) => (typeof v === "string" ? v : (v as { id?: string } | undefined)?.id))
    .filter((v): v is string => typeof v === "string");
  const [targetActorIri, contentIri] = iris;
  if (!targetActorIri) return;

  let targetActorUrl: URL;
  try {
    targetActorUrl = new URL(targetActorIri);
  } catch {
    return;
  }
  if (targetActorUrl.host !== localDomain()) return;
  const username = targetActorUrl.pathname.split("/").filter(Boolean).pop();
  if (!username) return;
  const targetActor = await prisma.actor.findFirst({ where: { username, domain: localDomain() } });
  if (!targetActor) return;

  const target = contentIri ? await resolveLocalObject(contentIri) : null;
  const reason = typeof activity.content === "string" ? activity.content : "(no reason given)";

  await prisma.report.create({
    data: {
      reporterId: remote.id,
      targetActorId: targetActor.id,
      targetPostId: target?.kind === "post" ? target.postId : null,
      targetCommentId: target?.kind === "comment" ? target.commentId : null,
      reason,
    },
  });
  console.log(`[inbox] ${remote.username}@${remote.domain} reported ${targetActor.username}`);
}

// Shared by both the per-actor and shared inbox routes below. Verifies the
// sender's HTTP signature, then handles every activity type this app
// needs on the receiving end: a complete Follow handshake in both
// directions (Follow/Accept/Undo), incoming posts/replies (Create),
// incoming likes on our own content (Like), incoming boosts
// (Announce/Undo), incoming edits/deletes of content we cache
// (Update/Delete, posts and replies alike), incoming Block (someone
// blocking one of our local actors), and incoming Flag (a report against
// one of our local actors/content, landing in the same admin queue a
// local report does). Anything else is accepted (202) and logged, not
// processed — e.g. group/community content, a different, adjacent use of
// Announce (Lemmy-style community relay) than the person-level boost
// this app understands.
//
// A Follow/Create-reply/Like from someone the target has blocked is
// dropped alongside its existing follow-gate/author-match check
// (isBlockedBy, checked inside processIncomingNote/processIncomingLike
// and inline in the Follow branch below) — see routes/blocks.ts for the
// outgoing half and the disclosed limit on what block enforcement covers.
//
// `targetActor` is the local actor this activity concerns — required for
// Follow/Accept/Undo/Block (there's a specific Follow/membership/block
// row and, for Accept, a specific key to sign it with). Create/Like
// don't need it: a reply's target comes from inReplyTo, a like's from
// its object, and a top-level note's acceptance comes from the follow
// graph, not from who the delivery happened to be addressed to — see
// processIncomingNote.
async function processInboxActivity(
  targetActor: Actor | null,
  activity: Record<string, unknown> | undefined,
  req: Request,
): Promise<InboxResult> {
  const actorIri: string | undefined =
    typeof activity?.actor === "string" ? activity.actor : (activity?.actor as { id?: string })?.id;
  if (!activity?.type || !actorIri) {
    return { status: 400, body: { error: "invalid activity" } };
  }

  // Instance-level defederation — rejected before even resolving the
  // sender's key, so a blocked domain costs this instance nothing more
  // than a URL parse. See the DomainBlock model's own comment for every
  // other choke point this same block applies at.
  try {
    if (await isDomainBlocked(new URL(actorIri).host)) {
      return { status: 403, body: { error: "domain blocked" } };
    }
  } catch {
    // Unparseable actorIri — fetchRemoteActor below will fail on it too,
    // same as before this check existed.
  }

  const remoteActorPayload = await fetchRemoteActor(actorIri, targetActor ?? undefined);
  if (!remoteActorPayload?.publicKey?.publicKeyPem) {
    return { status: 401, body: { error: "could not resolve sender key" } };
  }

  const verified = verifySignedRequest({
    req,
    publicKey: remoteActorPayload.publicKey.publicKeyPem,
    rawBody: req.rawBody,
  });
  if (!verified) {
    return { status: 401, body: { error: "invalid signature" } };
  }

  const remote = await upsertRemoteActor(remoteActorPayload);
  const object = activity.object as { type?: string } | string | undefined;

  if (activity.type === "Follow" && targetActor && (await isBlockedBy(targetActor.id, remote.id))) {
    console.log(`[inbox] dropped a follow from ${remote.username}@${remote.domain} (blocked)`);
  } else if (activity.type === "Follow" && targetActor) {
    if (targetActor.type === "Group") {
      // A join request for one of our own local groups — goes through
      // CommunityMembership, not the Follow table (see
      // routes/communities.ts's requestRemoteMembership for the other
      // direction). Public groups auto-accept immediately, same as a
      // Person target always has; private/secret land pending for the
      // existing approve-request UI (routes/communities.ts), which
      // delivers the eventual Accept itself.
      const community = await prisma.community.findUnique({ where: { actorId: targetActor.id } });
      if (community) {
        const state = community.privacy === "public" ? "accepted" : "pending";
        await prisma.communityMembership.upsert({
          where: { actorId_communityId: { actorId: remote.id, communityId: community.id } },
          create: { actorId: remote.id, communityId: community.id, role: "member", state },
          update: { state },
        });
        console.log(
          `[inbox] ${remote.username}@${remote.domain} ${state === "accepted" ? "joined" : "requested to join"} ${targetActor.username}`,
        );
        if (state === "accepted") {
          await deliverActivity(targetActor, remote.inboxUrl, acceptActivity(targetActor, activity));
        }
      }
    } else {
      await prisma.follow.upsert({
        where: { followerId_followingId: { followerId: remote.id, followingId: targetActor.id } },
        create: { followerId: remote.id, followingId: targetActor.id, state: "accepted" },
        update: { state: "accepted" },
      });
      console.log(`[inbox] ${remote.username}@${remote.domain} followed ${targetActor.username}`);
      // Complete the handshake — without this the follower's server has no
      // way to know we accepted (Mastodon et al. won't show the relationship
      // as established until they see this).
      await deliverActivity(targetActor, remote.inboxUrl, acceptActivity(targetActor, activity));
    }
  } else if (activity.type === "Accept" && typeof object === "object" && object?.type === "Follow" && targetActor) {
    // Someone (or some group) we asked to join/follow is confirming it —
    // keyed on `remote`'s type, not targetActor's, since the follower
    // side here is always a Person (only a logged-in account can
    // initiate a join/follow).
    if (remote.type === "Group") {
      const community = await prisma.community.findUnique({ where: { actorId: remote.id } });
      if (community) {
        await prisma.communityMembership.updateMany({
          where: { actorId: targetActor.id, communityId: community.id, state: "pending" },
          data: { state: "accepted" },
        });
      }
      console.log(`[inbox] ${remote.username}@${remote.domain} accepted ${targetActor.username}'s join request`);
    } else {
      await prisma.follow.updateMany({
        where: { followerId: targetActor.id, followingId: remote.id, state: "pending" },
        data: { state: "accepted" },
      });
      console.log(`[inbox] ${remote.username}@${remote.domain} accepted ${targetActor.username}'s follow`);
    }
  } else if (activity.type === "Undo" && typeof object === "object" && object?.type === "Follow" && targetActor) {
    // They're leaving/unfollowing us. A remote Group revoking *our*
    // membership would need a different activity (Remove/Block) — not
    // handled here, same posture as any other unhandled activity type.
    if (targetActor.type === "Group") {
      const community = await prisma.community.findUnique({ where: { actorId: targetActor.id } });
      if (community) {
        await prisma.communityMembership.deleteMany({
          where: { actorId: remote.id, communityId: community.id },
        });
      }
      console.log(`[inbox] ${remote.username}@${remote.domain} left ${targetActor.username}`);
    } else {
      await prisma.follow.deleteMany({
        where: { followerId: remote.id, followingId: targetActor.id },
      });
      console.log(`[inbox] ${remote.username}@${remote.domain} unfollowed ${targetActor.username}`);
    }
  } else if (activity.type === "Undo" && typeof object === "object" && object?.type === "Announce") {
    await processIncomingUndoAnnounce(remote, (object as { object?: unknown }).object);
  } else if (activity.type === "Update" && typeof object === "object" && object?.type === "Note") {
    await processIncomingUpdate(remote, activity.object);
  } else if (activity.type === "Update" && typeof object === "object" && (object as { id?: string })?.id === actorIri) {
    // A profile edit (routes/profile.ts/profileImage.ts/communities.ts's
    // updateActorActivity). Nothing further to do here — every inbox
    // delivery already re-fetches and re-upserts the sender's actor
    // (fetchRemoteActor + upsertRemoteActor above, for signature
    // verification), which now also picks up icon/image, so this branch
    // exists only so an explicit Update(Actor) doesn't get mislogged as
    // unhandled.
    console.log(`[inbox] refreshed ${remote.username}@${remote.domain}'s profile via Update`);
  } else if (activity.type === "Delete") {
    await processIncomingDelete(remote, activity.object);
  } else if (
    activity.type === "Create" &&
    typeof object === "object" &&
    (object?.type === "Note" || object?.type === "Question")
  ) {
    // A poll is a Question, not a Note (federation/activities.ts's
    // createNoteFromPost) — same content/addressing shape otherwise, so
    // one handler covers both; processIncomingNote itself checks for
    // oneOf/anyOf to know whether to also create PollOption rows.
    await processIncomingNote(remote, object as Record<string, unknown>);
  } else if (activity.type === "Like") {
    await processIncomingLike(remote, activity.object, typeof activity.content === "string" ? activity.content : undefined);
  } else if (activity.type === "Announce") {
    await processIncomingAnnounce(remote, activity.object, targetActor);
  } else if (activity.type === "Block" && targetActor) {
    // Someone blocks one of our local actors — delete the Follow row
    // from them to that actor (either direction) so deliverToFollowers
    // naturally stops delivering to them from this point on, the only
    // enforcement that actually matters on our end (routes/blocks.ts's
    // own comment on why we don't attempt more).
    await prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: remote.id, followingId: targetActor.id },
          { followerId: targetActor.id, followingId: remote.id },
        ],
      },
    });
    console.log(`[inbox] ${remote.username}@${remote.domain} blocked ${targetActor.username}`);
  } else if (activity.type === "Flag") {
    await processIncomingFlag(remote, activity);
  } else {
    console.log(`[inbox] received unhandled activity type: ${activity.type}`);
  }

  return { status: 202 };
}

function respond(res: Response, result: InboxResult) {
  if (result.body === undefined) {
    res.status(result.status).end();
  } else {
    res.status(result.status).json(result.body);
  }
}

// POST /users/:username/inbox -> per-actor federation entrypoint.
inboxRouter.post("/users/:username/inbox", inboxRateLimit, async (req, res) => {
  const targetActor = await prisma.actor.findFirst({
    where: { username: req.params.username, domain: localDomain() },
  });
  if (!targetActor) return res.status(404).json({ error: "not found" });

  respond(res, await processInboxActivity(targetActor, req.body, req));
});

// A Follow's object is the actor being followed; an Accept/Undo wraps the
// original Follow, one level deeper — in both cases that's the local actor
// this activity is actually about, which the shared inbox needs to resolve
// since there's no :username in its URL to tell it directly.
function resolveInboxTargetIri(activity: Record<string, unknown> | undefined): string | undefined {
  const asIri = (value: unknown): string | undefined =>
    typeof value === "string" ? value : (value as { id?: string } | undefined)?.id;

  if (activity?.type === "Follow" || activity?.type === "Block") return asIri(activity.object);
  if (activity?.type === "Accept" || activity?.type === "Undo") {
    const inner = activity.object as { type?: string; object?: unknown } | undefined;
    if (inner?.type === "Follow") return asIri(inner.object);
  }
  return undefined;
}

// POST /inbox -> shared inbox (advertised as endpoints.sharedInbox on
// every local actor, routes/actor.ts). Lets a sender deliver once instead
// of once per local follower. Only Follow/Accept/Undo(Follow)/Block need
// a resolved target (see processInboxActivity) — Create/Like/Announce/
// Undo(Announce)/Update/Delete are processed exactly the same with or
// without one (their targets come from inReplyTo/object/the follow
// graph/remoteId, not addressing; a missing target just means an
// Announce's object-fetch, if needed, goes out unsigned), and anything
// truly unhandled is still just logged, so an unresolvable target here
// never hard-fails a delivery.
inboxRouter.post("/inbox", inboxRateLimit, async (req, res) => {
  const activity = req.body as Record<string, unknown> | undefined;
  const targetIri = resolveInboxTargetIri(activity);

  let targetActor: Actor | null = null;
  if (targetIri) {
    try {
      const url = new URL(targetIri);
      if (url.host === localDomain()) {
        const username = url.pathname.split("/").pop();
        if (username) {
          targetActor = await prisma.actor.findFirst({ where: { username, domain: localDomain() } });
        }
      }
    } catch {
      // malformed target IRI — fall through with targetActor left null
    }
  }

  respond(res, await processInboxActivity(targetActor, activity, req));
});
