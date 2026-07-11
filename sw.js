// Service worker do App Orçamento Familiar — cache local para o app abrir
// mesmo sem internet depois da primeira visita. Nao guarda nenhum dado do
// usuario (isso continua so no IndexedDB do navegador); so guarda os
// arquivos do proprio app (HTML/CSS/JS/icones).
const CACHE_NAME = 'orcamento-familiar-v1';
const ARQUIVOS = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './seed.js',
  './crypto.js',
  './logic.js',
  './storage.js',
  './sync.js',
  './app.js',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((resp) => {
      if (resp) return resp;
      return fetch(event.request).then((rede) => {
        const copia = rede.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return rede;
      }).catch(() => resp);
    })
  );
});
