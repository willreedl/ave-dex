// eBird CSV import: turns either eBird export into a list of seen species.
// Supports:
//   - "Download My Data" export (MyEBirdData.csv): one row per observation
//   - Life List page download: one row per species
// Pure functions, no DOM — this logic is meant to be ported to Swift later.

/** RFC-4180-ish CSV parser (quoted fields, escaped quotes, newlines in quotes). */
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const COLS = {
  common: ["common name"],
  sci: ["scientific name"],
  order: ["taxonomic order", "taxon order"],
  category: ["category"],
  date: ["date"],
  time: ["time"],
  location: ["location"],
  region: ["state/province", "s/p"],
  count: ["count"],
  subId: ["submission id", "subid"],
  countable: ["countable"],
  lat: ["latitude"],
  lon: ["longitude"],
  locId: ["location id", "locid"],
};

const MAX_LOCS = 300; // per species, keeps storage small for very common birds

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Returns "YYYY-MM-DD" or null. Handles "2021-03-03" and "03 Mar 2021". */
export function normalizeDate(s) {
  if (!s) return null;
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()] + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // US m/d/yyyy
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/**
 * Decide whether an eBird row is a full species, and if so return its
 * species-level names. Subspecies groups (ISSF, e.g. "Yellow-rumped Warbler
 * (Myrtle)") collapse to the parent species; spuhs, slashes, hybrids,
 * domestics and forms are dropped.
 */
export function toSpecies(common, sci, category) {
  const cat = (category || "").toLowerCase().trim();
  if (cat && !["species", "issf"].includes(cat)) return null;
  if (!sci) return null;
  if (/\bsp\.|\s[x×]\s|\(hybrid\)|domestic/i.test(sci + " " + common)) return null;
  const parts = sci.trim().split(/\s+/);
  if (parts.length < 2) return null;
  // A slash in genus/species means "Downy/Hairy"-style uncertainty; a slash
  // after that (e.g. "Colaptes auratus auratus/luteus") is a subspecies group.
  if (/\//.test(parts[0] + parts[1]) || /\//.test(common.replace(/\(.*\)/, ""))) return null;
  if (!/^[A-Z][a-z]+$/.test(parts[0]) || !/^[a-z-]+$/.test(parts[1])) return null;
  const binomial = `${parts[0]} ${parts[1]}`;
  const cleanCommon = common.replace(/\s*\(.*\)\s*$/, "").trim();
  return { sci: binomial, common: cleanCommon };
}

/** Main entry point: CSV text -> { species: [...], meta } */
export function importEbirdCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("That file looks empty.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(COLS)) {
    idx[key] = header.findIndex((h) => names.includes(h));
  }
  if (idx.common < 0 || idx.sci < 0) {
    throw new Error("This doesn't look like an eBird export (no Common Name / Scientific Name columns).");
  }
  const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || "").trim() : "");
  const isObservationExport = idx.subId >= 0 && header.includes("submission id");

  const bySci = new Map();
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const sp = toSpecies(get(r, "common"), get(r, "sci"), get(r, "category"));
    if (!sp) { skipped++; continue; }
    const date = normalizeDate(get(r, "date"));
    const order = parseFloat(get(r, "order"));
    const count = parseInt(get(r, "count"), 10);
    const sighting = {
      date, time: get(r, "time"), location: get(r, "location"),
      region: get(r, "region"), subId: get(r, "subId"),
    };
    let s = bySci.get(sp.sci);
    if (!s) {
      s = { sci: sp.sci, common: sp.common, taxonOrder: isNaN(order) ? Infinity : order,
            first: sighting, last: sighting, checklists: new Set(), dates: new Set(), total: 0, hasCounts: false,
            locs: new Map(), months: new Array(12).fill(0), monthSubs: new Set() };
      bySci.set(sp.sci, s);
    }
    // Prefer the plain species name over a subspecies-group label.
    if (!/\(/.test(get(r, "common"))) s.common = sp.common;
    if (!isNaN(order)) s.taxonOrder = Math.min(s.taxonOrder, order);
    if (date && (!s.first.date || date < s.first.date)) s.first = sighting;
    if (date && (!s.last.date || date > s.last.date)) s.last = sighting;
    if (sighting.subId) s.checklists.add(sighting.subId);
    if (date) s.dates.add(date);
    // where & when: one point per location, one tally per checklist per month
    const lat = parseFloat(get(r, "lat")), lon = parseFloat(get(r, "lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const key = get(r, "locId") || `${lat.toFixed(3)},${lon.toFixed(3)}`;
      const loc = s.locs.get(key) || { lat: +lat.toFixed(4), lon: +lon.toFixed(4), name: sighting.location, subs: new Set() };
      loc.subs.add(sighting.subId || date);
      s.locs.set(key, loc);
    }
    const visit = sighting.subId || `${date}|${sighting.location}`;
    if (date && !s.monthSubs.has(visit)) { s.monthSubs.add(visit); s.months[+date.slice(5, 7) - 1]++; }
    if (!isNaN(count)) { s.total += count; s.hasCounts = true; }
  }

  const species = [...bySci.values()]
    .sort((a, b) => a.taxonOrder - b.taxonOrder || a.sci.localeCompare(b.sci))
    .map((s) => ({
      sci: s.sci,
      common: s.common,
      taxonOrder: s.taxonOrder === Infinity ? null : s.taxonOrder,
      first: s.first,
      last: s.last,
      timesSeen: isObservationExport ? s.checklists.size : null,
      totalCount: isObservationExport && s.hasCounts ? s.total : null,
      dates: [...s.dates].sort(), // used to spot logged sightings already in eBird
      // [lat, lon, location name, checklists there]
      locs: [...s.locs.values()].sort((a, b) => b.subs.size - a.subs.size).slice(0, MAX_LOCS)
        .map((l) => [l.lat, l.lon, l.name, l.subs.size]),
      months: isObservationExport ? s.months : null, // a life-list export only has first dates
    }));

  return {
    species,
    meta: {
      source: isObservationExport ? "My eBird Data export" : "Life list export",
      rows: rows.length - 1,
      skipped,
      importedAt: new Date().toISOString(),
    },
  };
}
