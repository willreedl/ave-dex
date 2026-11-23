// Bird sounds for an entry.
//   - With a xeno-canto API key (free with a xeno-canto account): separate
//     SONG and CALL recordings, best-rated first, with spectrograms.
//   - Without a key: Creative-Commons recordings from iNaturalist research-grade
//     observations, which aren't labeled song vs. call.

const SETTINGS_KEY = "fielddex:settings:v1";
const memo = new Map();

export function getSettings() {
  try { return { autoplay: false, xcKey: "", ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
  catch { return { autoplay: false, xcKey: "" }; }
}
export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  memo.clear();
}
export const hasXenoCanto = () => !!getSettings().xcKey;

const QUALITY = { A: 0, B: 1, C: 2, D: 3, E: 4 };
const licenseName = (url) => {
  const m = (url || "").match(/licenses\/([a-z-]+)\/([\d.]+)/i);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : "CC license";
};

async function xenoCanto(sci, type) {
  const key = getSettings().xcKey;
  const query = `sp:"${sci.toLowerCase()}" type:${type}`;
  const url = `https://xeno-canto.org/api/3/recordings?query=${encodeURIComponent(query)}&per_page=50&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `xeno-canto ${res.status}`);
  return (data.recordings || [])
    .filter((r) => r.type?.toLowerCase().split(/,\s*/).includes(type))
    .sort((a, b) => (QUALITY[a.q] ?? 9) - (QUALITY[b.q] ?? 9))
    .slice(0, 15)
    .map((r) => ({
      src: r.file,
      credit: `${r.rec} · XC${r.id}`,
      where: [r.loc, r.cnt].filter(Boolean).join(", "),
      license: licenseName(r.lic),
      page: r.url?.startsWith("//") ? "https:" + r.url : r.url,
      spectrogram: r.sono?.med ? (r.sono.med.startsWith("//") ? "https:" + r.sono.med : r.sono.med) : null,
      length: r.length,
      label: r.type,
    }));
}

async function iNaturalist(inatId) {
  const url = `https://api.inaturalist.org/v1/observations?taxon_id=${inatId}&sounds=true&quality_grade=research` +
    `&sound_license=cc-by,cc-by-nc,cc-by-sa,cc-by-nc-sa,cc0&order_by=votes&per_page=10`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
  const data = await res.json();
  return data.results.flatMap((o) => o.sounds.filter((s) => s.license_code && s.file_url).map((s) => ({
    src: s.file_url,
    credit: s.attribution,
    where: o.place_guess || "",
    license: s.license_code.toUpperCase().replace(/^CC-?/, "CC "),
    page: `https://www.inaturalist.org/observations/${o.id}`,
    spectrogram: null,
    label: "recording",
  }))).slice(0, 15);
}

/**
 * kind: "song" | "call" (xeno-canto) or "any" (iNaturalist fallback).
 * Returns a list of recordings (possibly empty). Cached for the session.
 */
export function getRecordings(sp, kind, inatId) {
  const id = `${sp.sci}|${kind}|${hasXenoCanto()}`;
  if (!memo.has(id)) {
    const p = kind === "any"
      ? (inatId ? iNaturalist(inatId) : Promise.resolve([]))
      : xenoCanto(sp.sci, kind);
    memo.set(id, p.catch((e) => { memo.delete(id); throw e; }));
  }
  return memo.get(id);
}

// ---- one shared player ----
export const player = new Audio();
player.preload = "none";
