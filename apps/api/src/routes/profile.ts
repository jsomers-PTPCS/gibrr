import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { toPublicActor } from "../federation/localActor.js";
import { sanitizeProfileHtml } from "../federation/sanitizeProfileHtml.js";
import { toDescriptionHtml } from "../federation/descriptionHtml.js";
import { updateActorActivity } from "../federation/activities.js";
import { deliverToFollowers } from "../federation/deliver.js";
import { fontPresetKeySchema } from "../federation/fontPresets.js";
import {
  headerPresetKeySchema,
  backgroundPresetKeySchema,
  avatarPresetKeySchema,
} from "../federation/imagePresetKeys.js";
import { aboutVisibilitySchema, redactAboutFields } from "../federation/aboutFields.js";
import { relationshipStatusSchema } from "../federation/relationshipStatus.js";
import { fetchBookwyrmActivity } from "../federation/bookwyrmActivity.js";
import { requireAuth, optionalAuth } from "../auth/session.js";
import { areFriends } from "./friends.js";
import { postInclude, FEED_PAGE_SIZE, withCommentCount, postVisibilityWhere } from "./posts.js";
import {
  attachPostVotes,
  attachCommentVotes,
  attachCalendarSaves,
  attachReactions,
  attachPolls,
  attachBookmarked,
} from "../votes.js";

export const profileRouter = Router();

// GET /profile/:username -> public profile: actor info, follower/following/post
// counts, and their recent posts. Distinct from GET /users/:username (the
// canonical ActivityPub actor IRI, serving JSON-LD) so the web app has a
// plain-JSON shape to consume without content negotiation.
profileRouter.get("/profile/:username", optionalAuth, async (req, res) => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });

  const visibility = await postVisibilityWhere(req.actor?.id);
  const [followerCount, followingCount, posts, comments] = await Promise.all([
    prisma.follow.count({ where: { followingId: actor.id, state: "accepted" } }),
    prisma.follow.count({ where: { followerId: actor.id, state: "accepted" } }),
    prisma.post.findMany({
      where: { authorActorId: actor.id, ...visibility },
      take: FEED_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: "desc" },
      include: postInclude,
    }),
    // "Activity" for the profile's comments tab — not paginated/cursored
    // like posts, just the most recent ones (same simplicity tradeoff as
    // the rest of comments: no pagination this milestone).
    prisma.comment.findMany({
      where: { authorActorId: actor.id },
      take: FEED_PAGE_SIZE,
      orderBy: { createdAt: "desc" },
      include: { post: { select: { id: true, title: true } } },
    }),
  ]);

  const nextCursor = posts.length === FEED_PAGE_SIZE ? posts[posts.length - 1].id : null;
  const [postsWithVotes, commentsWithVotes] = await Promise.all([
    attachPostVotes(posts, req.actor?.id),
    attachCommentVotes(comments, req.actor?.id),
  ]);
  const postsWithSaves = await attachCalendarSaves(postsWithVotes, req.actor?.id);
  const postsWithReactions = await attachReactions(postsWithSaves, req.actor?.id);
  const postsWithPolls = await attachPolls(postsWithReactions, req.actor?.id);
  const postsWithBookmarks = await attachBookmarked(postsWithPolls, req.actor?.id);

  const isOwner = req.actor?.id === actor.id;

  // The viewer's own private sticky note about this profile — never
  // this profile owner's memo about themselves (there isn't one to
  // show a stranger), never anyone else's. null when the viewer isn't
  // logged in or hasn't written one.
  const memo = req.actor
    ? await prisma.profileMemo.findUnique({
        where: { authorActorId_subjectActorId: { authorActorId: req.actor.id, subjectActorId: actor.id } },
      })
    : null;

  res.json({
    actor: redactAboutFields(toPublicActor(actor), isOwner),
    counts: { followers: followerCount, following: followingCount },
    posts: postsWithBookmarks.map(withCommentCount),
    nextCursor,
    comments: commentsWithVotes,
    memo: memo?.body ?? null,
  });
});

const memoSchema = z.object({ body: z.string().max(2000) });

// PUT /profile/:username/memo { body } -> create or replace the
// viewer's own private note about this profile — one slot per
// (author, subject), same replace-don't-stack shape as a Reaction.
// Empty string is accepted (clears the memo to blank without deleting
// the row); DELETE below is for actually removing it.
profileRouter.put("/profile/:username/memo", requireAuth, async (req, res) => {
  const parsed = memoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const subject = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!subject) return res.status(404).json({ error: "not found" });

  const memo = await prisma.profileMemo.upsert({
    where: { authorActorId_subjectActorId: { authorActorId: req.actor!.id, subjectActorId: subject.id } },
    create: { authorActorId: req.actor!.id, subjectActorId: subject.id, body: parsed.data.body },
    update: { body: parsed.data.body },
  });
  res.json({ memo: memo.body });
});

profileRouter.delete("/profile/:username/memo", requireAuth, async (req, res) => {
  const subject = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!subject) return res.status(404).json({ error: "not found" });

  await prisma.profileMemo.deleteMany({
    where: { authorActorId: req.actor!.id, subjectActorId: subject.id },
  });
  res.status(204).end();
});

// GET /profile/:username/bookwyrm -> that actor's recent BookWyrm
// reading activity, live-read (not cached — same "read straight
// through" model as Explore's own live timeline view, since this is a
// specific known person's feed, not a trending list worth pre-warming
// via a sweep). Gated to the owner and their accepted friends only —
// unlike website/other profile fields, this one has real content
// behind it, not just a link, and the feature was asked for
// specifically as a friends-list thing rather than public like the
// rest of the profile.
profileRouter.get("/profile/:username/bookwyrm", optionalAuth, async (req, res) => {
  const actor = await prisma.actor.findFirst({ where: { username: req.params.username } });
  if (!actor) return res.status(404).json({ error: "not found" });
  if (!actor.bookwyrmHandle) return res.status(404).json({ error: "no BookWyrm account linked" });

  const isOwner = req.actor?.id === actor.id;
  if (!isOwner && !(req.actor && (await areFriends(req.actor.id, actor.id)))) {
    return res.status(403).json({ error: "only friends can see this" });
  }

  const items = await fetchBookwyrmActivity(actor.bookwyrmHandle);
  if (items === null) return res.status(502).json({ error: "could not reach that BookWyrm account" });

  res.json({ items });
});

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  summary: z.string().max(2000).optional(),
  pronouns: z.string().max(50).optional(),
  location: z.string().max(100).optional(),
  // Not a strict z.string().url() — plenty of people will type
  // "example.com" without a scheme, and rejecting that is more annoying
  // than useful. The frontend prepends https:// when rendering as a link.
  website: z.string().max(300).optional(),
  // "user@domain", same loose-validation philosophy as website above —
  // real resolution (webfinger) happens live at fetch time
  // (federation/bookwyrmActivity.ts), not here, so a typo just means
  // "couldn't reach that account" later rather than a rejected save now.
  bookwyrmHandle: z
    .string()
    .max(200)
    .transform((v) => v.trim().replace(/^@/, ""))
    .optional(),
  // MySpace-style customization, rendered client-side inside a
  // sandbox="" iframe (see CustomProfileFrame.tsx) — sanitizing customHtml
  // here is defense in depth, not the primary control. customCss is
  // stored as-is: CSS can't execute script, and the sandbox already
  // contains the two things user CSS could otherwise abuse (full-page
  // takeover via position:fixed, and scope escape).
  customCss: z.string().max(20000).optional(),
  customHtml: z.string().max(20000).optional(),
  // Loosely validated strings, not a strict hex regex — CSS accepts named
  // colors and rgb()/hsl() too. The safety property here comes from how
  // these are applied on the frontend (React's style prop, never a raw
  // <style> block), not from input validation.
  backgroundColor: z.string().max(40).optional(),
  headerColor: z.string().max(40).optional(),
  introBoxColor: z.string().max(40).optional(),
  contentBoxColor: z.string().max(40).optional(),
  fontColor: z.string().max(40).optional(),
  // Closed vocabulary — see federation/fontPresets.ts.
  fontFamily: fontPresetKeySchema.optional(),
  // Built-in preset "pictures" — mutually exclusive with the corresponding
  // uploaded image (see the handler below, which clears the *ImageUrl
  // field whenever its preset is set).
  headerPreset: headerPresetKeySchema.optional(),
  backgroundPreset: backgroundPresetKeySchema.optional(),
  avatarPreset: avatarPresetKeySchema.optional(),
  // "About" section — free text where there's no controlled vocabulary to
  // enforce, arrays where the data is naturally tag-like (and where a
  // future search-filter feature will want discrete values to match
  // against, not substrings of a paragraph).
  workplace: z.string().max(200).optional(),
  hometown: z.string().max(200).optional(),
  dateOfBirth: z.string().datetime().optional(),
  gender: z.string().max(200).optional(),
  languages: z.array(z.string().max(40)).max(20).optional(),
  education: z.string().max(200).optional(),
  interests: z.array(z.string().max(40)).max(20).optional(),
  customFacts: z
    .array(z.object({ label: z.string().max(60), value: z.string().max(300) }))
    .max(10)
    .optional(),
  // Free self-description — see federation/relationshipStatus.ts. Tagging
  // a specific person (spouse/partner/etc.) is separate, see
  // routes/family.ts, and requires their confirmation.
  relationshipStatus: relationshipStatusSchema.optional(),
  // Default-hidden — see federation/aboutFields.ts. Merged into the
  // existing map, not replaced wholesale, so toggling one field doesn't
  // require resending every other field's visibility.
  aboutVisibility: aboutVisibilitySchema.optional(),
});

// PATCH /profile -> update the logged-in user's own profile fields.
profileRouter.patch("/profile", requireAuth, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { customHtml, summary, headerPreset, backgroundPreset, avatarPreset, dateOfBirth, aboutVisibility, ...rest } =
    parsed.data;

  let mergedVisibility: Record<string, boolean> | undefined;
  if (aboutVisibility) {
    const current = await prisma.actor.findUnique({
      where: { id: req.actor!.id },
      select: { aboutVisibility: true },
    });
    mergedVisibility = {
      ...((current?.aboutVisibility as Record<string, boolean> | null) ?? {}),
      ...aboutVisibility,
    };
  }

  const actor = await prisma.actor.update({
    where: { id: req.actor!.id },
    data: {
      ...rest,
      ...(customHtml !== undefined ? { customHtml: sanitizeProfileHtml(customHtml) } : {}),
      // A plain textarea (see u/[username]/edit/page.tsx) — real markup
      // never comes from here, but toDescriptionHtml promotes the plain
      // text to the same blank-line-paragraph HTML a remote actor's own
      // summary already arrives as (see remoteActor.ts), so both render
      // identically through RenderedDescription on the profile page.
      ...(summary !== undefined ? { summary: toDescriptionHtml(summary) } : {}),
      ...(dateOfBirth !== undefined ? { dateOfBirth: new Date(dateOfBirth) } : {}),
      ...(mergedVisibility !== undefined ? { aboutVisibility: mergedVisibility } : {}),
      // Picking a preset means "use this instead of my uploaded image" —
      // enforced here rather than trusted from the client.
      ...(headerPreset !== undefined ? { headerPreset, headerImageUrl: null } : {}),
      ...(backgroundPreset !== undefined ? { backgroundPreset, backgroundImageUrl: null } : {}),
      ...(avatarPreset !== undefined ? { avatarPreset, avatarImageUrl: null } : {}),
    },
  });

  // Fire-and-forget, same as every other federated delivery in this app
  // — a slow/unreachable follower inbox shouldn't delay the response.
  void deliverToFollowers(actor, updateActorActivity(actor));

  res.json({ actor: toPublicActor(actor) });
});
