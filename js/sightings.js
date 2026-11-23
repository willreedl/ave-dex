// Sightings you log in the app, plus merging them with the eBird import into
// one life list. Logged sightings are stored separately from the import, so
// re-importing eBird data never wipes them. A logged sighting whose species
// and date also appear in the latest eBird import is treated as "now in
// eBird" and no longer counted twice.

import { resolve, taxonomyLoaded } from "./taxonomy.js";

const KEY = "fielddex:manual:v1";

let manual = [];
try { manual = JSON.parse(localStorage.getItem(KEY)) || []; } catch { manual = []; }
const persist = () => localStorage.setItem(KEY, JSON.stringify(manual));

export const allManual = () => manual;

export function addSighting(s) {
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    code: s.code, sci: s.sci, common: s.common,
    date: s.date, time: s.time || "", location: s.location || "", region: s.region || "",
    count: s.count ?? null, notes: s.notes || "",
    lat: Number.isFinite(s.lat) ? s.lat : null, lon: Number.isFinite(s.lon) ? s.lon : null,
    createdAt: new Date().toISOString(),
  };
  manual.push(entry);
  persist();
  return entry;
}

export function deleteSighting(id) {
  manual = manual.filter((m) => m.id !== id);
  persist();
}

const earlier = (a, b) => (!b?.date || (a.date && a.date < b.date) ? a : b);
const later = (a, b) => (!b?.date || (a.date && a.date > b.date) ? a : b);

/**
 * Merge imported species and logged sightings into life-list entries:
 * { key, code, sci, common, dex, sortOrder, order, family, familyCommon,
 *   first, last, timesSeen, totalCount, logged: [{...sighting, inEbird}] }
 */
export function buildLifeList(imported) {
  const entries = new Map();

  for (const sp of imported?.species || []) {
    const t = resolve(sp.sci, sp.common);
    const key = t?.code || sp.sci;
    entries.set(key, {
      key, code: t?.code || null,
      sci: t?.sci || sp.sci, common: t?.common || sp.common,
      dex: t?.dex ?? null, sortOrder: t?.taxonOrder ?? sp.taxonOrder ?? Infinity,
      order: t?.order || null, family: t?.family || null, familyCommon: t?.familyCommon || null,
      first: sp.first, last: sp.last,
      timesSeen: sp.timesSeen, totalCount: sp.totalCount,
      dates: new Set(sp.dates || []),
      locs: (sp.locs || []).map((l) => [...l]),
      months: sp.months ? [...sp.months] : null,
      imported: true, logged: [],
    });
  }

  for (const m of manual) {
    const t = resolve(m.sci, m.common);
    const key = t?.code || m.code || m.sci;
    let e = entries.get(key);
    if (!e) {
      e = {
        key, code: t?.code || m.code || null,
        sci: t?.sci || m.sci, common: t?.common || m.common,
        dex: t?.dex ?? null, sortOrder: t?.taxonOrder ?? Infinity,
        order: t?.order || null, family: t?.family || null, familyCommon: t?.familyCommon || null,
        first: null, last: null, timesSeen: 0, totalCount: null,
        dates: new Set(), locs: [], months: new Array(12).fill(0), imported: false, logged: [],
      };
      entries.set(key, e);
    }
    const inEbird = e.imported && e.dates.has(m.date);
    const sighting = { date: m.date, time: m.time, location: m.location, region: m.region, subId: null, logged: true };
    e.logged.push({ ...m, inEbird });
    if (inEbird) continue;
    if (e.months) e.months[+m.date.slice(5, 7) - 1]++;
    if (m.lat != null && m.lon != null) e.locs.push([m.lat, m.lon, m.location || "Logged sighting", 1, true]);
    e.first = e.first ? earlier(sighting, e.first) : sighting;
    e.last = e.last ? later(sighting, e.last) : sighting;
    if (e.timesSeen != null) e.timesSeen += 1;
    // (a life-list import has no counts, so don't start a misleading partial total)
    if (Number.isFinite(m.count) && (e.totalCount != null || !e.imported)) e.totalCount = (e.totalCount ?? 0) + m.count;
  }

  const list = [...entries.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.sci.localeCompare(b.sci));
  // Without the taxonomy (offline on first run), fall back to numbering by position.
  if (!taxonomyLoaded()) list.forEach((e, i) => { e.dex = null; e.fallbackDex = i + 1; });
  for (const e of list) e.logged.sort((a, b) => b.date.localeCompare(a.date));
  return list;
}

/** Merge logged sightings from a backup (matched by id; existing ones kept). Returns how many were added. */
export function mergeManual(list) {
  const have = new Set(manual.map((m) => m.id));
  const fresh = (list || []).filter((m) => m && m.id && m.sci && m.date && !have.has(m.id));
  manual.push(...fresh);
  persist();
  return fresh.length;
}
