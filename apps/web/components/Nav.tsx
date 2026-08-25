"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { getMe, getSetupStatus, type Me } from "../lib/api";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { LoopsIcon, FederatedIcon } from "./icons";

export function Nav() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | "loading">("loading");
  const [query, setQuery] = useState("");

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

      {/* Federated/Circles text links + search — always visible now (no
          hamburger to hide behind), just repositioned on mobile: the
          search form is what actually fills this row's center there
          (see .nav-links's own mobile rule), since Federated/Circles
          both have their own icon elsewhere on that breakpoint and stay
          hidden here (nav-federated-link/nav-circles-link). On desktop,
          unchanged from before — all three sit together, left of center. */}
      <div className="nav-links">
        <Link href="/federated" className="nav-federated-link" style={{ whiteSpace: "nowrap" }}>
          Fediverse
        </Link>

        <Link href="/g" className="nav-circles-link" style={{ whiteSpace: "nowrap" }}>
          Circles
        </Link>

        <form onSubmit={handleSearch} style={{ flex: 1, maxWidth: 360 }}>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Gibrr"
            aria-label="Search"
            style={{ width: "100%" }}
          />
        </form>
      </div>

      {/* Inverse of .nav-loops-icon above — hidden on desktop (where
          "Fediverse" already shows as a plain text link just above),
          shown only on mobile, top-right (see .nav-federated-icon's
          mobile rule for its actual order in that row). */}
      <Link href="/federated" aria-label="Fediverse" title="Fediverse" className="nav-federated-icon">
        <FederatedIcon width={22} height={22} />
      </Link>

      <div className="nav-spacer" />
      {/* The profile link inside (nav-account-profile-link) is hidden on
          mobile — BottomTabBar.tsx has its own, centered profile tab
          there instead. Log in/Register stay visible on every size:
          there's nothing else on mobile to reach them from now that
          there's no hamburger panel for them to live in. */}
      <div className="nav-account">
      {me === "loading" ? null : me ? (
        // Straight to the profile page — Settings and Log out live
        // there now, so there's no need for a separate switcher menu
        // just to reach them.
        <Link
          href={`/u/${me.actor.username}`}
          className="btn btn-ghost nav-account-profile-link"
          style={{ alignItems: "center", gap: "0.5rem" }}
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
          <Link href="/login">Log in</Link>
          <Link href="/register" className="btn btn-primary">
            Register
          </Link>
        </>
      )}
      </div>
    </nav>
  );
}
