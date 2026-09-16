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
        python tools/fetch_faces.py --offline [--source=DIR]

`--offline` mirrors from a local directory (default `assets/faces/`) instead of the
network, for when the art has already been fetched once. The files still land in
`public/faces/`, because that is the only directory Vite serves -- art sitting in
`assets/faces/` is invisible to the browser, and art without a manifest draws
nothing at all.
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
LOCAL = ROOT / "assets" / "faces"
BASE = "https://commander.dragondice.com/images/faces"

CLASS_SHORT = {
    "heavy_melee": "heavy",
    "light_melee": "light",
    "cavalry": "cavalry",
    "missile": "missile",
    "magic": "magic",
}
FACE_RE = re.compile(r"^(\d+) (.+)$")

# **A die face has exactly one image.** Where several dice of one species print the
# same icon, the candidate order below cannot tell them apart -- it asks the same
# question for each and gets the same answer -- so the ones that differ are pinned
# here. `resolve` reports any face it finds more than one image for, which is how a
# missing entry announces itself instead of quietly drawing the wrong die.
#
# Both tables are keyed by (unit id, icon) rather than by face index, because it is a
# fact about the die rather than about one side of it -- Redwood prints Trample twice.
#
# **Pin the variant, not the path, whenever the name follows the generator's rule.**
# A die can print one icon at two different counts -- Nymph maneuvers for 1 on one
# face and for 2 on another -- and those are two different files, so a table of paths
# can only ever name one of them. The variant is the part that is actually a fact
# about the die; the count comes from the face.
FACE_ART_VARIANTS = {
    # Redwood and Unicorn both carry `4 SAI:Trample` and both resolved to
    # `trample-m.svg`, which is neither of them.
    ("treefolk.redwood", "SAI:Trample"): 2,
    ("treefolk.unicorn", "SAI:Trample"): 1,
    # The same shape again: one generic `cantrip-m.svg` landed on all three
    # firewalkers monsters at once.
    ("firewalkers.fireshadow", "SAI:Cantrip"): 2,
    ("firewalkers.genie", "SAI:Cantrip"): 2,
    ("firewalkers.salamander", "SAI:Cantrip"): 2,
    # Treefolk draw maneuver twice: variant 1 is a bare humanoid footprint, variant 2
    # a clawed root-foot. The split is by what the creature is, not by its count or
    # class -- the willow and pine lines are trees and take the claw, while the
    # nymph/naiad/Lady Nereid line are water spirits and keep the foot. Firewalkers
    # have only one maneuver image, so nothing there needs pinning.
    ("treefolk.willowling", "MANEUVER"): 2,
    ("treefolk.willow", "MANEUVER"): 2,
    ("treefolk.noble_willow", "MANEUVER"): 2,
    ("treefolk.redwood", "MANEUVER"): 2,
    ("treefolk.pineling", "MANEUVER"): 2,
    ("treefolk.pine", "MANEUVER"): 2,
    ("treefolk.strangle_vine", "MANEUVER"): 2,
    ("treefolk.nymph", "MANEUVER"): 1,
    ("treefolk.naiad", "MANEUVER"): 1,
    ("treefolk.lady_nereid", "MANEUVER"): 1,
}

# For a name the generator's rule cannot reach at all. Ashbringer is a *large* die,
# so the generator would append its health as the suffix and ask for `cantrip-1-3`;
# the `-m` in the file it actually wants is part of the remote's name for that image,
# not the "monster" suffix. Prefer FACE_ART_VARIANTS above unless the name is
# genuinely irregular like this one.
FACE_ART_OVERRIDES = {
    ("firewalkers.ashbringer", "SAI:Cantrip"): "firewalkers/sais/cantrip-1-m.svg",
}


def unit_candidates(unit, face):
    """Remote paths to try for one unit face, best guess first."""
    species = unit["species"]
    match = FACE_RE.match(face)
    if not match:
        return []
    count, icon = int(match.group(1)), match.group(2)

    override = FACE_ART_OVERRIDES.get((unit["id"], icon))
    if override is not None:
        return [override]

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

    variant = FACE_ART_VARIANTS.get((unit["id"], icon))
    if variant is not None:
        return [f"{folder}/{stem}-{variant}-{suffix}.svg"]

    return [
        f"{folder}/{stem}-{suffix}.svg",
        f"{folder}/{stem}-1-{suffix}.svg",
        f"{folder}/{stem}-2-{suffix}.svg",
    ]


def fetch(path, dry_run, source=None):
    """Put one file in OUT, from `source` if given else the network. True if present."""
    dest = OUT / path
    if dest.exists():
        return True
    if source is not None:
        # A local mirror can be probed for free, so --dry-run stays honest here.
        src = source / path
        if not src.exists():
            return False
        if dry_run:
            return True
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
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


def exists(path, dry_run, source=None):
    """Whether one file is there, without downloading it."""
    if (OUT / path).exists():
        return True
    if source is not None:
        return (source / path).exists()
    if dry_run:
        # Nothing to ask without the network. `main` knows not to judge ambiguity on
        # this, since answering yes to everything makes everything look ambiguous.
        return True
    request = urllib.request.Request(f"{BASE}/{path}", method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=20):
            found = True
    except urllib.error.HTTPError:
        found = False
    except Exception as error:  # noqa: BLE001
        print(f"  {path}: {type(error).__name__}")
        found = False
    time.sleep(0.12)  # be polite to their server
    return found


def resolve(candidates, dry_run, cache, source=None):
    """The candidates that exist, best guess first.

    Every candidate is probed rather than stopping at the first hit, because a face
    has exactly one image and two hits mean the guess cannot say which -- that is
    what put one generic `cantrip-m.svg` on three different monsters. The caller
    takes the first and reports anything longer.
    """
    found = []
    for path in candidates:
        if path not in cache:
            cache[path] = exists(path, dry_run, source)
        if cache[path]:
            found.append(path)
    return found


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    source = None
    for arg in sys.argv[1:]:
        if arg.startswith("--source="):
            source = pathlib.Path(arg.split("=", 1)[1])
    if source is None and "--offline" in sys.argv:
        source = LOCAL
    if source is not None and not source.is_dir():
        print(f"no such directory: {source}", file=sys.stderr)
        return 1

    units_doc = json.loads(UNITS.read_text(encoding="utf-8"))

    cache: dict[str, bool] = {}
    manifest_units: dict[str, str] = {}
    missing: list[str] = []
    ambiguous: list[str] = []
    # A remote dry run answers yes to every probe, so every face would look ambiguous.
    can_judge = source is not None or not dry_run

    for unit in units_doc["units"]:
        for index, face in enumerate(unit["faces"]):
            if face == "TODO":
                continue
            found = resolve(unit_candidates(unit, face), dry_run, cache, source)
            key = f"{unit['id']}#{index}"
            if not found:
                missing.append(f"{key} ({face})")
                continue
            if len(found) > 1 and can_judge:
                ambiguous.append(f"{key} ({face}) -> {', '.join(found)}")
            manifest_units[key] = found[0]
            fetch(found[0], dry_run, source)

    manifest_terrains: dict[str, str] = {}
    if TERRAINS.exists():
        terrains_doc = json.loads(TERRAINS.read_text(encoding="utf-8"))
        for type_id, terrain in terrains_doc["terrainTypes"].items():
            for number, icon in terrain["faces"].items():
                path = f"terrain/sais/{icon.lower()}-{number}.svg"
                if resolve([path], dry_run, cache, source):
                    manifest_terrains[f"{type_id}#{number}"] = path
                    fetch(path, dry_run, source)
                else:
                    missing.append(f"terrain {type_id}#{number}")
        for die in terrains_doc["terrains"]:
            eighth = die["eighthFace"].replace("_", "-")
            path = f"terrain/sais/{eighth}-8.svg"
            if resolve([path], dry_run, cache, source):
                manifest_terrains[f"eighth#{die['eighthFace']}"] = path
                fetch(path, dry_run, source)

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

    used = len(set(manifest_units.values()) | set(manifest_terrains.values()))
    print(f"{len(manifest_units)} unit faces and {len(manifest_terrains)} terrain faces mapped")
    print(f"{used} distinct files in {OUT.relative_to(ROOT)}/ (gitignored)")
    if missing:
        print(f"\n{len(missing)} could not be resolved (they fall back to our glyphs):")
        for item in missing[:20]:
            print(f"  {item}")
    if ambiguous:
        print(
            f"\n{len(ambiguous)} face(s) matched more than one image. A face has exactly"
            "\none, so the first was taken -- name the right one in FACE_ART_OVERRIDES:"
        )
        for item in ambiguous[:20]:
            print(f"  {item}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
