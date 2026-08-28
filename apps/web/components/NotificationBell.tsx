"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getMe, getUnreadNotificationCount } from "../lib/api";
import { BellIcon } from "./icons";

const POLL_MS = 30000;

// Fires after the notifications page marks everything read, so the badge
// clears without waiting for the next poll. Also lets the page bump it
// back up if a new one lands while it's open.
const NOTIF_COUNT_EVENT = "gibrr:notif-count";

export function emitNotificationCount(count: number) {
  window.dispatchEvent(new CustomEvent(NOTIF_COUNT_EVENT, { detail: count }));
}

// The bell + unread badge in the top nav. Visible on every breakpoint
// (unlike the profile link / account switcher, which the bottom tab bar
// replaces on mobile) — it's the only notifications entry point on a
// phone, so it can't hide there.
export function NotificationBell() {
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    getMe()
      .then(() => setLoggedIn(true))
      .catch(() => setLoggedIn(false));
  }, []);

  useEffect(() => {
    if (!loggedIn) return;

    function refresh() {
      getUnreadNotificationCount()
        .then((r) => setCount(r.count))
        .catch(() => {});
    }
    refresh();

    const interval = setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    function onCountEvent(e: Event) {
      const detail = (e as CustomEvent<number>).detail;
      if (typeof detail === "number") setCount(Math.max(0, detail));
    }
    window.addEventListener(NOTIF_COUNT_EVENT, onCountEvent);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTIF_COUNT_EVENT, onCountEvent);
    };
  }, [loggedIn, pathname]);

  if (!loggedIn) return null;

  return (
    <Link
      href="/notifications"
      className="btn btn-ghost nav-bell"
      aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
      title="Notifications"
      style={{ padding: "0.4rem 0.5rem" }}
    >
      <span style={{ position: "relative", display: "inline-flex" }}>
        <BellIcon width={20} height={20} filled={count > 0} />
        {count > 0 && <span className="chat-dock-badge">{count > 9 ? "9+" : count}</span>}
      </span>
    </Link>
  );
}
