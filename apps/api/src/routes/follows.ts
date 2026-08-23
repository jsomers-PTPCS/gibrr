import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../auth/session.js";
import { localDomain, actorIri, isLocalActor } from "../federation/localActor.js";
import { discoverActor, fetchRemoteActor, upsertRemoteActor } from "../federation/remoteActor.js";
import { deliverActivity } from "../federation/deliver.js";
import { followActivity, undoFollowActivity } from "../federation/activities.js";

export const followsRouter = Router();

const FOLLOW_SUMMARY_SELECT = {
  id: true,
  username: true,
  domain: true,
  displayName: true,
  avatarImageUrl: true,
  avatarPreset: true,
} as const;

const handleSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]+@[a-zA-Z0-9.-]+(:[0-9]+)?$/, "expected the form user@domain");

// POST /follows { handle } -> follow a local or remote actor by fediverse
// handle. Local targets are accepted immediately (both sides already live
// in our DB, nothing to deliver); remote targets go through webfinger
// discovery and a signed Follow delivery, landing "pending" until their
// server's Accept comes back through the inbox.
followsRouter.post("/follows", requireAuth, async (req, res) => {
  // Accepts either a handle (user@domain, webfinger-discovered) or a
  // direct profile URL (fetched via content negotiation, no webfinger
  // round trip) — same two paths as GET /follows/preview above, so
  // whichever one the preview resolved with is the one actually
  // followed here too.
  const urlParsed = z.object({ url: z.string().url() }).safeParse(req.body);
  let target;
  if (urlParsed.success) {
    let iri: URL;
    try {
      iri = new URL(urlParsed.data.url);
    } catch {
      return res.status(404).json({ error: "not found" });
    }
    if (iri.host === localDomain()) return res.status(404).json({ error: "not found" });
    const remote = await fetchRemoteActor(urlParsed.data.url, req.actor!);
    if (!remote || (remote.type && remote.type !== "Person")) {
      return res.status(404).json({ error: "could not resolve that URL" });
    }
    target = await upsertRemoteActor(remote);
  } else {
    const parsed = z.object({ handle: handleSchema }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const [username, domain] = parsed.data.handle.split("@");

    target = await prisma.actor.findUnique({ where: { username_domain: { username, domain } } });

    if (!target && domain !== localDomain()) {
      const remote = await discoverActor(parsed.data.handle, req.actor!);
      if (!remote) return res.status(404).json({ error: "could not resolve that handle" });
      target = await upsertRemoteActor(remote);
    }
  }
  if (!target) return res.status(404).json({ error: "not found" });
  if (target.id === req.actor!.id) {
    return res.status(400).json({ error: "can't follow yourself" });
  }

  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: req.actor!.id, followingId: target.id } },
  });
  if (existing) return res.status(409).json({ error: "already following, or a request is pending" });

  const local = isLocalActor(target);
  const follow = await prisma.follow.create({
    data: {
      followerId: req.actor!.id,
      followingId: target.id,
      state: local ? "accepted" : "pending",
    },
  });

  if (!local) {
    await deliverActivity(req.actor!, target.inboxUrl, followActivity(req.actor!, actorIri(target)));
  }

  res.status(201).json({ state: follow.state });
});

// DELETE /follows/:actorId -> unfollow. Idempotent (no error if there was
// no Follow row). Delivers Undo(Follow) when the target is remote.
followsRouter.delete("/follows/:actorId", requireAuth, async (req, res) => {
  const target = await prisma.actor.findUnique({ where: { id: req.params.actorId } });

  await prisma.follow.deleteMany({
    where: { followerId: req.actor!.id, followingId: req.params.actorId },
  });

  if (target && !isLocalActor(target)) {
    await deliverActivity(req.actor!, target.inboxUrl, undoFollowActivity(req.actor!, actorIri(target)));
  }

  res.status(204).end();
});

// GET /follows/status/:username -> drives the Follow button on a (local)
// profile page: one of "self" | "none" | "pending" | "accepted". Local
// only — a remote actor has no profile page in this app to put the button
// on, so nothing needs to look up status for one.
followsRouter.get("/follows/status/:username", optionalAuth, async (req, res) => {
  const other = await prisma.actor.findFirst({
    where: { username: req.params.username, domain: localDomain() },
  });
  if (!other) return res.status(404).json({ error: "not found" });

  if (!req.actor) return res.json({ status: "none" });
  if (req.actor.id === other.id) return res.json({ status: "self" });

  const follow = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: req.actor.id, followingId: other.id } },
  });
  res.json({ status: follow?.state ?? "none" });
});

// GET /follows/preview?handle=user@domain -> live lookup for the handle
// input on the Fediverse panel, so a viewer sees who they're about to
// follow before committing. Registered before GET /follows/:username so
// "preview" isn't swallowed as a username. Deliberately read-only — unlike
// POST /follows, this never upserts a remote actor into our Actor table;
// typing a handle to look at it shouldn't leave a row behind for someone
// never actually followed. There's no fediverse-wide search index to
// suggest *candidates* from (no server has one) — this only resolves a
// handle that's already a complete, real address.
//
// Also accepts ?url=<profile IRI> as an alternative to ?handle — for
// someone who has a person's profile link (e.g. pasted from another
// site) rather than their handle. Fetched directly via signed GET with
// Accept: application/activity+json, the same content-negotiation every
// AP-compliant profile page answers for post URLs already
// (federation/remotePost.ts) — no webfinger round trip needed since the
// URL itself is the thing to dereference.
followsRouter.get("/follows/preview", requireAuth, async (req, res) => {
  const urlParam = typeof req.query.url === "string" ? req.query.url : undefined;
  if (urlParam) {
    let iri: URL;
    try {
      iri = new URL(urlParam);
    } catch {
      return res.status(404).json({ error: "not found" });
    }
    if (iri.host === localDomain()) {
      return res.status(404).json({ error: "not found" });
    }
    const remote = await fetchRemoteActor(urlParam, req.actor!);
    if (!remote || (remote.type && remote.type !== "Person")) return res.status(404).json({ error: "not found" });
    return res.json({
      id: null,
      username: remote.preferredUsername ?? iri.pathname.split("/").pop() ?? remote.id,
      domain: iri.host,
      displayName: remote.name ?? null,
      avatarImageUrl: null,
      avatarPreset: null,
      // The actor's own AP object IRI — real fediverse software answers
      // this same URL with an HTML profile page via content negotiation
      // when a browser (no Accept: activity+json) requests it, same as
      // how Post.remoteId already doubles as a real "view original"
      // link. This is the *only* way to actually browse this person's
      // posts — there's no in-app profile page for a remote actor.
      url: remote.id,
    });
  }

  const parsed = handleSchema.safeParse(req.query.handle);
  if (!parsed.success) return res.status(404).json({ error: "not found" });

  const [username, domain] = parsed.data.split("@");

  if (domain === localDomain()) {
    const actor = await prisma.actor.findUnique({
      where: { username_domain: { username, domain } },
      select: FOLLOW_SUMMARY_SELECT,
    });
    if (!actor) return res.status(404).json({ error: "not found" });
    // A local actor already has a real in-app profile page — no
    // external link needed, see search/page.tsx's use of this field.
    return res.json({ ...actor, url: null });
  }

  const remote = await discoverActor(parsed.data, req.actor!);
  if (!remote) return res.status(404).json({ error: "not found" });

  const remoteIri = new URL(remote.id);
  res.json({
    id: null,
    username: remote.preferredUsername ?? remoteIri.pathname.split("/").pop() ?? remote.id,
    domain: remoteIri.host,
    displayName: remote.name ?? null,
    avatarImageUrl: null,
    // See the ?url= branch above's own comment — same "AP object IRI
    // doubles as a real browser-viewable profile page" reasoning.
    url: remote.id,
    avatarPreset: null,
  });
});

// GET /follows/:username -> that actor's following/followers lists, for
// the Fediverse panel on the Relationships tab — public, same as the
// existing follower/following counts on any profile (routes/profile.ts),
// not gated to the owner. Pending outgoing follows are only meaningful to
// the owner, but including them for everyone is harmless (mirrors how a
// pending Friendship's existence isn't hidden either) and keeps this one
// query shared instead of forking owner-vs-viewer logic.
followsRouter.get("/follows/:username", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const [following, followers] = await Promise.all([
    prisma.follow.findMany({
      where: { followerId: actor.id },
      include: { following: { select: FOLLOW_SUMMARY_SELECT } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.follow.findMany({
      where: { followingId: actor.id, state: "accepted" },
      include: { follower: { select: FOLLOW_SUMMARY_SELECT } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  res.json({
    following: following.map((f) => ({ ...f.following, state: f.state })),
    followers: followers.map((f) => ({ ...f.follower, state: f.state })),
  });
});
