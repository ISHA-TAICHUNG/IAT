// Service Worker — 離線快取策略
const CACHE_NAME = "exam-v20260329d";
const STATIC_ASSETS = [
    "./",
    "./index.html",
    "./exam.html",
    "./result.html",
    "./manifest.json",
    "./css/style.css?v=20260329d",
    "./js/config.js?v=20260329d",
    "./js/utils.js?v=20260329d",
    "./js/app.js?v=20260329d",
    "./js/exam.js?v=20260329d",
    "./js/result.js?v=20260329d",
];

// 安裝：預快取靜態資源
self.addEventListener("install", (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// 啟用：清理舊快取
self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch：靜態資源 Cache-First，API Network-First
self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);

    // GAS API → Network-First（有快取 fallback）
    if (url.href.includes("script.google.com")) {
        e.respondWith(
            fetch(e.request)
                .then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // 靜態資源 → Cache-First
    e.respondWith(
        caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
});
