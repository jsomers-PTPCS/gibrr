import { Router } from "express";
import { z } from "zod";
import type { Actor, Community } from "@prisma/client";
import { prisma } from "../db.js";
import { createLocalActor, toPublicActor, isLocalActor, actorIri } from "../federation/localActor.js";
import { discoverActor, upsertRemoteActor } from "../federation/remoteActor.js";
import { toDescriptionHtml } from "../federation/descriptionHtml.js";
import { fetchInstanceSoftware } from "../federation/instanceSoftware.js";
import { deliverActivity } from "../federation/deliver.js";
import { followActivity, acceptActivity, undoFollowActivity, updateActorActivity } from "../federation/activities.js";
import { requireAuth, optionalAuth } from "../auth/session.js";
import { deletePosts } from "../deletion.js";

export const communitiesRouter = Router();

// A group's "followers" for delivery purposes are its CommunityMembership
// rows, not a Follow table (see the module comment above on how group
// joining maps onto Follow/Accept) — so unlike deliverToFollowers
// (federation/deliver.ts), this queries membership directly.
async function deliverToGroupMembers(
  communityId: string,
  groupActor: Actor,
  activity: Record<string, unknown>,
): Promise<void> {
  const members = await prisma.communityMembership.findMany({
    where: { communityId, state: "accepted" },
    include: { actor: true },
  });
  const remoteMembers = members.map((m) => m.actor).filter((a) => !isLocalActor(a) && a.inboxUrl);
  await Promise.allSettled(remoteMembers.map((a) => deliverActivity(groupActor, a.inboxUrl, activity)));
}

// "join a remote group" maps onto ActivityPub the same way Lemmy does it:
// following the group's actor. Membership state lives on
// CommunityMembership (not a parallel Follow row) — see routes/inbox.ts's
// Group-vs-Person branching for the other side of this handshake.
const handleSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]+@[a-zA-Z0-9.-]+(:[0-9]+)?$/, "expected the form group@domain");

async function requestRemoteMembership(actor: Actor, community: Community & { actor: Actor }) {
  await prisma.communityMembership.upsert({
    where: { actorId_communityId: { actorId: actor.id, communityId: community.id } },
    create: { actorId: actor.id, communityId: community.id, role: "member", state: "pending" },
    update: { state: "pending" },
  });
  await deliverActivity(actor, community.actor.inboxUrl, followActivity(actor, actorIri(community.actor)));
}

// "owner" > "admin" > "moderator" > "member" — enforced here, not the DB.
// Owner: everything, including deleting the group and promoting/demoting
// anyone (only the owner can appoint/remove an Admin). Admin: edit
// settings, approve/deny requests, remove Moderators/Members, promote a
// Member to Moderator (not to Admin). Moderator: approve/deny requests,
// remove Members only. Member: post (if accepted), leave.
const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, moderator: 1, member: 0 };

function outranks(callerRole: string, targetRole: string): boolean {
  return ROLE_RANK[callerRole] > ROLE_RANK[targetRole];
}

async function getMembership(actorId: string, communityId: string) {
  return prisma.communityMembership.findUnique({
    where: { actorId_communityId: { actorId, communityId } },
  });
}

const privacySchema = z.enum(["public", "private", "secret"]);

const createCommunitySchema = z.object({
  name: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "name may only contain letters, numbers, and underscores"),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  privacy: privacySchema.default("public"),
});

// POST /communities -> creates the group's actor + Community row, and —
// unlike before this feature — an "owner" membership for the creator in
// the same transaction. Nothing tracked who created a community before
// this; existing communities have no owner membership as a result (a
// disclosed gap for old data, not backfilled).
communitiesRouter.post("/communities", requireAuth, async (req, res) => {
  const parsed = createCommunitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { name, title, privacy } = parsed.data;
  // A group's description is rendered as real (sanitized) HTML, not
  // plain text — see descriptionHtml.ts. Plain text typed into the
  // form gets promoted to paragraphs; markup pasted in (e.g. copied
  // from a remote community's real bio) gets sanitized down to a safe
  // subset and kept as structure, not flattened away.
  const description = parsed.data.description ? toDescriptionHtml(parsed.data.description) : parsed.data.description;

  const existing = await prisma.actor.findFirst({ where: { username: name } });
  if (existing) return res.status(409).json({ error: "community name taken" });

  const community = await prisma.$transaction(async (tx) => {
    const actor = await createLocalActor(tx, {
      username: name,
      type: "Group",
      displayName: title,
      summary: description,
    });
    const created = await tx.community.create({
      data: { actorId: actor.id, title, description, privacy },
      include: { actor: true },
    });
    await tx.communityMembership.create({
      data: { actorId: req.actor!.id, communityId: created.id, role: "owner", state: "accepted" },
    });
    return created;
  });

  res.status(201).json({ ...community, actor: toPublicActor(community.actor) });
});

// GET /communities -> browse list. Secret communities are excluded
// unless the viewer already has an accepted membership in them.
communitiesRouter.get("/communities", optionalAuth, async (req, res) => {
  const viewerId = req.actor?.id;
  const communities = await prisma.community.findMany({
    where: viewerId
      ? {
          OR: [
            { privacy: { not: "secret" } },
            { members: { some: { actorId: viewerId, state: "accepted" } } },
          ],
        }
      : { privacy: { not: "secret" } },
    include: { actor: true },
    orderBy: { createdAt: "desc" },
  });

  const counts = await prisma.communityMembership.groupBy({
    by: ["communityId"],
    where: { communityId: { in: communities.map((c) => c.id) }, state: "accepted" },
    _count: { _all: true },
  });
  const countByCommunity = new Map(counts.map((c) => [c.communityId, c._count._all]));

  res.json(
    communities.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      privacy: c.privacy,
      memberCount: countByCommunity.get(c.id) ?? 0,
      actor: toPublicActor(c.actor),
    })),
  );
});

// GET /communities/name/:name -> full detail for the group's own page.
// 404 (not 403) for a secret group the viewer isn't in — existence-
// hiding, same convention as private photo albums.
communitiesRouter.get("/communities/name/:name", optionalAuth, async (req, res) => {
  const community = await prisma.community.findFirst({
    where: { actor: { username: req.params.name } },
    include: { actor: true },
  });
  if (!community) return res.status(404).json({ error: "not found" });

  const viewerMembership = req.actor ? await getMembership(req.actor.id, community.id) : null;
  const isMember = viewerMembership?.state === "accepted";
  if (community.privacy === "secret" && !isMember) {
    return res.status(404).json({ error: "not found" });
  }

  const memberCount = await prisma.communityMembership.count({
    where: { communityId: community.id, state: "accepted" },
  });

  res.json({
    id: community.id,
    title: community.title,
    description: community.description,
    privacy: community.privacy,
    memberCount,
    actor: toPublicActor(community.actor),
    viewerMembership: viewerMembership
      ? { role: viewerMembership.role, state: viewerMembership.state }
      : null,
  });
});

// GET /communities/:id/members -> accepted member list with roles, plus
// (for admin/mod/owner callers) the pending request queue. Registered
// under the group's id since the management panel already has it from
// the detail fetch above.
communitiesRouter.get("/communities/:id/members", optionalAuth, async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) return res.status(404).json({ error: "not found" });

  const viewerMembership = req.actor ? await getMembership(req.actor.id, community.id) : null;
  if (community.privacy === "secret" && viewerMembership?.state !== "accepted") {
    return res.status(404).json({ error: "not found" });
  }

  const members = await prisma.communityMembership.findMany({
    where: { communityId: community.id, state: "accepted" },
    include: { actor: { select: { id: true, username: true, domain: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
  });

  const canManage = viewerMembership && ROLE_RANK[viewerMembership.role] >= 1;
  const pending = canManage
    ? await prisma.communityMembership.findMany({
        where: { communityId: community.id, state: "pending" },
        include: { actor: { select: { id: true, username: true, domain: true, displayName: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  res.json({
    members: members.map((m) => ({ role: m.role, actor: m.actor })),
    pending: pending.map((m) => m.actor),
  });
});

// POST /communities/:id/join -> public communities create an accepted
// membership immediately (unchanged from before this feature);
// private/secret create a pending one an admin/mod/owner must approve.
// A remote-hosted community (already cached locally, e.g. someone else
// on this instance found it first) always lands pending — we don't
// control their acceptance — and delivers a real Follow to their inbox,
// same as POST /communities/join-remote below.
communitiesRouter.post("/communities/:id/join", requireAuth, async (req, res) => {
  const community = await prisma.community.findUnique({
    where: { id: req.params.id },
    include: { actor: true },
  });
  if (!community) return res.status(404).json({ error: "not found" });

  const existing = await getMembership(req.actor!.id, community.id);
  if (existing) {
    return res
      .status(409)
      .json({ error: existing.state === "pending" ? "request already pending" : "already a member" });
  }

  if (!isLocalActor(community.actor)) {
    await requestRemoteMembership(req.actor!, community);
    return res.status(201).json({ state: "pending" });
  }

  const state = community.privacy === "public" ? "accepted" : "pending";
  await prisma.communityMembership.create({
    data: { actorId: req.actor!.id, communityId: community.id, role: "member", state },
  });

  res.status(201).json({ state });
});

// POST /communities/join-remote { handle } -> discover a group we don't
// have cached yet (or reuse the cached one) by fediverse handle, then the
// same federated-join path as above.
communitiesRouter.post("/communities/join-remote", requireAuth, async (req, res) => {
  const parsed = z.object({ handle: handleSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const remote = await discoverActor(parsed.data.handle, req.actor!);
  if (!remote) return res.status(404).json({ error: "could not resolve that handle" });
  if (remote.type !== "Group") {
    return res.status(400).json({ error: "that handle is a person, not a group — use Follow instead" });
  }

  const remoteActorRow = await upsertRemoteActor(remote);

  let community = await prisma.community.findUnique({
    where: { actorId: remoteActorRow.id },
    include: { actor: true },
  });
  if (!community) {
    community = await prisma.community.create({
      data: {
        actorId: remoteActorRow.id,
        title: remoteActorRow.displayName ?? remoteActorRow.username,
        // A remote group's summary is real HTML (Lemmy communities in
        // particular ship full markup — headers, blockquotes, links) —
        // sanitized down to a safe subset and kept as real HTML
        // (descriptionHtml.ts), not flattened away.
        description: remoteActorRow.summary ? toDescriptionHtml(remoteActorRow.summary) : null,
        // Our own local approximation — we can't know their real privacy
        // tier from the actor object alone, and "public" matches how
        // this shows up everywhere else in this app (browse list, search).
        privacy: "public",
      },
      include: { actor: true },
    });
  }

  const existing = await getMembership(req.actor!.id, community.id);
  if (existing) {
    return res
      .status(409)
      .json({ error: existing.state === "pending" ? "request already pending" : "already a member" });
  }

  await requestRemoteMembership(req.actor!, community);

  res.status(201).json({ state: "pending", communityId: community.id });
});

// GET /communities/lookup-remote?handle=group@domain -> read-only preview
// for the search bar's live remote-group lookup, mirrors GET
// /follows/preview exactly — never persists anything, unlike the join
// route above.
communitiesRouter.get("/communities/lookup-remote", requireAuth, async (req, res) => {
  const parsed = handleSchema.safeParse(req.query.handle);
  if (!parsed.success) return res.status(404).json({ error: "not found" });

  const remote = await discoverActor(parsed.data, req.actor!);
  if (!remote || remote.type !== "Group") return res.status(404).json({ error: "not found" });

  const url = new URL(remote.id);
  const software = await fetchInstanceSoftware(url.host);
  res.json({
    username: remote.preferredUsername ?? url.pathname.split("/").pop() ?? remote.id,
    domain: url.host,
    title: remote.name ?? remote.preferredUsername ?? url.pathname.split("/").pop() ?? remote.id,
    description: remote.summary ? toDescriptionHtml(remote.summary) : null,
    software,
  });
});

// POST /communities/:id/members/:username/approve -> admin/mod/owner only.
// Delivers a signed Accept back when the request being approved came from
// a remote member — completes the join handshake, mirroring how
// routes/inbox.ts already does this for the auto-accepted public case.
communitiesRouter.post("/communities/:id/members/:username/approve", requireAuth, async (req, res) => {
  const community = await prisma.community.findUnique({
    where: { id: req.params.id },
    include: { actor: true },
  });
  if (!community) return res.status(404).json({ error: "not found" });

  const callerMembership = await getMembership(req.actor!.id, community.id);
  if (!callerMembership || ROLE_RANK[callerMembership.role] < 1) {
    return res.status(403).json({ error: "not allowed" });
  }

  const target = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!target) return res.status(404).json({ error: "not found" });

  const targetMembership = await getMembership(target.id, community.id);
  if (!targetMembership || targetMembership.state !== "pending") {
    return res.status(404).json({ error: "no pending request" });
  }

  await prisma.communityMembership.update({
    where: { id: targetMembership.id },
    data: { state: "accepted" },
  });

  if (!isLocalActor(target)) {
    await deliverActivity(
      community.actor,
      target.inboxUrl,
      acceptActivity(community.actor, followActivity(target, actorIri(community.actor))),
    );
  }

  res.json({ approved: true });
});

// DELETE /communities/:id/members/:username -> unified leave / remove /
// deny-request. Self-target = leave (blocked for the owner, who must
// delete the group instead). Otherwise requires the caller to outrank
// the target — this also covers denying a pending request, since a
// pending row is just a "member"-rank membership. Self-leaving a
// remote-hosted community also delivers Undo(Follow), so their server
// knows we're actually gone rather than just silently dropping our own
// bookkeeping.
communitiesRouter.delete("/communities/:id/members/:username", requireAuth, async (req, res) => {
  const community = await prisma.community.findUnique({
    where: { id: req.params.id },
    include: { actor: true },
  });
  if (!community) return res.status(404).json({ error: "not found" });

  const target = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!target) return res.status(404).json({ error: "not found" });

  const targetMembership = await getMembership(target.id, community.id);
  if (!targetMembership) return res.status(204).end();

  const isSelf = target.id === req.actor!.id;
  if (isSelf) {
    if (targetMembership.role === "owner") {
      return res.status(403).json({ error: "the owner can't leave — delete the group instead" });
    }
  } else {
    const callerMembership = await getMembership(req.actor!.id, community.id);
    if (!callerMembership || !outranks(callerMembership.role, targetMembership.role)) {
      return res.status(403).json({ error: "not allowed" });
    }
  }

  await prisma.communityMembership.delete({ where: { id: targetMembership.id } });

  if (isSelf && !isLocalActor(community.actor)) {
    await deliverActivity(req.actor!, community.actor.inboxUrl, undoFollowActivity(req.actor!, actorIri(community.actor)));
  }

  res.status(204).end();
});

const roleChangeSchema = z.object({ role: z.enum(["admin", "moderator", "member"]) });

// PATCH /communities/:id/members/:username/role -> owner can set anyone
// to admin/moderator/member; admin can only promote a member to
// moderator or demote a moderator to member (can't touch other admins,
// can't assign "admin").
communitiesRouter.patch("/communities/:id/members/:username/role", requireAuth, async (req, res) => {
  const parsed = roleChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) return res.status(404).json({ error: "not found" });

  const target = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!target) return res.status(404).json({ error: "not found" });

  const targetMembership = await getMembership(target.id, community.id);
  if (!targetMembership || targetMembership.state !== "accepted") {
    return res.status(404).json({ error: "not a member" });
  }
  if (targetMembership.role === "owner") {
    return res.status(403).json({ error: "can't change the owner's role" });
  }

  const callerMembership = await getMembership(req.actor!.id, community.id);
  const newRole = parsed.data.role;
  const allowed = callerMembership
    ? callerMembership.role === "owner" ||
      (callerMembership.role === "admin" && newRole !== "admin" && targetMembership.role !== "admin")
    : false;
  if (!allowed) return res.status(403).json({ error: "not allowed" });

  await prisma.communityMembership.update({
    where: { id: targetMembership.id },
    data: { role: newRole },
  });
  res.json({ role: newRole });
});

const updateCommunitySchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  privacy: privacySchema.optional(),
});

// PATCH /communities/:id -> admin/owner only.
communitiesRouter.patch("/communities/:id", requireAuth, async (req, res) => {
  const parsed = updateCommunitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) return res.status(404).json({ error: "not found" });

  const callerMembership = await getMembership(req.actor!.id, community.id);
  if (!callerMembership || ROLE_RANK[callerMembership.role] < 2) {
    return res.status(403).json({ error: "not allowed" });
  }

  // Same sanitize-and-render-as-HTML treatment as POST /communities.
  const description =
    parsed.data.description !== undefined ? toDescriptionHtml(parsed.data.description) : undefined;
  const updateData = { ...parsed.data, ...(description !== undefined ? { description } : {}) };

  const [updated, actor] = await Promise.all([
    prisma.community.update({ where: { id: community.id }, data: updateData }),
    // A group's AP-facing identity (name/summary) is the underlying
    // Actor row, not the Community row — without this sync, an edited
    // group's federated identity silently goes stale (same bug class as
    // the PostBoost FK cascade issue found in the post-delete phase).
    prisma.actor.update({
      where: { id: community.actorId },
      data: {
        ...(parsed.data.title !== undefined ? { displayName: parsed.data.title } : {}),
        ...(description !== undefined ? { summary: description } : {}),
      },
    }),
  ]);

  void deliverToGroupMembers(community.id, actor, updateActorActivity(actor));

  res.json(updated);
});

// DELETE /communities/:id -> owner, or an instance admin, only. Cascades:
// votes/comments/posts belonging to the group, then its memberships, then
// the group itself — same manual-cascade shape used for album deletion.
// The group's Actor row is left in place, same accepted gap as orphaned
// uploaded files (nothing in this app ever deletes an Actor).
communitiesRouter.delete("/communities/:id", requireAuth, async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) return res.status(404).json({ error: "not found" });

  const callerMembership = await getMembership(req.actor!.id, community.id);
  const isOwner = callerMembership?.role === "owner";
  if (!isOwner && !req.localUser!.isAdmin) {
    return res.status(403).json({ error: "only the owner (or an admin) can delete this group" });
  }

  const posts = await prisma.post.findMany({
    where: { communityId: community.id },
    select: { id: true },
  });

  await deletePosts(posts.map((p) => p.id));
  await prisma.$transaction([
    prisma.communityMembership.deleteMany({ where: { communityId: community.id } }),
    prisma.community.delete({ where: { id: community.id } }),
  ]);

  res.status(204).end();
});

// GET /communities/member/:username -> communities that actor has
// accepted membership in. Secret ones are dropped unless the viewer
// shares that membership (or is looking at their own profile) — avoids
// leaking a secret group's existence/membership through someone's
// profile.
communitiesRouter.get("/communities/member/:username", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const memberships = await prisma.communityMembership.findMany({
    where: { actorId: actor.id, state: "accepted" },
    include: { community: { include: { actor: true } } },
    orderBy: { createdAt: "desc" },
  });

  const viewerId = req.actor?.id;
  const viewerCommunityIds = viewerId
    ? new Set(
        (
          await prisma.communityMembership.findMany({
            where: {
              actorId: viewerId,
              state: "accepted",
              communityId: { in: memberships.map((m) => m.communityId) },
            },
            select: { communityId: true },
          })
        ).map((m) => m.communityId),
      )
    : new Set<string>();

  const visible = memberships.filter(
    (m) =>
      m.community.privacy !== "secret" || viewerCommunityIds.has(m.communityId) || actor.id === viewerId,
  );

  res.json(visible.map((m) => ({ ...m.community, actor: toPublicActor(m.community.actor) })));
});
