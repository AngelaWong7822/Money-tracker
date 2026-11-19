/* 錢錢簿 service worker：網絡優先，冇網先用快取（資產數字永遠由雲端攞，唔會快取） */
const CACHE = 'money-shell-v13';
const SHELL = [
    './', './index.html', './css/app.css', './manifest.webmanifest',
    './js/config.js', './js/store.js', './js/calc.js', './js/app.js', './js/import.js', './js/analysis.js', './js/chat.js', './js/trades.js',
    './vendor/supabase/supabase.js',
    './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== location.origin) return;
    e.respondWith(
        fetch(e.request)
            .then((res) => {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(e.request, copy));
                return res;
            })
            .catch(() => caches.match(e.request)),
    );
});
