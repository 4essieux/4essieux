const CACHE_NAME = '4essieux-v3-cache-v4';
const RUNTIME_CACHE = '4essieux-runtime-v4';
const ASSETS = [
    '/',
    '/index.html',
    '/src/main.js',
    '/src/style.css',
    '/manifest.json',
    '/logo.jpg',
    '/wasm_exec.js',
    '/tachoparser.wasm',
    '/vite.svg',
    'https://unpkg.com/lucide@latest',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Pre-caching assets...');
                return cache.addAll(ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE)
                    .map((cacheName) => caches.delete(cacheName))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - network first for API, cache first for assets
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests for standard caching
    if (request.method !== 'GET') {
        // Here we could handle offline POST later via Background Sync
        return;
    }

    // Network-first strategy for API calls and Supabase
    if (url.pathname.includes('/api/') || url.hostname.includes('supabase') || url.hostname.includes('googleapis')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Clone and cache successful responses
                    if (response.ok && response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(RUNTIME_CACHE).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Fallback to cache if network fails
                    return caches.match(request);
                })
        );
        return;
    }

    // Cache-first strategy for static assets
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                // Return cached version but potentially update it in background (stale-while-revalidate)
                return cachedResponse;
            }

            return fetch(request).then((response) => {
                // Don't cache non-successful responses or non-standard protocols
                if (!response || response.status !== 200 || response.type === 'error' || response.type === 'opaque') {
                    if (response.type === 'opaque') {
                        // We can cache opaque responses but it's tricky with storage limits
                        // For Lucide/Google Fonts it's fine
                        const responseClone = response.clone();
                        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, responseClone));
                    }
                    return response;
                }

                const responseClone = response.clone();
                caches.open(RUNTIME_CACHE).then((cache) => {
                    cache.put(request, responseClone);
                });

                return response;
            }).catch(() => {
                // Return offline fallback for navigation requests
                if (request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});

// Background sync for offline data submission
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-data') {
        event.waitUntil(processBackgroundSync());
    }
});

async function processBackgroundSync() {
    console.log('🔄 Background sync triggered: processing offline data...');
    // This will be called when the browser regains connectivity
    // We send a message to the client to trigger its sync logic
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({ type: 'SYNC_RETRY' });
    });
}

// Push notification support (for future features)
self.addEventListener('push', (event) => {
    const options = {
        body: event.data ? event.data.text() : 'Nouvelle notification',
        icon: '/logo.jpg',
        badge: '/logo.jpg',
        vibrate: [200, 100, 200],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        }
    };

    event.waitUntil(
        self.registration.showNotification('4ESSIEUX', options)
    );
});

