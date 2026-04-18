// ─── LaporPak Service Worker ───────────────────────────────────────────────
const CACHE_NAME = 'laporpak-v1';
const STATIC_CACHE = 'laporpak-static-v1';
const DYNAMIC_CACHE = 'laporpak-dynamic-v1';

// File yang di-cache saat install (app shell)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Aset lokal lainnya
  '/image_4.png',
  // Font Google (jika ada koneksi saat install)
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Nunito:wght@400;600;700;800;900&display=swap'
];

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing LaporPak Service Worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        // cache.addAll gagal jika 1 asset error, gunakan Promise.allSettled
        return Promise.allSettled(
          STATIC_ASSETS.map(url => cache.add(url).catch(err => {
            console.warn('[SW] Failed to cache:', url, err);
          }))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating LaporPak Service Worker...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ─── FETCH (Strategi Cache) ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET & cross-origin kecuali font Google
  if (request.method !== 'GET') return;

  // ── API / form submit → Network Only (jangan cache POST) ──
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  // ── Font Google → Cache First ──
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, DYNAMIC_CACHE));
    return;
  }

  // ── App Shell (HTML) → Network First, fallback cache ──
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // ── Asset statis lainnya → Cache First ──
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ─── STRATEGI ───────────────────────────────────────────────────────────────

// Cache First: ambil dari cache, jika tidak ada baru fetch & simpan
async function cacheFirst(request, cacheName = STATIC_CACHE) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

// Network First: coba fetch dulu, jika gagal ambil dari cache
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

// Network Only
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ error: 'Tidak ada koneksi internet', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Fallback saat offline
function offlineFallback(request) {
  if (request.headers.get('accept')?.includes('text/html')) {
    return caches.match('/index.html');
  }
  // Fallback gambar transparan 1x1
  if (request.headers.get('accept')?.includes('image')) {
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  return new Response('Offline', { status: 503 });
}

// ─── PUSH NOTIFICATION ──────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'LaporPak', body: 'Ada update laporan Anda!', icon: '/icons/icon-192.png' };
  try { data = { ...data, ...event.data.json() }; } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: data.tag || 'laporpak-notif',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' }
    })
  );
});

// ─── NOTIFICATION CLICK ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ─── BACKGROUND SYNC ────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reports') {
    console.log('[SW] Background sync: mengirim laporan yang tertunda...');
    event.waitUntil(syncPendingReports());
  }
});

async function syncPendingReports() {
  // Implementasi: ambil laporan dari IndexedDB dan kirim ke server
  console.log('[SW] Sync laporan selesai');
}
