/* AgriLink service worker — keeps the app usable on weak or no connectivity.
 * Network first for everything; when the network fails, serve the last copy:
 *   - page navigations → cached app shell (index.html)
 *   - GET /api/advisory/*, /api/messages/me, /api/farmers/me → last response (read-only, may be stale)
 * Writes (POST/PUT/PATCH) are never cached; the app queues farmer actions itself (src/offline.js). */
const CACHE = "agrilink-v1";
const API_CACHED = [/^\/api\/advisory\/me/, /^\/api\/messages\/me/, /^\/api\/farmers\/me$/, /^\/api\/crops/];

self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"]).catch(() => {}))); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/socket.io") || url.pathname.startsWith("/@") || url.pathname.includes("hot-update")) return;
  const isApi = url.pathname.startsWith("/api/");
  if (isApi && !API_CACHED.some((re) => re.test(url.pathname))) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && (isApi || req.mode === "navigate" || /\.(js|css|svg|png|woff2?)$/.test(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(isApi ? req.url : req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const hit = await caches.match(isApi ? req.url : req);
      if (hit) return hit;
      if (req.mode === "navigate") { const shell = await caches.match("/"); if (shell) return shell; }
      return new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "content-type": "application/json" } });
    }
  })());
});
