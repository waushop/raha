const CACHE_NAME = "empty-wallet-v5";
const STATIC_CACHE = "empty-wallet-static-v5";
const SHELL = ["/", "/dashboard", "/login", "/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png"];

// A page that ended up on /login (signed out) or came through a redirect is
// not the page that was asked for; never store it under the requested URL.
// Navigation requests also refuse a redirected response, so copy the body
// into a fresh Response before caching.
async function storable(response, requestUrl) {
  if (!response || !response.ok || response.type === "opaque") return null;
  const finalPath = new URL(response.url || requestUrl, self.location.origin).pathname;
  const asked = new URL(requestUrl, self.location.origin).pathname;
  if (response.redirected && finalPath !== asked) return null;
  if (!response.redirected) return response.clone();
  const body = await response.clone().blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Pre-cache the app shell. Each URL is best effort: signed out, the app
// pages redirect to /login and are skipped (they get cached on first visit).
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        SHELL.map(async (url) => {
          const res = await storable(await fetch(url, { credentials: "same-origin", cache: "no-store" }), url);
          if (res) await cache.put(url, res);
        })
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== STATIC_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Signing out (or switching user) drops the cached pages so the next person
// on this device can't read the previous user's data offline.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear-pages") {
    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        for (const k of await cache.keys()) {
          if (new URL(k.url).pathname !== "/login" && !k.url.endsWith(".png") && !k.url.endsWith(".svg") && !k.url.endsWith(".json")) await cache.delete(k);
        }
      })
    );
  }
});

// Keep the page cache bounded (search URLs etc. would otherwise pile up);
// the shell entries are kept.
const MAX_PAGES = 60;
async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.filter((k) => !SHELL.includes(new URL(k.url).pathname + new URL(k.url).search));
  for (const k of extra.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(k);
}

// While the server restarts during a deploy the ingress answers with a bare
// 502/503/504 or a plain-text 404; show a small page that retries instead.
function transient(response) {
  if ([502, 503, 504].includes(response.status)) return true;
  return response.status === 404 && (response.headers.get("content-type") || "").startsWith("text/plain");
}

function retryPage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#111112"><title>Empty Wallet</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111112;color:#fff;font-family:system-ui,-apple-system,sans-serif}p{margin:6px 0;text-align:center}small{color:#a3a3ab}</style></head>
<body><div><p><b>Empty Wallet is updating</b></p><p><small>Trying again in a few seconds…</small></p></div>
<script>setTimeout(function(){location.reload()},3000)</script></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

// Navigations: network first; offline, the cached copy of that URL, then the
// cached "/" (month view), then the login page, then a retrying page — never
// the browser's own "couldn't load" error.
async function navigate(request) {
  const cache = await caches.open(CACHE_NAME);
  const fallback = async () =>
    (await cache.match(request.url, { ignoreVary: true }))
    || (await cache.match(request.url, { ignoreSearch: true, ignoreVary: true }))
    || null;
  try {
    const response = await fetch(request);
    if (transient(response)) return (await fallback()) || retryPage();
    const copy = await storable(response, request.url);
    if (copy) cache.put(request.url, copy).then(() => trim(cache)).catch(() => {});
    return response;
  } catch {
    return (await fallback())
      || (await cache.match("/", { ignoreVary: true }))
      || (await cache.match("/login", { ignoreVary: true }))
      || retryPage();
  }
}

// Hashed build assets never change under the same URL: answer from cache and
// refresh it in the background (stale-while-revalidate).
async function staticAsset(event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(event.request);
  const network = fetch(event.request)
    .then((response) => {
      if (response.ok) cache.put(event.request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => cached);
  if (cached) {
    event.waitUntil(network.then(() => undefined));
    return cached;
  }
  return network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticAsset(event));
  }
});

// Web push: show the nudge and open its page on tap.
self.addEventListener("push", (event) => {
  let data = { title: "Empty Wallet", body: "", url: "/inbox" };
  try { data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url },
      tag: data.url,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/inbox";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) { client.navigate(url); return client.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
