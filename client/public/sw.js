// OpenChat's service worker, small on purpose. It keeps one thing offline: a
// page that says you're offline (and the icon it shows). It only answers page
// loads of this site; API calls, the live connection, files, photos and the
// app's own scripts all go to the network as if it weren't here, so no
// message, key or other private data is ever stored by it.
// Bump the version to replace the stored files.
const CACHE = "openchat-offline-v1";
const OFFLINE_URL = "/offline.html";
const STORED = [OFFLINE_URL, "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STORED))
      .then(() => self.skipWaiting()),
  );
});

// A new version takes over straight away and removes the old stored files.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // Always the network; the offline page only when there is none.
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  } else if (STORED.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(url.pathname)));
  }
});
