// 서비스 워커: 한 번 연 뒤에는 인터넷 없이도 앱이 열리게 저장해 둡니다.
// 버전과 미리 저장할 파일 목록은 빌드할 때 vite.config.js 가 채워 넣습니다.
const VERSION = '__VERSION__';
const APP_CACHE = `app-${VERSION}`;
const MODEL_CACHE = 'bgdata-1.4.5'; // AI 모델(약 100MB)은 버전이 바뀔 때만 새로 받음
const FONT_CACHE = 'fonts-v1';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  const keep = [APP_CACHE, MODEL_CACHE, FONT_CACHE];
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (await cache.match('./')) || (await cache.match('index.html'));
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req));
    if (url.pathname.includes('/bgdata/')) return e.respondWith(cacheFirst(req, MODEL_CACHE));
    return e.respondWith(cacheFirst(req, APP_CACHE));
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return e.respondWith(cacheFirst(req, FONT_CACHE));
  }
});
