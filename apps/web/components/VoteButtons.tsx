"use client";

import type { VoteValue } from "../lib/api";

export function VoteButtons({
  score,
  myVote,
  onVote,
}: {
  score: number;
  myVote: VoteValue | null;
  onVote: (value: VoteValue) => void;
}) {
  return (
    <span className="vote-chip">
      <button
        onClick={() => onVote(1)}
        aria-label="upvote"
        className={myVote === 1 ? "active-up" : undefined}
      >
        ▲
      </button>
      <span className="vote-score">{score}</span>
      <button
        onClick={() => onVote(-1)}
        aria-label="downvote"
        className={myVote === -1 ? "active-down" : undefined}
      >
        ▼
      </button>
    </span>
  );
}
