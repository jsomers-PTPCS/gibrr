"use client";

import { useEffect, useState } from "react";
import {
  sendFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  getFriendStatus,
  ApiError,
  type FriendStatus,
} from "../lib/api";
import { useConfirm } from "./ConfirmDialog";

// Drives the friend-action control in the profile header off the single
// GET /friends/status/:username value — same idea as savedToCalendar on
// posts, but this is viewer-relative-only so it's its own fetch on
// profile load rather than threaded through a batching helper.
export function FriendButton({ username }: { username: string }) {
  const confirm = useConfirm();
  const [status, setStatus] = useState<FriendStatus | "loading">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFriendStatus(username)
      .then((r) => setStatus(r.status))
      .catch(() => setStatus("none"));
  }, [username]);

  async function act(action: () => Promise<unknown>, nextStatus: FriendStatus) {
    setBusy(true);
    try {
      await action();
      setStatus(nextStatus);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "self") return null;

  if (status === "none") {
    return (
      <button
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => act(() => sendFriendRequest(username), "pending_sent")}
      >
        Add Friend
      </button>
    );
  }

  if (status === "pending_sent") {
    return (
      <button
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => act(() => removeFriendship(username), "none")}
      >
        Request Sent — Cancel
      </button>
    );
  }

  if (status === "pending_received") {
    return (
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          className="btn btn-accent"
          disabled={busy}
          onClick={() => act(() => acceptFriendRequest(username), "friends")}
        >
          Accept Friend Request
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => act(() => removeFriendship(username), "none")}
        >
          Decline
        </button>
      </div>
    );
  }

  async function handleRemoveFriend() {
    if (!(await confirm(`Remove @${username} as a friend?`))) return;
    act(() => removeFriendship(username), "none");
  }

  return (
    <button className="btn btn-ghost" disabled={busy} onClick={handleRemoveFriend}>
      ✓ Friends — Remove
    </button>
  );
}
