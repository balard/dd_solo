#!/usr/bin/env python3
"""Validate data/starter/*.json: schema shape plus Dragon Dice semantic rules.

Exit code 1 on any error. Warnings do not fail the run.

Usage:  python tools/validate_data.py
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from species import KNOWN_SAIS  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
UNITS = ROOT / "data" / "starter" / "units.json"
TERRAINS = ROOT / "data" / "starter" / "terrains.json"

FACE_RE = re.compile(r"^(\d+) (ID|MELEE|MISSILE|MAGIC|SAVE|MANEUVER|SAI:[A-Za-z][A-Za-z ]*)$")
FACES_FOR = {"d6": 6, "d10": 10}

errors, warnings, todo_dice = [], [], []
sais_used = set()


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def check_units():
    doc = json.loads(UNITS.read_text(encoding="utf-8"))
    ids = set()

    for u in doc["units"]:
        uid = u["id"]
        if uid in ids:
            err(f"{uid}: duplicate id")
        ids.add(uid)

        if u["species"] not in doc["species"]:
            err(f"{uid}: unknown species {u['species']!r}")

        expected_faces = FACES_FOR[u["dieType"]]
        if len(u["faces"]) != expected_faces:
            err(f"{uid}: {u['dieType']} needs {expected_faces} faces, has {len(u['faces'])}")

        if u["faces"].count("TODO"):
            todo_dice.append(uid)
            continue  # nothing further to check on an untranscribed die

        parsed = []
        for f in u["faces"]:
            m = FACE_RE.match(f)
            if not m:
                err(f"{uid}: unparseable face {f!r}")
                continue
            parsed.append((int(m.group(1)), m.group(2)))

        # --- semantic rules from the rulebook ---

        # Every unit die has exactly one ID face.
        id_faces = [(n, icon) for n, icon in parsed if icon == "ID"]
        if len(id_faces) != 1:
            err(f"{uid}: expected exactly 1 ID face, found {len(id_faces)}")

        # An ID icon generates the unit's health-worth of results.
        for n, _ in id_faces:
            if n != u["health"]:
                err(f"{uid}: ID face is '{n} ID' but the unit has {u['health']} health")

        # Monster icons count for four results. SAI counts may be an X parameter
        # instead (e.g. '2 Flame' targets 2 health-worth), so only warn there.
        if u["size"] == "monster":
            for n, icon in parsed:
                if n != 4:
                    (warn if icon.startswith("SAI:") else err)(
                        f"{uid}: monster face '{n} {icon}' is not 4 results"
                        + (" (fine if that number is the SAI's X value)" if icon.startswith("SAI:") else ""))

        # A face carrying more icons than the die's largest plausible count is a typo.
        for n, icon in parsed:
            if n > 4:
                err(f"{uid}: face '{n} {icon}' has an implausible count")

        # SAI names must match the rulebook, or it is a transcription typo.
        for _, icon in parsed:
            if icon.startswith("SAI:"):
                name = icon[4:]
                sais_used.add(name)
                if name not in KNOWN_SAIS:
                    err(f"{uid}: unknown SAI {name!r} -- not in the starter rulebook list")

        # Non-monster faces usually carry at most health+1 icons. Higher is legal but
        # rare enough to be worth a second look at the die.
        if u["size"] != "monster":
            for n, icon in parsed:
                if icon != "ID" and n > u["health"] + 1:
                    warn(f"{uid}: face '{n} {icon}' on a {u['health']}-health unit "
                         f"(more than health+1) -- worth re-checking against the die")


def check_terrains():
    if not TERRAINS.exists():
        todo_dice.append("terrains.json (not generated yet)")
        return
    doc = json.loads(TERRAINS.read_text(encoding="utf-8"))
    types = doc["terrainTypes"]

    for tid, t in types.items():
        faces = t["faces"]
        missing = [k for k in map(str, range(1, 8)) if k not in faces]
        if missing:
            err(f"terrain type {tid}: missing faces {missing}")
        for k, v in faces.items():
            if v not in ("MELEE", "MISSILE", "MAGIC"):
                err(f"terrain type {tid}: face {k} is {v!r}, not a normal action")
            if v == "TODO":
                todo_dice.append(f"terrain type {tid}")

        # Distance ordering: magic is far, melee is close. Every real terrain die
        # runs magic -> missile -> melee as the number rises, with no interleaving.
        order = {"MAGIC": 0, "MISSILE": 1, "MELEE": 2}
        seq = [order.get(faces[k], -1) for k in map(str, range(1, 8))]
        if seq != sorted(seq):
            err(f"terrain type {tid}: faces are not ordered magic -> missile -> melee "
                f"as the number rises ({[faces[k] for k in map(str, range(1, 8))]})")
        if len(set(seq)) != 3:
            warn(f"terrain type {tid}: does not use all three actions across faces 1-7")

    seen = set()
    for d in doc["terrains"]:
        if d["type"] not in types:
            err(f"terrain {d['id']}: unknown type {d['type']!r}")
        if d["id"] in seen:
            err(f"terrain {d['id']}: duplicate id")
        seen.add(d["id"])
        if d["id"] != f"{d['type']}_{d['eighthFace']}":
            err(f"terrain {d['id']}: id does not match type + eighthFace")

    # Every type should exist in all four eighth-face variants.
    for tid in types:
        variants = {d["eighthFace"] for d in doc["terrains"] if d["type"] == tid}
        missing = {"city", "standing_stones", "temple", "tower"} - variants
        if missing:
            warn(f"terrain type {tid}: no die for eighth face(s) {', '.join(sorted(missing))}")


def main():
    check_units()
    check_terrains()

    for w in warnings:
        print(f"  warn: {w}")
    for e in errors:
        print(f" ERROR: {e}")

    if todo_dice:
        print(f"\n{len(todo_dice)} dice still untranscribed:")
        for d in todo_dice:
            print(f"  TODO: {d}")

    print()
    if errors:
        print(f"FAILED: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    unused = KNOWN_SAIS - sais_used
    print(f"OK: {len(warnings)} warning(s), {len(todo_dice)} die(ce) awaiting transcription")
    print(f"    {len(sais_used)}/{len(KNOWN_SAIS)} rulebook SAIs appear in the data"
          + (f"; unused: {', '.join(sorted(unused))}" if unused else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
