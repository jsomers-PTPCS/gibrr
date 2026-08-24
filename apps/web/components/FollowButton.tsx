"use client";

import { useEffect, useState } from "react";
import { followHandle, unfollow, getFollowStatus, ApiError, type FollowStatus } from "../lib/api";

// Fediverse follow — distinct from FriendButton (mutual, request/accept)
// and from joining a community: one-directional, and (via followHandle)
// works across instances. Shown on any profile page, local or remote —
// see FollowPanel for following someone by handle directly instead of
// through their profile.
export function FollowButton({
  username,
  domain,
  actorId,
}: {
  username: string;
  domain: string;
  actorId: string;
}) {
  const [status, setStatus] = useState<FollowStatus | "loading">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFollowStatus(username, domain)
      .then((r) => setStatus(r.status))
      .catch(() => setStatus("none"));
  }, [username, domain]);

  async function follow() {
    setBusy(true);
    try {
      const { state } = await followHandle(`${username}@${domain}`);
      setStatus(state);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await unfollow(actorId);
      setStatus("none");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "self") return null;

  if (status === "none") {
    return (
      <button className="btn btn-ghost" disabled={busy} onClick={follow}>
        Listen
      </button>
    );
  }

  if (status === "pending") {
    return (
      <button className="btn btn-ghost" disabled={busy} onClick={stop}>
        Listen Requested — Cancel
      </button>
    );
  }

  return (
    <button className="btn btn-ghost" disabled={busy} onClick={stop}>
      ✓ Listening — Unlisten
    </button>
  );
}
