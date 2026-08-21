"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { voteComment, createComment, adminDeleteComment, ApiError, type Comment, type VoteValue } from "../lib/api";
import { VoteButtons } from "./VoteButtons";
import { LinkifiedText } from "./LinkifiedText";
import { useConfirm } from "./ConfirmDialog";

export function CommentThread({
  comment,
  postId,
  childrenByParent,
  onReplyPosted,
  isAdmin = false,
  depth = 0,
}: {
  comment: Comment;
  postId: string;
  childrenByParent: Map<string | null, Comment[]>;
  onReplyPosted: () => void;
  isAdmin?: boolean;
  depth?: number;
}) {
  const confirm = useConfirm();
  const [{ score, myVote }, setVote] = useState({ score: comment.score, myVote: comment.myVote });
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdminDelete() {
    if (!(await confirm("Delete this chatter and all its replies?"))) return;
    setDeleting(true);
    try {
      await adminDeleteComment(comment.id);
      setDeleted(true);
    } catch {
      setError("failed to delete");
      setDeleting(false);
    }
  }

  async function handleVote(value: VoteValue) {
    try {
      const result = await voteComment(comment.id, value);
      setVote(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    }
  }

  async function handleReply(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createComment(postId, { body: replyBody, parentId: comment.id });
      setReplyBody("");
      setReplying(false);
      onReplyPosted();
    } catch (err) {
      setError(err instanceof ApiError ? "failed to gab this reply" : "something went wrong");
    }
  }

  const replies = childrenByParent.get(comment.id) ?? [];

  if (deleted) return null;

  return (
    <div
      style={{
        marginLeft: depth > 0 ? 20 : 0,
        marginTop: "0.75rem",
        borderLeft: depth > 0 ? "2px solid var(--border)" : undefined,
        paddingLeft: depth > 0 ? "0.9rem" : undefined,
      }}
    >
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <VoteButtons score={score} myVote={myVote} onVote={handleVote} />
        <div style={{ flex: 1 }}>
          <Link href={`/u/${comment.author.username}`} className="text-faint" style={{ fontWeight: 600 }}>
            {comment.author.username}
          </Link>
          <p style={{ margin: "0.2rem 0 0.35rem" }}>
            <LinkifiedText text={comment.body} />
          </p>
          <button onClick={() => setReplying((r) => !r)} className="btn btn-ghost" style={{ padding: "0.2rem 0.6rem", fontSize: "0.85rem" }}>
            {replying ? "cancel" : "reply"}
          </button>
          {isAdmin && (
            <button
              onClick={handleAdminDelete}
              disabled={deleting}
              className="btn btn-ghost"
              style={{ padding: "0.2rem 0.6rem", fontSize: "0.85rem", marginLeft: "0.4rem", color: "var(--danger)" }}
            >
              host delete
            </button>
          )}
        </div>
      </div>

      {replying && (
        <form onSubmit={handleReply} style={{ marginTop: "0.5rem", marginLeft: "2.4rem", maxWidth: 420 }}>
          <textarea
            className="input"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={3}
            required
            style={{ display: "block", width: "100%", marginBottom: "0.4rem" }}
          />
          <button type="submit" className="btn btn-accent">
            Gab reply
          </button>
        </form>
      )}
      {error && <p className="error-text">{error}</p>}

      {replies.map((reply) => (
        <CommentThread
          key={reply.id}
          comment={reply}
          postId={postId}
          childrenByParent={childrenByParent}
          onReplyPosted={onReplyPosted}
          isAdmin={isAdmin}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
