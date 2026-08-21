import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { isLocalActor, actorIri } from "../federation/localActor.js";
import { flagActivity, postObjectIri, commentObjectIri } from "../federation/activities.js";
import { deliverActivity } from "../federation/deliver.js";

export const reportsRouter = Router();

const createReportSchema = z.object({
  targetType: z.enum(["post", "comment", "actor"]),
  targetId: z.string().uuid(),
  reason: z.string().min(1).max(1000),
});

// POST /reports -> file a report. Resolves the real target actor (a
// post/comment's author, or the actor directly), creates a Report row —
// same row shape whether local or remote, one admin queue either way
// (see the incoming Flag handler in routes/inbox.ts, which creates the
// identical row from the other direction). Delivers a real ActivityPub
// Flag to a remote target's inbox, the shape Mastodon actually sends and
// expects for cross-instance reports.
reportsRouter.post("/reports", requireAuth, async (req, res) => {
  const parsed = createReportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { targetType, targetId, reason } = parsed.data;

  let targetActorId: string;
  let targetPostId: string | null = null;
  let targetCommentId: string | null = null;
  let contentIri: string | null = null;

  if (targetType === "post") {
    const post = await prisma.post.findUnique({ where: { id: targetId } });
    if (!post) return res.status(404).json({ error: "not found" });
    targetActorId = post.authorActorId;
    targetPostId = post.id;
    contentIri = postObjectIri(post);
  } else if (targetType === "comment") {
    const comment = await prisma.comment.findUnique({ where: { id: targetId } });
    if (!comment) return res.status(404).json({ error: "not found" });
    targetActorId = comment.authorActorId;
    targetCommentId = comment.id;
    contentIri = commentObjectIri(comment);
  } else {
    const actor = await prisma.actor.findUnique({ where: { id: targetId } });
    if (!actor) return res.status(404).json({ error: "not found" });
    targetActorId = actor.id;
  }

  if (targetActorId === req.actor!.id) {
    return res.status(400).json({ error: "can't report yourself" });
  }

  await prisma.report.create({
    data: { reporterId: req.actor!.id, targetActorId, targetPostId, targetCommentId, reason },
  });

  const targetActor = await prisma.actor.findUnique({ where: { id: targetActorId } });
  if (targetActor && !isLocalActor(targetActor)) {
    void deliverActivity(
      req.actor!,
      targetActor.inboxUrl,
      flagActivity(req.actor!, actorIri(targetActor), contentIri, reason),
    );
  }

  res.status(201).json({ reported: true });
});
