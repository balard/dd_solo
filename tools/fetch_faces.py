#!/usr/bin/env python3
"""Mirror the Dice Commander face art for every face our data actually uses.

Reference art only -- see docs/OVERVIEW.md section 5 on the asset position. The app
ships our own glyphs; this exists so we can *look* at the real icons while building,
and so a future build can optionally use them for personal use.

The asset set is sparse and not derivable from (icon, count): only combinations
actually printed on some die exist, some icons carry a variant index
(maneuver-1-4, cantrip-1-3), and monster faces use a '-m' suffix. So we try a
fallback chain per face and report what could not be resolved.

Output: assets/faces/<species>/... mirroring the remote layout. Gitignored.

Usage:  python tools/fetch_faces.py [--dry-run]
"""
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
UNITS = ROOT / "data" / "starter" / "units.json"
TERRAINS = ROOT / "data" / "starter" / "terrains.json"
OUT = ROOT / "assets" / "faces"
BASE = "https://commander.dragondice.com/images/faces"

CLASS_SHORT = {"heavy_melee": "heavy", "light_melee": "light",
               "cavalry": "cavalry", "missile": "missile", "magic": "magic"}
FACE_RE = re.compile(r"^(\d+) (.+)$")


def candidates(unit, face):
    """Remote paths to try for one face, best guess first."""
    sp = unit["species"]
    m = FACE_RE.match(face)
    if not m:
        return []
    count, icon = int(m.group(1)), m.group(2)

    if icon == "ID":
        if unit["size"] == "monster":
            return [f"{sp}/ids/monster-{unit['id'].split('.', 1)[1].replace('_', '-')}.svg"]
        return [f"{sp}/ids/{CLASS_SHORT[unit['class']]}-{unit['size']}.svg"]

    if icon.startswith("SAI:"):
        stem, folder = icon[4:].lower().replace(" ", "-"), f"{sp}/sais"
    else:
        stem, folder = icon.lower(), sp

    suffix = "m" if unit["size"] == "monster" else str(count)
    return [
        f"{folder}/{stem}-{suffix}.svg",     # save-3, smite-4, melee-m
        f"{folder}/{stem}-1-{suffix}.svg",   # maneuver-1-4, cantrip-1-3
        f"{folder}/{stem}-2-{suffix}.svg",
    ]


def fetch(path, dry_run):
    dest = OUT / path
    if dest.exists():
        return "cached"
    url = f"{BASE}/{path}"
    if dry_run:
        return "would-fetch"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        return f"http-{e.code}"
    except Exception as e:                                  # noqa: BLE001
        return f"error-{type(e).__name__}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(body)
    time.sleep(0.15)                                        # be polite to their server
    return "fetched"


def main():
    dry_run = "--dry-run" in sys.argv
    doc = json.loads(UNITS.read_text(encoding="utf-8"))

    wanted, unresolved = {}, []

    # Terrain faces: art is shared across terrain types and named by the number
    # printed on the face -- terrain/sais/melee-7.svg, terrain/sais/city-8.svg.
    if TERRAINS.exists():
        tdoc = json.loads(TERRAINS.read_text(encoding="utf-8"))
        for t in tdoc["terrainTypes"].values():
            for number, icon in t["faces"].items():
                path = f"terrain/sais/{icon.lower()}-{number}.svg"
                wanted.setdefault(path, [path])
        for d in tdoc["terrains"]:
            path = f"terrain/sais/{d['eighthFace'].replace('_', '-')}-8.svg"
            wanted.setdefault(path, [path])

    for unit in doc["units"]:
        for face in unit["faces"]:
            if face == "TODO":
                continue
            paths = candidates(unit, face)
            if not paths:
                unresolved.append((unit["id"], face, "unparseable"))
                continue
            wanted.setdefault(paths[0], paths)

    counts = {}
    for _, paths in sorted(wanted.items()):
        for path in paths:
            result = fetch(path, dry_run)
            counts[result] = counts.get(result, 0) + 1
            if result in ("fetched", "cached", "would-fetch"):
                break
        else:
            unresolved.append((path, "", "no candidate resolved"))

    print(f"{len(wanted)} distinct faces referenced by data/starter/units.json")
    for k, v in sorted(counts.items()):
        print(f"  {k}: {v}")
    if unresolved:
        print(f"\n{len(unresolved)} unresolved:")
        for a, b, why in unresolved:
            print(f"  {a} {b} -- {why}")
    if not dry_run:
        print(f"\nmirrored into {OUT.relative_to(ROOT)}/ (gitignored)")


if __name__ == "__main__":
    main()
