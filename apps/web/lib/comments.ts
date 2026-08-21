import type { Comment } from "./api";

// Groups a flat comment list into a parent -> children map (root comments
// live under the `null` key). Extracted so both the post detail page and
// the feed's inline comments (PostComments.tsx) build the tree the same
// way — this is real logic, not just a vocabulary constant, so it's
// shared rather than duplicated.
export function buildCommentTree(comments: Comment[]): Map<string | null, Comment[]> {
  const childrenByParent = new Map<string | null, Comment[]>();
  for (const comment of comments) {
    const key = comment.parentId;
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), comment]);
  }
  return childrenByParent;
}
