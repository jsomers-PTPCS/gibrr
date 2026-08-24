"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getMe, getConversations, type Me } from "../lib/api";
import { toggleChatDockList } from "../lib/chatDock";
import { HomeIcon, CirclesIcon, LoopsIcon } from "./icons";
import { MessageIcon } from "./MessageIcon";
import { Avatar } from "./Avatar";

const POLL_MS = 10000;

// Mobile-only (see .bottom-tab-bar's media query) — the 4 primary
// destinations as icons, mirroring a native app's bottom tab bar. Login
// state is only needed here for the unread-messages badge; the tabs
// themselves are equally reachable logged out (Messenger just sends a
// logged-out tap to /login, same as every other messaging entry point).
export function BottomTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!me) return;
    function refresh() {
      getConversations()
        .then((cs) => setUnread(cs.reduce((sum, c) => sum + c.unreadCount, 0)))
        .catch(() => {});
    }
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [me]);

  function handleMessenger() {
    if (me) {
      toggleChatDockList();
    } else {
      router.push("/login");
    }
  }

  const isHome = pathname === "/";
  const isLoops = pathname.startsWith("/loops");
  const isCircles = pathname.startsWith("/g");
  const isOwnProfile = me !== null && pathname === `/u/${me.actor.username}`;
  const ICON_SIZE = 19;

  return (
    <nav className="bottom-tab-bar" aria-label="Primary">
      <Link href="/" className={isHome ? "bottom-tab-active" : undefined} aria-label="Home">
        <HomeIcon width={ICON_SIZE} height={ICON_SIZE} />
        Home
      </Link>
      <Link href="/loops" className={isLoops ? "bottom-tab-active" : undefined} aria-label="Loops">
        <LoopsIcon width={ICON_SIZE} height={ICON_SIZE} />
        Loops
      </Link>
      {/* Center tab — the top nav's own profile link
          (nav-account-profile-link) is hidden on mobile in favor of this
          one, so this is the only way to reach your own profile there. A
          logged-out visitor gets sent to /login instead, same fallback
          Messenger just below already uses. */}
      <Link
        href={me ? `/u/${me.actor.username}` : "/login"}
        className={isOwnProfile ? "bottom-tab-active" : undefined}
        aria-label="Profile"
      >
        <Avatar
          name={me?.actor.displayName ?? me?.actor.username ?? "?"}
          size={ICON_SIZE}
          imageUrl={me?.actor.avatarImageUrl}
          preset={me?.actor.avatarPreset}
        />
        Profile
      </Link>
      <Link href="/g" className={isCircles ? "bottom-tab-active" : undefined} aria-label="Circles">
        <CirclesIcon width={ICON_SIZE} height={ICON_SIZE} />
        Circles
      </Link>
      <button type="button" onClick={handleMessenger} aria-label="Messages">
        <span style={{ position: "relative", display: "inline-flex" }}>
          <MessageIcon size={ICON_SIZE} />
          {unread > 0 && <span className="chat-dock-badge">{unread > 9 ? "9+" : unread}</span>}
        </span>
        Messages
      </button>
    </nav>
  );
}
