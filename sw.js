const CACHE_NAME = 'carbflow-v10';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url || '';
  if (
    event.request.method !== 'GET' ||
    !url.startsWith('http') ||
    url.includes('/api/')
  ) {
    return;
  }
  // version.json 永远走网络不缓存，确保实时检测到最新版本
  if (url.includes('version.json')) {
    event.respondWith(fetch(url, { cache: 'no-store', credentials: 'same-origin' }));
    return;
  }
  // 同源请求传 URL 字符串 + cache: 'no-cache' 绕过 GitHub Pages max-age=600 HTTP 缓存（注意不直接套用于 event.request navigate 对象，避免 TypeError）
  const isSameOrigin = (() => {
    try {
      return new URL(url).origin === self.location.origin;
    } catch (_) {
      return false;
    }
  })();
  const netFetch = isSameOrigin
    ? fetch(url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(event.request);

  // 网络优先策略：联网时自动拉取最新代码实现应用内热更新；断网时无缝回退本地缓存
  event.respondWith(
    netFetch
      .then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
