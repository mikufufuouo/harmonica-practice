import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
async function files(dir, relative = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(join(dir, entry.name), join(relative, entry.name)) : [join(relative, entry.name)]))).flat();
}
const names = (await files(dist)).filter((name) => !name.endsWith('.map') && name !== 'sw.js').map((name) => `./${name.replaceAll('\\', '/')}`).sort();
const hash = createHash('sha256');
for (const name of names) { hash.update(name); hash.update(await readFile(join(dist, name.slice(2)))); }
const revision = hash.digest('hex').slice(0, 16);
const source = `const PRECACHE = ${JSON.stringify(names)};
const CACHE_PREFIX = 'harmonica-lab-shell:';
const cachePrefix = () => CACHE_PREFIX + encodeURIComponent(self.registration.scope) + ':';
const cacheName = () => cachePrefix() + '${revision}';
const precacheUrls = () => new Set(PRECACHE.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName()).then(cache => cache.addAll(PRECACHE))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(cachePrefix()) && key !== cacheName()).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.destination === 'audio') return;
  const url = new URL(event.request.url);
  const rootNavigation = event.request.mode === 'navigate' && (url.href === self.registration.scope || url.href === new URL('index.html', self.registration.scope).href);
  if (!precacheUrls().has(url.href) && !rootNavigation) return;
  event.respondWith(caches.open(cacheName()).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || fetch(event.request);
    return fetch(event.request);
  }));
});
`;
await writeFile(join(dist, 'sw.js'), source);
