#!/usr/bin/env python3
"""Build data/starter/units.json from the raw face transcriptions in data/raw/.

The raw files are the source of truth; units.json is generated and should never
be hand-edited. Re-running this is always safe.

Raw format -- a die header, then one line per face:

    https://commander.dragondice.com/images/faces/firewalkers/ids/heavy-small.svg
    1 ID
    2 Melee
    ...

The header may be a Dice Commander face-art URL or a bare "<class>-<size>"
("heavy-small", "monster-gorgon"). Blank lines and '#' comments are ignored, and
trailing whitespace/tabs from copy-paste are stripped.

Usage:  python tools/import_faces.py
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from species import SPECIES, SIZES, CLASSES, CLASS_LABELS, NORMAL_ICONS  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT = ROOT / "data" / "starter" / "units.json"

SIZE_BY_NAME = {name: (name, health, faces) for name, health, faces in SIZES}
FACE_RE = re.compile(r"^(\d+)\s+(.+?)$")
HEADER_RE = re.compile(r"^(?:.*/ids/)?([a-z]+)-([a-z][a-z_-]*)\.svg$|^([a-z]+)-([a-z][a-z_-]*)$")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def parse_header(line, species_id):
    """Return (class_key, size_key, unit_name) or raise ValueError."""
    m = HEADER_RE.match(line.strip())
    if not m:
        raise ValueError(f"unrecognised die header: {line!r}")
    left, right = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
    right = right.replace("-", "_")  # "strangle-vine" and "strangle_vine" are the same die
    names = SPECIES[species_id]["units"]

    if left == "monster":
        # "monster-gorgon" -> find which class that monster belongs to
        for cls in CLASSES:
            if slug(names[cls][3]) == right:
                return cls, "monster", names[cls][3]
        raise ValueError(f"unknown monster {right!r} for {species_id}")

    if left not in CLASSES:
        raise ValueError(f"unknown class {left!r}")
    if right not in SIZE_BY_NAME:
        raise ValueError(f"unknown size {right!r}")
    index = [s[0] for s in SIZES].index(right)
    return left, right, names[left][index]


def parse_face(line):
    """'2 Melee' -> '2 MELEE'; '4 Create Fireminions' -> '4 SAI:Create Fireminions'."""
    if line.strip().upper() == "TODO":
        return "TODO"
    m = FACE_RE.match(line.strip())
    if not m:
        raise ValueError(f"unrecognised face: {line!r}")
    count, icon = int(m.group(1)), m.group(2).strip()
    canonical = icon.upper()
    if canonical in NORMAL_ICONS:
        return f"{count} {canonical}"
    # Anything not a normal action icon is an SAI; preserve its printed name.
    return f"{count} SAI:{icon}"


def parse_raw(path, species_id):
    dice, header, faces = [], None, []

    def flush():
        if header is not None:
            dice.append((header, faces[:]))

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()  # drop inline and whole-line comments
        if not line:
            continue
        if FACE_RE.match(line) or line.upper() == "TODO":
            if header is None:
                raise ValueError(f"{path.name}: face line before any die header: {line!r}")
            faces.append(parse_face(line))
        else:
            flush()
            header, faces = parse_header(line, species_id), []
    flush()
    return dice


def main():
    all_units, seen = [], {}

    for species_id, sp in SPECIES.items():
        raw = RAW_DIR / f"{species_id}.faces.txt"
        parsed = dict()
        if raw.exists():
            for (cls, size, name), faces in parse_raw(raw, species_id):
                parsed[(cls, size)] = (name, faces)
        else:
            print(f"  note: {raw.relative_to(ROOT)} not found -- emitting TODO placeholders")

        for cls in CLASSES:
            for index, (size, health, face_count) in enumerate(SIZES):
                name = sp["units"][cls][index]
                got = parsed.get((cls, size))
                faces = got[1] if got else ["TODO"] * face_count
                all_units.append({
                    "id": f"{species_id}.{slug(name)}",
                    "name": name,
                    "species": species_id,
                    "class": CLASS_LABELS[cls],
                    "size": size,
                    "health": health,
                    "dieType": f"d{face_count}",
                    "faces": faces,
                })
        seen[species_id] = len(parsed)

    doc = {
        "$schema": "../schema/dice.schema.json",
        "_generated": "by tools/import_faces.py from data/raw/*.faces.txt -- DO NOT EDIT BY HAND",
        "species": {k: {"name": v["name"], "elements": v["elements"]} for k, v in SPECIES.items()},
        "units": all_units,
    }
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    todo = sum(f == "TODO" for u in all_units for f in u["faces"])
    total = sum(len(u["faces"]) for u in all_units)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(all_units)} units, "
          f"{total - todo}/{total} faces transcribed ({todo} TODO)")
    for species_id, count in seen.items():
        print(f"  {species_id}: {count}/20 dice")


if __name__ == "__main__":
    main()
