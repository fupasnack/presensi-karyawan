// service-worker.js — cache dasar untuk shell offline dengan semua asset yang diperlukan
const CACHE = "presensi-fupa-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./karyawan.html",
  "./admin.html",
  "./app.js",
  "./manifest.webmanifest",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap",
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:FILL,GRAD@1,200",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
  "https://api.dicebear.com/7.x/initials/svg?seed=Admin&backgroundColor=ffb300,ffd54f&radius=20",
  "https://api.dicebear.com/7.x/initials/svg?seed=Karyawan&backgroundColor=ffb300,ffd54f&radius=20"
];

self.addEventListener("install", (e) => {
  console.log("[Service Worker] Installing Service Worker");
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => {
        console.log("[Service Worker] Caching app shell");
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  console.log("[Service Worker] Activating Service Worker");
  e.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys.filter(key => key !== CACHE)
            .map(key => {
              console.log("[Service Worker] Removing old cache", key);
              return caches.delete(key);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Skip cross-origin requests
  if (!e.request.url.startsWith(self.location.origin) && !e.request.url.includes('firebase') && !e.request.url.includes('googleapis') && !e.request.url.includes('gstatic')) {
    return;
  }

  e.respondWith(
    caches.match(e.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(e.request);
      })
      .catch(() => {
        // For HTML pages, return the offline page
        if (e.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      })
  );
});

// Handle background sync for offline functionality
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    console.log('[Service Worker] Background sync triggered');
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // This would be implemented to sync offline data when connection is restored
  console.log('[Service Worker] Doing background sync');
}

// Handle push notifications
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/icons/icon-72x72.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [200, 100, 200],
      tag: 'presensi-notification'
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});