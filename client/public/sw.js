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

// Web Push (while OpenChat is closed): the server sends { title, body, url,
// tag } (server/src/services/push.service.js). Never message text: chats are
// end-to-end encrypted and the server can't read them. Every push shows a
// notification (browsers require it); tag: one per chat, a newer replaces it.
self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "OpenChat", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "/icon-192.png",
      data: { url: data.url || "/chat" },
    }),
  );
});

// Tapping it opens the right page: an OpenChat window that is already open is
// brought forward and sent there, else a new one opens. Only pages of this site.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/chat", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : new URL("/chat", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      return open.focus().then((client) => (client && "navigate" in client ? client.navigate(url) : undefined));
    }),
  );
});
