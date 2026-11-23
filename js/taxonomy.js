// The eBird/Clements taxonomy: every bird species in eBird's taxonomic order.
// Gives each species a fixed dex number (its position among all ~11,000
// species), its eBird species code, and its order and family.
// Fetched once from the eBird API (no key needed) and cached locally.

const URL = "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species";
const CACHE_KEY = "fielddex:taxonomy:v1";
const MAX_AGE_DAYS = 60; // eBird updates its taxonomy once a year (in the fall)

let list = [];
const bySci = new Map(), byCode = new Map(), byCommon = new Map();

function index(rows) {
  list = rows;
  bySci.clear(); byCode.clear(); byCommon.clear();
  rows.forEach((t, i) => {
    t.dex = i + 1;
    bySci.set(t.sci.toLowerCase(), t);
    byCode.set(t.code, t);
    byCommon.set(t.common.toLowerCase(), t);
  });
}

/** Load the taxonomy (cache first, then network). Resolves to the list. */
export async function loadTaxonomy() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch {}
  const fresh = cached && Date.now() - cached.fetchedAt < MAX_AGE_DAYS * 864e5;
  if (cached) index(cached.rows.map(unpack));
  if (fresh) return list;
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`eBird ${res.status}`);
    const rows = (await res.json())
      .filter((t) => t.category === "species")
      .sort((a, b) => a.taxonOrder - b.taxonOrder)
      .map((t) => [t.speciesCode, t.comName, t.sciName, t.taxonOrder, t.order, t.familyComName, t.familySciName]);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), rows }));
    index(rows.map(unpack));
  } catch (e) {
    console.warn("Could not load eBird taxonomy", e);
  }
  return list;
}

const unpack = ([code, common, sci, taxonOrder, order, familyCommon, family]) =>
  ({ code, common, sci, taxonOrder, order, familyCommon, family });

export const taxonomyLoaded = () => list.length > 0;
export const speciesCount = () => list.length;
export const byCodeGet = (code) => byCode.get(code);

/** Match an eBird export row to the current taxonomy (scientific name, then common name). */
export function resolve(sci, common) {
  return bySci.get((sci || "").toLowerCase()) || byCommon.get((common || "").toLowerCase()) || null;
}

/** Search for the sighting form: matches common name, scientific name, or banding code (e.g. "NOCA"). */
export function searchTaxa(query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts = [], contains = [];
  for (const t of list) {
    const com = t.common.toLowerCase(), sci = t.sci.toLowerCase();
    const words = com.split(/[\s-]+/);
    const banding = words.length > 1 ? (words.length === 2
      ? words[0].slice(0, 2) + words[1].slice(0, 2)
      : words[0][0] + words[1][0] + words[words.length - 1].slice(0, 2)) : com.slice(0, 4);
    if (com.startsWith(q) || sci.startsWith(q) || banding === q || words.some((w) => w.startsWith(q))) starts.push(t);
    else if (com.includes(q) || sci.includes(q)) contains.push(t);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Every species in taxonomic order (for family totals). */
export const allTaxa = () => list;
