import { Router } from "express";
import type { Actor, PostVisibility } from "@prisma/client";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../auth/session.js";
import {
  attachPostVotes,
  attachCalendarSaves,
  attachBoosted,
  attachReactions,
  attachPolls,
  attachBookmarked,
} from "../votes.js";
import { saveProcessedImage, saveValidatedFile } from "../uploads.js";
import { isLocalActor, actorIri, getOrCreateInstanceActor } from "../federation/localActor.js";
import {
  createNoteFromPost,
  createActivity,
  updateActivity,
  deleteActivity,
  likeActivity,
  reactActivity,
  voteActivity,
  announceActivity,
  undoAnnounceActivity,
  postObjectIri,
} from "../federation/activities.js";
import { deliverToFollowers, deliverActivity } from "../federation/deliver.js";
import { deletePosts } from "../deletion.js";
import { extractHashtagTokens, extractMentionTokens } from "../federation/textEntities.js";
import { resolveMentions } from "../federation/mentions.js";
import { resolveAndCacheRemotePost } from "../federation/remotePost.js";
import { fetchLiveCounts } from "../federation/remoteEngagement.js";

// Whether the viewer is this post's real local author — computed here
// (not a votes.ts-style batch helper, no query needed: authorActorId
// already rides along on every Post row via postInclude's `include`)
// rather than shipping raw actor ids for the client to compare, matching
// the myVote/boosted per-viewer-computed-server-side convention.
function canEditPost(post: { authorActorId: string }, viewerId?: string): boolean {
  return viewerId !== undefined && post.authorActorId === viewerId;
}

function wantsActivityJson(req: { get(name: string): string | undefined }): boolean {
  const accept = req.get("accept") ?? "";
  return accept.includes("activity+json") || accept.includes("ld+json");
}

export const postsRouter = Router();

// Memory storage, same pattern as routes/profileImage.ts and
// routes/photos.ts — 50MB cap, larger than the 15MB photo-only cap
// elsewhere since this endpoint also accepts video.
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const POST_IMAGE_SPEC = { width: 2048, height: 2048, fit: "inside" as const };
const ALLOWED_VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);

// POST /posts/media (multipart: file) -> uploads and validates a photo or
// video, returns a URL to reference from POST /posts. Two-step upload
// (this, then create the post referencing the returned URL) rather than
// folding file upload into POST /posts's JSON body, which already has a
// lot of optional fields from earlier features. The buffer's real type is
// sniffed via magic bytes (file-type), never trusted from the client's
// declared Content-Type or filename — same rule saveProcessedImage
// already enforces for every other image upload in this app. Video has
// no re-encoding pipeline (no ffmpeg in this project) — accepted
// containers are stored as-is once confirmed genuine; a disclosed
// limitation, not every codec inside is guaranteed to play in every
// browser.
postsRouter.post("/posts/media", requireAuth, mediaUpload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "missing file" });
  }

  const detected = await fileTypeFromBuffer(req.file.buffer);
  if (!detected) {
    return res.status(400).json({ error: "could not determine file type" });
  }

  if (detected.mime.startsWith("image/")) {
    try {
      const url = await saveProcessedImage(req.file.buffer, POST_IMAGE_SPEC);
      return res.status(201).json({ url, type: "image" });
    } catch {
      return res.status(400).json({ error: "could not process image — is it a valid image file?" });
    }
  }

  if (ALLOWED_VIDEO_MIME.has(detected.mime)) {
    const url = await saveValidatedFile(req.file.buffer, detected.ext);
    return res.status(201).json({ url, type: "video" });
  }

  return res
    .status(400)
    .json({ error: "unsupported file type — only images and common video formats are accepted" });
});

// A post is visible to a viewer if: its community is public, or the
// viewer has an accepted membership in it; OR (a communityId: null
// "personal note") its visibility is "public"/"local_only" (both fully
// visible locally — they only differ in federation delivery, see
// createNoteFromPost), or the viewer is the author, follows the author
// ("followers" visibility), or is a specified recipient ("specified"
// visibility). Shared by GET /tags/:name, GET /profile/:username's
// posts list, and the post half of GET /search (routes/search.ts) so
// these can't drift apart — GET /feed has its own two visibility
// builders (federated scope, follow-graph scope) since its shape
// doesn't fit this single where-clause, but they apply the same rules.
export async function postVisibilityWhere(viewerId?: string) {
  // Plain authorActorId: { in: [...] }, precomputed here, rather than a
  // nested author: { followers: { some: {...} } } relation filter —
  // simpler and matches how GET /feed already computes its own
  // followedIds list rather than filtering through the relation.
  const followingIds = viewerId
    ? (
        await prisma.follow.findMany({
          where: { followerId: viewerId, state: "accepted" },
          select: { followingId: true },
        })
      ).map((f) => f.followingId)
    : [];

  return {
    OR: [
      { community: { privacy: "public" } },
      ...(viewerId
        ? [
            { community: { members: { some: { actorId: viewerId, state: "accepted" } } } },
            { authorActorId: viewerId },
            {
              communityId: null,
              visibility: "followers" as const,
              authorActorId: { in: followingIds },
            },
            {
              communityId: null,
              visibility: "specified" as const,
              recipients: { some: { actorId: viewerId } },
            },
          ]
        : []),
      { communityId: null, visibility: { in: ["public", "local_only"] as PostVisibility[] } },
    ],
  };
}

// Actor ids the viewer has blocked — applied at every post-listing
// endpoint (GET /feed, GET /posts/:id, GET /communities/:id/posts,
// GET /tags/:name, and the post half of GET /search) so a blocked
// author's posts stop showing up in any of them. Does NOT make the
// blocked author's profile page itself inaccessible — that would need
// auth-aware visibility checks on every profile read path, a much
// bigger change than "block hides their stuff from your feeds and cuts
// off new interaction." A disclosed limitation, not silently dropped.
export async function blockedActorIds(viewerId?: string): Promise<string[]> {
  if (!viewerId) return [];
  const blocks = await prisma.block.findMany({ where: { blockerId: viewerId }, select: { blockedId: true } });
  return blocks.map((b) => b.blockedId);
}

// Write-path counterpart — whether an actor may post to a community.
// Same rule as postVisibilityWhere's community branch, checked directly
// (not via a where clause) since callers already have the community
// row. Used both at post-creation time (is this community postable-to)
// and by hasPostAccess below (does an existing community post's own
// community allow this viewer in).
async function hasCommunityAccess(
  communityId: string,
  privacy: string | null,
  actorId?: string,
): Promise<boolean> {
  if (privacy === "public") return true;
  if (!actorId) return false;
  const membership = await prisma.communityMembership.findUnique({
    where: { actorId_communityId: { actorId, communityId } },
  });
  return membership?.state === "accepted";
}

// Write-path counterpart to postVisibilityWhere — whether an actor may
// view/vote/react/boost an *existing* post, community or personal note
// alike. Takes the post itself (not just its community) since a
// personal note's access rule depends on its own visibility/author/
// recipients, not a community row. See postVisibilityWhere for the read
// (where-clause) version of the same rule.
async function hasPostAccess(
  post: {
    id: string;
    communityId: string | null;
    visibility: PostVisibility;
    authorActorId: string;
    community: { privacy: string } | null;
  },
  actorId?: string,
): Promise<boolean> {
  if (actorId === post.authorActorId) return true;
  if (post.communityId !== null) {
    return hasCommunityAccess(post.communityId, post.community?.privacy ?? null, actorId);
  }
  if (post.visibility === "public" || post.visibility === "local_only") return true;
  if (!actorId) return false;
  if (post.visibility === "followers") {
    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: actorId, followingId: post.authorActorId } },
    });
    return follow?.state === "accepted";
  }
  // "specified"
  const recipient = await prisma.postRecipient.findUnique({
    where: { postId_actorId: { postId: post.id, actorId } },
  });
  return Boolean(recipient);
}

// imageUrl/videoUrl must point at a file this app generated (via POST
// /posts/media), not an arbitrary external URL — this field means "the
// file I just uploaded," not a generic embed.
const uploadedFileUrl = z.string().max(500).regex(/^\/uploads\//, "must be an uploaded file");

const POST_VISIBILITY_LEVELS = ["public", "followers", "specified", "local_only"] as const;

const createPostSchema = z
  .object({
    // Optional: omitting it makes this a "personal note" (no community),
    // governed by `visibility` instead of a community's own
    // public/private/secret tier. A community post is always forced to
    // "public" server-side regardless of what's sent (below) — the
    // community's own privacy tier already governs it.
    communityId: z.string().uuid().optional(),
    visibility: z.enum(POST_VISIBILITY_LEVELS).default("public"),
    // Only meaningful when visibility === "specified" — space-free
    // handles ("user" or "user@domain"), resolved the same way @mentions
    // in a post body already are (federation/mentions.ts).
    specifiedHandles: z.array(z.string().min(1).max(320)).max(20).optional(),
    title: z.string().min(1).max(300),
    url: z.string().url().optional(),
    body: z.string().max(20000).optional(),
    contentWarning: z.string().max(300).optional(),
    eventStart: z.string().datetime().optional(),
    eventEnd: z.string().datetime().optional(),
    eventLocation: z.string().max(300).optional(),
    imageUrl: uploadedFileUrl.optional(),
    videoUrl: uploadedFileUrl.optional(),
    location: z.string().max(200).optional(),
    // A poll — federated as an ActivityPub Question, not a Note (see
    // federation/activities.ts's createNoteFromPost). 2-8 options;
    // pollExpiresAt omitted/null means it never expires.
    pollOptions: z.array(z.string().min(1).max(200)).min(2).max(8).optional(),
    pollMultiple: z.boolean().default(false),
    pollExpiresAt: z.string().datetime().optional(),
  })
  .refine(
    (data) =>
      Boolean(data.url) || Boolean(data.body) || Boolean(data.imageUrl) || Boolean(data.videoUrl) ||
      Boolean(data.pollOptions?.length),
    { message: "post must have a url, a body, media, or a poll" },
  )
  .refine((data) => !(data.imageUrl && data.videoUrl), {
    message: "a post can have an image or a video, not both",
    path: ["videoUrl"],
  })
  .refine((data) => !data.eventEnd || Boolean(data.eventStart), {
    message: "eventEnd requires eventStart",
    path: ["eventEnd"],
  })
  .refine((data) => !data.eventLocation || Boolean(data.eventStart), {
    message: "eventLocation requires eventStart",
    path: ["eventLocation"],
  })
  .refine(
    (data) => !data.eventEnd || new Date(data.eventEnd) > new Date(data.eventStart!),
    { message: "eventEnd must be after eventStart", path: ["eventEnd"] },
  );

postsRouter.post("/posts", requireAuth, async (req, res) => {
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const {
    communityId,
    visibility: requestedVisibility,
    specifiedHandles,
    title,
    url,
    body,
    contentWarning,
    eventStart,
    eventEnd,
    eventLocation,
    imageUrl,
    videoUrl,
    location,
    pollOptions,
    pollMultiple,
    pollExpiresAt,
  } = parsed.data;

  let community: { id: string; privacy: string } | null = null;
  if (communityId) {
    community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) return res.status(404).json({ error: "community not found" });
    if (!(await hasCommunityAccess(community.id, community.privacy, req.actor!.id))) {
      return res.status(403).json({ error: "you must be a member of this community to post here" });
    }
  }
  // A community post is always "public" — the community's own privacy
  // tier already governs it; a second, conflicting visibility concept
  // on the same post would just be confusing.
  const visibility: PostVisibility = community ? "public" : requestedVisibility;

  // Resolving a remote @user@domain mention needs a webfinger round trip
  // (federation/mentions.ts) — done before creating the row since it
  // doesn't depend on the post existing yet.
  const mentionedActors = await resolveMentions(extractMentionTokens(body ?? ""), req.actor!);

  let recipientActors: Actor[] = [];
  if (visibility === "specified") {
    // Same tokenizer/resolver pair @mentions in a body already use — a
    // list of "@handle" strings, some local some remote, is exactly
    // what that pair already solves.
    const handleTokens = extractMentionTokens((specifiedHandles ?? []).map((h) => `@${h}`).join(" "));
    recipientActors = await resolveMentions(handleTokens, req.actor!);
    if (recipientActors.length === 0) {
      return res.status(400).json({ error: "specify at least one valid recipient" });
    }
  }

  const post = await prisma.post.create({
    data: {
      title,
      url,
      body,
      contentWarning,
      hashtags: body ? extractHashtagTokens(body) : [],
      communityId: community?.id,
      visibility,
      authorActorId: req.actor!.id,
      eventStart: eventStart ? new Date(eventStart) : undefined,
      eventEnd: eventEnd ? new Date(eventEnd) : undefined,
      eventLocation,
      imageUrl,
      videoUrl,
      location,
      ...(recipientActors.length > 0
        ? { recipients: { create: recipientActors.map((a) => ({ actorId: a.id })) } }
        : {}),
      ...(pollOptions
        ? {
            pollMultiple,
            pollExpiresAt: pollExpiresAt ? new Date(pollExpiresAt) : undefined,
            pollOptions: { create: pollOptions.map((text, position) => ({ text, position })) },
          }
        : {}),
    },
    include: postInclude,
  });
  const [withVotes] = await attachPostVotes([post], req.actor!.id);
  const [withSaves] = await attachCalendarSaves([withVotes], req.actor!.id);
  const [withBoosted] = await attachBoosted([withSaves], req.actor!.id);
  const [withReactions] = await attachReactions([withBoosted], req.actor!.id);
  const [withPoll] = await attachPolls([withReactions], req.actor!.id);
  const [withBookmarked] = await attachBookmarked([withPoll], req.actor!.id);

  const createNote = createActivity(
    createNoteFromPost(post, req.actor!, mentionedActors, recipientActors),
    req.actor!,
  );

  if (visibility === "specified") {
    // Delivered only to the named recipients — a mention inside the
    // body is deliberately NOT an additional delivery target here
    // (unlike public/followers below), since that would leak a
    // specified note to someone outside the chosen audience.
    for (const recipient of recipientActors) {
      if (!isLocalActor(recipient)) {
        void deliverActivity(req.actor!, recipient.inboxUrl, createNote);
      }
    }
  } else if (visibility !== "local_only") {
    // Fire-and-forget — a slow/unreachable follower inbox shouldn't delay
    // (or fail) the response for the person who just posted.
    void deliverToFollowers(req.actor!, createNote);
    // A mention reaches the mentioned actor directly, regardless of the
    // follow graph — same reasoning routes/comments.ts already uses for
    // reply notifications.
    for (const mentioned of mentionedActors) {
      if (!isLocalActor(mentioned)) {
        void deliverActivity(req.actor!, mentioned.inboxUrl, createNote);
      }
    }
  }
  // "local_only" is never delivered anywhere, by design — see
  // createNoteFromPost's addressing comment.

  res.status(201).json({ ...withBookmarked, commentCount: 0, boostedBy: null, canEdit: true });
});

export const postInclude = {
  author: {
    select: {
      username: true,
      domain: true,
      displayName: true,
      avatarImageUrl: true,
      avatarPreset: true,
    },
  },
  community: {
    select: { id: true, title: true, privacy: true, actor: { select: { username: true } } },
  },
  _count: { select: { comments: true } },
  pollOptions: {
    orderBy: { position: "asc" as const },
    include: { _count: { select: { votes: true } } },
  },
} as const;

export function withCommentCount<T extends { _count: { comments: number } }>(post: T) {
  const { _count, ...rest } = post;
  return { ...rest, commentCount: _count.comments };
}

export const FEED_PAGE_SIZE = 25;

// GET /feed -> the one timeline. Community-visible posts (postVisibilityWhere
// — public communities, plus ones the viewer has joined) merged with two
// follow-graph sources for a logged-in viewer: their null-community
// federated timeline posts (routes/inbox.ts; the one thing community
// visibility can't express — a post with no community never matches
// postVisibilityWhere's community-relation filter), and posts *boosted* by
// someone they follow (PostBoost, tagged with who boosted it, possibly
// authored by someone they don't follow at all — that's the point of a
// boost). Everything else a naive "posts by people I follow" query would
// add is already covered by postVisibilityWhere regardless of authorship —
// a public or member-visible community post shows up here whether or not
// the viewer follows its author.
//
// Pagination only covers the community-query cursor — the follow-graph
// branch and boosts are merged in on top, best-effort, not part of the
// cursor. Cleanly paginating a union of independently-cursored sources is
// real complexity this demo-scale app doesn't need; the first page
// reliably interleaves everything, later pages may not.
// GET /feed/federated-domains[?scope=federated] -> populates the server
// filter on the Federated and Home feeds. Registered as its own path,
// not a query param on GET /feed itself, since it's a wholly different
// shape (a domain list, not a page of posts).
//
// The two scopes answer genuinely different questions, not just a
// narrower/wider version of the same one. Federated's is "every domain
// with any eligible public post" — a firehose filter, so the list is
// exactly as broad as the feed it narrows. Home's is "servers you're
// actually connected to" (people you follow, servers you've subscribed
// to via Explore) rather than "every domain among anything visible in
// your feed" (which used to be this same query generalized to home
// scope) — confirmed live that the latter listed 160+ domains, almost
// all from Explore-cached content the viewer never asked to see
// individually, making the picker too broad to actually use for what
// it's for: narrowing down to specific people/servers you deliberately
// listen to.
postsRouter.get("/feed/federated-domains", optionalAuth, async (req, res) => {
  const viewerId = req.actor?.id;
  const federated = req.query.scope === "federated";

  if (federated) {
    const actors = await prisma.actor.findMany({
      where: {
        posts: { some: { communityId: null, visibility: { in: ["public", "local_only"] as PostVisibility[] } } },
      },
      select: { domain: true },
      distinct: ["domain"],
      orderBy: { domain: "asc" },
    });
    return res.json(actors.map((a) => a.domain));
  }

  if (!viewerId) return res.json([]);

  const [followedDomains, subscribedServerDomains] = await Promise.all([
    prisma.actor.findMany({
      where: { followers: { some: { followerId: viewerId, state: "accepted" } } },
      select: { domain: true },
      distinct: ["domain"],
    }),
    prisma.exploreServer.findMany({
      where: { subscriptions: { some: { actorId: viewerId } } },
      select: { domain: true },
    }),
  ]);

  const domains = [
    ...new Set([...followedDomains.map((a) => a.domain), ...subscribedServerDomains.map((s) => s.domain)]),
  ].sort();
  res.json(domains);
});

// "new" keeps the existing cursor-paginated, multi-source merge below
// entirely unchanged in shape — every other sort ranks by a metric
// (score, score/age, comment count, recent-activity count) that isn't a
// stored, monotonic column the way createdAt is, so cursor pagination
// doesn't apply to them the same way; see the ranked branch further
// down for how those are handled instead (a bounded candidate window,
// ranked and paged by plain offset).
const feedSortSchema = z.enum(["new", "top", "rising", "active", "comments"]);
const feedRangeSchema = z.enum(["day", "week", "month", "all"]);

function rangeStartDate(range: z.infer<typeof feedRangeSchema>): Date | null {
  const now = Date.now();
  switch (range) {
    case "day":
      return new Date(now - 24 * 60 * 60_000);
    case "week":
      return new Date(now - 7 * 24 * 60 * 60_000);
    case "month":
      return new Date(now - 30 * 24 * 60 * 60_000);
    case "all":
      return null;
  }
}

postsRouter.get("/feed", optionalAuth, async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const viewerId = req.actor?.id;
  const federated = req.query.scope === "federated";

  const sortParsed = feedSortSchema.safeParse(req.query.sort);
  const sort = sortParsed.success ? sortParsed.data : "new";
  const rangeParsed = feedRangeSchema.safeParse(req.query.range);
  const range = rangeParsed.success ? rangeParsed.data : "all";
  const rangeStart = rangeStartDate(range);
  // "Show only these" (not "hide these") — an empty list means no
  // narrowing at all, same as today, rather than "show nothing."
  const communityIds =
    typeof req.query.communityIds === "string"
      ? req.query.communityIds.split(",").map((id) => id.trim()).filter(Boolean)
      : [];

  const blockedIds = await blockedActorIds(viewerId);

  // Federated scope: every null-community post/boost this instance has
  // ever cached, from anyone — a follow, a relay (routes/admin.ts's
  // relay subscriptions), or a resolved URL — not scoped to the
  // viewer's own follow graph at all. This is the actual "see more of
  // the fediverse" surface: relay-forwarded content caches exactly like
  // any other federated post, but the default scope below only ever
  // shows *your own* follows' content, so without this branch a relay
  // subscription would have nowhere visible to show up.
  const followedIds = federated
    ? []
    : viewerId
      ? (
          await prisma.follow.findMany({
            where: { followerId: viewerId, state: "accepted" },
            select: { followingId: true },
          })
        ).map((f) => f.followingId)
      : [];

  // Author domain(s) and/or a keyword — was federated-scope-only, a
  // single value (that firehose is the one broad enough to usually need
  // narrowing down), now a "show only these" allow-list available on
  // Home too, same shape as communityIds just below, so "which servers/
  // circles show up" can actually narrow either feed. `communityIds`/
  // `rangeStart` (parsed above) fold in here too, since all of these are
  // just additional filter conditions layered onto whatever scope's own
  // visibility rules already decide is eligible.
  const domainFilter =
    typeof req.query.domain === "string"
      ? req.query.domain.split(",").map((d) => d.trim()).filter(Boolean)
      : [];
  const qFilter = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
  const extraPostFilter = {
    ...(domainFilter.length > 0 ? { author: { domain: { in: domainFilter } } } : {}),
    ...(qFilter
      ? {
          OR: [
            { title: { contains: qFilter, mode: "insensitive" as const } },
            { body: { contains: qFilter, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
    ...(communityIds.length > 0 ? { communityId: { in: communityIds } } : {}),
  };

  const postsWhere = federated
    ? {
        AND: [
          // A followers-only/specified note must never surface in the
          // instance-wide relay/browse tab, unlike the default scope
          // below where a follow relationship (or being a specified
          // recipient) can unlock it.
          { communityId: null, visibility: { in: ["public", "local_only"] as PostVisibility[] } },
          ...(blockedIds.length > 0 ? [{ authorActorId: { notIn: blockedIds } }] : []),
          extraPostFilter,
        ],
      }
    : await (async () => {
        // Deliberately NOT postVisibilityWhere(viewerId) here — that
        // helper's own last OR branch ({ communityId: null, visibility:
        // { in: ["public", "local_only"] } }, no author restriction at
        // all) is exactly right for viewing one post by direct link
        // (GET /posts/:id) or browsing a hashtag across everyone (GET
        // /tags/:name), but wrong for Home: it means literally any
        // public personal note this instance has ever cached — a
        // relay's, an explore-sweep's before its own narrowing below
        // even applies, anything ever resolved by URL — counts as
        // "visible," so it can (and, confirmed live, does) crowd real
        // follows/circles out of the recency-ordered take-25 below
        // whenever there's enough of that other content sitting in the
        // database. Home's own equivalent replaces that catch-all with
        // one scoped to an actual relationship: a public/local_only note
        // only counts here if its author is someone the viewer actually
        // follows.
        const homeVisibilityOr = [
          { community: { privacy: "public" } },
          ...(viewerId
            ? [
                { community: { members: { some: { actorId: viewerId, state: "accepted" } } } },
                { authorActorId: viewerId },
                {
                  communityId: null,
                  visibility: "specified" as const,
                  recipients: { some: { actorId: viewerId } },
                },
              ]
            : []),
          ...(followedIds.length > 0
            ? [
                {
                  communityId: null,
                  authorActorId: { in: followedIds },
                  visibility: { in: ["public", "followers", "local_only"] as PostVisibility[] },
                },
              ]
            : []),
        ];
        return {
          AND: [
            { OR: homeVisibilityOr },
            ...(blockedIds.length > 0 ? [{ authorActorId: { notIn: blockedIds } }] : []),
            // Explore-cached content (federation/exploreSweep.ts) is
            // meant to be private to whoever subscribed to that server
            // — without this, postVisibilityWhere's generic "any public
            // personal note is visible to everyone" clause would leak
            // one person's subscription into every other user's Home
            // feed the moment the sweep caches something. Only narrows
            // posts that actually carry an explore-cache link; anything
            // cached some other way (a follow, a relay, a resolved URL)
            // is untouched, and this doesn't apply to the Federated
            // scope above, which is meant to show everything cached to
            // everyone regardless (same as relay content already does
            // there). Disclosed edge case: a post that happens to be
            // both explore-cached AND independently visible some other
            // way (e.g. also from someone you follow) can still get
            // excluded here if you don't subscribe to the server that
            // cached it — not worth untangling "which of a post's
            // several reasons to be visible actually applies" for that
            // narrow overlap.
            {
              OR: [
                { exploreCachedIn: { none: {} } },
                ...(viewerId
                  ? [
                      {
                        exploreCachedIn: {
                          some: { server: { subscriptions: { some: { actorId: viewerId } } } },
                        },
                      },
                    ]
                  : []),
              ],
            },
            // Same reasoning and shape as the exploreCachedIn clause just
            // above, for RSS/Atom content (federation/rssFeeds.ts) —
            // private to whoever's actually listening to that feed.
            {
              OR: [
                { rssCachedIn: { is: null } },
                ...(viewerId
                  ? [{ rssCachedIn: { is: { feed: { subscriptions: { some: { actorId: viewerId } } } } } }]
                  : []),
              ],
            },
            extraPostFilter,
          ],
        };
      })();

  // Top/Rising/Active/Most-comments: ranks real Posts by an aggregate
  // metric rather than createdAt, so it can't reuse the cursor-paginated
  // multi-source merge below (a boost isn't a distinct thing to rank —
  // it's a reshare of a Post that already gets ranked on its own
  // merits, so boostedBy is always null here, unlike "new"). Ranks
  // within a bounded, most-recent-first candidate window rather than
  // truly everything postsWhere matches — for "all time" on a feed with
  // more than RANK_CANDIDATE_CAP eligible posts, a genuinely old but
  // still-highly-scored post outside that window won't surface, the
  // same "make forward progress within a bound, not exhaustive" posture
  // used elsewhere in this codebase (e.g. remote reply syncing). `cursor`
  // here is a page number, not a post id, but reuses the same query
  // param/response field the "new" path's own cursor does, so the
  // frontend's "pass nextCursor back to load more" flow doesn't need to
  // know which kind of feed it's paging through.
  if (sort !== "new") {
    // A freshly-cached federated post's local commentCount/score is close
    // to meaningless for ranking purposes on their own — comments only
    // get pulled in from the origin server lazily, the first time someone
    // actually opens that post's thread (routes/comments.ts), and a local
    // vote score alone ignores every like/boost the post has picked up
    // elsewhere in the fediverse. Confirmed live: sorting 500 candidates
    // by raw commentCount surfaced nothing but zeros ahead of posts with
    // real double-digit comment counts on their origin server. Both
    // "comments" and "top" fetch each candidate's live counts
    // (federation/remoteEngagement.ts, the same fetch GET /posts/:id
    // already does for one post) before ranking rather than after — a
    // real per-post network cost, so the candidate window is cut down for
    // these two sorts specifically to keep it bounded.
    const RANK_CANDIDATE_CAP = sort === "comments" || sort === "top" ? 150 : 500;
    const page = cursor && /^\d+$/.test(cursor) ? parseInt(cursor, 10) : 0;

    const candidates = await prisma.post.findMany({
      where: postsWhere,
      take: RANK_CANDIDATE_CAP,
      orderBy: { createdAt: "desc" },
      include: postInclude,
    });

    const withVotes = await attachPostVotes(candidates, viewerId);
    const withSaves = await attachCalendarSaves(withVotes, viewerId);
    const withBoosted = await attachBoosted(withSaves, viewerId);
    const withReactions = await attachReactions(withBoosted, viewerId);
    const withPolls = await attachPolls(withReactions, viewerId);
    const withBookmarked = await attachBookmarked(withPolls, viewerId);
    const withCounts = withBookmarked.map(withCommentCount);

    // "Most active" is a recent-activity signal (attention in roughly
    // the last day), deliberately independent of the selected time
    // range — a post's lifetime vote/comment totals (already available
    // as score/commentCount) say nothing about whether it's active
    // *right now*, which is what this sort is actually for. Only
    // computed for this one bounded candidate set, not attempted feed-
    // wide.
    const recentActivityByPostId = new Map<string, number>();
    if (sort === "active" && withCounts.length > 0) {
      const recentWindowStart = new Date(Date.now() - 24 * 60 * 60_000);
      const ids = withCounts.map((p) => p.id);
      const [recentVotes, recentComments] = await Promise.all([
        prisma.postVote.groupBy({
          by: ["postId"],
          where: { postId: { in: ids }, createdAt: { gte: recentWindowStart } },
          _count: { _all: true },
        }),
        prisma.comment.groupBy({
          by: ["postId"],
          where: { postId: { in: ids }, createdAt: { gte: recentWindowStart } },
          _count: { _all: true },
        }),
      ]);
      for (const v of recentVotes) {
        recentActivityByPostId.set(v.postId, (recentActivityByPostId.get(v.postId) ?? 0) + v._count._all);
      }
      for (const c of recentComments) {
        recentActivityByPostId.set(c.postId, (recentActivityByPostId.get(c.postId) ?? 0) + c._count._all);
      }
    }

    // Same live remote-engagement fetch the "new" path does below —
    // duplicated rather than shared across the early return, since the
    // two paths' post shapes diverge before this point (withCounts here
    // vs. withBookmarked there). Run on the *candidate* set (not just
    // the eventual page) for "comments" specifically, since ranking by
    // this sort needs the real count before it can sort at all — see
    // this branch's own opening comment. Every other sort still only
    // fetches this for the final page, right before responding, same as
    // before.
    const remoteEngagementByPostId = new Map<
      string,
      { likes: number | null; shares: number | null; comments?: number | null }
    >();
    async function fetchRemoteEngagementFor(subjects: (typeof withCounts)[number][]): Promise<void> {
      const eligible = subjects.filter((p) => {
        if (!p.remoteId || remoteEngagementByPostId.has(p.id)) return false;
        try {
          return !new URL(p.remoteId).host.endsWith("reddit.com");
        } catch {
          return false;
        }
      });
      if (eligible.length === 0) return;
      const instanceActor = await getOrCreateInstanceActor();
      await Promise.all(
        eligible.map(async (p) => {
          const counts = await fetchLiveCounts(p.remoteId!, instanceActor).catch(() => null);
          if (counts) remoteEngagementByPostId.set(p.id, counts);
        }),
      );
    }
    // "Top" needs each candidate's live fediverse counts before it can
    // rank at all too — a local vote score alone ignores every like,
    // reaction, and boost the post picked up on its origin server (or
    // anywhere else in the fediverse), which is most of a federated
    // post's real popularity.
    if (sort === "comments" || sort === "top") await fetchRemoteEngagementFor(withCounts);

    const now = Date.now();
    function metricFor(post: (typeof withCounts)[number]): number {
      switch (sort) {
        case "top": {
          // Local score (this instance's own up/downvotes) plus local
          // emoji reactions plus the origin server's live favourite and
          // boost/reblog counts — a federated post's real popularity
          // isn't just whatever votes it picked up here.
          const localReactions = post.reactions.reduce((sum, r) => sum + r.count, 0);
          const remote = remoteEngagementByPostId.get(post.id);
          return post.score + localReactions + (remote?.likes ?? 0) + (remote?.shares ?? 0);
        }
        case "rising": {
          // Velocity, not raw score — a brand-new post with a handful of
          // votes can outrank an old post that's merely accumulated more
          // over a much longer time, which is the whole point of Rising
          // versus Top. Floored at 1 hour so a post from the last few
          // minutes doesn't get an extreme, noisy score/age ratio.
          const ageHours = Math.max(1, (now - post.createdAt.getTime()) / 3_600_000);
          return post.score / ageHours;
        }
        case "comments":
          // The real, origin-reported total when available — falls back
          // to the local (likely stale/zero) commentCount only for a
          // local post, or one whose live fetch just failed.
          return remoteEngagementByPostId.get(post.id)?.comments ?? post.commentCount;
        case "active":
          return recentActivityByPostId.get(post.id) ?? 0;
        default:
          return 0;
      }
    }

    const ranked = [...withCounts].sort((a, b) => metricFor(b) - metricFor(a));
    const pageStart = page * FEED_PAGE_SIZE;
    const pagePosts = ranked.slice(pageStart, pageStart + FEED_PAGE_SIZE);
    const rankedNextCursor = pageStart + FEED_PAGE_SIZE < ranked.length ? String(page + 1) : null;

    await fetchRemoteEngagementFor(pagePosts);

    return res.json({
      posts: pagePosts.map((p) => ({
        ...p,
        boostedBy: null,
        canEdit: canEditPost(p, viewerId),
        remoteEngagement: remoteEngagementByPostId.get(p.id) ?? null,
      })),
      nextCursor: rankedNextCursor,
    });
  }

  const boostsWhere = federated
    ? {
        post: {
          communityId: null,
          ...(blockedIds.length > 0 ? { authorActorId: { notIn: blockedIds } } : {}),
          ...extraPostFilter,
        },
      }
    : {
        actorId: { in: followedIds },
        post: {
          ...(blockedIds.length > 0 ? { authorActorId: { notIn: blockedIds } } : {}),
          ...extraPostFilter,
        },
      };

  const [posts, boosts, explorePosts, rssPosts] = await Promise.all([
    prisma.post.findMany({
      where: postsWhere,
      take: FEED_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: "desc" },
      include: postInclude,
    }),
    federated || followedIds.length > 0
      ? prisma.postBoost.findMany({
          where: boostsWhere,
          orderBy: { createdAt: "desc" },
          take: FEED_PAGE_SIZE,
          include: {
            post: { include: postInclude },
            actor: { select: { username: true, domain: true, displayName: true } },
          },
        })
      : Promise.resolve([]),
    // Posts federation/exploreSweep.ts resolved+cached from a server the
    // viewer subscribed to (routes/explore.ts) — merged into the same
    // home timeline as everything else, same reasoning a boost from
    // someone you follow is: you opted into this source, so it belongs
    // here, not off in a separate view. Not part of the federated scope
    // (that's every cached post regardless of any opt-in) or the
    // community-shaped postsWhere above (this join has nothing to do
    // with community membership).
    !federated && viewerId
      ? prisma.post.findMany({
          where: {
            exploreCachedIn: { some: { server: { subscriptions: { some: { actorId: viewerId } } } } },
            ...(blockedIds.length > 0 ? { authorActorId: { notIn: blockedIds } } : {}),
            ...extraPostFilter,
          },
          take: FEED_PAGE_SIZE,
          orderBy: { createdAt: "desc" },
          include: postInclude,
        })
      : Promise.resolve([]),
    // Same reasoning as explorePosts just above, for RSS/Atom content
    // (federation/rssFeeds.ts) — guarantees a feed you listen to shows
    // up on the first page even if postsWhere's own cursor window filled
    // up with follow-graph/community content first.
    !federated && viewerId
      ? prisma.post.findMany({
          where: {
            rssCachedIn: { is: { feed: { subscriptions: { some: { actorId: viewerId } } } } },
            ...(blockedIds.length > 0 ? { authorActorId: { notIn: blockedIds } } : {}),
            ...extraPostFilter,
          },
          take: FEED_PAGE_SIZE,
          orderBy: { createdAt: "desc" },
          include: postInclude,
        })
      : Promise.resolve([]),
  ]);

  const nextCursor = posts.length === FEED_PAGE_SIZE ? posts[posts.length - 1].id : null;

  const entries = [
    ...posts.map((post) => ({ post, sortAt: post.createdAt, boostedBy: null })),
    ...boosts.map((b) => ({ post: b.post, sortAt: b.createdAt, boostedBy: b.actor })),
    ...explorePosts.map((post) => ({ post, sortAt: post.createdAt, boostedBy: null })),
    ...rssPosts.map((post) => ({ post, sortAt: post.createdAt, boostedBy: null })),
  ];

  const seen = new Set<string>();
  const merged = entries
    .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime())
    .filter((e) => (seen.has(e.post.id) ? false : (seen.add(e.post.id), true)))
    .slice(0, FEED_PAGE_SIZE);

  const boostedByPostId = new Map(merged.map((e) => [e.post.id, e.boostedBy]));

  const withVotes = await attachPostVotes(
    merged.map((e) => e.post),
    viewerId,
  );
  const withSaves = await attachCalendarSaves(withVotes, viewerId);
  const withBoosted = await attachBoosted(withSaves, viewerId);
  const withReactions = await attachReactions(withBoosted, viewerId);
  const withPolls = await attachPolls(withReactions, viewerId);
  const withBookmarked = await attachBookmarked(withPolls, viewerId);

  // Real origin like/reply counts, live — same fetch GET /posts/:id
  // already does for a single post, now also done here despite the cost
  // (a per-post live network round trip, in parallel, on every feed
  // load) because a freshly-cached federated post's own score/
  // commentCount are always ~0: whoever posted it had zero interactions
  // *at the moment their server pushed it to our inbox*, and nothing
  // about a follow-graph delivery ever tells us how that's changed
  // since. Best-effort per post — one slow/unreachable server degrades
  // to that post showing no remoteEngagement, not the whole feed.
  const remoteEngagementByPostId = new Map<
    string,
    { likes: number | null; shares: number | null; comments?: number | null }
  >();
  // Reddit's remoteId (federation/rssFeeds.ts) is never a real
  // ActivityPub object — a live signed fetch against it would only ever
  // fail, so it's excluded up front rather than attempted and discarded.
  const remoteCandidates = withBookmarked.filter((p) => {
    if (!p.remoteId) return false;
    try {
      return !new URL(p.remoteId).host.endsWith("reddit.com");
    } catch {
      return false;
    }
  });
  if (remoteCandidates.length > 0) {
    const instanceActor = await getOrCreateInstanceActor();
    await Promise.all(
      remoteCandidates.map(async (p) => {
        const counts = await fetchLiveCounts(p.remoteId!, instanceActor).catch(() => null);
        if (counts) remoteEngagementByPostId.set(p.id, counts);
      }),
    );
  }

  res.json({
    posts: withBookmarked.map((p) => ({
      ...withCommentCount(p),
      boostedBy: boostedByPostId.get(p.id) ?? null,
      canEdit: canEditPost(p, viewerId),
      remoteEngagement: remoteEngagementByPostId.get(p.id) ?? null,
    })),
    nextCursor,
  });
});

// GET /tags/:name -> local hashtag browse (app/tag/[name]/page.tsx).
// Same visibility rule as /feed's community branch (postVisibilityWhere)
// — a tag browse doesn't bypass a private community's posts any more
// than the main feed does. name is lowercased to match how
// Post.hashtags is stored (extractHashtagTokens normalizes the same way
// at write time), so "#Foo" and "#foo" land on the same page.
postsRouter.get("/tags/:name", optionalAuth, async (req, res) => {
  const tag = req.params.name.toLowerCase();
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const blockedIds = await blockedActorIds(req.actor?.id);

  const posts = await prisma.post.findMany({
    where: {
      hashtags: { has: tag },
      ...(await postVisibilityWhere(req.actor?.id)),
      ...(blockedIds.length > 0 ? { authorActorId: { notIn: blockedIds } } : {}),
    },
    take: FEED_PAGE_SIZE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: "desc" },
    include: postInclude,
  });

  const nextCursor = posts.length === FEED_PAGE_SIZE ? posts[posts.length - 1].id : null;
  const withVotes = await attachPostVotes(posts, req.actor?.id);
  const withSaves = await attachCalendarSaves(withVotes, req.actor?.id);
  const withBoosted = await attachBoosted(withSaves, req.actor?.id);
  const withReactions = await attachReactions(withBoosted, req.actor?.id);
  const withPolls = await attachPolls(withReactions, req.actor?.id);
  const withBookmarked = await attachBookmarked(withPolls, req.actor?.id);

  res.json({
    posts: withBookmarked.map((p) => ({ ...withCommentCount(p), boostedBy: null, canEdit: canEditPost(p, req.actor?.id) })),
    nextCursor,
  });
});

// GET /communities/:id/posts -> that group's own posts, for the group
// page (routes/communities.ts covers everything else group-related, but
// this is post-querying logic that belongs next to postInclude/
// attachPostVotes/hasCommunityAccess — both routers mount at the app
// root with no path prefix, so where a route is defined doesn't matter).
// 404 (not empty list) for a private/secret group the viewer can't
// access — same existence-hiding convention as GET /posts/:id.
postsRouter.get("/communities/:id/posts", optionalAuth, async (req, res) => {
  const community = await prisma.community.findUnique({ where: { id: req.params.id } });
  if (!community) return res.status(404).json({ error: "not found" });

  if (!(await hasCommunityAccess(community.id, community.privacy, req.actor?.id))) {
    return res.status(404).json({ error: "not found" });
  }

  const blockedIds = await blockedActorIds(req.actor?.id);
  const posts = await prisma.post.findMany({
    where: {
      communityId: community.id,
      ...(blockedIds.length > 0 ? { authorActorId: { notIn: blockedIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: FEED_PAGE_SIZE,
    include: postInclude,
  });
  const withVotes = await attachPostVotes(posts, req.actor?.id);
  const withSaves = await attachCalendarSaves(withVotes, req.actor?.id);
  const withBoosted = await attachBoosted(withSaves, req.actor?.id);
  const withReactions = await attachReactions(withBoosted, req.actor?.id);
  const withPolls = await attachPolls(withReactions, req.actor?.id);
  const withBookmarked = await attachBookmarked(withPolls, req.actor?.id);

  res.json(
    withBookmarked.map((p) => ({ ...withCommentCount(p), boostedBy: null, canEdit: canEditPost(p, req.actor?.id) })),
  );
});

// GET /posts/resolve?url=<iri> -> "paste a post URL to view/reply/like
// it," the pull counterpart to this app's existing push-only federation
// (a follow's Create, a boost, a reply). Deliberately not follow-gated —
// that gate exists to stop a stranger from pushing content into a local
// user's timeline unsolicited; this is an authenticated user pulling a
// specific URL they already have, same as Mastodon's own "look up a
// post by URL." requireAuth alone (not a follow relationship) is what
// keeps this from being an open URL-fetch proxy. Registered before
// GET /posts/:id — that route would otherwise swallow "resolve" as if
// it were a post id.
postsRouter.get("/posts/resolve", requireAuth, async (req, res) => {
  const parsed = z.object({ url: z.string().url() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const postId = await resolveAndCacheRemotePost(parsed.data.url, req.actor!);
  if (!postId) return res.status(404).json({ error: "could not resolve that URL to a post" });

  res.json({ id: postId });
});

// Content-negotiated: a remote server dereferencing a post's object IRI
// (the same URL referenced in the Create/Like activities we deliver) gets
// the AP Note representation; the web client (default Accept) gets the
// existing plain-JSON shape unchanged.
postsRouter.get("/posts/:id", optionalAuth, async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    include: postInclude,
  });
  if (!post) return res.status(404).json({ error: "not found" });

  if (!(await hasPostAccess(post, req.actor?.id))) {
    return res.status(404).json({ error: "not found" });
  }

  if (wantsActivityJson(req)) {
    res.set("Content-Type", "application/activity+json");
    return res.json(createNoteFromPost(post, post.author));
  }

  // Blocking is a viewer-scoped concept, not something a remote server
  // dereferencing this object (the branch above) should ever be subject
  // to — only the web client's own plain-JSON response is gated.
  if (req.actor && (await blockedActorIds(req.actor.id)).includes(post.authorActorId)) {
    return res.status(404).json({ error: "not found" });
  }

  const [withVotes] = await attachPostVotes([post], req.actor?.id);
  const [withSaves] = await attachCalendarSaves([withVotes], req.actor?.id);
  const [withBoosted] = await attachBoosted([withSaves], req.actor?.id);
  const [withReactions] = await attachReactions([withBoosted], req.actor?.id);
  const [withPoll] = await attachPolls([withReactions], req.actor?.id);
  const [withBookmarked] = await attachBookmarked([withPoll], req.actor?.id);

  // For a federated post, its real origin-reported like/share/comment
  // counts — fetched live, on this one already-slower single-post path,
  // never on the feed. The actual reply *thread* isn't synced here
  // anymore — GET /posts/:postId/comments (routes/comments.ts) is the
  // one place that happens now, since that's hit by every way a viewer
  // actually looks at comments (this page, a feed's inline accordion,
  // the Loops drawer), not just this one. commentCount below still
  // reflects whatever's already been synced from an earlier comments
  // fetch — a real, if momentarily stale, number, not a fresh sync
  // trigger of its own.
  let commentCount = withBookmarked._count.comments;
  let remoteEngagement: { likes: number | null; shares: number | null; comments?: number | null } | null = null;
  // Reddit's remoteId (federation/rssFeeds.ts) is never a real
  // ActivityPub object — no live counts to fetch this way (Reddit's real
  // API needs its own authenticated app, which this instance isn't set
  // up for).
  const isReddit = (() => {
    if (!post.remoteId) return false;
    try {
      return new URL(post.remoteId).host.endsWith("reddit.com");
    } catch {
      return false;
    }
  })();
  if (post.remoteId && !isReddit) {
    const instanceActor = await getOrCreateInstanceActor();
    remoteEngagement = await fetchLiveCounts(post.remoteId, instanceActor);
    commentCount = await prisma.comment.count({ where: { postId: post.id } });
  }

  res.json({
    ...withCommentCount(withBookmarked),
    commentCount,
    remoteEngagement,
    boostedBy: null,
    canEdit: canEditPost(withBookmarked, req.actor?.id),
  });
});

// Same editable-field shape as createPostSchema minus communityId (moving
// communities is a different action) and the event fields (fixed
// post-creation this pass — wrong event details means delete-and-repost).
// Nullable + optional throughout: an omitted field is left alone, an
// explicit null clears it — standard PATCH semantics. title stays
// non-nullable, same as creation — a local post always has one.
const updatePostSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  url: z.string().url().nullable().optional(),
  body: z.string().max(20000).nullable().optional(),
  contentWarning: z.string().max(300).nullable().optional(),
  imageUrl: uploadedFileUrl.nullable().optional(),
  videoUrl: uploadedFileUrl.nullable().optional(),
  location: z.string().max(200).nullable().optional(),
});

// PATCH /posts/:id -> author-only edit. authorActorId === req.actor!.id
// alone guarantees this is genuinely local content, not something cached
// from elsewhere — a cached post's authorActorId is always its real
// remote author, which can never equal a local viewer's own actor id.
// Federates an Update wrapping the refreshed Note, same follower-delivery
// helper POST /posts already uses for Create.
postsRouter.patch("/posts/:id", requireAuth, async (req, res) => {
  const parsed = updatePostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: "not found" });
  if (post.authorActorId !== req.actor!.id) {
    return res.status(403).json({ error: "you can only edit your own posts" });
  }

  const patch = parsed.data;
  const merged = {
    title: patch.title !== undefined ? patch.title : post.title,
    url: patch.url !== undefined ? patch.url : post.url,
    body: patch.body !== undefined ? patch.body : post.body,
    contentWarning: patch.contentWarning !== undefined ? patch.contentWarning : post.contentWarning,
    imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : post.imageUrl,
    videoUrl: patch.videoUrl !== undefined ? patch.videoUrl : post.videoUrl,
    location: patch.location !== undefined ? patch.location : post.location,
  };
  // Same two invariants createPostSchema enforces at creation time,
  // re-checked here since a PATCH can clear a field creation never could.
  if (!(merged.url || merged.body || merged.imageUrl || merged.videoUrl)) {
    return res.status(400).json({ error: "post must have a url, a body, or media" });
  }
  if (merged.imageUrl && merged.videoUrl) {
    return res.status(400).json({ error: "a post can have an image or a video, not both" });
  }

  // An edit can add a brand-new mention, so this resolves again rather
  // than reusing whatever was resolved at creation time.
  const mentionedActors = await resolveMentions(extractMentionTokens(merged.body ?? ""), req.actor!);

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      ...merged,
      hashtags: merged.body ? extractHashtagTokens(merged.body) : [],
      updatedAt: new Date(),
    },
    include: postInclude,
  });

  const updateNote = updateActivity(createNoteFromPost(updated, req.actor!, mentionedActors), req.actor!);
  void deliverToFollowers(req.actor!, updateNote);
  for (const mentioned of mentionedActors) {
    if (!isLocalActor(mentioned)) {
      void deliverActivity(req.actor!, mentioned.inboxUrl, updateNote);
    }
  }

  const [withVotes] = await attachPostVotes([updated], req.actor!.id);
  const [withSaves] = await attachCalendarSaves([withVotes], req.actor!.id);
  const [withBoosted] = await attachBoosted([withSaves], req.actor!.id);
  const [withReactions] = await attachReactions([withBoosted], req.actor!.id);
  const [withPoll] = await attachPolls([withReactions], req.actor!.id);
  const [withBookmarked] = await attachBookmarked([withPoll], req.actor!.id);

  res.json({ ...withCommentCount(withBookmarked), boostedBy: null, canEdit: true });
});

// DELETE /posts/:id -> author-only delete, federates a Delete to the
// author's own followers, then the same cascade (src/deletion.ts) admin
// moderation and community deletion use.
postsRouter.delete("/posts/:id", requireAuth, async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post) return res.status(404).json({ error: "not found" });
  if (post.authorActorId !== req.actor!.id) {
    return res.status(403).json({ error: "you can only delete your own posts" });
  }

  void deliverToFollowers(req.actor!, deleteActivity(req.actor!, postObjectIri(post)));
  await deletePosts([post.id]);

  res.status(204).end();
});

const voteSchema = z.object({ value: z.union([z.literal(1), z.literal(-1)]) });

postsRouter.post("/posts/:id/vote", requireAuth, async (req, res) => {
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const postId = req.params.id;
  const actorId = req.actor!.id;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { community: { select: { id: true, privacy: true } }, author: true },
  });
  if (!post) return res.status(404).json({ error: "not found" });
  if (!(await hasPostAccess(post, actorId))) {
    return res.status(404).json({ error: "not found" });
  }

  const existing = await prisma.postVote.findUnique({
    where: { postId_actorId: { postId, actorId } },
  });
  // Only a fresh upvote federates as a Like — no clean AP equivalent for a
  // downvote, and un-liking would need an Undo(Like) referencing the
  // original activity's id, which isn't persisted (out of scope).
  const becameLike = parsed.data.value === 1 && existing?.value !== 1;

  if (existing?.value === parsed.data.value) {
    await prisma.postVote.delete({ where: { id: existing.id } });
  } else {
    await prisma.postVote.upsert({
      where: { postId_actorId: { postId, actorId } },
      create: { postId, actorId, value: parsed.data.value },
      update: { value: parsed.data.value },
    });
  }

  if (becameLike && !isLocalActor(post.author)) {
    void deliverActivity(req.actor!, post.author.inboxUrl, likeActivity(req.actor!, postObjectIri(post)));
  }

  const [{ score, myVote }] = await attachPostVotes([{ id: postId }], actorId);
  res.json({ score, myVote });
});

const reactionSchema = z.object({ emoji: z.string().min(1).max(64) });
const CUSTOM_EMOJI_PATTERN = /^:([a-z0-9_]+):$/;

// PUT /posts/:id/reactions { emoji } -> upserts the viewer's one
// reaction slot (one per person per post — picking a new emoji replaces
// the old one, same semantics real Misskey uses, not independent
// stacking toggles). `emoji` is either a raw unicode character/sequence
// or ":shortcode:" referencing a CustomEmoji.
postsRouter.put("/posts/:id/reactions", requireAuth, async (req, res) => {
  const parsed = reactionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const postId = req.params.id;
  const actorId = req.actor!.id;
  const emoji = parsed.data.emoji;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { community: { select: { id: true, privacy: true } }, author: true },
  });
  if (!post) return res.status(404).json({ error: "not found" });
  if (!(await hasPostAccess(post, actorId))) {
    return res.status(404).json({ error: "not found" });
  }

  let customEmojiImageUrl: string | undefined;
  const shortcodeMatch = emoji.match(CUSTOM_EMOJI_PATTERN);
  if (shortcodeMatch) {
    const customEmoji = await prisma.customEmoji.findUnique({ where: { shortcode: shortcodeMatch[1] } });
    if (!customEmoji) return res.status(400).json({ error: "unknown custom emoji" });
    customEmojiImageUrl = customEmoji.imageUrl;
  }

  await prisma.reaction.upsert({
    where: { postId_actorId: { postId, actorId } },
    create: { postId, actorId, emoji },
    update: { emoji },
  });

  // Same federation posture as the vote route above: only a fresh
  // reaction delivers, and only to a remote author — replacing an
  // existing reaction doesn't send an Undo for the old one either (no
  // original activity id persisted to reference, same disclosed gap as
  // a changed/removed vote never un-federating).
  if (!isLocalActor(post.author)) {
    void deliverActivity(
      req.actor!,
      post.author.inboxUrl,
      reactActivity(req.actor!, postObjectIri(post), emoji, customEmojiImageUrl),
    );
  }

  const [{ reactions, myReaction }] = await attachReactions([{ id: postId }], actorId);
  res.json({ reactions, myReaction });
});

// DELETE /posts/:id/reactions -> removes the viewer's own reaction, if
// any. No federation — same non-issue as un-voting today (nothing was
// ever un-federated for that either).
postsRouter.delete("/posts/:id/reactions", requireAuth, async (req, res) => {
  const postId = req.params.id;
  const actorId = req.actor!.id;

  await prisma.reaction.deleteMany({ where: { postId, actorId } });

  const [{ reactions, myReaction }] = await attachReactions([{ id: postId }], actorId);
  res.json({ reactions, myReaction });
});

const pollVoteSchema = z.object({ optionIds: z.array(z.string().uuid()).min(1).max(8) });

// POST /posts/:id/poll-votes { optionIds } -> vote (or, for a
// single-select poll, replace an existing vote — same "one choice
// slot" rule as PUT /posts/:id/reactions, not independent toggles).
// Gated by hasPostAccess exactly like every other post interaction —
// a poll attached to a followers-only/specified personal note you
// can't see refuses your vote the same way it refuses a reaction.
postsRouter.post("/posts/:id/poll-votes", requireAuth, async (req, res) => {
  const parsed = pollVoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const postId = req.params.id;
  const actorId = req.actor!.id;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      community: { select: { id: true, privacy: true } },
      author: true,
      pollOptions: true,
    },
  });
  if (!post) return res.status(404).json({ error: "not found" });
  if (post.pollOptions.length === 0) return res.status(400).json({ error: "this post has no poll" });
  if (!(await hasPostAccess(post, actorId))) {
    return res.status(404).json({ error: "not found" });
  }
  if (post.pollExpiresAt && post.pollExpiresAt < new Date()) {
    return res.status(400).json({ error: "this poll has closed" });
  }

  const optionIds = parsed.data.optionIds;
  const validOptionIds = new Set(post.pollOptions.map((o) => o.id));
  if (!optionIds.every((id) => validOptionIds.has(id))) {
    return res.status(400).json({ error: "invalid option" });
  }
  if (!post.pollMultiple && optionIds.length !== 1) {
    return res.status(400).json({ error: "this poll only accepts one choice" });
  }

  if (!post.pollMultiple) {
    // Single-select: a new vote replaces any existing one(s).
    await prisma.pollVote.deleteMany({
      where: { actorId, optionId: { in: post.pollOptions.map((o) => o.id) } },
    });
  }

  const existingVotes = await prisma.pollVote.findMany({
    where: { actorId, optionId: { in: optionIds } },
    select: { optionId: true },
  });
  const alreadyVotedIds = new Set(existingVotes.map((v) => v.optionId));
  const newOptionIds = post.pollMultiple ? optionIds.filter((id) => !alreadyVotedIds.has(id)) : optionIds;

  if (newOptionIds.length > 0) {
    await prisma.pollVote.createMany({ data: newOptionIds.map((optionId) => ({ optionId, actorId })) });
  }

  // Only a genuinely new vote delivers — re-selecting an option you'd
  // already picked (multi-select) is a no-op locally and shouldn't
  // spam a duplicate reply activity either.
  if (newOptionIds.length > 0 && !isLocalActor(post.author)) {
    const pollObjectIri = postObjectIri(post);
    const authorIri = actorIri(post.author);
    for (const optionId of newOptionIds) {
      const option = post.pollOptions.find((o) => o.id === optionId)!;
      void deliverActivity(
        req.actor!,
        post.author.inboxUrl,
        voteActivity(req.actor!, pollObjectIri, authorIri, option.text),
      );
    }
  }

  const freshOptions = await prisma.pollOption.findMany({
    where: { postId },
    orderBy: { position: "asc" },
    include: { _count: { select: { votes: true } } },
  });
  const [{ poll }] = await attachPolls(
    [{ id: postId, pollMultiple: post.pollMultiple, pollExpiresAt: post.pollExpiresAt, pollOptions: freshOptions }],
    actorId,
  );
  res.json({ poll });
});

// POST /posts/:id/boost -> reshare, delivered to the booster's own
// followers as a signed Announce — federation/deliver.ts's
// deliverToFollowers, same helper POST /posts already uses for Create.
// Targets postObjectIri(post), so boosting a *cached* federated post
// correctly announces the real remote object, not a URL we invented.
postsRouter.post("/posts/:id/boost", requireAuth, async (req, res) => {
  const postId = req.params.id;
  const actorId = req.actor!.id;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { community: { select: { id: true, privacy: true } } },
  });
  if (!post) return res.status(404).json({ error: "not found" });
  if (!(await hasPostAccess(post, actorId))) {
    return res.status(404).json({ error: "not found" });
  }
  // Boosting delivers an Announce to *your own* followers, including
  // remote ones — reshare a followers-only/specified/local-only
  // personal note and either its restricted audience is no longer
  // restricted, or (local_only) it leaves the instance despite never
  // being meant to. Same reasoning Mastodon uses to block reblogging a
  // non-public status.
  if (post.communityId === null && post.visibility !== "public") {
    return res.status(403).json({ error: "can't boost a non-public post" });
  }

  const existing = await prisma.postBoost.findUnique({
    where: { actorId_postId: { actorId, postId } },
  });
  if (existing) return res.status(409).json({ error: "already boosted" });

  await prisma.postBoost.create({ data: { actorId, postId } });
  void deliverToFollowers(req.actor!, announceActivity(req.actor!, postObjectIri(post)));

  res.status(201).json({ boosted: true });
});

postsRouter.delete("/posts/:id/boost", requireAuth, async (req, res) => {
  const postId = req.params.id;
  const actorId = req.actor!.id;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return res.status(404).json({ error: "not found" });

  await prisma.postBoost.deleteMany({ where: { actorId, postId } });
  void deliverToFollowers(req.actor!, undoAnnounceActivity(req.actor!, postObjectIri(post)));

  res.status(204).end();
});

// POST/DELETE /posts/:id/bookmark -> a purely private, never-federated
// "save for later" (Misskey/Mastodon's "bookmark") — same shape and
// same reasoning as CalendarEventSave (routes/calendar.ts): gated by
// hasPostAccess like every other post interaction, but no delivery of
// any kind, since nothing about a bookmark is anyone else's business.
postsRouter.post("/posts/:id/bookmark", requireAuth, async (req, res) => {
  const postId = req.params.id;
  const actorId = req.actor!.id;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { community: { select: { id: true, privacy: true } } },
  });
  if (!post) return res.status(404).json({ error: "not found" });
  if (!(await hasPostAccess(post, actorId))) {
    return res.status(404).json({ error: "not found" });
  }

  await prisma.bookmark.upsert({
    where: { actorId_postId: { actorId, postId } },
    create: { actorId, postId },
    update: {},
  });

  res.status(201).json({ bookmarked: true });
});

postsRouter.delete("/posts/:id/bookmark", requireAuth, async (req, res) => {
  const postId = req.params.id;
  const actorId = req.actor!.id;

  await prisma.bookmark.deleteMany({ where: { actorId, postId } });

  res.status(204).end();
});

// GET /bookmarks -> the logged-in actor's own bookmarked posts, most
// recently bookmarked first. No pagination — matches this app's
// established simplicity precedent for post listings (see GET /feed's
// sibling pages in apps/web, none of which have "load more" UI yet).
postsRouter.get("/bookmarks", requireAuth, async (req, res) => {
  const actorId = req.actor!.id;

  const bookmarks = await prisma.bookmark.findMany({
    where: { actorId },
    orderBy: { createdAt: "desc" },
    include: { post: { include: postInclude } },
  });
  const posts = bookmarks.map((b) => b.post);

  const withVotes = await attachPostVotes(posts, actorId);
  const withSaves = await attachCalendarSaves(withVotes, actorId);
  const withBoosted = await attachBoosted(withSaves, actorId);
  const withReactions = await attachReactions(withBoosted, actorId);
  const withPolls = await attachPolls(withReactions, actorId);
  const withBookmarked = await attachBookmarked(withPolls, actorId);

  res.json({
    posts: withBookmarked.map((p) => ({
      ...withCommentCount(p),
      boostedBy: null,
      canEdit: canEditPost(p, actorId),
    })),
  });
});
