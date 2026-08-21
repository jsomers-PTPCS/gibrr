"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  getMe,
  getSetupStatus,
  getSessions,
  switchAccount,
  removeSession,
  logout,
  type Me,
  type SessionAccount,
} from "../lib/api";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";

export function Nav() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | "loading">("loading");
  const [query, setQuery] = useState("");

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionAccount[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const switcherRef = useRef<HTMLDivElement>(null);

  function refresh() {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
    getSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }

  useEffect(() => {
    refresh();

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

  useEffect(() => {
    if (!switcherOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [switcherOpen]);

  async function handleSwitch(actorId: string) {
    setSwitching(actorId);
    try {
      await switchAccount(actorId);
      refresh();
      setSwitcherOpen(false);
    } finally {
      setSwitching(null);
    }
  }

  async function handleRemoveSession(actorId: string) {
    await removeSession(actorId);
    refresh();
  }

  async function handleLogout() {
    await logout();
    refresh();
    setSwitcherOpen(false);
    router.push("/");
  }

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

      <Link href="/federated" style={{ whiteSpace: "nowrap" }}>
        Federated
      </Link>

      <Link href="/g" style={{ whiteSpace: "nowrap" }}>
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

      <div className="nav-spacer" />
      {me === "loading" ? null : me ? (
        <>
          {me.isAdmin && (
            <Link href="/admin" style={{ whiteSpace: "nowrap" }}>
              Host
            </Link>
          )}
          <div ref={switcherRef} style={{ position: "relative" }}>
            <button
              className="btn btn-ghost"
              onClick={() => setSwitcherOpen((open) => !open)}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <Avatar
                name={me.actor.displayName ?? me.actor.username}
                size={28}
                imageUrl={me.actor.avatarImageUrl}
                preset={me.actor.avatarPreset}
              />
              {me.actor.username}
            </button>

            {switcherOpen && (
              <div
                className="card"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 0.5rem)",
                  minWidth: 240,
                  zIndex: 20,
                  padding: "0.5rem",
                }}
              >
                <Link
                  href={`/u/${me.actor.username}`}
                  onClick={() => setSwitcherOpen(false)}
                  style={{ display: "block", padding: "0.4rem 0.5rem", color: "inherit" }}
                >
                  Me
                </Link>
                <Link
                  href="/bookmarks"
                  onClick={() => setSwitcherOpen(false)}
                  style={{ display: "block", padding: "0.4rem 0.5rem", color: "inherit" }}
                >
                  Keeps
                </Link>
                <Link
                  href="/antennas"
                  onClick={() => setSwitcherOpen(false)}
                  style={{ display: "block", padding: "0.4rem 0.5rem", color: "inherit" }}
                >
                  Watching
                </Link>

                {sessions.length > 1 && (
                  <>
                    <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "0.4rem 0" }} />
                    {sessions
                      .filter((s) => !s.current)
                      .map((s) => (
                        <div
                          key={s.actor.id}
                          style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0.5rem" }}
                        >
                          <button
                            onClick={() => handleSwitch(s.actor.id)}
                            disabled={switching === s.actor.id}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                              background: "none",
                              border: "none",
                              color: "inherit",
                              cursor: "pointer",
                              padding: 0,
                              textAlign: "left",
                            }}
                          >
                            <Avatar
                              name={s.actor.displayName ?? s.actor.username}
                              size={22}
                              imageUrl={s.actor.avatarImageUrl}
                              preset={s.actor.avatarPreset}
                            />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {switching === s.actor.id ? "Switching…" : s.actor.username}
                            </span>
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => handleRemoveSession(s.actor.id)}
                            title="Sign out of this account"
                            style={{ padding: "0.1rem 0.4rem", fontSize: "0.8rem" }}
                          >
                            Sign out
                          </button>
                        </div>
                      ))}
                  </>
                )}

                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "0.4rem 0" }} />
                <Link
                  href="/login"
                  onClick={() => setSwitcherOpen(false)}
                  style={{ display: "block", padding: "0.4rem 0.5rem", color: "inherit" }}
                >
                  + Add another account
                </Link>
                <button
                  onClick={handleLogout}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "0.4rem 0.5rem",
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <Link href="/login">Log in</Link>
          <Link href="/register" className="btn btn-primary">
            Register
          </Link>
        </>
      )}
    </nav>
  );
}
