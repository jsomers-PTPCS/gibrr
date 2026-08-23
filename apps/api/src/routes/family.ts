import { Router } from "express";
import { z } from "zod";
import { FamilyRelationType } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../auth/session.js";

export const familyRouter = Router();

const ACTOR_SUMMARY_SELECT = { id: true, username: true, domain: true, displayName: true } as const;

// relationType is always from the link's actorId's point of view
// ("relative is my {relationType}"). When displaying on the *relative's*
// own profile, the inverse is shown instead — computed here, not stored
// twice.
const INVERSE_RELATION: Record<FamilyRelationType, FamilyRelationType> = {
  partner: "partner",
  spouse: "spouse",
  parent: "child",
  child: "parent",
  sibling: "sibling",
  other: "other",
};

const linkSchema = z.object({
  relativeUsername: z.string().min(1),
  relationType: z.nativeEnum(FamilyRelationType),
});

// POST /family/link -> creates a pending FamilyLink from the caller to the
// named relative. Requires the relative's confirmation (POST
// /family/confirm/:linkId) before it appears on either profile — same
// trust model as a friend request, since one person shouldn't be able to
// unilaterally claim a relationship with another.
familyRouter.post("/family/link", requireAuth, async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const relative = await prisma.actor.findFirst({
    where: { username: parsed.data.relativeUsername },
  });
  if (!relative) return res.status(404).json({ error: "not found" });
  if (relative.id === req.actor!.id) {
    return res.status(400).json({ error: "can't link yourself as family" });
  }

  const existing = await prisma.familyLink.findFirst({
    where: {
      OR: [
        { actorId: req.actor!.id, relativeId: relative.id },
        { actorId: relative.id, relativeId: req.actor!.id },
      ],
    },
  });
  if (existing) {
    return res.status(409).json({ error: "a family link already exists with that person" });
  }

  const link = await prisma.familyLink.create({
    data: {
      actorId: req.actor!.id,
      relativeId: relative.id,
      relationType: parsed.data.relationType,
    },
  });

  res.status(201).json({ id: link.id, state: link.state });
});

// POST /family/confirm/:linkId -> caller must be the relative on a pending
// link.
familyRouter.post("/family/confirm/:linkId", requireAuth, async (req, res) => {
  const link = await prisma.familyLink.findUnique({ where: { id: req.params.linkId } });
  if (!link || link.relativeId !== req.actor!.id || link.state !== "pending") {
    return res.status(404).json({ error: "no pending request" });
  }

  await prisma.familyLink.update({ where: { id: link.id }, data: { state: "accepted" } });
  res.json({ accepted: true });
});

// DELETE /family/:linkId -> either party may remove it (covers
// decline/cancel/unlink with one idempotent action).
familyRouter.delete("/family/:linkId", requireAuth, async (req, res) => {
  const link = await prisma.familyLink.findUnique({ where: { id: req.params.linkId } });
  if (!link) return res.status(204).end();
  if (link.actorId !== req.actor!.id && link.relativeId !== req.actor!.id) {
    return res.status(403).json({ error: "not your family link" });
  }

  await prisma.familyLink.delete({ where: { id: link.id } });
  res.status(204).end();
});

// GET /family/requests -> caller's pending incoming family-link requests.
// Registered before GET /family/:username so "requests" isn't swallowed
// as a username.
familyRouter.get("/family/requests", requireAuth, async (req, res) => {
  const requests = await prisma.familyLink.findMany({
    where: { relativeId: req.actor!.id, state: "pending" },
    include: { actor: { select: ACTOR_SUMMARY_SELECT } },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    requests.map((r) => ({ id: r.id, relationType: r.relationType, actor: r.actor })),
  );
});

// GET /family/requests/sent -> caller's own pending outgoing links — the
// other half of the picture GET /family/requests only shows the incoming
// side of. relationType is returned as-is (from the caller's own point
// of view, same as it was submitted) since the caller is actorId here,
// not relativeId — no inversion needed, unlike GET /family/:username.
familyRouter.get("/family/requests/sent", requireAuth, async (req, res) => {
  const requests = await prisma.familyLink.findMany({
    where: { actorId: req.actor!.id, state: "pending" },
    include: { relative: { select: ACTOR_SUMMARY_SELECT } },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    requests.map((r) => ({ id: r.id, relationType: r.relationType, actor: r.relative })),
  );
});

// GET /family/:username -> that actor's accepted family links, mapped to
// the viewer-appropriate direction (the inverse relation type is shown
// when the link's relativeId is the profile being viewed rather than
// actorId), gated by aboutVisibility.familyMembers for non-owners.
familyRouter.get("/family/:username", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const isOwner = req.actor?.id === actor.id;
  if (!isOwner) {
    const visibility = (actor.aboutVisibility as Record<string, boolean> | null) ?? {};
    if (visibility.familyMembers !== true) {
      return res.status(403).json({ error: "not visible" });
    }
  }

  const links = await prisma.familyLink.findMany({
    where: {
      state: "accepted",
      OR: [{ actorId: actor.id }, { relativeId: actor.id }],
    },
    include: {
      actor: { select: ACTOR_SUMMARY_SELECT },
      relative: { select: ACTOR_SUMMARY_SELECT },
    },
  });

  const members = links.map((link) =>
    link.actorId === actor.id
      ? { id: link.id, person: link.relative, relationType: link.relationType }
      : { id: link.id, person: link.actor, relationType: INVERSE_RELATION[link.relationType] },
  );

  res.json(members);
});
