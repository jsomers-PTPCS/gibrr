// Minimal service worker — its only job is to exist and respond to fetch,
// which is what Chrome/Android require before offering the install
// prompt at all. Deliberately not an offline cache: this is a live feed
// of other people's posts, and serving a stale cached copy while
// claiming to be "working offline" would be actively misleading for an
// app like this. Every request just goes straight to the network.
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
