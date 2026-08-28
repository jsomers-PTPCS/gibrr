"use client";

import { useEffect, useState } from "react";
import {
  followHandle,
  unfollow,
  getFollowStatus,
  setFollowNotify,
  ApiError,
  type FollowStatus,
} from "../lib/api";
import { BellIcon } from "./icons";

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
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);

  useEffect(() => {
    getFollowStatus(username, domain)
      .then((r) => {
        setStatus(r.status);
        setNotify(r.notify);
      })
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
      setNotify(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleNotify() {
    const next = !notify;
    setNotify(next); // optimistic
    setNotifyBusy(true);
    try {
      await setFollowNotify(actorId, next);
    } catch (err) {
      setNotify(!next); // roll back
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = "/login";
      }
    } finally {
      setNotifyBusy(false);
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
        Pending
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
      <button
        type="button"
        className="btn btn-ghost post-icon-btn"
        disabled={notifyBusy}
        onClick={toggleNotify}
        aria-pressed={notify}
        aria-label={notify ? "Stop notifying me about new posts" : "Notify me about new posts"}
        title={notify ? "Notifying you about new posts" : "Get notified when they post"}
        style={{ width: "2rem", height: "2rem", color: notify ? "var(--primary-bright)" : undefined }}
      >
        <BellIcon width={16} height={16} filled={notify} />
      </button>
      <button className="btn btn-ghost" disabled={busy} onClick={stop}>
        Listening
      </button>
    </span>
  );
}
