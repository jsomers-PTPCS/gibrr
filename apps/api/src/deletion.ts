import { prisma } from "./db.js";

// Deleting a post has to clear everything that references its id first —
// none of these relations cascade at the DB level. Shared by every place a
// post gets deleted: the author's own DELETE /posts/:id, admin moderation
// (routes/admin.ts), a whole community being deleted (routes/communities.ts),
// and an incoming federated Delete for a post we cached (routes/inbox.ts).
// PostBoost was added after the first of these cascades was written and
// missed in all of them — deleting a boosted post used to throw a Postgres
// FK violation.
export async function deletePosts(postIds: string[]): Promise<void> {
  if (postIds.length === 0) return;

  // Report.targetPostId/targetCommentId aren't covered by any of the
  // deletes below — an open report against a post (or a comment under
  // it) would otherwise leave the delete transaction hitting a Postgres
  // FK violation. Comment ids gathered first since they need to go into
  // the same Report cleanup.
  const commentIds = (
    await prisma.comment.findMany({ where: { postId: { in: postIds } }, select: { id: true } })
  ).map((c) => c.id);
  // PollVote FKs to PollOption, not Post directly, so its ids need
  // gathering first too.
  const pollOptionIds = (
    await prisma.pollOption.findMany({ where: { postId: { in: postIds } }, select: { id: true } })
  ).map((o) => o.id);

  await prisma.$transaction([
    prisma.report.deleteMany({
      where: { OR: [{ targetPostId: { in: postIds } }, { targetCommentId: { in: commentIds } }] },
    }),
    prisma.reaction.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.postRecipient.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.pollVote.deleteMany({ where: { optionId: { in: pollOptionIds } } }),
    prisma.pollOption.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.postBoost.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.calendarEventSave.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.bookmark.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.exploreCachedPost.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.commentVote.deleteMany({ where: { comment: { postId: { in: postIds } } } }),
    prisma.comment.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.postVote.deleteMany({ where: { postId: { in: postIds } } }),
    prisma.post.deleteMany({ where: { id: { in: postIds } } }),
  ]);
}

// Comments can nest arbitrarily deep (Comment.parentId), so deleting one has
// to take its whole reply subtree with it — otherwise replies would be left
// pointing at a parentId that no longer exists. Walks the tree breadth-first,
// collecting every descendant id, then deletes them all.
export async function deleteCommentSubtree(rootId: string): Promise<void> {
  const ids = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.comment.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    ids.push(...frontier);
  }

  await prisma.$transaction([
    // Same FK gap as deletePosts above — an open report against one of
    // these comments would otherwise block the delete.
    prisma.report.deleteMany({ where: { targetCommentId: { in: ids } } }),
    prisma.commentVote.deleteMany({ where: { commentId: { in: ids } } }),
    prisma.comment.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

// Permanently removes a local account and everything it touches —
// content it authored, its interactions with everyone else's content,
// every graph edge (follows/blocks/friendships/etc.), messaging
// participation, and side tables — following the same hard-delete
// convention deletePosts/deleteCommentSubtree already establish (no
// tombstoning). This is the first "delete an entire Actor" cascade in
// the app; the schema has no onDelete rules anywhere, so every table
// with a foreign key to Actor has to be cleared by hand, in dependency
// order, or the final actor.delete throws a Postgres FK violation.
//
// Callers are responsible for delivering a federated Delete(actor) to
// followers *before* calling this — deliverToFollowers needs the Follow
// rows this function removes (see routes/admin.ts).
export async function deleteActor(actorId: string): Promise<void> {
  const actor = await prisma.actor.findUnique({
    where: { id: actorId },
    include: { community: true, localUser: true },
  });
  if (!actor) return;
  if (actor.community) {
    // This function is for a LocalUser-backed Person only — deleting a
    // Group needs the whole-community cascade (routes/communities.ts's
    // DELETE /communities/:id), not this. Should be unreachable from
    // the admin users list (Groups aren't LocalUsers), but worth
    // asserting rather than silently mis-cascading a community.
    throw new Error(`deleteActor called on a Group actor (${actorId}) — use community deletion instead`);
  }

  const ownPosts = (
    await prisma.post.findMany({ where: { authorActorId: actorId }, select: { id: true } })
  ).map((p) => p.id);
  await deletePosts(ownPosts);

  // Their own comments anywhere, not just under their own posts —
  // deleteCommentSubtree takes the full reply subtree under each with
  // it, same semantics DELETE /admin/comments/:id already uses.
  const ownCommentIds = (
    await prisma.comment.findMany({ where: { authorActorId: actorId }, select: { id: true } })
  ).map((c) => c.id);
  for (const commentId of ownCommentIds) {
    await deleteCommentSubtree(commentId);
  }

  // Conversations they're a participant in — delete their own sent
  // messages and their participant row; if that leaves a conversation
  // with nobody in it, remove the conversation and whatever messages
  // (from the other party) are left in it too, rather than leaving an
  // orphaned empty thread around.
  const conversationIds = (
    await prisma.conversationParticipant.findMany({ where: { actorId }, select: { conversationId: true } })
  ).map((p) => p.conversationId);

  await prisma.$transaction([
    // Votes/boosts/saves on *other* people's content — not covered by
    // the post/comment deletes above, which only clear rows tied to
    // content this actor itself authored.
    prisma.postVote.deleteMany({ where: { actorId } }),
    prisma.commentVote.deleteMany({ where: { actorId } }),
    prisma.postBoost.deleteMany({ where: { actorId } }),
    prisma.reaction.deleteMany({ where: { actorId } }),
    prisma.pollVote.deleteMany({ where: { actorId } }),
    // Being a "specified" recipient on someone else's personal note —
    // not covered by deletePosts(ownPosts) above, which only clears
    // recipients of posts *this* actor authored.
    prisma.postRecipient.deleteMany({ where: { actorId } }),
    prisma.calendarEventSave.deleteMany({ where: { actorId } }),
    prisma.bookmark.deleteMany({ where: { actorId } }),
    prisma.antenna.deleteMany({ where: { actorId } }),
    prisma.exploreSubscription.deleteMany({ where: { actorId } }),
    // Both directions — memos this actor wrote about others, and any
    // memos other people wrote about this actor (their own private
    // notes, gone the same as any other data tied to a deleted actor).
    prisma.profileMemo.deleteMany({ where: { OR: [{ authorActorId: actorId }, { subjectActorId: actorId }] } }),

    // Graph edges, both directions.
    prisma.follow.deleteMany({ where: { OR: [{ followerId: actorId }, { followingId: actorId }] } }),
    prisma.block.deleteMany({ where: { OR: [{ blockerId: actorId }, { blockedId: actorId }] } }),
    prisma.friendship.deleteMany({ where: { OR: [{ requesterId: actorId }, { addresseeId: actorId }] } }),
    prisma.familyLink.deleteMany({ where: { OR: [{ actorId }, { relativeId: actorId }] } }),
    prisma.report.deleteMany({ where: { OR: [{ reporterId: actorId }, { targetActorId: actorId }] } }),
    prisma.communityMembership.deleteMany({ where: { actorId } }),

    // Messaging: their own sent messages, then their participation.
    prisma.message.deleteMany({ where: { senderActorId: actorId } }),
    prisma.conversationParticipant.deleteMany({ where: { actorId } }),

    // 1:1 side tables and misc.
    prisma.calendarConnection.deleteMany({ where: { actorId } }),
    prisma.immichConnection.deleteMany({ where: { actorId } }),
    prisma.photo.deleteMany({ where: { actorId } }),
    prisma.album.deleteMany({ where: { actorId } }),
    prisma.outboundDelivery.deleteMany({ where: { actorId } }),
  ]);

  // Now that this actor's participant rows are gone, any conversation
  // that has nobody left in it is orphaned — clean those up too.
  if (conversationIds.length > 0) {
    const emptied = await prisma.conversationParticipant.groupBy({
      by: ["conversationId"],
      where: { conversationId: { in: conversationIds } },
    });
    const stillOccupied = new Set(emptied.map((g) => g.conversationId));
    const orphanedIds = conversationIds.filter((id) => !stillOccupied.has(id));
    if (orphanedIds.length > 0) {
      await prisma.$transaction([
        prisma.message.deleteMany({ where: { conversationId: { in: orphanedIds } } }),
        prisma.conversation.deleteMany({ where: { id: { in: orphanedIds } } }),
      ]);
    }
  }

  if (actor.localUser) {
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { localUserId: actor.localUser.id } }),
      prisma.twoFactorChallenge.deleteMany({ where: { localUserId: actor.localUser.id } }),
      prisma.localUser.delete({ where: { id: actor.localUser.id } }),
    ]);
  }

  await prisma.actor.delete({ where: { id: actorId } });
}
