// Every bird gets two types:
//   1. a FAMILY type from its taxonomic order/family (Raptor, Waterfowl, …)
//   2. a HABITAT type from AVONET's main-habitat data (Forest, Wetland, …)

export const FAMILY_TYPES = {
  Songbird:    "#d9a521",
  Corvid:      "#4b4f6b",
  Swallow:     "#6fb3d9",
  Hummingbird: "#d6457a",
  Swift:       "#5a7d9a",
  Raptor:      "#9c4a2c",
  Owl:         "#5b3f8c",
  Nightjar:    "#6e5a7e",
  Waterfowl:   "#2f7fb8",
  Diver:       "#1f4f8a",
  Seabird:     "#5c8fa8",
  Gull:        "#8aa0ad",
  Shorebird:   "#c9a56b",
  Wader:       "#4fa39a",
  Rail:        "#6b8f3a",
  Gamebird:    "#8a6a3b",
  Dove:        "#9a8fb0",
  Cuckoo:      "#7e8c55",
  Woodpecker:  "#c23b2e",
  Kingfisher:  "#1e9bb0",
  Parrot:      "#3aa84a",
  Tropical:    "#e07b2a",
  Ratite:      "#7a6a5a",
  Bird:        "#888888",
};

export const HABITAT_TYPES = {
  Forest:    "#2e6b34",
  Woodland:  "#5f8a3a",
  Shrubland: "#8f9a3c",
  Grassland: "#b39a2e",
  Wetland:   "#3f8f86",
  Riverine:  "#3577a8",
  Coastal:   "#3fa0b3",
  Marine:    "#1d4a80",
  Rocky:     "#7d7468",
  Desert:    "#c9874a",
  Urban:     "#6c6c78",
};

const BY_ORDER = {
  Passeriformes: "Songbird",
  Anseriformes: "Waterfowl",
  Galliformes: "Gamebird",
  Tinamiformes: "Gamebird",
  Podicipediformes: "Diver",
  Gaviiformes: "Diver",
  Sphenisciformes: "Seabird",
  Procellariiformes: "Seabird",
  Suliformes: "Seabird",
  Phaethontiformes: "Seabird",
  Pelecaniformes: "Wader",
  Ciconiiformes: "Wader",
  Phoenicopteriformes: "Wader",
  Eurypygiformes: "Wader",
  Gruiformes: "Rail",
  Charadriiformes: "Shorebird",
  Accipitriformes: "Raptor",
  Falconiformes: "Raptor",
  Cathartiformes: "Raptor",
  Cariamiformes: "Raptor",
  Strigiformes: "Owl",
  Caprimulgiformes: "Nightjar",
  Apodiformes: "Swift",
  Columbiformes: "Dove",
  Pterocliformes: "Dove",
  Cuculiformes: "Cuckoo",
  Otidiformes: "Gamebird",
  Piciformes: "Woodpecker",
  Coraciiformes: "Kingfisher",
  Psittaciformes: "Parrot",
  Trogoniformes: "Tropical",
  Bucerotiformes: "Tropical",
  Musophagiformes: "Tropical",
  Coliiformes: "Tropical",
  Leptosomiformes: "Tropical",
  Opisthocomiformes: "Tropical",
  Struthioniformes: "Ratite",
  Rheiformes: "Ratite",
  Casuariiformes: "Ratite",
  Apterygiformes: "Ratite",
};

const BY_FAMILY = {
  Corvidae: "Corvid",
  Hirundinidae: "Swallow",
  Laridae: "Gull",
  Alcidae: "Seabird",
  Stercorariidae: "Seabird",
  Trochilidae: "Hummingbird",
  Apodidae: "Swift",
  Hemiprocnidae: "Swift",
  Ramphastidae: "Tropical",
  Ardeidae: "Wader",
  Gruidae: "Wader",
};

const HABITAT_NAMES = { "Human Modified": "Urban", Rock: "Rocky" };

export function familyType(order, family) {
  return BY_FAMILY[family] || BY_ORDER[order] || "Bird";
}

// ---- trait data (built by scripts/build_traits.py from AVONET) ----
let traits = null;
const sortedBy = {}; // field -> sorted values across all species, for percentiles
const FIELD = { habitat: 0, lifestyle: 1, diet: 2, migration: 3, mass: 4, wing: 5, beak: 6, tail: 7, tarsus: 8, handWing: 9, match: 10 };

export async function loadTraits() {
  try {
    const res = await fetch("data/traits.json");
    traits = await res.json();
    for (const f of ["mass", "wing", "beak", "tail", "tarsus", "handWing"]) {
      sortedBy[f] = Object.values(traits.species).map((v) => v[FIELD[f]]).filter((x) => x != null).sort((a, b) => a - b);
    }
  } catch (e) { console.warn("No trait data", e); }
}

/** Share of all bird species with a smaller value (0–1). */
export function percentile(field, value) {
  const arr = sortedBy[field];
  if (!arr?.length || value == null) return null;
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < value) lo = mid + 1; else hi = mid; }
  return lo / arr.length;
}

/** All AVONET traits for a species, or null. */
export function traitsFor(sci) {
  const v = traits?.species[sci];
  if (!v) return null;
  const pick = (i, list) => (v[i] == null ? null : list[v[i]]);
  const rawHab = pick(FIELD.habitat, traits.habitats);
  return {
    habitat: rawHab ? HABITAT_NAMES[rawHab] || rawHab : null,
    lifestyle: pick(FIELD.lifestyle, traits.lifestyles),
    diet: pick(FIELD.diet, traits.diets),
    migration: v[FIELD.migration],
    mass: v[FIELD.mass], wing: v[FIELD.wing], beak: v[FIELD.beak],
    tail: v[FIELD.tail], tarsus: v[FIELD.tarsus], handWing: v[FIELD.handWing],
    estimated: v[FIELD.match] > 0,
    estimatedFrom: v[FIELD.match] === 1 ? "genus" : v[FIELD.match] === 2 ? "family" : null,
  };
}
export const habitatFor = traitsFor;

/** Both types for a species: [{ name, kind, color }] */
export function typesFor({ order, family, sci }) {
  const out = [];
  if (order || family) {
    const f = familyType(order, family);
    out.push({ name: f, kind: "family", color: FAMILY_TYPES[f] });
  }
  const h = traitsFor(sci)?.habitat;
  if (h) out.push({ name: h, kind: "habitat", color: HABITAT_TYPES[h] });
  return out;
}

const LIFESTYLE_WORDS = {
  Insessorial: "Perches in trees and shrubs",
  Terrestrial: "Mostly on the ground",
  Aquatic: "Mostly on or in water",
  Aerial: "Mostly in flight",
  Generalist: "Generalist",
};
export const lifestyleText = (l) => LIFESTYLE_WORDS[l] || l;

const DIET_WORDS = {
  Invertivore: "Insects & other invertebrates",
  Omnivore: "A bit of everything",
  Frugivore: "Fruit",
  Granivore: "Seeds & grain",
  Nectarivore: "Nectar",
  "Aquatic predator": "Fish & aquatic prey",
  Vertivore: "Small animals",
  "Herbivore terrestrial": "Leaves & plants",
  "Herbivore aquatic": "Water plants",
  Scavenger: "Carrion",
};
export const dietText = (d) => DIET_WORDS[d] || d;
export const migrationText = (m) => ({ 1: "Resident (doesn't migrate)", 2: "Partial migrant", 3: "Migratory" }[m] || null);
