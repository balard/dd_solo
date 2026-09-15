# Face vocabulary

## The thing to get right

**A face is not one icon.** A face carries a *count* of icons, and that count is what the face
generates. The Firewalker `Guardian` — a 1-health small unit — has a face reading `2 MELEE`.

So every face is written **`<count> <ICON>`**.

Counts broadly scale with size, but not by a formula you can rely on: most faces carry at most
health+1 icons, yet the Treefolk `Oak` (2 health) has a `4 SAVE` face. Transcribe, never compute.

Getting this wrong makes every damage number in the game wrong, which is why the validator
enforces it.

## Unit dice (`data/starter/units.json`)

| Form | Meaning |
|---|---|
| `<n> ID` | The unit's identity icon. Generates `n` of whatever result is being rolled for, where `n` is the unit's health. Every unit die has **exactly one** ID face. |
| `<n> MELEE` | `n` melee results. |
| `<n> MISSILE` | `n` missile results. |
| `<n> MAGIC` | `n` magic results. |
| `<n> SAVE` | `n` save results. |
| `<n> MANEUVER` | `n` maneuver results. |
| `<n> SAI:<Name>` | A Special Action Icon, e.g. `4 SAI:Smite`, `2 SAI:Flame`. |
| `TODO` | Not yet transcribed. |

**On monsters**, every normal icon counts as 4, so monster faces all read `4 X`.

**SAI names must match the rulebook.** The starter set's two species between them use exactly the
25 SAIs documented in the starter rulebook (pp. 10–11) — no more, no fewer. The validator holds
that list and errors on anything outside it, which catches transcription typos.

**The count on an SAI face is not always a result count.** For result-generating SAIs it is
(`4 SAI:Smite` = 4 smite results). For targeting SAIs it is the SAI's **X parameter** —
`2 SAI:Flame` means Flame targeting *two health-worth* of units, not two results. The engine must
let each SAI interpret its own `n`. The validator warns rather than errors on monster SAI faces
whose count isn't 4, for exactly this reason.

**SAIs are inert in v0.** An `SAI:*` face produces zero results. We still record the real name and
count so enabling SAIs later is a pure engine change with no re-transcription. Use the exact names
from the starter rulebook (pp. 10–11) or the full rules (pp. 31–43).

Face counts: small/medium/large are d6 (6 faces), monsters are d10 (10 faces).

## Terrain dice (`data/starter/terrains.json`)

**Watch the number.** In the terrain raw file the leading number is the **face number** (1–8), not
an icon count. `7 Melee` means *face 7 shows melee*. This is the opposite of the unit files, where
`2 Melee` means *two melee icons on one face*. Same syntax, different meaning — which is why the
two live in separate files with separate importers.

A terrain die is a **terrain type** (which fixes faces 1–7) plus an **eighth-face icon**. The four
eighth-face variants of a type are identical on faces 1–7, so the generated JSON stores each type's
faces once and lists the dice as combinations. 3 types × 4 icons = 12 dice.

Faces 1–7 carry `MELEE`, `MISSILE` or `MAGIC`. Low number = armies far apart, high = close, and
every die runs magic → missile → melee as the number rises. **The split points differ per type**,
and that difference is most of what distinguishes these dice:

| Type | Elements | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| Swampland | water + earth | magic | magic | missile | missile | melee | melee | melee |
| Highland | fire + earth | magic | magic | magic | missile | missile | melee | melee |
| Wasteland | air + fire | magic | missile | missile | melee | melee | melee | melee |

Face 8 is the eighth face: `city`, `standing_stones`, `temple` or `tower`. **Recorded but inert in
v0** — capturing wins the game, but the icon grants nothing (see `docs/RULES-V0.md` §2).

The validator enforces the magic → missile → melee ordering and checks that all four eighth-face
variants of each type agree on faces 1–7.

## Elements

`air` (blue), `water` (green), `earth` (yellow), `fire` (red), `death` (black), `ivory` (none).

Unused in v0 (no spells), recorded now so the spell system can be added without touching the data.

## Pipeline

```
data/raw/<species>.faces.txt  --[ tools/import_faces.py ]-->  data/starter/units.json
data/raw/terrains.faces.txt   --[ tools/import_terrains.py ]-->  data/starter/terrains.json
                                                                        |
                                                      tools/validate_data.py -> pass/fail
```

The `data/raw/` files are the source of truth and are hand-transcribed. The files under
`data/starter/` are **generated** and must never be hand-edited.

The raw format is a die header then one line per face, which is close enough to what Dice Commander
displays that transcription is mostly copy-paste:

```
heavy-small          # or the full .../ids/heavy-small.svg URL
1 ID
1 Melee
1 Save
1 Missile
2 Melee
1 Maneuver
```

Headers are `<class>-<size>` (`heavy-small`, `magic-large`) or `monster-<name>`
(`monster-gorgon`, `monster-strangle-vine`). Classes: `heavy`, `light`, `cavalry`, `missile`,
`magic`. Sizes: `small`, `medium`, `large`. Inline `#` comments and blank lines are ignored;
icon names are case-insensitive.

## Reference art

`python tools/fetch_faces.py` mirrors the real icon SVGs into `assets/faces/` (gitignored) for
every face our data references. Reference only — the app ships our own glyphs.

The remote asset set is **sparse, per-species, and not derivable from (icon, count)**. It mirrors
exactly the faces that species actually has: `treefolk/save-4.svg` and `treefolk/magic-4.svg` exist
because Treefolk dice carry those faces, while the same paths under `firewalkers/` are 404 because
no Firewalker die does. Some icons also carry a variant index (`maneuver-1-4`, `cantrip-1-3`,
`trample-1-m` vs `trample-2-m`), and monster faces use a `-m` suffix. So the fetcher tries a
fallback chain per face rather than computing a filename.

A useful consequence: **the asset listing is a weak independent oracle for the face data.**
Probing which `<species>/<icon>-<n>.svg` exist tells you which (icon, count) pairs appear somewhere
in that species — not which die carries them, but enough to catch an invented or mistyped count.
