// 서비스 워커: 홈 화면에 설치한 앱이 인터넷 없이도 열리게 한다.
// 네트워크 우선 — 연결되어 있으면 항상 최신 파일을 받아 캐시를 갱신하고, 끊겼을 때만 캐시를 쓴다.
// (데이터는 localStorage에 있으므로 여기서는 앱 파일만 다룬다.)
var CACHE = 'todo-app-v1';
var FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(FILES); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // 이름이 바뀐 옛 캐시 정리
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE; }).map(function (key) {
      return caches.delete(key);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      // 오프라인: 캐시에서. 주소만 연 경우(./)는 index.html로
      return caches.match(request).then(function (cached) {
        return cached || caches.match('index.html');
      });
    })
  );
});
