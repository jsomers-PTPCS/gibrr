"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMe, logout, type Me } from "../lib/api";

export function Nav() {
  const [me, setMe] = useState<Me | null | "loading">("loading");

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function handleLogout() {
    await logout();
    setMe(null);
    window.location.href = "/";
  }

  return (
    <nav style={{ display: "flex", gap: "1rem", padding: "1rem", borderBottom: "1px solid #ccc" }}>
      <Link href="/">Astrion</Link>
      {me === "loading" ? null : me ? (
        <>
          <Link href="/submit">Submit</Link>
          <Link href={`/u/${me.actor.username}`}>{me.actor.username}</Link>
          <button onClick={handleLogout}>Log out</button>
        </>
      ) : (
        <>
          <Link href="/login">Log in</Link>
          <Link href="/register">Register</Link>
        </>
      )}
    </nav>
  );
}
