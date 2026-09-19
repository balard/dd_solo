#!/usr/bin/env python3
"""Build data/starter/dragons.json from data/raw/dragons.faces.txt.

A dragon die is an ELEMENT plus a FORM (drake or wyrm). The form fixes all twelve
faces, so -- exactly as import_terrains.py does for a terrain type -- the generated
file stores each form's faces once and lists the dice as combinations.

Careful: as in the terrain file, the leading number on a face line is the FACE
NUMBER, not an icon count. A dragon face is a fixed named ability, not a count of
result icons.

Usage:  python tools/import_dragons.py
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "dragons.faces.txt"
OUT = ROOT / "data" / "starter" / "dragons.json"

# Only the five base elements. Ivory and White dragons are out of scope: neither is
# one element, and both change the rules rather than just the breath (full rules
# p. 17). See docs/PLAN-V1.md Phase 6.
ELEMENTS = ["air", "death", "earth", "fire", "water"]

FORMS = {"drake", "wyrm"}

ICONS = {"JAWS", "BREATH", "CLAW", "BELLY", "WING", "TAIL", "TREASURE"}

FACE_COUNT = 12

FACE_RE = re.compile(r"^([0-9]{1,2})\s+(.+?)$")


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
            if len(words) != 2:
                raise ValueError(f"bad header {line!r}: expected '<element> <form>'")
            element, form = slug(words[0]), slug(words[1])
            if element not in ELEMENTS:
                raise ValueError(f"unknown dragon element {element!r}")
            if form not in FORMS:
                raise ValueError(f"unknown dragon form {form!r}")
            header, faces = (element, form), {}
    flush()
    return dice


def main():
    dice = parse()
    forms, dragons, errors = {}, [], []

    for (element, form), faces in dice:
        numbers = [str(n) for n in range(1, FACE_COUNT + 1)]
        missing = [n for n in numbers if n not in faces]
        if missing:
            errors.append(f"{element} {form}: missing faces {missing}")
            continue
        extra = [n for n in faces if n not in numbers]
        if extra:
            errors.append(f"{element} {form}: face numbers out of range {sorted(extra)}")
            continue

        for n, icon in faces.items():
            if icon not in ICONS:
                errors.append(f"{element} {form}: face {n} is {icon!r}, not a dragon icon")

        # A wyrm has a treasure chest and no wings; a drake is the other way round
        # (full rules p. 17). That is the one structural fact about the two forms
        # either rulebook states, so it is worth failing on.
        if form == "wyrm" and "WING" in faces.values():
            errors.append(f"{element} wyrm: wyrms have no wings")
        if form == "drake" and "TREASURE" in faces.values():
            errors.append(f"{element} drake: drakes have no treasure chest")

        # Every element of a form carries the same twelve faces; only the breath
        # effect differs. Two transcriptions that disagree mean one is wrong.
        if form in forms:
            if forms[form]["faces"] != faces:
                errors.append(f"{element} {form}: faces disagree with the other {form} dice")
        else:
            forms[form] = {"name": form.title(), "faces": faces}

        dragons.append({
            "id": f"{element}_{form}",
            "element": element,
            "form": form,
        })

    missing_forms = sorted(FORMS - set(forms))
    if missing_forms:
        errors.append(f"no dice transcribed for form(s) {missing_forms}")
    missing_dice = [f"{e}_{f}" for e in ELEMENTS for f in sorted(FORMS)
                    if not any(d["id"] == f"{e}_{f}" for d in dragons)]
    if missing_dice:
        errors.append(f"missing dragon dice: {missing_dice}")

    if errors:
        for e in errors:
            print(f" ERROR: {e}")
        return 1

    doc = {
        "$schema": "../schema/dragon.schema.json",
        "_generated": "by tools/import_dragons.py from data/raw/dragons.faces.txt -- DO NOT EDIT BY HAND",
        "_comment": "All twelve faces live on the dragon form; a die is an element plus a form. "
                    "Only the breath effect differs by element (full rules p. 20).",
        "dragonForms": forms,
        "dragons": dragons,
    }
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"wrote {OUT.relative_to(ROOT)}: {len(forms)} forms, {len(dragons)} dice")
    for fid, f in forms.items():
        profile = [f["faces"][str(n)] for n in range(1, FACE_COUNT + 1)]
        counts = {i: profile.count(i) for i in sorted(ICONS) if profile.count(i)}
        print(f"  {fid:6s} " + "  ".join(f"{i.lower()} {c}" for i, c in counts.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
