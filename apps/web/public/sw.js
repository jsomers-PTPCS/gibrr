// Service worker — two jobs:
//
// 1. Exist and handle `fetch`, which is what Chrome/Android require before
//    offering the install prompt at all. Deliberately not an offline
//    cache: this is a live feed of other people's posts, and serving a
//    stale copy while claiming to work offline would be actively
//    misleading. Every request goes straight to the network.
//
// 2. Web Push (see apps/api/src/federation/webPush.ts). A `push` event
//    carries a JSON payload ({ title, body, url, tag }); we show it as an
//    OS notification, and `notificationclick` focuses an existing Gibrr
//    tab at that URL or opens a new one.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally not calling event.respondWith — falls through to the
  // browser's default network handling for every request.
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: "Gibrr", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Gibrr";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // A push service can reject a payload with no visible notification,
    // and userVisibleOnly:true (set on the subscription) promises one —
    // so always show something.
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/notifications" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/notifications";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        // Same-origin Gibrr tab already open — focus it and navigate.
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch (_e) {
              // cross-scope navigate can throw; the focus alone is still useful
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(target);
      }
    })(),
  );
});
