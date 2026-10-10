// Offline support for the app shell.
// - Same-origin app files: precached on install, served cache-first.
// - The WebLLM library from jsDelivr (version-pinned, immutable): cached on first use.
// - Everything else (Open-Meteo weather, Hugging Face weights, model wasm) passes
//   straight through. WebLLM keeps the weights in its own Cache Storage entries.
const VERSION = "touchgrass-v1";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./llm.js",
  "./worker.js",
  "./prompt.js",
  "./context.js",
  "./missions.js",
  "./manifest.webmanifest",
  "./icon.svg",
];
const CDN = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@";
const WEBLLM = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm"; // keep in sync with llm.js

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then(async (c) => {
        await c.addAll(SHELL);
        // Best effort: also fetch the WebLLM library now, so offline works even if
        // the first page load imported it before this worker took control.
        await c.add(WEBLLM).catch(() => {});
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("touchgrass-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isLib = req.url.startsWith(CDN);
  if (!sameOrigin && !isLib) return; // let the browser handle it

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: sameOrigin });
      if (hit) {
        // refresh same-origin files in the background so updates arrive next launch
        if (sameOrigin) event.waitUntil(fetch(req).then((r) => r.ok && cache.put(req, r)).catch(() => {}));
        return hit;
      }
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === "navigate") return (await cache.match("./index.html")) || Response.error();
        throw err;
      }
    })
  );
});
