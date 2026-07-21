// Service Worker: кэш оболочки приложения и модуля SQLite для работы без сети.
const VERSION = "notes-v1.0.0";
const SHELL = ["./", "index.html", "manifest.webmanifest", "css/app.css", "js/app.js", "js/model.js", "js/demo.js",
  "js/stores/index.js", "js/stores/sqlite-store.js", "js/stores/file-store.js", "js/stores/idb.js",
  "js/stores/opfs-worker.js", "icons/icon-192.png", "icons/icon-512.png"];
const CDN = "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll([...SHELL, CDN + "sql-wasm.js", CDN + "sql-wasm.wasm"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // сначала сеть для своих файлов (свежая версия), при отсутствии сети — кэш; CDN — сначала кэш
  const fromCdn = e.request.url.startsWith(CDN);
  e.respondWith(
    (fromCdn ? caches.match(e.request) : Promise.resolve(null)).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && (fromCdn || new URL(e.request.url).origin === location.origin)) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))));
});
