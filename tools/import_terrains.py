#!/usr/bin/env python3
"""Build data/starter/terrains.json from data/raw/terrains.faces.txt.

A terrain die is a terrain TYPE (which fixes faces 1-7) plus an EIGHTH-FACE icon.
Faces 1-7 are identical across the four eighth-face variants of a type, so the
generated file stores each type's faces once and lists the dice as combinations.

Careful: in this raw file the leading number on a face line is the FACE NUMBER,
not an icon count. That is the opposite of the unit files.

Usage:  python tools/import_terrains.py
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "terrains.faces.txt"
OUT = ROOT / "data" / "starter" / "terrains.json"

# Elements per terrain type, from the full rules (p. 6).
ELEMENTS = {
    "swampland": ["water", "earth"],
    "highland": ["fire", "earth"],
    "wasteland": ["air", "fire"],
    "coastland": ["air", "water"],
    "flatland": ["air", "earth"],
    "feyland": ["water", "fire"],
    "deadland": ["death"],
}

EIGHTH_FACES = {"city", "standing_stones", "temple", "tower"}
ACTIONS = {"MELEE", "MISSILE", "MAGIC"}

FACE_RE = re.compile(r"^([1-8])\s+(.+?)$")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def parse():
    dice, header, faces = [], None, {}

    def flush():
        if header is not None:
            dice.append((header, dict(faces)))

    for raw_line in RAW.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        m = FACE_RE.match(line)
        if m and header is not None:
            number, icon = m.group(1), slug(m.group(2)).upper()
            if number in faces:
                raise ValueError(f"{header}: face {number} listed twice")
            faces[number] = icon
        else:
            flush()
            words = line.split()
            terrain_type = slug(words[0])
            eighth = slug(" ".join(words[1:]))
            if terrain_type not in ELEMENTS:
                raise ValueError(f"unknown terrain type {terrain_type!r}")
            if eighth not in EIGHTH_FACES:
                raise ValueError(f"unknown eighth face {eighth!r}")
            header, faces = (terrain_type, eighth), {}
    flush()
    return dice


def main():
    dice = parse()
    types, terrains, errors = {}, [], []

    for (terrain_type, eighth), faces in dice:
        missing = [n for n in map(str, range(1, 9)) if n not in faces]
        if missing:
            errors.append(f"{terrain_type} {eighth}: missing faces {missing}")
            continue

        if faces["8"] != eighth.upper():
            errors.append(f"{terrain_type} {eighth}: face 8 is {faces['8']}, expected {eighth.upper()}")

        action_faces = {n: faces[n] for n in map(str, range(1, 8))}
        for n, icon in action_faces.items():
            if icon not in ACTIONS:
                errors.append(f"{terrain_type} {eighth}: face {n} is {icon!r}, not a normal action")

        # Faces 1-7 must agree across every eighth-face variant of a type.
        if terrain_type in types:
            if types[terrain_type]["faces"] != action_faces:
                errors.append(f"{terrain_type} {eighth}: faces 1-7 disagree with the other "
                              f"{terrain_type} dice")
        else:
            types[terrain_type] = {
                "name": terrain_type.title(),
                "elements": ELEMENTS[terrain_type],
                "faces": action_faces,
            }

        terrains.append({
            "id": f"{terrain_type}_{eighth}",
            "type": terrain_type,
            "eighthFace": eighth,
        })

    if errors:
        for e in errors:
            print(f" ERROR: {e}")
        return 1

    doc = {
        "$schema": "../schema/terrain.schema.json",
        "_generated": "by tools/import_terrains.py from data/raw/terrains.faces.txt -- DO NOT EDIT BY HAND",
        "_comment": "Faces 1-7 live on the terrain type; a die is a type plus an eighth-face icon. "
                    "The eighth-face icons are recorded but inert in v0 (see docs/RULES-V0.md).",
        "terrainTypes": types,
        "terrains": terrains,
    }
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"wrote {OUT.relative_to(ROOT)}: {len(types)} terrain types, {len(terrains)} dice")
    for tid, t in types.items():
        profile = [t["faces"][n] for n in map(str, range(1, 8))]
        counts = {a: profile.count(a) for a in ("MELEE", "MISSILE", "MAGIC")}
        print(f"  {tid:10s} {'+'.join(t['elements']):14s} "
              f"melee {counts['MELEE']}  missile {counts['MISSILE']}  magic {counts['MAGIC']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
