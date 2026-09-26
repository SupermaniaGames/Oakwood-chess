const CACHE_NAME = "oakwood-chess-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./main.js",
  "./clock.js",
  "./storage.js",
  "./multiplayer.js",
  "./leaderboard.js",
  "./firebase-config.js",
  "./manifest.json",
  "./vendor/chess.js",
  "./vendor/peerjs.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle our own static files — let PeerJS signaling, Firebase, and
  // anything else cross-origin go straight to the network untouched.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  // Network-first: an installed app should always see a fresh deploy when
  // it has a connection. The cache exists purely as an offline fallback —
  // serving it first would mean updates never reach an already-installed
  // app until the browser happened to re-check on its own schedule.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
