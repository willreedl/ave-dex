// Looks up photos, summaries and families from the iNaturalist API
// (free, no key, openly licensed photos with attribution) and caches results
// in localStorage so each species is only fetched once.

const API = "https://api.inaturalist.org/v1";
const CACHE_KEY = "fielddex:taxa:v2";
const GAP_MS = 1100; // stay under iNaturalist's ~60 requests/minute guideline

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { cache = {}; }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(CACHE_KEY, JSON.stringify(cache)), 300);
}

export const getInfo = (sci) => cache[sci];
export function clearCache() { cache = {}; localStorage.removeItem(CACHE_KEY); }

const listeners = new Set();
export const onUpdate = (fn) => listeners.add(fn);
const emit = (sci) => listeners.forEach((fn) => fn(sci));

let lastCall = 0;
async function call(path) {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(API + path, { headers: { Accept: "application/json" } });
  if (res.status === 429) { lastCall = Date.now() + 30000; throw new Error("rate-limited"); }
  if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
  return res.json();
}

function pickMatch(results, sci) {
  const exact = results.find((t) => t.name?.toLowerCase() === sci.toLowerCase());
  return exact || results.find((t) => t.rank === "species") || results[0];
}

// Only use openly licensed (Creative Commons / public domain) photos.
function toPhoto(p) {
  if (!p || !p.license_code) return null;
  return {
    url: p.medium_url || p.url?.replace("square", "medium"),
    square: p.square_url || p.url,
    attribution: p.attribution,
    license: p.license_code,
  };
}

// Step 1: name -> iNaturalist taxon id + photo
async function search(sp) {
  const q = encodeURIComponent(sp.sci);
  let data = await call(`/taxa?q=${q}&rank=species&iconic_taxa=Aves&per_page=5`);
  let t = data.results.length ? pickMatch(data.results, sp.sci) : null;
  if (!t) { // taxonomy mismatch: try the common name
    data = await call(`/taxa?q=${encodeURIComponent(sp.common)}&rank=species&iconic_taxa=Aves&per_page=5`);
    t = data.results[0];
  }
  if (!t) { cache[sp.sci] = { notFound: true }; return null; }
  cache[sp.sci] = {
    id: t.id,
    inatName: t.name,
    photo: toPhoto(t.default_photo),
    wikipedia: t.wikipedia_url || null,
    partial: true,
  };
  return t.id;
}

// Step 2: taxon ids -> family, order, Wikipedia summary (batched, up to 30 per call)
async function details(entries) {
  const ids = entries.map(([, info]) => info.id).join(",");
  const data = await call(`/taxa/${ids}`);
  for (const t of data.results) {
    const entry = entries.find(([, info]) => info.id === t.id);
    if (!entry) continue;
    const [sci, info] = entry;
    const anc = t.ancestors || [];
    const fam = anc.find((a) => a.rank === "family");
    const ord = anc.find((a) => a.rank === "order");
    Object.assign(info, {
      family: fam?.name || null,
      familyCommon: fam?.preferred_common_name || null,
      order: ord?.name || null,
      summary: t.wikipedia_summary || null,
      photo: info.photo || (t.taxon_photos || []).map((tp) => toPhoto(tp.photo)).find(Boolean) || null,
      partial: false,
    });
    emit(sci);
  }
}

// --- queue -------------------------------------------------------------
let queue = [];
let running = false;

export function enqueue(speciesList) {
  queue = speciesList.filter((s) => !cache[s.sci] || cache[s.sci].partial);
  run();
}

/** Fetch one species right away (e.g. when the user opens its entry). */
export function prioritize(sp) {
  const have = cache[sp.sci];
  if (have && (have.notFound || !have.partial)) return;
  queue = queue.filter((s) => s.sci !== sp.sci);
  queue.unshift({ ...sp, urgent: true });
  run();
}

async function run() {
  if (running) return;
  running = true;
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending; pending = [];
    try { await details(batch); save(); }
    catch (e) { console.warn("details failed", e); }
  };
  try {
    while (queue.length) {
      const sp = queue.shift();
      try {
        if (!cache[sp.sci]) { await search(sp); save(); emit(sp.sci); }
      } catch (e) {
        if (e.message === "rate-limited") { queue.unshift(sp); continue; }
        console.warn("lookup failed", sp.sci, e);
        continue;
      }
      const info = cache[sp.sci];
      if (info && !info.notFound && info.partial) pending.push([sp.sci, info]);
      if (pending.length >= 10 || sp.urgent || queue[0]?.urgent || !queue.length) await flush();
    }
    await flush();
  } finally {
    running = false;
  }
}
