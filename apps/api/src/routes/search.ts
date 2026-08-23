import { Router } from "express";
import type { Actor } from "@prisma/client";
import { prisma } from "../db.js";
import { optionalAuth } from "../auth/session.js";
import { postInclude, withCommentCount, postVisibilityWhere, blockedActorIds } from "./posts.js";
import { attachPostVotes, attachCalendarSaves, attachReactions, attachPolls, attachBookmarked } from "../votes.js";
import { toPublicActor } from "../federation/localActor.js";
import type { AboutFieldKey } from "../federation/aboutFields.js";

export const searchRouter = Router();

const SEARCH_LIMIT = 20;

export interface AboutMatch {
  field: AboutFieldKey;
  value: string;
}

// String About fields matched by substring; array fields (languages,
// interests) matched by exact tag value, not substring — see the comment
// on those fields in routes/profile.ts's updateProfileSchema: they were
// deliberately kept as discrete tags "for a future search-filter feature
// [that] will want discrete values to match against, not substrings of a
// paragraph." This is that feature.
const STRING_ABOUT_FIELDS = ["workplace", "hometown", "education", "gender"] as const;
const ARRAY_ABOUT_FIELDS = ["languages", "interests"] as const;

// Only ever returns matches on fields the actor has explicitly made
// public (aboutVisibility[field] === true) — a private field must never
// be observable through search, even indirectly (e.g. "this person
// showed up for query X" would leak that a private field matches X).
// This check runs in application code, after the DB has already done the
// broad substring/tag narrowing, so it's the actual privacy boundary
// here — not the query itself.
function publicAboutMatches(actor: Actor, q: string): AboutMatch[] {
  const visibility = (actor.aboutVisibility as Record<string, boolean> | null) ?? {};
  const lowerQ = q.toLowerCase();
  const matches: AboutMatch[] = [];

  for (const field of STRING_ABOUT_FIELDS) {
    const value = actor[field];
    if (value && visibility[field] === true && value.toLowerCase().includes(lowerQ)) {
      matches.push({ field, value });
    }
  }

  for (const field of ARRAY_ABOUT_FIELDS) {
    if (visibility[field] !== true) continue;
    const hit = actor[field].find((v) => v.toLowerCase() === lowerQ);
    if (hit) matches.push({ field, value: hit });
  }

  return matches;
}

// GET /search?q=... -> posts (by title), local people (by username, or by
// a public About field), and local groups (by title/description/actor
// username), case-insensitive substring match. Public — no auth required
// to search, same as browsing the feed.
searchRouter.get("/search", optionalAuth, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.json({ posts: [], actors: [], groups: [] });

  // People search accepts a leading "@" the way typing an actual handle
  // (@alice) naturally would, and ignores it — a literal "@" is never
  // part of anyone's stored username/displayName/domain, so leaving it
  // in would silently return zero matches instead of finding the person
  // the "@" was clearly meant to reference. Left alone for the post/
  // group search below: those match arbitrary text content, where an
  // "@" could be a real, intentional part of what's being searched for
  // (e.g. finding a post that mentions "@alice").
  const personQuery = q.startsWith("@") ? q.slice(1) : q;

  const viewerId = req.actor?.id;
  const blockedIds = await blockedActorIds(viewerId);
  const visibility = await postVisibilityWhere(viewerId);

  const [posts, actorsByUsername, actorsByAbout, groups] = await Promise.all([
    prisma.post.findMany({
      where: {
        // Both this OR and postVisibilityWhere's own OR would collide
        // under a plain object spread (same key, one silently
        // overwrites the other) — AND-wrapping keeps them as two
        // independent conditions, same pattern GET /feed already uses
        // to combine multiple OR-bearing where-clauses.
        AND: [
          {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { body: { contains: q, mode: "insensitive" } },
            ],
          },
          visibility,
          ...(blockedIds.length > 0 ? [{ authorActorId: { notIn: blockedIds } }] : []),
        ],
      },
      take: SEARCH_LIMIT,
      orderBy: { createdAt: "desc" },
      include: postInclude,
    }),
    // Matches anywhere in the name — username, display name, or the
    // instance domain itself (so "therapist" finds someone whose
    // *server* is therapist.social even if their handle doesn't say
    // so) — not just a prefix or exact match. Also matches remote
    // actors this instance already has cached (Actor rows created via
    // upsertRemoteActor — anyone who's followed/been followed,
    // mentioned, boosted, or authored a post that arrived through a
    // relay subscription, see federation/remoteActor.ts) — this is
    // still only ever a search over what this instance already knows
    // about, never a live crawl of the wider fediverse (no server has
    // an index like that to search). Excludes Application/Service
    // actors (relay bots themselves) since those aren't type "Person".
    prisma.actor.findMany({
      where: {
        type: "Person",
        OR: [
          { username: { contains: personQuery, mode: "insensitive" } },
          { displayName: { contains: personQuery, mode: "insensitive" } },
          { domain: { contains: personQuery, mode: "insensitive" } },
        ],
      },
      take: SEARCH_LIMIT,
    }),
    prisma.actor.findMany({
      where: {
        type: "Person",
        OR: [
          ...STRING_ABOUT_FIELDS.map((field) => ({ [field]: { contains: q, mode: "insensitive" as const } })),
          ...ARRAY_ABOUT_FIELDS.map((field) => ({ [field]: { has: q } })),
        ],
      },
      take: SEARCH_LIMIT,
    }),
    // Same secret-exclusion rule as GET /communities (routes/communities.ts):
    // a secret group is invisible here unless the viewer already belongs to it.
    prisma.community.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { actor: { username: { contains: q, mode: "insensitive" } } },
          { actor: { domain: { contains: q, mode: "insensitive" } } },
        ],
        AND: viewerId
          ? {
              OR: [
                { privacy: { not: "secret" } },
                { members: { some: { actorId: viewerId, state: "accepted" } } },
              ],
            }
          : { privacy: { not: "secret" } },
      },
      include: { actor: true },
      take: SEARCH_LIMIT,
    }),
  ]);

  const withVotes = await attachPostVotes(posts, req.actor?.id);
  const withSaves = await attachCalendarSaves(withVotes, req.actor?.id);
  const withReactions = await attachReactions(withSaves, req.actor?.id);
  const withPolls = await attachPolls(withReactions, req.actor?.id);
  const withBookmarked = await attachBookmarked(withPolls, req.actor?.id);

  const groupMemberCounts = await prisma.communityMembership.groupBy({
    by: ["communityId"],
    where: { communityId: { in: groups.map((g) => g.id) }, state: "accepted" },
    _count: { _all: true },
  });
  const groupMemberCountById = new Map(groupMemberCounts.map((c) => [c.communityId, c._count._all]));

  const byId = new Map<string, { actor: Actor; aboutMatches: AboutMatch[] }>();
  for (const actor of actorsByUsername) {
    byId.set(actor.id, { actor, aboutMatches: [] });
  }
  for (const actor of actorsByAbout) {
    const aboutMatches = publicAboutMatches(actor, q);
    if (aboutMatches.length === 0) continue; // matched at the DB level via a private field — must not surface
    const existing = byId.get(actor.id);
    if (existing) existing.aboutMatches = aboutMatches;
    else byId.set(actor.id, { actor, aboutMatches });
  }

  res.json({
    posts: withBookmarked.map(withCommentCount),
    actors: [...byId.values()].map(({ actor, aboutMatches }) => ({
      ...toPublicActor(actor),
      aboutMatches,
    })),
    groups: groups.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      privacy: g.privacy,
      memberCount: groupMemberCountById.get(g.id) ?? 0,
      actor: toPublicActor(g.actor),
    })),
  });
});
