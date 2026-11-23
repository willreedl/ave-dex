// Milestones, badges and family completion, all computed from the life list.

import { allTaxa } from "./taxonomy.js";
import { typesFor, traitsFor, HABITAT_TYPES } from "./types.js";

const SEEN_KEY = "fielddex:badgesSeen:v1";
const SPECIES_MARKS = [1, 10, 25, 50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000];

const byFirstDate = (a, b) => (a.first?.date || "9999").localeCompare(b.first?.date || "9999");
const country = (region) => (region || "").split("-")[0].toUpperCase() || null;

/** Every date a species was seen (imported + logged), as "YYYY-MM-DD". */
function datesOf(e) {
  const out = new Set(e.dates || []);
  if (e.first?.date) out.add(e.first.date);
  for (const m of e.logged || []) if (!m.inEbird) out.add(m.date);
  return out;
}

// ---- badges -----------------------------------------------------------
// Each: id, name, icon, description, and a function returning the qualifying
// entries (sorted by first sighting) + target. Unlock date = when the
// target-th qualifying species was first seen.
const count = (pred) => (life) => life.filter(pred).sort(byFirstDate);
const ofType = (name) => (e) => typesFor(e).some((t) => t.name === name);
const ofFamily = (fam) => (e) => e.family === fam;
const ofOrder = (ord) => (e) => e.order === ord;

const BADGES = [
  { id: "first", icon: "🥚", name: "Hatchling", desc: "Your first species", target: 1, pick: count(() => true) },
  { id: "c100", icon: "💯", name: "Century", desc: "100 species", target: 100, pick: count(() => true) },
  { id: "c500", icon: "🌍", name: "Five Hundred Club", desc: "500 species", target: 500, pick: count(() => true) },
  { id: "owls", icon: "🦉", name: "Night Watch", desc: "3 owl species", target: 3, pick: count(ofOrder("Strigiformes")) },
  { id: "raptors", icon: "🦅", name: "Raptor Spotter", desc: "10 raptors (hawks, eagles, falcons, vultures)", target: 10, pick: count(ofType("Raptor")) },
  { id: "hummers", icon: "✨", name: "Hummingbird Hunter", desc: "5 hummingbird species", target: 5, pick: count(ofFamily("Trochilidae")) },
  { id: "warblers", icon: "🎶", name: "Warbler Wave", desc: "15 New World warblers", target: 15, pick: count(ofFamily("Parulidae")) },
  { id: "shorebirds", icon: "🌊", name: "Mudflat Sleuth", desc: "15 shorebirds", target: 15, pick: count(ofType("Shorebird")) },
  { id: "ducks", icon: "🦆", name: "Duck Dynasty", desc: "20 ducks, geese and swans", target: 20, pick: count(ofFamily("Anatidae")) },
  { id: "woodpeckers", icon: "🪵", name: "Knock Knock", desc: "8 woodpeckers", target: 8, pick: count(ofFamily("Picidae")) },
  { id: "tropics", icon: "🌴", name: "Into the Tropics", desc: "10 tropical-type birds (parrots, trogons, toucans…)", target: 10, pick: count((e) => ["Tropical", "Parrot"].some((t) => ofType(t)(e))) },
  { id: "tiny", icon: "🪶", name: "Featherweight", desc: "A bird under 5 g", target: 1, pick: count((e) => (traitsFor(e.sci)?.mass ?? 99) < 5) },
  { id: "giant", icon: "🏋️", name: "Heavyweight", desc: "A bird over 5 kg", target: 1, pick: count((e) => (traitsFor(e.sci)?.mass ?? 0) > 5000) },
  { id: "families50", icon: "🌳", name: "Family Tree", desc: "Birds from 50 families", target: 50,
    pick: (life) => firstOfEach(life, (e) => e.family) },
  { id: "habitats", icon: "🧭", name: "Habitat Hopper", desc: `A bird from every habitat type (${Object.keys(HABITAT_TYPES).length})`, target: Object.keys(HABITAT_TYPES).length,
    pick: (life) => firstOfEach(life, (e) => traitsFor(e.sci)?.habitat) },
  { id: "countries", icon: "✈️", name: "Globetrotter", desc: "Lifers in 3 countries", target: 3,
    pick: (life) => firstOfEach(life, (e) => country(e.first?.region)) },
];

/** The first entry (by date) for each distinct value of keyFn. */
function firstOfEach(life, keyFn) {
  const seen = new Map();
  for (const e of [...life].sort(byFirstDate)) {
    const k = keyFn(e);
    if (k && !seen.has(k)) seen.set(k, e);
  }
  return [...seen.values()];
}

export function computeBadges(life) {
  return BADGES.map((b) => {
    const hits = b.pick(life);
    const unlocked = hits.length >= b.target;
    return {
      id: b.id, icon: b.icon, name: b.name, desc: b.desc, target: b.target,
      progress: Math.min(hits.length, b.target), unlocked,
      date: unlocked ? hits[b.target - 1].first?.date : null,
      by: unlocked ? hits[b.target - 1] : null,
    };
  });
}

/** Badges unlocked since the last call (first call just records the current state). */
export function newlyUnlocked(life) {
  const badges = computeBadges(life).filter((b) => b.unlocked);
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)); } catch {}
  localStorage.setItem(SEEN_KEY, JSON.stringify(badges.map((b) => b.id)));
  if (!seen) return [];
  return badges.filter((b) => !seen.includes(b.id));
}

// ---- species milestones & year lists ----------------------------------
export function speciesMilestones(life) {
  const ordered = life.filter((e) => e.first?.date).sort(byFirstDate);
  const reached = SPECIES_MARKS.filter((n) => n <= ordered.length).map((n) => ({ n, entry: ordered[n - 1] }));
  const next = SPECIES_MARKS.find((n) => n > life.length);
  return { reached, next, toGo: next ? next - life.length : 0 };
}

export function yearLists(life) {
  const years = {};
  for (const e of life) {
    for (const d of datesOf(e)) {
      const y = d.slice(0, 4);
      (years[y] ||= { species: new Set(), lifers: 0 }).species.add(e.key);
    }
    const fy = e.first?.date?.slice(0, 4);
    if (fy) (years[fy] ||= { species: new Set(), lifers: 0 }).lifers++;
  }
  return Object.entries(years).sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, v]) => ({ year, species: v.species.size, lifers: v.lifers }));
}

// ---- family completion --------------------------------------------------
export function familyCompletion(life) {
  const totals = new Map();
  for (const t of allTaxa()) {
    const f = totals.get(t.family) || { family: t.family, common: t.familyCommon, total: 0, seen: 0, firstOrder: t.taxonOrder };
    f.total++;
    totals.set(t.family, f);
  }
  for (const e of life) { const f = totals.get(e.family); if (f) f.seen++; }
  const all = [...totals.values()];
  return {
    families: all.filter((f) => f.seen).sort((a, b) => a.firstOrder - b.firstOrder),
    familiesSeen: all.filter((f) => f.seen).length,
    familiesTotal: all.length,
    complete: all.filter((f) => f.seen && f.seen === f.total),
  };
}
