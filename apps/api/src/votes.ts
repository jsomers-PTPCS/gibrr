import { prisma } from "./db.js";

interface VoteData {
  score: number;
  myVote: 1 | -1 | null;
}

// Batches score + "my vote" lookups for a page of posts/comments instead of
// querying per row: one groupBy for the sums, one findMany for the viewer's
// own votes (skipped entirely if there's no logged-in viewer).

export async function attachPostVotes<T extends { id: string }>(
  items: T[],
  viewerActorId?: string,
): Promise<(T & VoteData)[]> {
  if (items.length === 0) return [];
  const ids = items.map((item) => item.id);

  const [sums, myVotes] = await Promise.all([
    prisma.postVote.groupBy({
      by: ["postId"],
      where: { postId: { in: ids } },
      _sum: { value: true },
    }),
    viewerActorId
      ? prisma.postVote.findMany({ where: { postId: { in: ids }, actorId: viewerActorId } })
      : Promise.resolve([]),
  ]);

  const scoreByPost = new Map(sums.map((s) => [s.postId, s._sum.value ?? 0]));
  const myVoteByPost = new Map(myVotes.map((v) => [v.postId, v.value as 1 | -1]));

  return items.map((item) => ({
    ...item,
    score: scoreByPost.get(item.id) ?? 0,
    myVote: myVoteByPost.get(item.id) ?? null,
  }));
}

// Whether the viewer has added a given event post to their own calendar
// (CalendarEventSave) — same per-viewer batching pattern as
// attachPostVotes, deliberately independent of who authored the post.
export async function attachCalendarSaves<T extends { id: string }>(
  items: T[],
  viewerActorId?: string,
): Promise<(T & { savedToCalendar: boolean })[]> {
  if (items.length === 0 || !viewerActorId) {
    return items.map((item) => ({ ...item, savedToCalendar: false }));
  }
  const ids = items.map((item) => item.id);

  const saves = await prisma.calendarEventSave.findMany({
    where: { actorId: viewerActorId, postId: { in: ids } },
  });
  const savedSet = new Set(saves.map((s) => s.postId));

  return items.map((item) => ({ ...item, savedToCalendar: savedSet.has(item.id) }));
}

export interface ReactionSummary {
  emoji: string;
  count: number;
}

// Reaction counts grouped by emoji, plus the viewer's own single
// reaction (if any) — same batching shape as attachPostVotes, but
// grouped by (postId, emoji) instead of summed to one score, since a
// post can carry many distinct emoji at once.
export async function attachReactions<T extends { id: string }>(
  items: T[],
  viewerActorId?: string,
): Promise<(T & { reactions: ReactionSummary[]; myReaction: string | null })[]> {
  if (items.length === 0) return [];
  const ids = items.map((item) => item.id);

  const [grouped, myReactions] = await Promise.all([
    prisma.reaction.groupBy({
      by: ["postId", "emoji"],
      where: { postId: { in: ids } },
      _count: { _all: true },
    }),
    viewerActorId
      ? prisma.reaction.findMany({ where: { postId: { in: ids }, actorId: viewerActorId } })
      : Promise.resolve([]),
  ]);

  const reactionsByPost = new Map<string, ReactionSummary[]>();
  for (const g of grouped) {
    const list = reactionsByPost.get(g.postId) ?? [];
    list.push({ emoji: g.emoji, count: g._count._all });
    reactionsByPost.set(g.postId, list);
  }
  const myReactionByPost = new Map(myReactions.map((r) => [r.postId, r.emoji]));

  return items.map((item) => ({
    ...item,
    reactions: reactionsByPost.get(item.id) ?? [],
    myReaction: myReactionByPost.get(item.id) ?? null,
  }));
}

export interface PollOptionResult {
  id: string;
  text: string;
  count: number;
}

export interface PollResult {
  options: PollOptionResult[];
  multiple: boolean;
  expiresAt: string | null;
  myOptionIds: string[];
}

type PollSourceItem = {
  id: string;
  pollMultiple: boolean;
  pollExpiresAt: Date | null;
  pollOptions: { id: string; text: string; position: number; _count: { votes: number } }[];
};

// Reshapes the pollOptions/pollMultiple/pollExpiresAt already loaded via
// postInclude into a single `poll` field (null when the post has no
// poll), plus the viewer's own selected option ids — one query for
// those, not per-post, same batching shape as attachReactions.
export async function attachPolls<T extends PollSourceItem>(
  items: T[],
  viewerActorId?: string,
): Promise<(T & { poll: PollResult | null })[]> {
  if (items.length === 0) return [];

  const allOptionIds = items.flatMap((item) => item.pollOptions.map((o) => o.id));
  const myVotes =
    viewerActorId && allOptionIds.length > 0
      ? await prisma.pollVote.findMany({
          where: { optionId: { in: allOptionIds }, actorId: viewerActorId },
          select: { optionId: true },
        })
      : [];
  const myVotedOptionIds = new Set(myVotes.map((v) => v.optionId));

  return items.map((item) => {
    if (item.pollOptions.length === 0) return { ...item, poll: null };
    const options = [...item.pollOptions]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, text: o.text, count: o._count.votes }));
    return {
      ...item,
      poll: {
        options,
        multiple: item.pollMultiple,
        expiresAt: item.pollExpiresAt ? item.pollExpiresAt.toISOString() : null,
        myOptionIds: options.map((o) => o.id).filter((id) => myVotedOptionIds.has(id)),
      },
    };
  });
}

// Whether the viewer has boosted a given post — same per-viewer batching
// pattern as attachCalendarSaves.
export async function attachBoosted<T extends { id: string }>(
  items: T[],
  viewerActorId?: string,
): Promise<(T & { boosted: boolean })[]> {
  if (items.length === 0 || !viewerActorId) {
    return items.map((item) => ({ ...item, boosted: false }));
  }
  const ids = items.map((item) => item.id);

  const boosts = await prisma.postBoost.findMany({
    where: { actorId: viewerActorId, postId: { in: ids } },
  });
  const boostedSet = new Set(boosts.map((b) => b.postId));

  return items.map((item) => ({ ...item, boosted: boostedSet.has(item.id) }));
}

// Whether the viewer has bookmarked a given post — same per-viewer
// batching pattern as attachBoosted. A bookmark is purely private/local
// (never federated, see the Bookmark model's own schema comment).
export async function attachBookmarked<T extends { id: string }>(
  items: T[],
  viewerActorId?: string,
): Promise<(T & { bookmarked: boolean })[]> {
  if (items.length === 0 || !viewerActorId) {
    return items.map((item) => ({ ...item, bookmarked: false }));
  }
  const ids = items.map((item) => item.id);

  const bookmarks = await prisma.bookmark.findMany({
    where: { actorId: viewerActorId, postId: { in: ids } },
  });
  const bookmarkedSet = new Set(bookmarks.map((b) => b.postId));

  return items.map((item) => ({ ...item, bookmarked: bookmarkedSet.has(item.id) }));
}

export async function attachCommentVotes<T extends { id: string }>(
  items: T[],
  viewerActorId?: string,
): Promise<(T & VoteData)[]> {
  if (items.length === 0) return [];
  const ids = items.map((item) => item.id);

  const [sums, myVotes] = await Promise.all([
    prisma.commentVote.groupBy({
      by: ["commentId"],
      where: { commentId: { in: ids } },
      _sum: { value: true },
    }),
    viewerActorId
      ? prisma.commentVote.findMany({ where: { commentId: { in: ids }, actorId: viewerActorId } })
      : Promise.resolve([]),
  ]);

  const scoreByComment = new Map(sums.map((s) => [s.commentId, s._sum.value ?? 0]));
  const myVoteByComment = new Map(myVotes.map((v) => [v.commentId, v.value as 1 | -1]));

  return items.map((item) => ({
    ...item,
    score: scoreByComment.get(item.id) ?? 0,
    myVote: myVoteByComment.get(item.id) ?? null,
  }));
}
