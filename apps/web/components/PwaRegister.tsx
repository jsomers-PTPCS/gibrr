"use client";

import { useEffect } from "react";

// Registers the no-op service worker (public/sw.js) that installability
// requires on Chrome/Android — Safari's "Add to Home Screen" doesn't need
// one, but registering is harmless there too. Silently no-ops in any
// browser without service worker support at all.
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return null;
}
