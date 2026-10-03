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
DRAGONS = ROOT / "data" / "starter" / "dragons.json"
OUT = ROOT / "public" / "faces"
LOCAL = ROOT / "assets" / "faces"
BASE = "https://commander.dragondice.com/images/faces"

# The twelve dragon faces of each form, in face order, by remote filename.
#
# **A literal table, not a rule.** The names are almost regular -- icon, form letter,
# occurrence index -- and three of them are not: jaws carries no form letter and is
# shared by both forms, breath and treasure carry no index. Deriving the regular ones
# and special-casing the rest would be more code than this and would invent a rule
# the remote never promised. `dragon_paths` checks each list against the transcribed
# faces, so a table that drifts from the data is an error rather than a wrong picture.
#
# **The art is per form, not per element**, verified against the live set: every
# `-<element>-` spelling 404s, and so do `wing-w-*` and `treasure-d-*`, which is the
# layout agreeing with itself. So all five drakes share one set of twelve images.
# (`dragon-jaws-2-d.svg` does exist and is *not* ours -- nothing in the base game's
# ten dice uses it. Do not "fix" jaws to it.)
DRAGON_FACE_ART = {
    "drake": [
        "dragon-jaws-1-d.svg",
        "dragon-breath-d-d.svg",
        "dragon-claw-d-1-d.svg",
        "dragon-claw-d-2-d.svg",
        "dragon-belly-d-1-d.svg",
        "dragon-belly-d-2-d.svg",
        "dragon-wing-d-1-d.svg",
        "dragon-wing-d-2-d.svg",
        "dragon-claw-d-3-d.svg",
        "dragon-claw-d-4-d.svg",
        "dragon-tail-d-1-d.svg",
        "dragon-tail-d-2-d.svg",
    ],
    "wyrm": [
        "dragon-jaws-1-d.svg",
        "dragon-breath-w-d.svg",
        "dragon-claw-w-1-d.svg",
        "dragon-claw-w-2-d.svg",
        "dragon-belly-w-1-d.svg",
        "dragon-belly-w-2-d.svg",
        "dragon-claw-w-3-d.svg",
        "dragon-claw-w-4-d.svg",
        "dragon-tail-w-1-d.svg",
        "dragon-tail-w-2-d.svg",
        "dragon-tail-w-3-d.svg",
        "dragon-treasure-w-d.svg",
    ],
}

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
    # Coral Elves (v2 Phase 5g), from the dice's owner's notes beside the transcription
    # (data/raw/coral_elves.faces.txt): maneuver variant 1 for the heavy and light melee
    # lines, the missile line, the Evoker and the monsters; variant 2 for the cavalry
    # line and the Conjurer. Fly variant 1 on the Eagle Knight, Gryphon and Sprite Swarm;
    # variant 2 on the Leviathan. Every other Coral Elves face has one image.
    ("coral_elves.fighter", "MANEUVER"): 1,
    ("coral_elves.trooper", "MANEUVER"): 1,
    ("coral_elves.guard", "MANEUVER"): 1,
    ("coral_elves.courier", "MANEUVER"): 1,
    ("coral_elves.herald", "MANEUVER"): 1,
    ("coral_elves.bowman", "MANEUVER"): 1,
    ("coral_elves.archer", "MANEUVER"): 1,
    ("coral_elves.sharpshooter", "MANEUVER"): 1,
    ("coral_elves.evoker", "MANEUVER"): 1,
    ("coral_elves.coral_giant", "MANEUVER"): 1,
    ("coral_elves.leviathan", "MANEUVER"): 1,
    ("coral_elves.tako", "MANEUVER"): 1,
    ("coral_elves.horseman", "MANEUVER"): 2,
    ("coral_elves.knight", "MANEUVER"): 2,
    ("coral_elves.conjurer", "MANEUVER"): 2,
    ("coral_elves.eagle_knight", "SAI:Fly"): 1,
    ("coral_elves.gryphon", "SAI:Fly"): 1,
    ("coral_elves.sprite_swarm", "SAI:Fly"): 1,
    ("coral_elves.leviathan", "SAI:Fly"): 2,
    # Dwarves, from the owner's list of remote paths: maneuver variant 1 for the heavy and
    # light lines and the monsters, 2 for the Pony Rider, 3 for the Lizard Rider. Roar and
    # Fly differ between two monsters that print the same icon: Roar 2 on the Androsphinx
    # and 1 on the Behemoth, Fly 2 on the Gargoyle and 1 on the Roc. Every other Dwarves
    # face has one image.
    ("dwarves.footman", "MANEUVER"): 1,
    ("dwarves.sergeant", "MANEUVER"): 1,
    ("dwarves.warlord", "MANEUVER"): 1,
    ("dwarves.sentry", "MANEUVER"): 1,
    ("dwarves.patroller", "MANEUVER"): 1,
    ("dwarves.skirmisher", "MANEUVER"): 1,
    ("dwarves.pony_rider", "MANEUVER"): 2,
    ("dwarves.lizard_rider", "MANEUVER"): 3,
    ("dwarves.behemoth", "MANEUVER"): 1,
    ("dwarves.gargoyle", "MANEUVER"): 1,
    ("dwarves.umber_hulk", "MANEUVER"): 1,
    ("dwarves.androsphinx", "SAI:Roar"): 2,
    ("dwarves.behemoth", "SAI:Roar"): 1,
    ("dwarves.gargoyle", "SAI:Fly"): 2,
    ("dwarves.roc", "SAI:Fly"): 1,
    # Goblins (v2 Phase 7f), from the owner's list of remote paths: maneuver variant 1 for
    # the heavy, light, missile and magic lines and the monsters, 2 for the cavalry. Every
    # other Goblins face has one image.
    ("goblins.thug", "MANEUVER"): 1,
    ("goblins.cutthroat", "MANEUVER"): 1,
    ("goblins.marauder", "MANEUVER"): 1,
    ("goblins.cannibal", "MANEUVER"): 1,
    ("goblins.mugger", "MANEUVER"): 1,
    ("goblins.ambusher", "MANEUVER"): 1,
    ("goblins.filcher", "MANEUVER"): 1,
    ("goblins.death_naga", "MANEUVER"): 1,
    ("goblins.wardog_rider", "MANEUVER"): 2,
    ("goblins.wolf_rider", "MANEUVER"): 2,
    ("goblins.pelter", "MANEUVER"): 1,
    ("goblins.slingman", "MANEUVER"): 1,
    ("goblins.trickster", "MANEUVER"): 1,
    ("goblins.hedge_wizard", "MANEUVER"): 1,
    ("goblins.death_mage", "MANEUVER"): 1,
    ("goblins.troll", "MANEUVER"): 1,
}

# For a name the generator's rule cannot reach at all. Ashbringer is a *large* die,
# so the generator would append its health as the suffix and ask for `cantrip-1-3`;
# the `-m` in the file it actually wants is part of the remote's name for that image,
# not the "monster" suffix. Prefer FACE_ART_VARIANTS above unless the name is
# genuinely irregular like this one.
FACE_ART_OVERRIDES = {
    ("firewalkers.ashbringer", "SAI:Cantrip"): "firewalkers/sais/cantrip-1-m.svg",
}


def remote_species(species_id):
    """The remote's folder for a species: its id with hyphens. `coral_elves` is
    `coral-elves/` there (v2 Phase 5g) -- the first species whose id has a separator, so
    the first place the two names differ."""
    return species_id.replace("_", "-")


def unit_candidates(unit, face):
    """Remote paths to try for one unit face, best guess first."""
    species = remote_species(unit["species"])
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


def dragon_paths(form_id, faces):
    """Remote paths for one form's twelve faces, checked against the transcription.

    The table above is in face order, so an entry whose icon disagrees with the data
    means one of the two has moved -- which is exactly the failure that would
    otherwise show up as a claw drawn where a tail was rolled.
    """
    names = DRAGON_FACE_ART.get(form_id)
    if names is None:
        raise SystemExit(f"no face art table for dragon form {form_id!r}")
    if len(names) != 12:
        raise SystemExit(f"{form_id}: {len(names)} art names for 12 faces")

    for index, name in enumerate(names, start=1):
        icon = faces[str(index)].lower()
        # `dragon-<icon>-...`: the icon is the second word of every filename.
        if name.split("-")[1] != icon:
            raise SystemExit(
                f"{form_id} face {index} is {icon.upper()} but its art is {name} -- "
                f"the table and data/starter/dragons.json disagree"
            )
    return [f"dragons/sais/{name}" for name in names]


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

    # Keep the offline mirror in step with what we just pulled. Without this the two
    # directories drift the moment new art is added -- `public/faces/` gets it and
    # `--offline` silently cannot, which is how the dragon faces ended up fetched but
    # missing from `assets/faces/`. Both are gitignored, so this puts nothing in the
    # repository (invariant 8).
    local = LOCAL / path
    if not local.exists():
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(body)

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

    # Keyed by *form*, not by die: the art carries no element, so all five drakes
    # share one set of twelve. The UI resolves a die's form before looking up.
    manifest_dragons: dict[str, str] = {}
    if DRAGONS.exists():
        dragons_doc = json.loads(DRAGONS.read_text(encoding="utf-8"))
        for form_id, form in dragons_doc["dragonForms"].items():
            for index, path in enumerate(dragon_paths(form_id, form["faces"]), start=1):
                if resolve([path], dry_run, cache, source):
                    manifest_dragons[f"{form_id}#{index}"] = path
                    fetch(path, dry_run, source)
                else:
                    missing.append(f"dragon {form_id}#{index}")

    if not dry_run:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / "manifest.json").write_text(
            json.dumps(
                {
                    "version": 2,
                    "units": manifest_units,
                    "terrains": manifest_terrains,
                    "dragons": manifest_dragons,
                },
                indent=1,
            )
            + "\n",
            encoding="utf-8",
        )

    used = len(
        set(manifest_units.values()) | set(manifest_terrains.values()) | set(manifest_dragons.values())
    )
    print(
        f"{len(manifest_units)} unit faces, {len(manifest_terrains)} terrain faces "
        f"and {len(manifest_dragons)} dragon faces mapped"
    )
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
