// Ave·Dex service worker: lets the app open and work offline.
//
// - App files (HTML/JS/CSS/data/icons): network first, so edits show up right
//   away when online; falls back to the cached copy when offline.
// - Bird photos and map tiles: cached as they're viewed (cache first), so
//   entries you've opened keep their photos offline. Capped in size.
// - API calls (iNaturalist, eBird, xeno-canto) aren't cached here; the app
//   already keeps their results in local storage. Sounds always stream.

const VERSION = "v1";
const SHELL = `avedex-shell-${VERSION}`;
const MEDIA = `avedex-media-${VERSION}`;
const MEDIA_LIMIT = 1500;

const SHELL_FILES = [
  "./", "index.html", "css/style.css", "manifest.webmanifest",
  "js/app.js", "js/ebird.js", "js/enrich.js", "js/types.js", "js/taxonomy.js",
  "js/sightings.js", "js/sounds.js", "js/backup.js", "js/map.js", "js/milestones.js",
  "data/traits.json", "data/demo-MyEBirdData.csv",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
];

const MEDIA_HOSTS = [
  "inaturalist-open-data.s3.amazonaws.com", "static.inaturalist.org",
  "tile.openstreetmap.org",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL)
      // add files one by one so a single missing file doesn't block install
      .then((c) => Promise.all(SHELL_FILES.map((f) => c.add(f).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, MEDIA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return cache.match("index.html");
    throw new Error("offline");
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MEDIA_LIMIT; i++) await cache.delete(keys[i]);
}

async function cacheFirst(req) {
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") { cache.put(req, res.clone()); trim(cache); }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (req.destination === "image" && MEDIA_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(cacheFirst(req));
  }
});
