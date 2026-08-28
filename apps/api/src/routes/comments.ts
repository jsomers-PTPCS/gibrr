import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../auth/session.js";
import { attachCommentVotes } from "../votes.js";
import { isLocalActor, getOrCreateInstanceActor } from "../federation/localActor.js";
import { syncRemoteReplies } from "../federation/remoteEngagement.js";
import { logger } from "../logger.js";
import {
  createNoteFromComment,
  createActivity,
  likeActivity,
  commentObjectIri,
} from "../federation/activities.js";
import { deliverToFollowers, deliverActivity } from "../federation/deliver.js";
import { notify } from "../federation/notifications.js";

export const commentsRouter = Router();

const commentInclude = {
  author: { select: { username: true, domain: true, displayName: true } },
} as const;

// GET /comments/:id -> AP Note for a single comment. Unlike GET
// /posts/:id, nothing in the web client fetches a comment individually
// (they arrive embedded in the post's comment tree), so this is AP-only —
// no content-negotiation branch needed, matching how GET /users/:username
// always returns AP JSON.
commentsRouter.get("/comments/:id", async (req, res) => {
  const comment = await prisma.comment.findUnique({
    where: { id: req.params.id },
    include: {
      author: { select: { username: true, domain: true } },
      post: { select: { id: true, remoteId: true } },
    },
  });
  if (!comment) return res.status(404).json({ error: "not found" });

  res.set("Content-Type", "application/activity+json");
  res.json(createNoteFromComment(comment, comment.author, comment.post));
});

// How long a remote post's already-cached reply thread is trusted
// before this route bothers re-walking it live — same "don't hammer
// every server on every single view" reasoning as ExploreServer's own
// sweep interval, just gated per-post-on-view instead of a fixed
// schedule (which remote posts anyone's even looking at is
// unpredictable, unlike Explore's fixed curated server list).
const COMMENTS_SYNC_STALE_MS = 5 * 60_000;

// The actual, single choke point for "someone is about to look at this
// post's comments" — hit whether that's the dedicated post page, a
// feed's inline "expand comments" accordion (PostItem), or the Loops
// video drawer, unlike GET /posts/:id's own remote-engagement fetch
// (which only ever ran for whoever loaded that one dedicated page).
// Reddit has no ActivityPub replies collection to walk (see
// federation/remoteEngagement.ts), so it's skipped the same way GET
// /posts/:id already skips it.
//
// Used to `await syncRemoteReplies(...)` inline, on every single
// request — confirmed live this took several real seconds against a
// slow/unfamiliar remote server (a serial per-reply crawl, up to two
// live HTTP round trips per reply), which is what made opening a remote
// post's comments feel slow. This now always answers from the DB
// immediately, the same fast path a local post's comments already take,
// and only kicks off a live re-sync in the background (not awaited) when
// this post's thread has never been synced or hasn't been rechecked in
// a while — an already-open comment panel just won't show a reply that
// arrived in the last few minutes until the next reload, the same
// "eventually consistent" tradeoff Explore/Loops' own sweeps already
// make. commentsLastSyncedAt is stamped *before* the crawl starts
// (Post.commentsLastSyncedAt's own schema comment), not after, so a
// burst of near-simultaneous opens of the same popular post only
// triggers one crawl, not one per request.
commentsRouter.get("/posts/:postId/comments", optionalAuth, async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.postId },
    select: { id: true, remoteId: true, commentsLastSyncedAt: true },
  });

  if (post?.remoteId) {
    const isReddit = (() => {
      try {
        return new URL(post.remoteId!).host.endsWith("reddit.com");
      } catch {
        return false;
      }
    })();
    const stale =
      !post.commentsLastSyncedAt || Date.now() - post.commentsLastSyncedAt.getTime() > COMMENTS_SYNC_STALE_MS;

    if (!isReddit && stale) {
      await prisma.post.update({ where: { id: post.id }, data: { commentsLastSyncedAt: new Date() } });
      const instanceActor = await getOrCreateInstanceActor();
      void syncRemoteReplies({ id: post.id, remoteId: post.remoteId }, instanceActor).catch((err) => {
        logger.warn({ err, postId: post.id }, "background comment sync failed");
      });
    }
  }

  const comments = await prisma.comment.findMany({
    where: { postId: req.params.postId },
    orderBy: { createdAt: "asc" },
    include: commentInclude,
  });

  const withVotes = await attachCommentVotes(comments, req.actor?.id);
  res.json(withVotes);
});

const createCommentSchema = z.object({
  body: z.string().min(1).max(10000),
  parentId: z.string().uuid().optional(),
});

commentsRouter.post("/posts/:postId/comments", requireAuth, async (req, res) => {
  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { postId } = req.params;
  const { body, parentId } = parsed.data;

  const post = await prisma.post.findUnique({ where: { id: postId }, include: { author: true } });
  if (!post) return res.status(404).json({ error: "post not found" });

  const parent = parentId
    ? await prisma.comment.findUnique({ where: { id: parentId }, include: { author: true } })
    : null;
  if (parentId && (!parent || parent.postId !== postId)) {
    return res.status(400).json({ error: "parent comment not found on this post" });
  }

  const comment = await prisma.comment.create({
    data: { postId, parentId, body, authorActorId: req.actor!.id },
    include: commentInclude,
  });

  const note = createNoteFromComment(comment, req.actor!, post);
  void deliverToFollowers(req.actor!, createActivity(note, req.actor!));
  // Reply notification straight to whoever is actually being replied to
  // (the parent comment's author for a nested reply, the post's author
  // for a top-level one), even if they don't follow the commenter back —
  // matches how a reply reaches its addressee on Mastodon regardless of
  // the follow graph. A nested reply used to always notify the original
  // post author instead of the comment author actually being replied to.
  const replyTarget = parent ? parent.author : post.author;
  if (replyTarget.id !== req.actor!.id && !isLocalActor(replyTarget)) {
    void deliverActivity(req.actor!, replyTarget.inboxUrl, createActivity(note, req.actor!));
  }
  // In-app notification for a local reply target — the federated case is
  // covered by the remote actor's own server processing the Create above.
  void notify({
    recipientId: replyTarget.id,
    actorId: req.actor!.id,
    type: "reply",
    postId,
    commentId: comment.id,
  });

  res.status(201).json({ ...comment, score: 0, myVote: null });
});

const voteSchema = z.object({ value: z.union([z.literal(1), z.literal(-1)]) });

commentsRouter.post("/comments/:id/vote", requireAuth, async (req, res) => {
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const commentId = req.params.id;
  const actorId = req.actor!.id;

  const comment = await prisma.comment.findUnique({ where: { id: commentId }, include: { author: true } });
  if (!comment) return res.status(404).json({ error: "not found" });

  const existing = await prisma.commentVote.findUnique({
    where: { commentId_actorId: { commentId, actorId } },
  });
  const becameLike = parsed.data.value === 1 && existing?.value !== 1;

  if (existing?.value === parsed.data.value) {
    await prisma.commentVote.delete({ where: { id: existing.id } });
  } else {
    await prisma.commentVote.upsert({
      where: { commentId_actorId: { commentId, actorId } },
      create: { commentId, actorId, value: parsed.data.value },
      update: { value: parsed.data.value },
    });
  }

  if (becameLike && !isLocalActor(comment.author)) {
    void deliverActivity(
      req.actor!,
      comment.author.inboxUrl,
      likeActivity(req.actor!, commentObjectIri(comment)),
    );
  }
  if (becameLike) {
    void notify({
      recipientId: comment.authorActorId,
      actorId: req.actor!.id,
      type: "comment_like",
      postId: comment.postId,
      commentId: comment.id,
    });
  }

  const [{ score, myVote }] = await attachCommentVotes([{ id: commentId }], actorId);
  res.json({ score, myVote });
});
