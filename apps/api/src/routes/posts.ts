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
import { syncRemoteReplies, fetchLiveCounts } from "../federation/remoteEngagement.js";

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
// GET /feed/federated-domains -> distinct author domains among posts
// eligible for the federated scope — populates the filter dropdown on
// the Federated tab. Registered as its own path, not a query param on
// GET /feed itself, since it's a wholly different shape (a domain list,
// not a page of posts).
postsRouter.get("/feed/federated-domains", optionalAuth, async (_req, res) => {
  const actors = await prisma.actor.findMany({
    where: {
      posts: { some: { communityId: null, visibility: { in: ["public", "local_only"] } } },
    },
    select: { domain: true },
    distinct: ["domain"],
    orderBy: { domain: "asc" },
  });
  res.json(actors.map((a) => a.domain));
});

postsRouter.get("/feed", optionalAuth, async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const viewerId = req.actor?.id;
  const federated = req.query.scope === "federated";

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

  // Federated-only filters — narrowing "everything this instance has
  // cached" down by author domain and/or a keyword, since that firehose
  // is exactly the scope broad enough to need it (Home is already
  // narrowed to your own follows/circles/subscriptions). Ignored
  // outside federated scope; there's no reason to filter an
  // already-personal feed the same way.
  const domainFilter =
    federated && typeof req.query.domain === "string" && req.query.domain.trim()
      ? req.query.domain.trim()
      : undefined;
  const qFilter =
    federated && typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;

  const postsWhere = federated
    ? {
        AND: [
          // A followers-only/specified note must never surface in the
          // instance-wide relay/browse tab, unlike the default scope
          // below where a follow relationship (or being a specified
          // recipient) can unlock it.
          { communityId: null, visibility: { in: ["public", "local_only"] as PostVisibility[] } },
          ...(blockedIds.length > 0 ? [{ authorActorId: { notIn: blockedIds } }] : []),
          ...(domainFilter ? [{ author: { domain: domainFilter } }] : []),
          ...(qFilter
            ? [
                {
                  OR: [
                    { title: { contains: qFilter, mode: "insensitive" as const } },
                    { body: { contains: qFilter, mode: "insensitive" as const } },
                  ],
                },
              ]
            : []),
        ],
      }
    : await (async () => {
        const visibility = await postVisibilityWhere(viewerId);
        return {
          AND: [
            followedIds.length > 0
              ? {
                  OR: [
                    ...visibility.OR,
                    {
                      communityId: null,
                      authorActorId: { in: followedIds },
                      visibility: { in: ["public", "followers", "local_only"] as PostVisibility[] },
                    },
                  ],
                }
              : visibility,
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
          ],
        };
      })();

  const boostsWhere = federated
    ? {
        post: {
          communityId: null,
          ...(blockedIds.length > 0 ? { authorActorId: { notIn: blockedIds } } : {}),
          ...(domainFilter ? { author: { domain: domainFilter } } : {}),
          ...(qFilter
            ? {
                OR: [
                  { title: { contains: qFilter, mode: "insensitive" as const } },
                  { body: { contains: qFilter, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
      }
    : {
        actorId: { in: followedIds },
        ...(blockedIds.length > 0 ? { post: { authorActorId: { notIn: blockedIds } } } : {}),
      };

  const [posts, boosts, explorePosts] = await Promise.all([
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

  res.json({
    posts: withBookmarked.map((p) => ({
      ...withCommentCount(p),
      boostedBy: boostedByPostId.get(p.id) ?? null,
      canEdit: canEditPost(p, viewerId),
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

  // For a federated post, pull in its real reply thread (as ordinary
  // Comment rows, so they render/vote/reply through the existing comment
  // UI and federation) and its real origin-reported like/share counts —
  // both fetched live, on this one already-slower single-post path, never
  // on the feed. See federation/remoteEngagement.ts for the bounded walk.
  let commentCount = withBookmarked._count.comments;
  let remoteEngagement: { likes: number | null; shares: number | null } | null = null;
  if (post.remoteId) {
    const instanceActor = await getOrCreateInstanceActor();
    await syncRemoteReplies({ id: post.id, remoteId: post.remoteId }, instanceActor);
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
