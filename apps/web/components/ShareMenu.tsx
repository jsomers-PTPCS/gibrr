"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShareIcon } from "./icons";
import { shareToChatDock } from "../lib/chatDock";

// A small popover of external + in-app share targets, replacing the old
// plain "↗ view original" link. Portaled to document.body (same reason
// as the profile page's tab-menu dropdown: the trigger often sits inside
// an overflow: hidden ancestor — here, a Loops video slide — that would
// otherwise clip it) and positioned from the trigger button's own
// measured rect.
//
// `url` may be a real absolute URL (a federated post's remoteId) or a
// same-origin path (a local post's "/posts/:id") — resolved against
// window.location.origin lazily, inside the click handlers below, never
// during render, since this component (like the rest of the app) still
// gets one server-side render pass before hydration, when window
// doesn't exist yet.
function resolveUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${window.location.origin}${url}`;
}

export function ShareMenu({
  url,
  triggerStyle,
  iconSize = 30,
}: {
  url: string;
  triggerStyle?: React.CSSProperties;
  iconSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Opens leftward/upward from the trigger — this button always
      // sits near the right edge of the screen (Loops' action column),
      // so anchoring from the right/bottom keeps the menu on-screen
      // instead of overflowing it.
      setPos({ top: rect.top, left: rect.left });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(resolveUrl(url));
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 900);
    } catch {
      // Clipboard API can throw in a non-secure/unsupported context —
      // nothing useful to do but leave the menu open.
    }
  }

  function handleMessenger() {
    // No app id, so this is the mobile deep link (opens the Messenger
    // app if installed) rather than Facebook's web "send" dialog, which
    // requires one — a no-op tap on desktop/no-app is an acceptable
    // degradation here, same as any share target the viewer doesn't have.
    window.open(`fb-messenger://share?link=${encodeURIComponent(resolveUrl(url))}`, "_blank");
    setOpen(false);
  }

  function handleText() {
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    window.open(`sms:${isIOS ? "&" : "?"}body=${encodeURIComponent(resolveUrl(url))}`, "_blank");
    setOpen(false);
  }

  function handleWhisper() {
    shareToChatDock(resolveUrl(url));
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        style={{ color: "#fff", background: "none", border: "none", padding: "0.3rem", cursor: "pointer", ...triggerStyle }}
        title="Share"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <ShareIcon width={iconSize} height={iconSize} />
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            className="card popover-menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translate(-100%, -100%)" }}
          >
            <button onClick={handleCopyLink}>{copied ? "Copied!" : "Copy link"}</button>
            <button onClick={handleMessenger}>Messenger</button>
            <button onClick={handleText}>Text</button>
            <button onClick={handleWhisper}>Whisper</button>
          </div>,
          document.body,
        )}
    </>
  );
}
