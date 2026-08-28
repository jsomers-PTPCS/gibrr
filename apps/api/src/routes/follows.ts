import { Router } from "express";
import { z } from "zod";
import type { Actor } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../auth/session.js";
import { localDomain, actorIri, isLocalActor } from "../federation/localActor.js";
import { discoverActor, fetchRemoteActor, upsertRemoteActor } from "../federation/remoteActor.js";
import { deliverActivity } from "../federation/deliver.js";
import { followActivity, undoFollowActivity } from "../federation/activities.js";
import { notify } from "../federation/notifications.js";

export const followsRouter = Router();

// Shared by POST /follows below and routes/starterPacks.ts's bulk
// follow-all — both already have a resolved target Actor row in hand
// (a starter pack's members are stored as actor ids, no handle
// resolution needed), so this starts right after that point: create the
// Follow row (accepted immediately for a local target, pending for a
// remote one awaiting their Accept), delivering the signed Follow
// activity only in the remote case.
export type FollowOutcome =
  | { status: "followed"; state: "accepted" | "pending" }
  | { status: "already" }
  | { status: "self" };

export async function followActor(follower: Actor, target: Actor): Promise<FollowOutcome> {
  if (target.id === follower.id) return { status: "self" };

  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: follower.id, followingId: target.id } },
  });
  if (existing) return { status: "already" };

  const local = isLocalActor(target);
  const follow = await prisma.follow.create({
    data: { followerId: follower.id, followingId: target.id, state: local ? "accepted" : "pending" },
  });

  if (!local) {
    await deliverActivity(follower, target.inboxUrl, followActivity(follower, actorIri(target)));
  } else {
    void notify({ recipientId: target.id, actorId: follower.id, type: "follow" });
  }

  return { status: "followed", state: follow.state };
}

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

  const outcome = await followActor(req.actor!, target);
  if (outcome.status === "self") return res.status(400).json({ error: "can't follow yourself" });
  if (outcome.status === "already") {
    return res.status(409).json({ error: "already following, or a request is pending" });
  }
  res.status(201).json({ state: outcome.state });
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

// GET /follows/status/:username[?domain=] -> drives the Follow button on
// a profile page: one of "self" | "none" | "pending" | "accepted".
// `domain` defaults to ours (the original local-only behavior) — a
// remote actor's profile page passes their real domain so the button
// reflects an existing follow/pending state instead of always reading
// as "none".
followsRouter.get("/follows/status/:username", optionalAuth, async (req, res) => {
  const domain = typeof req.query.domain === "string" ? req.query.domain : localDomain();
  const other = await prisma.actor.findFirst({
    where: { username: req.params.username, domain },
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
// Looks up whether the viewer already follows (or has a pending follow
// on) a username@domain, purely from whatever's already cached locally —
// a not-yet-cached remote actor trivially can't have a Follow row, so
// "none" is always correct there without a network round trip.
async function followStatusFor(
  viewerId: string,
  username: string,
  domain: string,
): Promise<"none" | "pending" | "accepted"> {
  const cached = await prisma.actor.findUnique({ where: { username_domain: { username, domain } } });
  if (!cached) return "none";
  const follow = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: viewerId, followingId: cached.id } },
  });
  return follow?.state ?? "none";
}

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
    const username = remote.preferredUsername ?? iri.pathname.split("/").pop() ?? remote.id;
    return res.json({
      id: null,
      username,
      domain: iri.host,
      displayName: remote.name ?? null,
      avatarImageUrl: null,
      avatarPreset: null,
      status: await followStatusFor(req.actor!.id, username, iri.host),
      // The actor's own AP object IRI — kept as a "view original" link
      // alongside the in-app profile (GET /u/{username}?domain={domain}
      // on the frontend), not instead of it.
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
    return res.json({
      ...actor,
      url: null,
      status: await followStatusFor(req.actor!.id, username, domain),
    });
  }

  const remote = await discoverActor(parsed.data, req.actor!);
  if (!remote) return res.status(404).json({ error: "not found" });

  const remoteIri = new URL(remote.id);
  const remoteUsername = remote.preferredUsername ?? remoteIri.pathname.split("/").pop() ?? remote.id;
  res.json({
    id: null,
    username: remoteUsername,
    domain: remoteIri.host,
    status: await followStatusFor(req.actor!.id, remoteUsername, remoteIri.host),
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
