// Service Worker — 離線快取策略
const CACHE_NAME = "exam-v20260421i";
const STATIC_ASSETS = [
    "./",
    "./index.html",
    "./exam.html",
    "./result.html",
    "./manifest.json",
    "./css/style.css?v=20260421i",
    "./js/config.js?v=20260421i",
    "./js/i18n.js?v=20260421i",
    "./js/utils.js?v=20260421i",
    "./js/app.js?v=20260421i",
    "./js/exam.js?v=20260421i",
    "./js/result.js?v=20260421i",
    "./query.html",
    "./css/query.css?v=20260421i",
    "./js/query.js?v=20260421i",
    "./exam-query.html",
    "./js/exam-query.js?v=20260421i",
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

    // GAS API：僅 GET 做 Network-First 快取；POST 直通（避免 POST 被誤快取）
    if (url.href.includes("script.google.com")) {
        if (e.request.method === "GET") {
            e.respondWith(
                fetch(e.request)
                    .then((res) => {
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                        return res;
                    })
                    .catch(() => caches.match(e.request))
            );
        }
        // POST / 其他方法 → 不攔截，讓瀏覽器正常發送
        return;
    }

    // 靜態資源 → Cache-First
    e.respondWith(
        caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
});
