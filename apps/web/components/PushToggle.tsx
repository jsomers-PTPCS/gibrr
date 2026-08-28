"use client";

import { useEffect, useState } from "react";
import { enablePush, disablePush, getPushState, type PushState } from "../lib/push";
import { BellIcon } from "./icons";

// Per-device Web Push opt-in, shown on the notifications page. Hidden
// entirely when the instance has no VAPID keypair ("unavailable"). On a
// browser that can't do push at all it shows a short hint instead of a
// dead button — most often an iPhone where Gibrr isn't an installed PWA
// yet.
export function PushToggle() {
  const [state, setState] = useState<PushState | "loading" | "working">("loading");

  useEffect(() => {
    getPushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  async function toggle(on: boolean) {
    setState("working");
    try {
      setState(on ? await enablePush() : await disablePush());
    } catch {
      // fall back to a re-read so the UI reflects reality
      setState(await getPushState().catch(() => "unsupported" as PushState));
    }
  }

  if (state === "loading" || state === "unavailable") return null;

  if (state === "unsupported") {
    // iOS only delivers web push to an installed PWA (iOS 16.4+); other
    // browsers that land here just don't support it.
    const iOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
    return (
      <p className="text-faint" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>
        {iOS
          ? "To get push notifications on iPhone: open Gibrr in Safari, Share → Add to Home Screen, then open it from the icon."
          : "This browser doesn’t support push notifications."}
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="text-faint" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>
        Notifications are blocked for Gibrr in your browser settings — re-allow them there to turn push on.
      </p>
    );
  }

  const busy = state === "working";
  const on = state === "subscribed";

  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={busy}
      onClick={() => toggle(!on)}
      style={{
        fontSize: "0.85rem",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        color: on ? "var(--primary-bright)" : undefined,
      }}
      title={on ? "Push notifications are on for this device" : "Get notified on this device even when Gibrr is closed"}
    >
      <BellIcon width={15} height={15} filled={on} />
      {busy ? "…" : on ? "Push on for this device" : "Enable push on this device"}
    </button>
  );
}
