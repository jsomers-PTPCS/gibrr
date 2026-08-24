"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getComments, createComment, getMe, ApiError, type Comment, type Me } from "../lib/api";
import { buildCommentTree } from "../lib/comments";
import { CommentThread } from "./CommentThread";

// Fetches + renders one post's comment tree (root comment form plus
// CommentThread list). Used both inline in the feed (PostItem, toggled
// open) and unconditionally on the post detail page — same component
// either way so the two don't drift apart.
export function PostComments({ postId }: { postId: string }) {
  const [comments, setComments] = useState<Comment[] | "loading">("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Used after posting a new comment — the full, synced fetch, same as
  // this component's very first load ends up doing once its own
  // background refresh below completes.
  function refetchComments() {
    getComments(postId).then(setComments);
  }

  useEffect(() => {
    // Two-phase: an instant paint of whatever's already cached (sync:
    // false, no network wait on the remote server), then a normal
    // (synced) fetch right behind it that applies whatever fresher
    // result comes back — confirmed live the synced fetch alone can
    // take real seconds against an unfamiliar remote server, which
    // otherwise left this whole panel blank that whole time even when
    // it already had comments to show. `cancelled` guards against the
    // second fetch clobbering a newer postId's state if this effect
    // re-ran (a different post's comments opened) before either
    // request finished.
    let cancelled = false;
    async function load() {
      try {
        const cached = await getComments(postId, { sync: false });
        if (!cancelled) setComments(cached);
      } catch {
        // Falls through to the synced fetch below regardless.
      }
      try {
        const synced = await getComments(postId);
        if (!cancelled) setComments(synced);
      } catch {
        // Leaves whatever's already shown (cached, or still "loading"
        // if even that failed) rather than surfacing a hard error here.
      }
    }
    load();
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function handleComment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createComment(postId, { body: commentBody });
      setCommentBody("");
      refetchComments();
    } catch (err) {
      setError(err instanceof ApiError ? "failed to gab that chatter" : "something went wrong");
    }
  }

  if (comments === "loading") {
    return <p className="text-dim">Loading chatter…</p>;
  }

  const childrenByParent = buildCommentTree(comments);
  const rootComments = childrenByParent.get(null) ?? [];

  return (
    <div>
      {me ? (
        <form onSubmit={handleComment} className="card">
          <textarea
            className="input"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            rows={3}
            required
            style={{ display: "block", width: "100%", marginBottom: "0.5rem" }}
          />
          <button type="submit" className="btn btn-accent">
            Gab
          </button>
          {error && <p className="error-text">{error}</p>}
        </form>
      ) : (
        <p className="text-dim">
          <a href="/login">Log in</a> to chatter.
        </p>
      )}

      {rootComments.length === 0 ? (
        <p className="text-dim">No chatter yet.</p>
      ) : (
        rootComments.map((comment) => (
          <CommentThread
            key={comment.id}
            comment={comment}
            postId={postId}
            childrenByParent={childrenByParent}
            onReplyPosted={refetchComments}
            isAdmin={me?.isAdmin ?? false}
          />
        ))
      )}
    </div>
  );
}
