/* =========================================================
   オフラインでも開けるようにする仕組み
   ・電波があるときは最新のファイルを取りに行き、控えを保存する
   ・電波がないときは控えのファイルで開く
   ファイルを増やしたときは FILES に名前を足してください。
   ========================================================= */
const CACHE = 'kantan-kakeibo-v1';
const FILES = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'design/theme.css',
  'design/manifest.json',
  'design/images/icon.svg',
  'design/images/icon-192.png',
  'design/images/icon-512.png',
  'design/images/apple-touch-icon.png',
  'design/images/logo.svg',
  'design/images/empty.svg',
  'design/images/icon-pen.svg',
  'design/images/icon-chart.svg',
  'design/images/icon-settings.svg',
  'design/images/icon-calendar.svg',
  'design/images/icon-memo.svg',
  'design/images/icon-backspace.svg',
  'design/images/icon-chevron-left.svg',
  'design/images/icon-chevron-right.svg',
  'design/images/icon-close.svg',
  'design/images/icon-up.svg',
  'design/images/icon-down.svg',
  'design/images/icon-plus.svg',
  'design/images/icon-download.svg',
  'design/images/icon-upload.svg',
  'design/images/icon-table.svg',
  'design/images/icon-card.svg',
];
const NETWORK_WAIT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetchWithTimeout(req, NETWORK_WAIT_MS)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : null))
          .then((hit) => hit || fetch(req))
      )
  );
});
