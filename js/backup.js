// Backup & restore: everything Ave·Dex keeps on this device, in one file.
// Also how you move your dex between devices (e.g. Mac -> iPhone).
// Your xeno-canto key is deliberately left out of backups.

import { allManual, mergeManual } from "./sightings.js";
import { getSettings, saveSettings } from "./sounds.js";

const IMPORT_KEY = "fielddex:life:v1";
const LAST_KEY = "fielddex:lastBackup:v1";

export function lastBackup() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY)); } catch { return null; }
}

/** Logged sightings created since the last backup. */
export function unsavedCount() {
  const last = lastBackup();
  return allManual().filter((m) => !last || m.createdAt > last.at).length;
}

export async function saveBackup() {
  const { xcKey, ...settings } = getSettings(); // eslint-disable-line no-unused-vars
  const data = {
    app: "ave-dex",
    version: 1,
    exportedAt: new Date().toISOString(),
    imported: JSON.parse(localStorage.getItem(IMPORT_KEY) || "null"),
    logged: allManual(),
    settings,
  };
  const name = `ave-dex-backup-${data.exportedAt.slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });

  // On iPhone, the share sheet is the natural way to save to Files / iCloud / AirDrop.
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Ave·Dex backup" }); }
    catch (e) { if (e.name === "AbortError") return null; throw e; }
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const info = { at: data.exportedAt, logged: data.logged.length, species: data.imported?.species?.length || 0 };
  localStorage.setItem(LAST_KEY, JSON.stringify(info));
  return info;
}

/** Read a backup file. Returns a summary and an apply() function; nothing changes until apply(). */
export async function readBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error("That file isn't an Ave·Dex backup (not valid JSON)."); }
  if (data?.app !== "ave-dex" || !Array.isArray(data.logged)) throw new Error("That file isn't an Ave·Dex backup.");
  const current = JSON.parse(localStorage.getItem(IMPORT_KEY) || "null");
  return {
    exportedAt: data.exportedAt,
    importedSpecies: data.imported?.species?.length || 0,
    currentSpecies: current?.species?.length || 0,
    logged: data.logged.length,
    /** replaceImport: use the backup's eBird import instead of the current one */
    apply({ replaceImport }) {
      if (replaceImport && data.imported?.species) localStorage.setItem(IMPORT_KEY, JSON.stringify(data.imported));
      const added = mergeManual(data.logged);
      if (data.settings) saveSettings({ ...getSettings(), ...data.settings, xcKey: getSettings().xcKey });
      return { added };
    },
  };
}
