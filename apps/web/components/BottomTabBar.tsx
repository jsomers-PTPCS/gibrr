"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getMe, getConversations, type Me } from "../lib/api";
import { toggleChatDockList } from "../lib/chatDock";
import { HomeIcon, CirclesIcon, LoopsIcon } from "./icons";
import { MessageIcon } from "./MessageIcon";

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

  return (
    <nav className="bottom-tab-bar" aria-label="Primary">
      <Link href="/" className={isHome ? "bottom-tab-active" : undefined} aria-label="Home">
        <HomeIcon width={22} height={22} />
        Home
      </Link>
      <Link href="/loops" className={isLoops ? "bottom-tab-active" : undefined} aria-label="Loops">
        <LoopsIcon width={22} height={22} />
        Loops
      </Link>
      <Link href="/g" className={isCircles ? "bottom-tab-active" : undefined} aria-label="Circles">
        <CirclesIcon width={22} height={22} />
        Circles
      </Link>
      <button type="button" onClick={handleMessenger} aria-label="Messages">
        <span style={{ position: "relative", display: "inline-flex" }}>
          <MessageIcon size={22} />
          {unread > 0 && <span className="chat-dock-badge">{unread > 9 ? "9+" : unread}</span>}
        </span>
        Messages
      </button>
    </nav>
  );
}
