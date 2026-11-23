"""Build data/traits.json from the AVONET dataset (Tobias et al. 2022, CC BY 4.0).

Usage:
    pip3 install openpyxl
    python3 scripts/build_traits.py "path/to/AVONET Supplementary dataset 1.xlsx"

Download the spreadsheet from https://figshare.com/articles/dataset/16586228
("AVONET Supplementary dataset 1.xlsx"). The script reads the AVONET2_eBird
sheet and matches it to the *current* eBird taxonomy (fetched from the eBird
API, no key needed).

Matching, best first:
  exact     same scientific name
  renamed   same species epithet in the same family (a genus change,
            e.g. Dryobates villosus -> Leuconotopicus villosus)
  genus     median/most common values of the genus   (marked estimated)
  family    habitat/diet/migration of the family only (marked estimated;
            body measurements are left out, too rough at family level)

Output per species (array):
  [habitat, lifestyle, diet, migration, mass_g, wing_mm, beak_mm, tail_mm,
   tarsus_mm, hand_wing_index, match]
  habitat/lifestyle/diet are indexes into the lookup lists; match is
  0 = exact/renamed, 1 = genus estimate, 2 = family estimate.
"""
import json
import statistics
import sys
import urllib.request
from collections import Counter
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parent.parent / "data" / "traits.json"
TAXONOMY_URL = "https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species"
CATEGORICAL = ["Habitat", "Primary.Lifestyle", "Trophic.Niche", "Migration"]
NUMERIC = ["Mass", "Wing.Length", "Beak.Length_Culmen", "Tail.Length", "Tarsus.Length", "Hand-Wing.Index"]


def clean(v):
    return None if v in (None, "NA", "") else v


def load_avonet(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    rows = wb["AVONET2_eBird"].iter_rows(values_only=True)
    header = next(rows)
    idx = {c: header.index(c) for c in ["Species2", "Family2", *CATEGORICAL, *NUMERIC]}
    out = {}
    for r in rows:
        if not r[idx["Species2"]]:
            continue
        out[r[idx["Species2"]].strip()] = {
            "family": r[idx["Family2"]],
            **{c: clean(r[idx[c]]) for c in CATEGORICAL + NUMERIC},
        }
    return out


def summarize(records, with_morphology):
    rec = {}
    for c in CATEGORICAL:
        common = Counter(x[c] for x in records if x[c] is not None).most_common(1)
        rec[c] = common[0][0] if common else None
    for c in NUMERIC:
        vals = [x[c] for x in records if isinstance(x[c], (int, float))]
        rec[c] = statistics.median(vals) if vals and with_morphology else None
    return rec


def main():
    avonet = load_avonet(sys.argv[1])
    with urllib.request.urlopen(TAXONOMY_URL) as res:
        taxonomy = json.load(res)

    by_epithet, by_genus, by_family = {}, {}, {}
    for sci, rec in avonet.items():
        genus, epithet = sci.split(" ")[:2]
        by_epithet.setdefault(epithet, []).append(rec)
        by_genus.setdefault(genus, []).append(rec)
        by_family.setdefault(rec["family"], []).append(rec)

    lookups = {"Habitat": [], "Primary.Lifestyle": [], "Trophic.Niche": []}

    def code(col, v):
        if v is None:
            return None
        table = lookups[col]
        if v not in table:
            table.append(v)
        return table.index(v)

    def num(v):
        if not isinstance(v, (int, float)):
            return None
        return round(v, 1) if v < 100 else round(v)

    species, stats = {}, Counter()
    for t in taxonomy:
        sci, fam = t["sciName"], t["familySciName"]
        genus, epithet = sci.split(" ")[:2]
        same = [r for r in by_epithet.get(epithet, []) if r["family"] == fam]
        if sci in avonet:
            rec, match = avonet[sci], 0; stats["exact"] += 1
        elif len(same) == 1:
            rec, match = same[0], 0; stats["renamed"] += 1
        elif genus in by_genus:
            rec, match = summarize(by_genus[genus], True), 1; stats["genus"] += 1
        elif fam in by_family:
            rec, match = summarize(by_family[fam], False), 2; stats["family"] += 1
        else:
            stats["missing"] += 1
            continue
        mig = rec["Migration"]
        species[sci] = [
            code("Habitat", rec["Habitat"]),
            code("Primary.Lifestyle", rec["Primary.Lifestyle"]),
            code("Trophic.Niche", rec["Trophic.Niche"]),
            int(mig) if isinstance(mig, (int, float)) else None,
            *[num(rec[c]) for c in NUMERIC],
            match,
        ]

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "AVONET (Tobias et al. 2022, Ecology Letters), CC BY 4.0",
        "fields": ["habitat", "lifestyle", "diet", "migration", "mass", "wing", "beak", "tail", "tarsus", "handWing", "match"],
        "habitats": lookups["Habitat"],
        "lifestyles": lookups["Primary.Lifestyle"],
        "diets": lookups["Trophic.Niche"],
        "species": species,
    }, separators=(",", ":")))
    print(f"{len(species)} of {len(taxonomy)} eBird species -> {OUT} ({OUT.stat().st_size // 1024} KB)")
    print(dict(stats))


if __name__ == "__main__":
    main()
