# Ave·Dex

A dex-style viewer for your eBird life list. It's a web app that can be installed on an iPhone home screen, and the plan is to port it to a native iPhone app later.

## Run it
```
python3 -m http.server 8765 --directory ~/Documents/Field-Dex
```
Then open http://localhost:8765. Always use port 8765: the browser ties your saved data to that address. Click **Import** to choose your eBird export, or **＋ Sighting** to log a bird. Settings, backup and help are under ⚙.

## Features
- **eBird taxonomic numbering:** each species keeps a fixed dex number, its position in the full eBird/Clements taxonomy (#1 Common Ostrich … about 11,200 species).
- **Two types per bird:** a *family type* (Raptor, Waterfowl…) and a *habitat type* (Forest, Wetland, Urban…).
- **Field stats:** weight, wing, bill, tail and leg size, with bars comparing the bird to all ~11,000 species, plus flight style, diet, habitat and migration.
- **Song & Call buttons:** labeled recordings with spectrograms if you add a free xeno-canto API key in Settings. Without a key, an unlabeled iNaturalist recording plays.
- **Log a sighting:** search any species by name or 4-letter code; add date, time, count, location (optionally your GPS position) and notes. A logged sighting that later shows up in an eBird import (same species and date) is marked "in eBird ✓" and not counted twice.
- **Where & when:** a map of every place you've seen the bird and a chart of checklists by month. Stats → Overview has a map of everywhere you've birded. *Needs the full eBird export (Download My Data); the Life List download has no coordinates.*
- **Milestones:** 16 badges (Night Watch, Warbler Wave, Globetrotter…), species milestones (#100, #200…), year lists, and a toast when you unlock a badge.
- **Families:** how many of the world's ~250 bird families you've seen, with completion bars for each.
- **Backup & restore** (⚙): saves your import, logged sightings and settings to one file (not your xeno-canto key). Restoring merges logged sightings and never deletes any. The ⚙ button shows a red dot when you have logged sightings that aren't backed up.
- **Installable & offline:** home-screen icon, full-screen mode, and offline use (app files, plus photos and map tiles you've already viewed).

## Live app
**https://willreedl.github.io/ave-dex/**, hosted free on GitHub Pages from this repo. Works anywhere, offline after the first visit, with GPS. The code contains none of your data: your sightings stay in each device's own storage, separate from the localhost copy.

### Put it on your iPhone
1. On the iPhone, open the live link in **Safari**.
2. Tap Share → **Add to Home Screen**, then open Ave·Dex from its icon.
3. Move your data over: on the Mac, ⚙ → **Save backup**, AirDrop the file to the phone, then in the app on the phone ⚙ → **Restore from backup**.
4. To work offline, open the app once while online so it caches itself.

### Publishing changes
Edit files locally, test at http://localhost:8765, then:
```
git add -A && git commit -m "Describe the change" && git push
```
The live site updates within a minute or two. Open the app twice to pick up the new version (the first open fetches it).

### Without hosting (same Wi-Fi as your Mac)
Run the server, then open `http://<your-mac-name>.local:8765` on the phone (find the name in System Settings → General → Sharing). The Mac must stay on, and offline mode and GPS won't work over plain http.

## Files
| File | What it does | iOS equivalent later |
|---|---|---|
| `js/ebird.js` | Parses eBird CSVs; drops spuhs/slashes/hybrids/domestics; keeps first/last sightings, locations and months | Swift `EbirdImporter` |
| `js/taxonomy.js` | eBird taxonomy (API, no key): dex numbers, name matching, species search | Bundled taxonomy + yearly refresh |
| `js/sightings.js` | Logged sightings, merged with the import into the life list | SwiftData model |
| `js/types.js` | Family/habitat types, field stats and percentiles | Copy as-is |
| `js/milestones.js` | Badges, species milestones, year lists, family completion | Copy as-is |
| `js/map.js` | Sighting maps (Leaflet + OpenStreetMap) | MapKit |
| `js/backup.js` | Backup & restore | Files / iCloud |
| `js/sounds.js` | xeno-canto / iNaturalist recordings | `AVPlayer` |
| `js/enrich.js` | iNaturalist photos (CC only) + Wikipedia summaries, cached | `URLSession` + cache |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and home-screen install | (native) |
| `data/traits.json` | AVONET traits per species (habitat, diet, migration, body measurements) | Bundled resource |
| `vendor/leaflet/` | Leaflet 1.9.4 map library (BSD-2), stored locally so maps work offline | — |
| `scripts/build_traits.py` | Rebuilds `traits.json` from AVONET + the current eBird taxonomy | (dev tool) |
| `scripts/make_icons.py` | Draws the app icons | (dev tool) |
| `data/demo-MyEBirdData.csv` | Made-up demo data | Test fixture |

### Rebuilding trait data (e.g. after eBird's yearly taxonomy update)
Download "AVONET Supplementary dataset 1.xlsx" from https://figshare.com/articles/dataset/16586228, then:
```
pip3 install openpyxl
python3 scripts/build_traits.py "AVONET Supplementary dataset 1.xlsx"
```
About 90% of species match exactly. Species split or renamed since 2021 are matched through their old name, or estimated from their genus or family (shown as "estimated" in the app).

### After changing app files
The service worker loads app files network-first, so edits show up on a normal reload while the server is running. If you change the list of files in `sw.js`, bump its `VERSION`.

## Where data lives
In each browser's local storage, separately per device: your import, logged sightings, settings (including your xeno-canto key) and caches. Clearing site data erases it, so use **⚙ → Save backup** regularly. Don't commit your xeno-canto key anywhere.

## Data sources & licensing
- Your sightings: eBird exports you download yourself. The app never signs in to eBird.
- Taxonomy: eBird API 2.0 (public reference endpoint).
- Photos: iNaturalist, CC-licensed only, credited. Most are **non-commercial** (CC BY-NC): fine for personal use, but needs revisiting before any App Store sale.
- Summaries: Wikipedia, via iNaturalist.
- Sounds: xeno-canto and iNaturalist, CC-licensed, credited in the player.
- Traits & habitat: AVONET, Tobias et al. 2022, *Ecology Letters*, CC BY 4.0.
- Maps: © OpenStreetMap contributors, via Leaflet.
- Original design, not affiliated with Cornell Lab of Ornithology or Nintendo.
