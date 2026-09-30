// Service Worker — 離線快取策略
const CACHE_NAME = "exam-v20260930a";
const STATIC_ASSETS = [
    "./",
    "./index.html",
    "./exam.html",
    "./result.html",
    "./manifest.json",
    "./css/style.css?v=20260930a",
    "./js/config.js?v=20260930a",
    "./js/i18n.js?v=20260930a",
    "./js/utils.js?v=20260930a",
    "./js/data-loader.js?v=20260930a",
    "./js/app.js?v=20260930a",
    "./js/exam.js?v=20260930a",
    "./js/result.js?v=20260930a",
    "./query.html",
    "./css/query.css?v=20260930a",
    "./js/query.js?v=20260930a",
    "./exam-query.html",
    "./js/exam-query.js?v=20260930a",
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

// 即時 API 由 data-loader 處理驗證與備援，避免把錯誤回應快取成題庫。
self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);

    // GAS API 與 POST 直通，不把即時錯誤回應寫入快取。
    if (e.request.method !== 'GET' || url.hostname === 'script.google.com' ||
        url.hostname.endsWith('.googleusercontent.com')) {
        return;
    }

    // 快照索引每次更新，hash 題庫檔才使用固定內容快取。
    if (url.pathname.endsWith('/banks/manifest.json')) return;
    if (/\/banks\/[a-f0-9]{64}\.json$/.test(url.pathname)) {
        e.respondWith(caches.open(CACHE_NAME).then(async function(cache) {
            var cached = await cache.match(e.request);
            if (cached) return cached;
            var response = await fetch(e.request);
            if (response.ok) {
                try {
                    var data = await response.clone().json();
                    var bytes = await response.clone().arrayBuffer();
                    var digest = await crypto.subtle.digest('SHA-256', bytes);
                    var hash = Array.from(new Uint8Array(digest)).map(function(b) {
                        return b.toString(16).padStart(2, '0');
                    }).join('');
                    if (Array.isArray(data) && data.length && url.pathname.endsWith('/' + hash + '.json')) {
                        await cache.put(e.request, response.clone());
                    }
                } catch (_) { }
            }
            return response;
        }));
        return;
    }

    // 靜態資源 → Cache-First
    e.respondWith(
        caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
});
