// Sighting maps (Leaflet + OpenStreetMap tiles).
// Points: [lat, lon, name, checklists, logged?]

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

const live = new Map(); // slot id -> { key, el, map }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Show a map of points inside `placeholder` (an element in freshly rendered HTML).
 * `slot` names the map ("entry", "stats"); `key` identifies what it shows. If the
 * same slot already shows the same key, the existing map is moved in instead of rebuilt.
 */
export function showMap(placeholder, slot, key, points, { label = "checklist" } = {}) {
  if (!placeholder || !window.L || !points.length) return;
  const cur = live.get(slot);
  if (cur && cur.key === key && cur.el.isConnected === false) {
    placeholder.replaceWith(cur.el);
    cur.map.invalidateSize();
    return;
  }
  if (cur) { cur.map.remove(); live.delete(slot); }

  const el = document.createElement("div");
  el.className = placeholder.className || "map";
  placeholder.replaceWith(el);
  const map = L.map(el, { scrollWheelZoom: false, attributionControl: true, zoomControl: true });
  L.tileLayer(TILE_URL, { maxZoom: 18, attribution: ATTRIBUTION }).addTo(map);

  const max = Math.max(...points.map((p) => p[3] || 1));
  const markers = points.map(([lat, lon, name, n, logged]) => L.circleMarker([lat, lon], {
    radius: 5 + 9 * Math.sqrt((n || 1) / max),
    color: logged ? "#a35a0c" : "#123631",
    weight: 1.5,
    fillColor: logged ? "#f0a63a" : "#2a6a60",
    fillOpacity: 0.75,
  }).bindPopup(`<b>${esc(name || "Unnamed location")}</b><br>${n || 1} ${label}${(n || 1) === 1 ? "" : "s"}${logged ? "<br><i>logged in Ave·Dex</i>" : ""}`));
  const group = L.featureGroup(markers).addTo(map);
  const frame = () => {
    if (live.get(slot)?.map !== map || !el.isConnected) return; // map was replaced or removed meanwhile
    map.invalidateSize();
    if (points.length === 1) map.setView([points[0][0], points[0][1]], 11);
    else map.fitBounds(group.getBounds().pad(0.15), { maxZoom: 12 });
  };
  live.set(slot, { key, el, map });
  frame();
  // re-frame once layout settles (the pane may still be sizing or sliding in on phones)
  requestAnimationFrame(frame);
  setTimeout(frame, 350);
}

export function dropMap(slot) {
  const cur = live.get(slot);
  if (cur) { cur.map.remove(); live.delete(slot); }
}
