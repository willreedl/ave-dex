import { importEbirdCSV } from "./ebird.js";
import { getInfo, enqueue, prioritize, onUpdate } from "./enrich.js";
import { FAMILY_TYPES, HABITAT_TYPES, typesFor, traitsFor, lifestyleText, dietText, migrationText, percentile, loadTraits } from "./types.js";
import { loadTaxonomy, searchTaxa, speciesCount, taxonomyLoaded, byCodeGet } from "./taxonomy.js";
import { buildLifeList, addSighting, deleteSighting } from "./sightings.js";
import { getRecordings, hasXenoCanto, getSettings, saveSettings, player } from "./sounds.js";
import { saveBackup, readBackup, lastBackup, unsavedCount } from "./backup.js";
import { showMap } from "./map.js";
import { computeBadges, newlyUnlocked, speciesMilestones, yearLists, familyCompletion } from "./milestones.js";

const STORE_KEY = "fielddex:life:v1";
const $ = (id) => document.getElementById(id);
const els = {
  device: $("device"), list: $("list"), detail: $("detail"), search: $("search"),
  typeFilter: $("typeFilter"), sort: $("sort"), counter: $("seenCounter"),
  status: $("lookupStatus"), file: $("fileInput"),
  log: $("logDialog"), settings: $("settingsDialog"),
};

let imported = loadImported(); // { species, meta, demo } from the last eBird import
let life = [];                 // merged life-list entries (see sightings.js)
let view = [];                 // filtered + sorted entries
let selected = null;           // entry key (eBird species code)
let mode = "detail";           // "detail" | "stats"
let flashKey = null;           // entry to celebrate as a new lifer

// ---------- persistence ----------
function loadImported() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
}
const storeImported = () => localStorage.setItem(STORE_KEY, JSON.stringify(imported));

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dexLabel = (e) => e.dex ? `#${String(e.dex).padStart(4, "0")}` : e.fallbackDex ? `#${String(e.fallbackDex).padStart(3, "0")}` : "#----";
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDate = (d) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
const entryFor = (key) => life.find((e) => e.key === key);
const typesOf = (e) => {
  const info = getInfo(e.sci);
  return typesFor({ order: e.order || info?.order, family: e.family || info?.family, sci: e.sci });
};
/** Keep only <b>/<i> from Wikipedia's HTML summary. */
function safeSummary(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return esc(n.textContent);
    if (n.nodeType !== 1) return "";
    const inner = walk(n);
    const tag = { B: "b", STRONG: "b", I: "i", EM: "i" }[n.tagName];
    return tag ? `<${tag}>${inner}</${tag}>` : inner;
  }).join("");
  return walk(doc.body);
}
function toast(msg, isError = false) {
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

function rebuild() {
  life = buildLifeList(imported);
  renderBackupStatus();
  announceBadges();
  if (selected && !entryFor(selected)) selected = null;
  renderList();
  renderDetail();
  updateStatus();
}

// Toast any badges unlocked since last time (needs taxonomy + traits loaded to be accurate).
let dataReady = false;
function announceBadges() {
  if (!dataReady || !life.length) return;
  newlyUnlocked(life).forEach((b, i) => setTimeout(() => toast(`${b.icon} Badge unlocked: ${b.name}!`), 600 + i * 1200));
}

// ---------- list ----------
function buildTypeFilter() {
  const opts = (obj) => Object.keys(obj).filter((t) => t !== "Bird").sort().map((t) => `<option>${t}</option>`).join("");
  els.typeFilter.innerHTML = `<option value="">All types</option>
    <optgroup label="Family type">${opts(FAMILY_TYPES)}</optgroup>
    <optgroup label="Habitat">${opts(HABITAT_TYPES)}</optgroup>`;
}

function computeView() {
  const q = els.search.value.trim().toLowerCase().replace(/^#0*/, "#");
  const type = els.typeFilter.value;
  view = life.filter((e) => {
    if (q) {
      const hay = `${e.common} ${e.sci} ${e.familyCommon || ""} ${e.family || ""} #${e.dex || e.fallbackDex || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (type && !typesOf(e).some((t) => t.name === type)) return false;
    return true;
  });
  const by = {
    dex: (a, b) => a.sortOrder - b.sortOrder,
    recent: (a, b) => (b.first?.date || "").localeCompare(a.first?.date || ""),
    oldest: (a, b) => (a.first?.date || "9").localeCompare(b.first?.date || "9"),
    name: (a, b) => a.common.localeCompare(b.common),
    seen: (a, b) => (b.timesSeen || 0) - (a.timesSeen || 0) || a.sortOrder - b.sortOrder,
  }[els.sort.value];
  view.sort(by);
}

function rowHTML(e) {
  const info = getInfo(e.sci);
  const thumb = info?.photo?.square
    ? `<span class="thumb" style="background-image:url('${esc(info.photo.square)}')"></span>`
    : `<span class="thumb empty">?</span>`;
  const dots = typesOf(e).map((t) => `<i class="${t.kind}" style="background:${t.color}" title="${t.name}"></i>`).join("");
  return `<li data-key="${esc(e.key)}" class="${e.key === selected ? "active" : ""}">
    <span class="num">${dexLabel(e)}</span>${thumb}<span class="name">${esc(e.common)}</span><span class="type-dots">${dots}</span></li>`;
}

function renderList() {
  computeView();
  const total = speciesCount();
  els.counter.innerHTML = `SEEN <b>${String(life.length).padStart(3, "0")}</b>${total ? `<small>/${total.toLocaleString()}</small>` : ""}`;
  if (!life.length) { els.list.innerHTML = `<li class="empty-list">No birds yet.<br>Import your eBird data or log a sighting.</li>`; return; }
  els.list.innerHTML = view.length ? view.map(rowHTML).join("") : `<li class="empty-list">No matches.</li>`;
}

function updateRowsFor(sci) {
  for (const e of life.filter((x) => x.sci === sci)) {
    const li = els.list.querySelector(`li[data-key="${CSS.escape(e.key)}"]`);
    if (li) li.outerHTML = rowHTML(e);
  }
}

// ---------- detail ----------
function select(key, { scroll = true, open = true } = {}) {
  if (selected !== key) stopSound();
  selected = key;
  mode = "detail";
  els.list.querySelectorAll("li.active").forEach((li) => li.classList.remove("active"));
  const li = els.list.querySelector(`li[data-key="${CSS.escape(key)}"]`);
  if (li) { li.classList.add("active"); if (scroll) li.scrollIntoView({ block: "nearest" }); }
  const e = entryFor(key);
  if (e) prioritize(e);
  renderDetail();
  if (open) els.device.classList.add("show-detail");
  // Autoplay the song shortly after an entry opens (if enabled in Settings).
  clearTimeout(autoTimer);
  if (e && getSettings().autoplay) autoTimer = setTimeout(() => {
    if (selected === key && !soundState) toggleSound(e, hasXenoCanto() ? "song" : "any");
  }, 500);
}
let autoTimer = null;

function renderDetail() {
  if (mode === "stats") return renderStats();
  if (!life.length) return renderWelcome();
  const e = entryFor(selected);
  if (!e) return renderPlaceholder();
  const info = getInfo(e.sci);
  const types = typesOf(e);
  const photo = info?.photo;
  const loading = !info || info.partial;
  const familyCommon = e.familyCommon || info?.familyCommon;
  const family = e.family || info?.family;

  const when = (s) => {
    if (!s) return "—";
    const d = s.subId && !imported?.demo
      ? `<a href="https://ebird.org/checklist/${encodeURIComponent(s.subId)}" target="_blank" rel="noopener">${fmtDate(s.date)}</a>`
      : fmtDate(s.date);
    const where = [s.location, s.region].filter(Boolean).map(esc).join(", ");
    return `${d}${s.logged ? ' <span class="tag">logged</span>' : ""}<br><small>${where}</small>`;
  };
  const stats = [
    ["First seen", when(e.first)],
    e.last && e.last !== e.first && e.last.date !== e.first?.date ? ["Last seen", when(e.last)] : null,
    e.timesSeen != null ? ["Times seen", `${e.timesSeen} checklist${e.timesSeen === 1 ? "" : "s"}`] : null,
    e.totalCount != null ? ["Birds counted", e.totalCount.toLocaleString()] : null,
  ].filter(Boolean);

  const links = [
    e.code ? [`https://ebird.org/species/${encodeURIComponent(e.code)}`, "eBird"] : null,
    info?.wikipedia ? [info.wikipedia, "Wikipedia"] : null,
    [`https://www.allaboutbirds.org/guide/${encodeURIComponent(e.common.replace(/['’]/g, "").replace(/\s+/g, "_"))}`, "All About Birds"],
    [`https://xeno-canto.org/species/${encodeURIComponent(e.sci.replace(" ", "-"))}`, "xeno-canto"],
  ].filter(Boolean);

  const logged = e.logged.map((m) => `<li>
      <div><b>${fmtDate(m.date)}</b>${m.time ? ` ${esc(m.time)}` : ""}${m.count ? ` · ${m.count} bird${m.count === 1 ? "" : "s"}` : ""}
        ${m.inEbird ? '<span class="tag ok" title="Same species and date found in your eBird import">in eBird ✓</span>' : ""}
        <br><small>${[m.location, m.region].filter(Boolean).map(esc).join(", ") || "No location"}</small>
        ${m.notes ? `<br><small class="dim">${esc(m.notes)}</small>` : ""}</div>
      <button class="x" data-del="${esc(m.id)}" title="Delete this logged sighting" aria-label="Delete">✕</button></li>`).join("");

  els.detail.innerHTML = `<article class="detail ${flashKey === e.key ? "new-entry" : ""}">
    <div>
      <button class="pill ghost back" id="backBtn">◀ List</button>
      <div class="photo-frame ${photo ? "" : loading ? "loading" : ""}" style="${photo ? `background-image:url('${esc(photo.url)}')` : ""}">
        ${!photo && !loading ? "NO PHOTO" : ""}${flashKey === e.key ? '<div class="new-banner">NEW ENTRY!</div>' : ""}</div>
      ${photo ? `<div class="credit">Photo ${esc(photo.attribution)}${info.id ? ` · <a href="https://www.inaturalist.org/taxa/${info.id}" target="_blank" rel="noopener">iNaturalist</a>` : ""}</div>` : ""}
      <div class="sounds" id="sounds"></div>
      ${fieldStatsHTML(e.sci)}
    </div>
    <div>
      <div class="dexno">${dexLabel(e)}</div>
      <h2>${esc(e.common)}</h2>
      <div class="sci">${esc(e.sci)}</div>
      <div class="badges">
        ${types.map((t) => `<span class="badge ${t.kind}" style="background:${t.color}" title="${t.kind === "habitat" ? "Habitat type" : "Family type"}">${t.name}</span>`).join("")}
        ${familyCommon || family ? `<span class="badge family-name">${esc(familyCommon || "")}${familyCommon && family ? " · " : ""}<i>${esc(family || "")}</i></span>` : ""}
      </div>
      <div class="stats-grid">${stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
      ${info?.summary ? `<p class="summary">${safeSummary(info.summary)}</p>`
        : `<p class="summary muted">${loading ? "Looking up field notes…" : "No summary available."}</p>`}
      <div class="links">${links.map(([href, label]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${label} ↗</a>`).join("")}</div>
      <section class="logged">
        <div class="logged-head"><h3>Your logged sightings</h3><button class="pill small accent" id="logThis">＋ Log one</button></div>
        ${logged ? `<ul>${logged}</ul>` : `<p class="dim">None logged in Ave·Dex yet.</p>`}
      </section>
    </div>
    ${whereWhenHTML(e)}
  </article>`;

  $("backBtn").onclick = () => els.device.classList.remove("show-detail");
  $("logThis").onclick = () => openLog(byCodeGet(e.code) || e);
  els.detail.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    if (!confirm("Delete this logged sighting? This can't be undone.")) return;
    deleteSighting(b.dataset.del);
    rebuild();
    if (!entryFor(selected)) { selected = view[0]?.key || null; renderDetail(); }
  }));
  renderSounds(e);
  showMap($("entryMap"), "entry", e.key + ":" + e.locs.length, e.locs);
  if (flashKey === e.key) setTimeout(() => { flashKey = null; }, 2500);
}

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function whereWhenHTML(e) {
  const hasMonths = e.months && e.months.some((n) => n > 0);
  if (!hasMonths && !e.locs.length) {
    return e.imported && !imported?.species?.some((sp) => sp.months)
      ? `<section class="where-when"><h3>Where &amp; when</h3><p class="dim small">Import your full eBird data (<a href="https://ebird.org/downloadMyData" target="_blank" rel="noopener">Download My Data</a>) to see a map of where you've seen this bird and which months.</p></section>`
      : "";
  }
  const max = Math.max(1, ...(e.months || []));
  const now = new Date().getMonth();
  const months = hasMonths ? `<div class="months" aria-label="Checklists by month">${e.months.map((n, i) =>
    `<div class="mo ${i === now ? "now" : ""}" title="${MONTH_NAMES[i]}: ${n} checklist${n === 1 ? "" : "s"}">
      <span class="mo-bar"><i style="height:${n ? Math.max(8, (n / max) * 100) : 0}%"></i></span><span class="mo-l">${MONTHS[i]}</span></div>`).join("")}</div>` : "";
  const places = e.locs.length;
  return `<section class="where-when">
    <h3>Where &amp; when</h3>
    ${months}
    ${places ? `<div id="entryMap" class="map"></div><p class="dim small">${places} location${places === 1 ? "" : "s"}${places >= 300 ? " (top 300 shown)" : ""}. Bigger circles = more checklists${e.locs.some((l) => l[4]) ? "; orange = logged in Ave·Dex" : ""}.</p>` : ""}
  </section>`;
}

// ---------- field stats (AVONET) ----------
const fmtMass = (g) => g >= 1000
  ? `${(g / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kg <small>(${(g / 453.6).toFixed(1)} lb)</small>`
  : `${g.toLocaleString(undefined, { maximumFractionDigits: 1 })} g <small>(${(g / 28.35).toFixed(g < 28 ? 2 : 1)} oz)</small>`;
const fmtLen = (mm) => mm >= 100
  ? `${(mm / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} cm <small>(${(mm / 25.4).toFixed(1)} in)</small>`
  : `${mm} mm <small>(${(mm / 25.4).toFixed(2)} in)</small>`;

function fieldStatsHTML(sci) {
  const t = traitsFor(sci);
  if (!t) return "";
  const rows = [
    ["Weight", "mass", fmtMass],
    ["Wing", "wing", fmtLen],
    ["Bill", "beak", fmtLen],
    ["Tail", "tail", fmtLen],
    ["Leg", "tarsus", fmtLen],
    ["Flight", "handWing", (v) => v >= 40 ? "Long-distance flier" : v >= 20 ? "Strong flier" : "Short-hop flier"],
  ].filter(([, f]) => t[f] != null).map(([label, f, fmt]) => {
    const p = percentile(f, t[f]);
    const pct = p == null ? 0 : Math.max(3, Math.round(p * 100));
    const tip = p == null ? "" : `${f === "handWing" ? "Wing shape built for longer flights than" : "Bigger than"} ${Math.round(p * 100)}% of bird species`;
    return `<div class="fs-row" title="${tip}"><span class="fs-k">${label}</span>
      <span class="fs-bar"><i style="width:${pct}%"></i></span><span class="fs-v">${fmt(t[f])}</span></div>`;
  }).join("");
  const facts = [
    t.diet ? ["Diet", dietText(t.diet)] : null,
    t.habitat ? ["Habitat", `${t.habitat}${t.lifestyle ? ` · ${lifestyleText(t.lifestyle).toLowerCase()}` : ""}`] : null,
    t.migration ? ["Migration", migrationText(t.migration)] : null,
  ].filter(Boolean).map(([k, v]) => `<div class="fs-fact"><span class="fs-k">${k}</span><span>${esc(v)}</span></div>`).join("");
  return `<section class="field-stats">
    <h3>Field stats</h3>
    ${rows}${facts}
    <p class="fs-note">${t.estimated
      ? `Estimated from related species in the same ${t.estimatedFrom}, because this species was named or split after the source data was published. `
      : ""}Typical adult values from AVONET; bars compare this bird with all ~11,000 bird species.</p>
  </section>`;
}

function renderPlaceholder() {
  els.detail.innerHTML = `<div class="panel"><h2>Pick a bird</h2><p>Choose an entry from the list.</p></div>`;
}

function renderWelcome() {
  els.detail.innerHTML = `<div class="panel">
    <h2>Welcome to Ave·Dex</h2>
    <p>Each bird species on your eBird life list becomes an entry here, numbered in eBird's taxonomic order. Entries show a photo, the bird's song and call, a field summary, its family and habitat types, and when and where you first saw it.</p>
    <p>eBird doesn't let other apps sign in to your account, so you import an export of your data. You can also log new sightings here. Everything stays on this device.</p>
    <div class="actions">
      <button class="pill" id="wImport">Import eBird CSV</button>
      <button class="pill accent" id="wLog">＋ Log a sighting</button>
      <button class="pill ghost" id="wHelp">How to export</button>
      <button class="pill ghost" id="wDemo">Try demo data</button>
    </div>
  </div>`;
  $("wImport").onclick = () => els.file.click();
  $("wLog").onclick = () => openLog();
  $("wHelp").onclick = openSettings;
  $("wDemo").onclick = loadDemo;
}

let statsTab = "overview"; // "overview" | "milestones" | "families"

function renderStats() {
  if (!life.length) return renderWelcome();
  const tabs = [["overview", "Overview"], ["milestones", "Milestones"], ["families", "Families"]];
  const body = { overview: statsOverviewHTML, milestones: statsMilestonesHTML, families: statsFamiliesHTML }[statsTab]();
  els.detail.innerHTML = `<div class="panel stats-panel">
    <button class="pill ghost back" id="backBtn">◀ List</button>
    <div class="tabs" role="tablist">${tabs.map(([id, label]) =>
      `<button role="tab" class="tab ${statsTab === id ? "on" : ""}" data-tab="${id}" aria-selected="${statsTab === id}">${label}</button>`).join("")}</div>
    ${body}
  </div>`;
  els.detail.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { statsTab = b.dataset.tab; renderStats(); els.detail.scrollTop = 0; }));
  els.detail.querySelectorAll("[data-goto]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); select(a.dataset.goto); }));
  $("backBtn").onclick = () => els.device.classList.remove("show-detail");
  if (statsTab === "overview") showMap($("statsMap"), "stats", `all:${life.length}:${life.reduce((n, e) => n + e.locs.length, 0)}`, allPlaces(), { label: "species" });
}

const barsHTML = (rows, color) => {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="bars">${rows.map(([k, n]) =>
    `<span>${esc(k)}</span><span class="bar" style="width:${(n / max) * 100}%;background:${color(k)}"></span><span class="n">${n}</span>`).join("")}</div>`;
};
const entryLink = (e) => `<a href="#" data-goto="${esc(e.key)}">${esc(e.common)}</a>`;

function allPlaces() {
  const byPlace = new Map();
  for (const e of life) for (const [lat, lon, name, , logged] of e.locs) {
    const k = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const p = byPlace.get(k) || [lat, lon, name, 0, logged];
    p[3]++;
    byPlace.set(k, p);
  }
  return [...byPlace.values()];
}

function statsOverviewHTML() {
  const tally = (kind) => {
    const c = {};
    for (const e of life) { const t = typesOf(e).find((x) => x.kind === kind); if (t) c[t.name] = (c[t.name] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  };
  const years = {};
  for (const e of life) { const y = e.first?.date?.slice(0, 4); if (y) years[y] = (years[y] || 0) + 1; }
  const total = speciesCount();
  const loggedOnly = life.filter((e) => !e.imported).length;
  const places = allPlaces();
  return `
    <div class="dexno">LIFE LIST</div>
    <div class="big-number">${life.length}${total ? `<small> / ${total.toLocaleString()}</small>` : ""}</div>
    <p>${total ? `${((life.length / total) * 100).toFixed(2)}% of the world's bird species. ` : ""}
      ${imported ? `Imported from ${esc(imported.meta.source)}${imported.demo ? " (demo data)" : ""} on ${fmtDate(imported.meta.importedAt.slice(0, 10))}; ${imported.meta.skipped} rows skipped (spuhs, slashes, hybrids, domestics).` : "No eBird import yet."}
      ${loggedOnly ? ` ${loggedOnly} species come only from sightings logged here.` : ""}</p>
    <h3>Family types</h3>${barsHTML(tally("family"), (k) => FAMILY_TYPES[k])}
    <h3>Habitats</h3>${barsHTML(tally("habitat"), (k) => HABITAT_TYPES[k])}
    <h3>New species by year</h3>${barsHTML(Object.entries(years).sort(), () => "var(--shell)")}
    ${places.length ? `<h3>Where you've birded</h3><div id="statsMap" class="map tall"></div>
      <p class="dim small">${places.length} locations · bigger circles = more species seen there.</p>`
      : `<h3>Where you've birded</h3><p class="dim small">Import your full eBird data (<a href="https://ebird.org/downloadMyData" target="_blank" rel="noopener">Download My Data</a>) or log sightings with your location to see a map.</p>`}`;
}

function statsMilestonesHTML() {
  const badges = computeBadges(life);
  const got = badges.filter((b) => b.unlocked).length;
  const ms = speciesMilestones(life);
  const yl = yearLists(life);
  const fullDates = imported?.species?.some((sp) => sp.months);
  return `
    <div class="dexno">BADGES · ${got} / ${badges.length}</div>
    <div class="badge-grid">${badges.map((b) => `<div class="bdg ${b.unlocked ? "got" : ""}" title="${esc(b.desc)}">
        <div class="bdg-icon">${b.unlocked ? b.icon : "🔒"}</div>
        <div class="bdg-name">${esc(b.name)}</div>
        <div class="bdg-desc">${esc(b.desc)}</div>
        ${b.unlocked
          ? `<div class="bdg-when">${fmtDate(b.date)}${b.by && b.id !== "first" ? ` · ${entryLink(b.by)}` : ""}</div>`
          : `<div class="bdg-prog"><i style="width:${(b.progress / b.target) * 100}%"></i></div><div class="bdg-when">${b.progress} / ${b.target}</div>`}
      </div>`).join("")}</div>

    <h3>Species milestones</h3>
    ${ms.next ? `<p class="next-mark"><b>${ms.toGo}</b> more species to reach <b>${ms.next}</b>.</p>` : ""}
    <ol class="marks">${ms.reached.slice().reverse().map(({ n, entry }) =>
      `<li><span class="mark-n">#${n}</span> ${entryLink(entry)} <span class="dim">· ${fmtDate(entry.first.date)}${entry.first.location ? ` · ${esc(entry.first.location)}` : ""}</span></li>`).join("")}</ol>

    <h3>Year lists</h3>
    <table class="years"><thead><tr><th>Year</th><th>${fullDates ? "Species seen" : "Species"}</th><th>New lifers</th></tr></thead>
      <tbody>${yl.map((y) => `<tr><td>${y.year}</td><td>${y.species}</td><td>${y.lifers}</td></tr>`).join("")}</tbody></table>
    ${fullDates ? "" : `<p class="dim small">Your import is a life list, which only has first sightings, so year lists count lifers plus sightings you've logged here. Import your full eBird data for complete year lists.</p>`}`;
}

function statsFamiliesHTML() {
  const fc = familyCompletion(life);
  if (!fc.familiesTotal) return "<p>The eBird species list is still loading…</p>";
  return `
    <div class="dexno">FAMILIES</div>
    <div class="big-number">${fc.familiesSeen}<small> / ${fc.familiesTotal}</small></div>
    <p>bird families seen${fc.complete.length ? `, ${fc.complete.length} complete (every species in the family): ${fc.complete.map((f) => esc(f.common)).join(", ")}` : ""}.</p>
    <div class="fam-list">${fc.families.map((f) => {
      const pct = f.seen / f.total;
      return `<div class="fam ${f.seen === f.total ? "done" : ""}">
        <div class="fam-name"><b>${esc(f.common)}</b> <i>${esc(f.family)}</i></div>
        <div class="fam-bar"><i style="width:${Math.max(2, pct * 100)}%"></i></div>
        <div class="fam-n">${f.seen}/${f.total}${f.seen === f.total ? " ★" : ""}</div>
      </div>`;
    }).join("")}</div>
    <p class="dim small">World totals from the current eBird taxonomy, listed in taxonomic order.</p>`;
}

// ---------- sounds ----------
let soundState = null; // { key, kind, list, i }

function stopSound() {
  player.pause();
  soundState = null;
}

function renderSounds(e) {
  const box = $("sounds");
  if (!box) return;
  const xc = hasXenoCanto();
  const kinds = xc ? [["song", "Song"], ["call", "Call"]] : [["any", "Recording"]];
  const playing = soundState?.key === e.key ? soundState : null;
  const rec = playing?.list[playing.i];
  box.innerHTML = `
    <div class="sound-buttons">
      ${kinds.map(([k, label]) => {
        const on = playing?.kind === k && !player.paused;
        return `<button class="sound-btn ${on ? "on" : ""}" data-kind="${k}">${on ? "❚❚" : "▶"} ${label}</button>`;
      }).join("")}
    </div>
    ${rec ? `<div class="now-playing">
        ${rec.spectrogram ? `<img src="${esc(rec.spectrogram)}" alt="Spectrogram" loading="lazy">` : ""}
        <div class="np-meta"><b>${esc(rec.label)}</b> ${playing.i + 1}/${playing.list.length}
          ${playing.list.length > 1 ? `<button class="link" id="nextRec">next ›</button>` : ""}<br>
          ${esc(rec.credit)}${rec.where ? ` · ${esc(rec.where)}` : ""}<br>
          <a href="${esc(rec.page)}" target="_blank" rel="noopener">${esc(rec.license)} · source ↗</a></div>
      </div>` : ""}
    ${xc ? "" : `<button class="link small" id="getXc">Separate song &amp; call buttons: add a xeno-canto key</button>`}
    <div class="sound-msg dim" id="soundMsg"></div>`;
  box.querySelectorAll(".sound-btn").forEach((b) => (b.onclick = () => toggleSound(e, b.dataset.kind)));
  $("nextRec")?.addEventListener("click", () => { soundState.i = (soundState.i + 1) % soundState.list.length; playCurrent(e); });
  $("getXc")?.addEventListener("click", openSettings);
}

async function toggleSound(e, kind) {
  if (soundState?.key === e.key && soundState.kind === kind) {
    if (player.paused) player.play().catch(() => {}); else player.pause();
    return renderSounds(e);
  }
  const msg = $("soundMsg");
  if (msg) msg.textContent = "Finding recordings…";
  try {
    const list = await getRecordings(e, kind, getInfo(e.sci)?.id);
    if (selected !== e.key) return;
    if (!list.length) {
      if ($("soundMsg")) $("soundMsg").textContent = `No ${kind === "any" ? "" : kind + " "}recordings found for this species.`;
      return;
    }
    soundState = { key: e.key, kind, list, i: 0 };
    playCurrent(e);
  } catch (err) {
    if ($("soundMsg")) $("soundMsg").textContent = /key/i.test(err.message)
      ? "xeno-canto didn't accept the API key. Check it in Settings." : `Couldn't load sounds (${err.message}).`;
  }
}

function playCurrent(e) {
  const rec = soundState.list[soundState.i];
  player.src = rec.src;
  player.play().catch(() => {});
  renderSounds(e);
}
player.addEventListener("ended", () => { const e = entryFor(selected); if (e) renderSounds(e); });
player.addEventListener("error", () => {
  // skip recordings the browser can't play
  if (soundState && soundState.i < soundState.list.length - 1) { soundState.i++; playCurrent(entryFor(selected)); }
});

// ---------- log a sighting ----------
let picked = null;
let suggestions = [], suggestIndex = -1;
let logCoords = null;

$("logLocate").onclick = () => {
  if (!navigator.geolocation) return toast("Location isn't available in this browser.", true);
  $("logCoords").textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition((pos) => {
    logCoords = { lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5) };
    $("logCoords").textContent = `📍 ${logCoords.lat.toFixed(4)}, ${logCoords.lon.toFixed(4)} (±${Math.round(pos.coords.accuracy)} m)`;
  }, (err) => {
    logCoords = null;
    $("logCoords").textContent = err.code === 1 ? "Location permission was declined." : "Couldn't get your location.";
  }, { enableHighAccuracy: true, timeout: 15000 });
};

function openLog(prefill = null) {
  if (!taxonomyLoaded()) return toast("The eBird species list is still loading. Try again in a moment.", true);
  $("logForm").reset();
  logCoords = null;
  $("logCoords").textContent = "";
  $("logDate").value = today();
  $("logDate").max = today();
  setPicked(prefill?.code ? byCodeGet(prefill.code) || prefill : null);
  els.log.showModal();
  (prefill ? $("logLocation") : $("logSpecies")).focus();
}

function setPicked(t) {
  picked = t;
  const box = $("logPicked");
  $("logSuggest").hidden = true;
  if (!t) { box.hidden = true; $("logSpecies").value = ""; return; }
  $("logSpecies").value = t.common;
  const seen = life.some((e) => e.key === t.code);
  box.hidden = false;
  box.innerHTML = `<span class="num">#${String(t.dex).padStart(4, "0")}</span> <b>${esc(t.common)}</b> <i>${esc(t.sci)}</i>
    ${seen ? '<span class="tag">on your list</span>' : '<span class="tag new">new lifer!</span>'}`;
}

function renderSuggest() {
  const ul = $("logSuggest");
  ul.hidden = !suggestions.length;
  ul.innerHTML = suggestions.map((t, i) => `<li role="option" data-i="${i}" class="${i === suggestIndex ? "hl" : ""}">
    <b>${esc(t.common)}</b> <i>${esc(t.sci)}</i>${life.some((e) => e.key === t.code) ? ' <span class="tag">seen</span>' : ""}</li>`).join("");
}

$("logSpecies").addEventListener("input", () => {
  picked = null; $("logPicked").hidden = true;
  suggestions = searchTaxa($("logSpecies").value);
  suggestIndex = suggestions.length ? 0 : -1;
  renderSuggest();
});
$("logSpecies").addEventListener("keydown", (ev) => {
  if ($("logSuggest").hidden) return;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    suggestIndex = (suggestIndex + (ev.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
    renderSuggest();
  } else if (ev.key === "Enter" && suggestIndex >= 0) {
    ev.preventDefault();
    setPicked(suggestions[suggestIndex]);
    $("logDate").focus();
  } else if (ev.key === "Escape") {
    ev.preventDefault(); $("logSuggest").hidden = true;
  }
});
$("logSuggest").addEventListener("mousedown", (ev) => {
  const li = ev.target.closest("li[data-i]");
  if (li) { ev.preventDefault(); setPicked(suggestions[+li.dataset.i]); $("logDate").focus(); }
});

$("logForm").addEventListener("submit", (ev) => {
  if (ev.submitter?.value !== "save") return;
  if (!picked) {
    ev.preventDefault();
    toast("Pick a species from the suggestions.", true);
    $("logSpecies").focus();
    return;
  }
  const count = parseInt($("logCount").value, 10);
  const wasNew = !life.some((e) => e.key === picked.code);
  addSighting({
    code: picked.code, sci: picked.sci, common: picked.common,
    date: $("logDate").value, time: $("logTime").value,
    location: $("logLocation").value.trim(), region: $("logRegion").value.trim(),
    count: Number.isFinite(count) ? count : null, notes: $("logNotes").value.trim(),
    lat: logCoords?.lat, lon: logCoords?.lon,
  });
  if (wasNew) flashKey = picked.code;
  const key = picked.code;
  rebuild();
  select(key);
  toast(wasNew ? `New lifer: ${picked.common}! 🎉` : `Logged ${picked.common}.`);
  renderBackupStatus();
});

// ---------- settings ----------
function openSettings() {
  const s = getSettings();
  $("xcKey").value = s.xcKey;
  $("autoplay").checked = s.autoplay;
  renderBackupStatus();
  els.settings.showModal();
}

// ---------- backup ----------
function renderBackupStatus() {
  const last = lastBackup();
  const unsaved = unsavedCount();
  $("backupStatus").innerHTML = last
    ? `Last backup: <b>${fmtDate(last.at.slice(0, 10))}</b>${unsaved ? ` · <span class="warn">${unsaved} logged sighting${unsaved === 1 ? "" : "s"} since then</span>` : " · up to date"}`
    : `<span class="warn">No backup yet${unsaved ? ` (${unsaved} logged sighting${unsaved === 1 ? "" : "s"} at risk)` : ""}.</span>`;
  // nudge: a dot on the settings button when logged sightings aren't backed up
  $("settingsBtn").classList.toggle("nudge", unsaved > 0);
}

$("saveBackup").onclick = async () => {
  try {
    const info = await saveBackup();
    if (info) toast(`Backup saved: ${info.species} imported species, ${info.logged} logged sightings.`);
    renderBackupStatus();
  } catch (e) { toast(`Couldn't save backup: ${e.message}`, true); }
};
$("restoreBackup").onclick = () => $("backupFile").click();
$("backupFile").addEventListener("change", async () => {
  const f = $("backupFile").files[0];
  $("backupFile").value = "";
  if (!f) return;
  try {
    const b = await readBackup(f);
    let replaceImport = false;
    if (b.importedSpecies) {
      replaceImport = !imported || confirm(
        `This backup (${fmtDate(b.exportedAt?.slice(0, 10))}) has an eBird import with ${b.importedSpecies} species. ` +
        `Your current import has ${b.currentSpecies}.\n\nOK = use the backup's import\nCancel = keep your current import\n\n` +
        `Logged sightings are merged either way; none are deleted.`);
    }
    const { added } = b.apply({ replaceImport });
    imported = loadImported();
    rebuild();
    if (!selected && life.length) select(life[0].key, { open: false });
    enqueue(life);
    renderBackupStatus();
    toast(`Restored${replaceImport ? ` ${b.importedSpecies} imported species and` : ""} ${added} new logged sighting${added === 1 ? "" : "s"}.`);
  } catch (e) { toast(e.message, true); }
});
els.settings.addEventListener("close", () => {
  const rv = els.settings.returnValue;
  if (rv === "save" || rv === "demo") {
    saveSettings({ xcKey: $("xcKey").value.trim(), autoplay: $("autoplay").checked });
    stopSound();
    renderDetail();
  }
  if (rv === "demo") loadDemo();
});

// ---------- import ----------
function ingest(text, { demo = false } = {}) {
  try {
    const result = importEbirdCSV(text);
    if (!result.species.length) throw new Error("No full species found in that file.");
    imported = { ...result, demo };
    storeImported();
    life = buildLifeList(imported);
    announceBadges();
    selected = life[0]?.key || null;
    mode = "detail";
    renderList();
    if (selected) select(selected, { open: false });
    enqueue(life);
    updateStatus();
    toast(`Imported ${result.species.length} species${demo ? " (demo)" : ""}.`);
  } catch (e) {
    toast(e.message, true);
  }
}

async function loadDemo() {
  const res = await fetch("data/demo-MyEBirdData.csv");
  ingest(await res.text(), { demo: true });
}

els.file.addEventListener("change", async () => {
  const f = els.file.files[0];
  if (f) ingest(await f.text());
  els.file.value = "";
});

// ---------- events ----------
$("importBtn").onclick = () => els.file.click();
$("logBtn").onclick = () => openLog();
$("settingsBtn").onclick = openSettings;
$("statsBtn").onclick = () => { mode = mode === "stats" ? "detail" : "stats"; renderDetail(); els.device.classList.add("show-detail"); };

els.list.addEventListener("click", (e) => {
  const li = e.target.closest("li[data-key]");
  if (li) select(li.dataset.key, { scroll: false });
});
for (const el of [els.search, els.typeFilter, els.sort]) el.addEventListener("input", renderList);

function move(delta) {
  if (!view.length) return;
  const i = view.findIndex((e) => e.key === selected);
  const next = view[Math.max(0, Math.min(view.length - 1, i < 0 ? 0 : i + delta))];
  select(next.key, { open: false });
}
document.querySelectorAll(".dp[data-move]").forEach((b) => (b.onclick = () => move(Number(b.dataset.move))));
document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  if (e.target === els.search && !["ArrowUp", "ArrowDown"].includes(e.key)) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) && e.target !== els.search) return;
  if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); move(1); }
  if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); move(-1); }
  if (e.key === "/" && e.target !== els.search) { e.preventDefault(); els.search.focus(); }
  if (e.key === " " && e.target === document.body) {
    e.preventDefault();
    const en = entryFor(selected);
    if (en) toggleSound(en, hasXenoCanto() ? "song" : "any");
  }
});

// Re-render as photo/summary lookups arrive.
let pendingRender = null;
onUpdate((sci) => {
  updateRowsFor(sci);
  if (els.typeFilter.value) { clearTimeout(pendingRender); pendingRender = setTimeout(renderList, 400); }
  const sel = entryFor(selected);
  if ((mode === "detail" && sel?.sci === sci) || mode === "stats") {
    // don't interrupt a playing recording's controls
    const scroll = els.detail.scrollTop;
    renderDetail();
    els.detail.scrollTop = scroll;
  }
  updateStatus();
});

function updateStatus() {
  if (!life.length) return (els.status.textContent = "");
  const done = life.filter((s) => { const i = getInfo(s.sci); return i && (i.notFound || !i.partial); }).length;
  const total = life.length;
  document.querySelector(".lens").classList.toggle("busy", done < total);
  els.status.textContent = done < total ? `Scanning field notes… ${done}/${total}` : `${total} entries ready`;
}

// ---------- offline support ----------
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Offline mode unavailable", e));
}

// ---------- boot ----------
buildTypeFilter();
renderBackupStatus();
rebuild();
if (life.length) { select(life[0].key, { open: false }); enqueue(life); }
Promise.all([loadTaxonomy(), loadTraits()]).then(() => {
  dataReady = true;
  const keep = entryFor(selected)?.sci;
  life = buildLifeList(imported);
  announceBadges();
  selected = (keep && life.find((e) => e.sci === keep)?.key) || life[0]?.key || null;
  renderList();
  if (selected) select(selected, { open: false }); else renderDetail();
  enqueue(life);
  updateStatus();
});
