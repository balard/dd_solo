#!/usr/bin/env python3
"""Mirror the Dice Commander face art and write a manifest the UI can look up.

Output goes to `public/faces/`, which Vite serves in dev and copies into `dist/`
on build -- so a local build shows the real dice. The directory is gitignored, so
the repository itself never contains SFR's artwork. See docs/OVERVIEW.md section 5.

**The app must work without any of this.** If the manifest is missing, every face
falls back to our own glyphs. Running this is optional, and a fresh clone that
never runs it is still a complete, playable game.

Why a manifest rather than computing filenames in the UI: the remote asset set is
sparse, per-species, and not derivable from (icon, count). Only combinations
actually printed on some die of that species exist, some icons carry a variant
index (maneuver-1-4, cantrip-1-3, trample-1-m vs trample-2-m), and monster faces
use a '-m' suffix. Resolving that needs to try several candidates and see which
answers -- fine here, impossible synchronously in a browser. So this script records
what it found, keyed by exactly what the UI knows: a unit type id and a face index.

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
OUT = ROOT / "public" / "faces"
BASE = "https://commander.dragondice.com/images/faces"

CLASS_SHORT = {
    "heavy_melee": "heavy",
    "light_melee": "light",
    "cavalry": "cavalry",
    "missile": "missile",
    "magic": "magic",
}
FACE_RE = re.compile(r"^(\d+) (.+)$")


def unit_candidates(unit, face):
    """Remote paths to try for one unit face, best guess first."""
    species = unit["species"]
    match = FACE_RE.match(face)
    if not match:
        return []
    count, icon = int(match.group(1)), match.group(2)

    if icon == "ID":
        if unit["size"] == "monster":
            name = unit["id"].split(".", 1)[1].replace("_", "-")
            return [f"{species}/ids/monster-{name}.svg"]
        return [f"{species}/ids/{CLASS_SHORT[unit['class']]}-{unit['size']}.svg"]

    if icon.startswith("SAI:"):
        stem, folder = icon[4:].lower().replace(" ", "-"), f"{species}/sais"
    else:
        stem, folder = icon.lower(), species

    suffix = "m" if unit["size"] == "monster" else str(count)
    return [
        f"{folder}/{stem}-{suffix}.svg",
        f"{folder}/{stem}-1-{suffix}.svg",
        f"{folder}/{stem}-2-{suffix}.svg",
    ]


def fetch(path, dry_run):
    dest = OUT / path
    if dest.exists():
        return True
    if dry_run:
        return True
    try:
        with urllib.request.urlopen(f"{BASE}/{path}", timeout=20) as response:
            body = response.read()
    except urllib.error.HTTPError:
        return False
    except Exception as error:  # noqa: BLE001
        print(f"  {path}: {type(error).__name__}")
        return False

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(body)
    time.sleep(0.12)  # be polite to their server
    return True


def resolve(candidates, dry_run, cache):
    """First candidate that actually exists, or None."""
    for path in candidates:
        if path in cache:
            if cache[path]:
                return path
            continue
        ok = fetch(path, dry_run)
        cache[path] = ok
        if ok:
            return path
    return None


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    units_doc = json.loads(UNITS.read_text(encoding="utf-8"))

    cache: dict[str, bool] = {}
    manifest_units: dict[str, str] = {}
    missing: list[str] = []

    for unit in units_doc["units"]:
        for index, face in enumerate(unit["faces"]):
            if face == "TODO":
                continue
            found = resolve(unit_candidates(unit, face), dry_run, cache)
            key = f"{unit['id']}#{index}"
            if found:
                manifest_units[key] = found
            else:
                missing.append(f"{key} ({face})")

    manifest_terrains: dict[str, str] = {}
    if TERRAINS.exists():
        terrains_doc = json.loads(TERRAINS.read_text(encoding="utf-8"))
        for type_id, terrain in terrains_doc["terrainTypes"].items():
            for number, icon in terrain["faces"].items():
                path = f"terrain/sais/{icon.lower()}-{number}.svg"
                if resolve([path], dry_run, cache):
                    manifest_terrains[f"{type_id}#{number}"] = path
                else:
                    missing.append(f"terrain {type_id}#{number}")
        for die in terrains_doc["terrains"]:
            eighth = die["eighthFace"].replace("_", "-")
            path = f"terrain/sais/{eighth}-8.svg"
            if resolve([path], dry_run, cache):
                manifest_terrains[f"eighth#{die['eighthFace']}"] = path

    if not dry_run:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / "manifest.json").write_text(
            json.dumps(
                {"version": 1, "units": manifest_units, "terrains": manifest_terrains},
                indent=1,
            )
            + "\n",
            encoding="utf-8",
        )

    fetched = sum(1 for ok in cache.values() if ok)
    print(f"{len(manifest_units)} unit faces and {len(manifest_terrains)} terrain faces mapped")
    print(f"{fetched} distinct files in {OUT.relative_to(ROOT)}/ (gitignored)")
    if missing:
        print(f"\n{len(missing)} could not be resolved (they fall back to our glyphs):")
        for item in missing[:20]:
            print(f"  {item}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
