"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { getMe, getSetupStatus, type Me } from "../lib/api";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { LoopsIcon } from "./icons";

export function Nav() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | "loading">("loading");
  const [query, setQuery] = useState("");

  // Federated/Circles/search collapse behind this on a narrow phone
  // screen (see .nav-toggle/.nav-links in globals.css) — without it, that
  // whole row is wider than the viewport and the entire page scrolls
  // sideways to show it.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));

    // First-run check: a brand new instance has no accounts at all,
    // which means no one could be logged in either — send any visitor
    // to /setup to create the instance's first (admin) account. Runs
    // once, since Nav lives in the root layout and doesn't remount on
    // client-side navigation.
    if (window.location.pathname !== "/setup") {
      getSetupStatus()
        .then(({ needsSetup }) => {
          if (needsSetup) router.push("/setup");
        })
        .catch(() => {});
    }
  }, [router]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <nav className="nav">
      <Link
        href="/"
        className="nav-logo"
        style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
      >
        <Logo size={26} />
        GIBRR
      </Link>

      {/* Hidden on mobile (display:flex lives in the .nav-loops-icon CSS
          rule, not inline, so the mobile media query can actually
          override it) — the bottom tab bar (BottomTabBar.tsx) has its
          own Loops icon there instead. */}
      <Link href="/loops" aria-label="Loops" title="Loops" className="nav-loops-icon">
        <LoopsIcon width={24} height={24} />
      </Link>

      <button
        type="button"
        className="nav-toggle btn btn-ghost"
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((open) => !open)}
      >
        {mobileOpen ? "✕" : "☰"}
      </button>

      <div className={`nav-links${mobileOpen ? " nav-links-open" : ""}`}>
        {/* Hidden in the mobile hamburger — the bottom tab bar
            (BottomTabBar.tsx) has its own Circles icon there instead.
            Still shown inline on desktop, which has no bottom tab bar. */}
        <Link href="/g" className="nav-circles-link" style={{ whiteSpace: "nowrap" }} onClick={() => setMobileOpen(false)}>
          Circles
        </Link>

        <form
          onSubmit={(e) => {
            handleSearch(e);
            setMobileOpen(false);
          }}
          style={{ flex: 1, maxWidth: 360 }}
        >
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Gibrr"
            aria-label="Search"
            style={{ width: "100%" }}
          />
        </form>

        <Link href="/federated" style={{ whiteSpace: "nowrap" }} onClick={() => setMobileOpen(false)}>
          Federated
        </Link>
      </div>

      <div className="nav-spacer" />
      {/* On mobile this collapses into the hamburger panel alongside
          .nav-links instead of sitting in the top-right corner — see the
          .nav-account media query in globals.css. Shares mobileOpen with
          .nav-links so both open/close together. */}
      <div className={`nav-account${mobileOpen ? " nav-account-open" : ""}`}>
      {me === "loading" ? null : me ? (
        // Straight to the profile page — Settings and Log out live
        // there now, so there's no need for a separate switcher menu
        // just to reach them.
        <Link
          href={`/u/${me.actor.username}`}
          onClick={() => setMobileOpen(false)}
          className="btn btn-ghost"
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <Avatar
            name={me.actor.displayName ?? me.actor.username}
            size={28}
            imageUrl={me.actor.avatarImageUrl}
            preset={me.actor.avatarPreset}
          />
          {me.actor.username}
        </Link>
      ) : (
        <>
          <Link href="/login" onClick={() => setMobileOpen(false)}>
            Log in
          </Link>
          <Link href="/register" className="btn btn-primary" onClick={() => setMobileOpen(false)}>
            Register
          </Link>
        </>
      )}
      </div>
    </nav>
  );
}
