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
DRAGONS = ROOT / "data" / "starter" / "dragons.json"
SPELLS = ROOT / "data" / "spells.json"

FACE_RE = re.compile(r"^(\d+) (ID|MELEE|MISSILE|MAGIC|SAVE|MANEUVER|SAI:[A-Za-z][A-Za-z ]*)$")
FACES_FOR = {"d6": 6, "d10": 10}

errors, warnings, todo_dice = [], [], []
sais_used = set()
spells_unbuilt = []


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

        # A face carrying more icons than the die's largest plausible count is a typo. That
        # is health+2 on a non-monster (the monster rule above already pins 4): a flat 4
        # was a fact about the starter set, and the Lava Elves print 5 on every large die
        # and 4 on every medium one (v2 Phase 8a).
        ceiling = 4 if u["size"] == "monster" else u["health"] + 2
        for n, icon in parsed:
            if n > ceiling:
                err(f"{uid}: face '{n} {icon}' has an implausible count")

        # SAI names must match the rulebook, or it is a transcription typo.
        for _, icon in parsed:
            if icon.startswith("SAI:"):
                name = icon[4:]
                sais_used.add(name)
                if name not in KNOWN_SAIS:
                    err(f"{uid}: unknown SAI {name!r} -- not in any rulebook list in tools/species.py")

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


def check_dragons():
    if not DRAGONS.exists():
        todo_dice.append("dragons.json (not generated yet)")
        return
    doc = json.loads(DRAGONS.read_text(encoding="utf-8"))
    forms = doc["dragonForms"]

    icons = {"JAWS", "BREATH", "CLAW", "BELLY", "WING", "TAIL", "TREASURE"}
    numbers = [str(n) for n in range(1, 13)]

    for fid, f in forms.items():
        faces = f["faces"]
        missing = [k for k in numbers if k not in faces]
        if missing:
            err(f"dragon form {fid}: missing faces {missing}")
        for k, v in faces.items():
            if v not in icons:
                err(f"dragon form {fid}: face {k} is {v!r}, not a dragon icon")

        profile = [faces.get(k) for k in numbers]

        # Exactly one Jaws and exactly one Breath on every dragon die. Both are the
        # die's rare faces -- Jaws is its 12 damage and Breath its whole elemental
        # identity -- so a second of either is a transcription slip, not a variant.
        for icon in ("JAWS", "BREATH"):
            n = profile.count(icon)
            if n != 1:
                err(f"dragon form {fid}: {n} {icon} faces, expected exactly 1")

        # Wings belong to drakes, the treasure chest to wyrms (full rules p. 17).
        # This is the only structural fact about the forms either rulebook states.
        if (profile.count("WING") > 0) != (fid == "drake"):
            err(f"dragon form {fid}: wings belong to drakes and only drakes")
        if (profile.count("TREASURE") > 0) != (fid == "wyrm"):
            err(f"dragon form {fid}: the treasure chest belongs to wyrms and only wyrms")

    seen = set()
    for d in doc["dragons"]:
        if d["form"] not in forms:
            err(f"dragon {d['id']}: unknown form {d['form']!r}")
        if d["id"] in seen:
            err(f"dragon {d['id']}: duplicate id")
        seen.add(d["id"])
        if d["id"] != f"{d['element']}_{d['form']}":
            err(f"dragon {d['id']}: id does not match element + form")

    # Five elements x two forms. A missing die is an error rather than a warning:
    # unlike a terrain eighth-face variant, force setup can draw any of these.
    for element in ("air", "death", "earth", "fire", "water"):
        for form in ("drake", "wyrm"):
            if f"{element}_{form}" not in seen:
                err(f"missing dragon die {element}_{form}")


# The eighteen spells Treefolk and Firewalkers can cast, full rules pp. 46-51. Unlike
# everything else here `data/spells.json` is hand-authored rather than generated, so
# these checks guard a transcription rather than an importer.
SPELL_ELEMENTS = {"air", "water", "earth", "fire", "death", "elemental"}
SPELL_TARGETS = {
    "army", "own_army", "opposing_army", "own_unit", "opposing_unit", "units", "opposing_units", "terrain",
    "own_dua", "dua",
}
RESULT_TYPES = {"melee", "missile", "magic", "save", "maneuver", "*", "non_maneuver"}
MODIFIER_KINDS = {"add", "subtract", "divide", "multiply", "ignore_ids"}
SPELL_ID_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def check_spells():
    doc = json.loads(SPELLS.read_text(encoding="utf-8"))
    species_ids = set(json.loads(UNITS.read_text(encoding="utf-8"))["species"]) | {"any"}
    ids = set()

    for s in doc["spells"]:
        sid = s.get("id", "?")
        if not SPELL_ID_RE.match(sid):
            err(f"spell {sid}: id is not a lower_snake_case key")
        if sid in ids:
            err(f"spell {sid}: duplicate id")
        ids.add(sid)

        if s["element"] not in SPELL_ELEMENTS:
            err(f"spell {sid}: unknown element {s['element']}")
        if s["species"] not in species_ids:
            err(f"spell {sid}: unknown species {s['species']}")
        if s["target"] not in SPELL_TARGETS:
            err(f"spell {sid}: unknown target {s['target']}")
        if not isinstance(s["cost"], int) or s["cost"] < 1:
            err(f"spell {sid}: cost must be a positive integer")
        for flag in ("cumulative", "reserves", "cantrip"):
            if not isinstance(s[flag], bool):
                err(f"spell {sid}: {flag} must be a boolean")
        if not s["text"].strip():
            err(f"spell {sid}: empty rules text")
        # Phase 9f: a cumulative spell whose handler ignores the count -- the picker offers
        # no stepper for it. Only meaningful on a cumulative spell.
        if "countScales" in s:
            if s["countScales"] is not False:
                err(f"spell {sid}: countScales is only ever written as false")
            if not s["cumulative"]:
                err(f"spell {sid}: countScales false on a spell that is not cumulative")

        # A spell carries at most one of these. Neither means transcribed but not yet
        # implemented, which is a real state until Phase 7f -- reported, not an error.
        if "effect" in s and "handler" in s:
            err(f"spell {sid}: has both an effect and a handler")
        if "effect" not in s and "handler" not in s:
            spells_unbuilt.append(sid)

        effect = s.get("effect")
        if effect is not None:
            if effect["duration"] != "caster_next_turn":
                err(f"spell {sid}: unknown duration {effect['duration']}")
            if not effect["modifiers"]:
                err(f"spell {sid}: effect with no modifiers")
            for m in effect["modifiers"]:
                if m["kind"] not in MODIFIER_KINDS:
                    err(f"spell {sid}: unknown modifier kind {m['kind']}")
                if m["resultType"] not in RESULT_TYPES:
                    err(f"spell {sid}: unknown result type {m['resultType']}")

    # A species spell belongs to an imported species -- checked above against units.json,
    # which is what tools/species.py puts there. Twenty-two spells: the starter set's
    # eighteen, the Coral Elves' two (v2 Phase 5e) and the Dwarves' two (v2 Phase 6g); a
    # later species' phase moves this number.
    if len(doc["spells"]) != 27:
        err(f"expected 27 spells in scope, found {len(doc['spells'])}")


def main():
    check_units()
    check_terrains()
    check_dragons()
    check_spells()

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
    if spells_unbuilt:
        print(f"    {len(spells_unbuilt)} spell(s) transcribed but not implemented: "
              + ", ".join(sorted(spells_unbuilt)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
