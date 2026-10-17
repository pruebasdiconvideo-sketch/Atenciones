/* ============================================================================
 *  service-worker.js - PWA Service Worker para Sistema de Atenciones
 *
 *  Estrategias de cache:
 *    - App Shell (HTML/JS/CSS)        : Cache First + update en background
 *    - API GET /dashboard, /tickets    : Network First, fallback a cache stale
 *    - Imagenes estaticas              : Stale While Revalidate
 *    - Fuentes (Google Fonts)          : Cache First
 *    - POST/PUT/PATCH                  : Sin cache (siempre network)
 *
 *  Version: 2.0  (cambiar para forzar update)
 * ========================================================================== */

const VERSION = 'atenciones-v2.0.0';
const CACHE_STATIC = `${VERSION}-static`;
const CACHE_API    = `${VERSION}-api`;
const CACHE_IMG    = `${VERSION}-img`;
const CACHE_FONT   = `${VERSION}-fonts`;

const PRECACHE_URLS = [
  '/',
  '/index.php',
  '/offline.html',
  '/assets/css/app.css',
  '/assets/js/app.js',
  '/assets/js/dashboard.js',
  '/assets/img/icon-192.png',
  '/assets/img/icon-512.png',
  '/manifest.json'
];

/* -------- INSTALL: precaching de recursos criticos -------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();   // activar nueva version inmediatamente
});

/* -------- ACTIVATE: limpiar caches antiguas -------- */
self.addEventListener('activate', (event) => {
  const validCaches = [CACHE_STATIC, CACHE_API, CACHE_IMG, CACHE_FONT];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !validCaches.includes(k))
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* -------- FETCH: enrutamiento por tipo de recurso -------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo HTTP/HTTPS propias
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // POST/PATCH/PUT/DELETE -> Background Sync si offline
  if (req.method !== 'GET') {
    event.respondWith(self.handleMutation(req));
    return;
  }

  // API GET -> Network First (con fallback stale)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(self.networkFirst(req, CACHE_API, 5000));
    return;
  }

  // Imagenes -> Stale While Revalidate
  if (req.destination === 'image' || /\.(png|jpg|jpeg|webp|svg|gif)$/.test(url.pathname)) {
    event.respondWith(self.staleWhileRevalidate(req, CACHE_IMG));
    return;
  }

  // Fuentes -> Cache First
  if (req.destination === 'font' || /\.(woff2?|ttf|eot)$/.test(url.pathname)) {
    event.respondWith(self.cacheFirst(req, CACHE_FONT));
    return;
  }

  // App shell -> Cache First + actualizar en background
  event.respondWith(self.cacheFirst(req, CACHE_STATIC));
});

/* -------- PUSH: notificaciones push desde el servidor -------- */
self.addEventListener('push', (event) => {
  let data = { title: 'Nueva notificacion', body: '', icon: '/assets/img/icon-192.png' };
  try {
    if (event.data) data = JSON.parse(event.data.text());
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge || '/assets/img/badge-72.png',
    tag: data.tag || 'atencion-' + Date.now(),
    renotify: true,
    data: data.data || { url: '/' },
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Abrir' },
      { action: 'dismiss', title: 'Cerrar' }
    ]
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

/* -------- NOTIFICATION CLICK: abrir la app en la URL -------- */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Si ya hay una ventana abierta, enfocarla
        for (const c of clientList) {
          if (c.url.includes(self.location.origin) && 'focus' in c) {
            c.navigate(urlToOpen);
            return c.focus();
          }
        }
        return self.clients.openWindow(urlToOpen);
      })
  );
});

/* -------- BACKGROUND SYNC: reintentar POSTs fallidos -------- */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending') {
    event.waitUntil(self.replayPendingMutations());
  }
});

/* -------- MESSAGE: comunicacion con la pagina -------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
  }
});

/* ============================================================================
 *  HELPERS
 * ========================================================================== */

self.cacheFirst = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    // Actualizar en background
    fetch(req).then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone());
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return caches.match('/offline.html');
  }
};

self.networkFirst = async (req, cacheName, timeout = 5000) => {
  const cache = await caches.open(cacheName);
  try {
    const res = await self.fetchWithTimeout(req, timeout);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    return cached || new Response(JSON.stringify({ ok: false, error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
};

self.staleWhileRevalidate = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
};

self.handleMutation = async (req) => {
  // Si offline, encolar para Background Sync
  if (!navigator.onLine) {
    const pending = await self.getPendingMutations();
    pending.push({ url: req.url, method: req.method, body: await req.clone().text() });
    await self.savePendingMutations(pending);
    self.registration.sync.register('sync-pending');
    return new Response(JSON.stringify({ ok: false, queued: true, message: 'Accion encolada' }),
      { status: 202, headers: { 'Content-Type': 'application/json' } });
  }
  return fetch(req);
};

self.fetchWithTimeout = (req, ms) => {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, ms);
    fetch(req, { signal: ctrl.signal })
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
};

self.replayPendingMutations = async () => {
  const pending = await self.getPendingMutations();
  const failed = [];
  for (const item of pending) {
    try {
      await fetch(item.url, { method: item.method, body: item.body,
                              headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      failed.push(item);
    }
  }
  await self.savePendingMutations(failed);
};

self.getPendingMutations = async () => {
  const cache = await caches.open(`${VERSION}-pending`);
  const res = await cache.match('pending');
  return res ? JSON.parse(await res.text()) : [];
};

self.savePendingMutations = async (list) => {
  const cache = await caches.open(`${VERSION}-pending`);
  await cache.put('pending', new Response(JSON.stringify(list)));
};
