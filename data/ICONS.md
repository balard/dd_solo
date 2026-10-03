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
25 SAIs documented in the starter rulebook (pp. 10–11) — no more, no fewer. Each later species adds
the SAIs its v4.01 species page lists (`SPECIES_SAIS` in `tools/species.py`; Coral Elves add six,
Dwarves four, Goblins five).
The validator holds the union and errors on anything outside it, which catches transcription typos.

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

## Dragon dice (`data/starter/dragons.json`)

**The number is a face number here too**, as on terrain dice and unlike unit dice — a dragon face
carries no count at all. Its numbers are in the rules, not on the die: Jaws is always 12 damage
whichever dragon rolled it, so there is nothing per-face to record.

A dragon die is an **element** plus a **form** (`drake` or `wyrm`), and the form fixes all twelve
faces. 5 elements × 2 forms = 10 dice. Only the breath differs by element, so the generated JSON
stores each form's faces once and lists the dice as combinations — the same shape as a terrain die,
though for a different reason (there it is the eighth face that varies).

| Form | Jaws | Breath | Claw | Belly | Wing | Tail | Treasure |
|---|---|---|---|---|---|---|---|
| Drake | 1 | 1 | 4 | 2 | 2 | 2 | — |
| Wyrm | 1 | 1 | 4 | 2 | — | 3 | 1 |

**The two forms are not a base layout plus one variant face.** A wyrm spends the drake's two wings
on a third tail *and* a treasure chest. Guessing from "drakes have wings, wyrms have a treasure
chest" (full rules p. 17 — the only structural hint either rulebook gives) would have produced a
wyrm with two treasures, and nothing in the books would have contradicted it. These layouts are
transcribed from real dice.

Face effects are full rules p. 20: `JAWS` 12 damage, `CLAW` 6, `TAIL` 3 and roll again, `WING` 5
and fly home if it survives, `BELLY` disables that dragon's own five automatic saves for the
attack, `TREASURE` promotes one unit of the army it is attacking, and `BREATH` kills five
health-worth plus the element's own effect. Breath is **five SAIs sharing one icon**, one per
element, because a hybrid dragon applies both of its elements' effects off the one face.

The validator checks exactly one Jaws and one Breath per form, that wings belong to drakes and the
treasure chest to wyrms, and that all ten dice exist.

## Elements

`air` (blue), `water` (green), `earth` (yellow), `fire` (red), `death` (black), `ivory` (none).

**Live since v1 Phase 7.** Under `magic: 'spells'` a species' two elements are what its army's
magic may be spent as, and a terrain's are what a Standing Stones widens that to; a spell's own
element is in `data/spells.json`, not here. Under `magic: 'simplified'` they are still stored and
ignored, which is what `V0_RULES` plays. `death` and `ivory` belong to dice out of scope (Phase 6's
dragons are the five basic elements only) and no spell names either.

## Pipeline

```
data/raw/<species>.faces.txt  --[ tools/import_faces.py ]-->  data/starter/units.json
data/raw/terrains.faces.txt   --[ tools/import_terrains.py ]-->  data/starter/terrains.json
data/raw/dragons.faces.txt    --[ tools/import_dragons.py ]-->  data/starter/dragons.json
                                                                        |
                                                      tools/validate_data.py -> pass/fail
```

**Only species named in `tools/species.py` are imported.** A raw file for any other species sits
in `data/raw/` untouched, transcribed ahead of the phase that needs it (v2 has eight). And an
imported species is not yet a *playable* one: the engine hands out a species' dice only once every
SAI on them has a handler and its species abilities are known (`src/engine/playable.ts`).

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

`python tools/fetch_faces.py` mirrors the real icon SVGs into `public/faces/` — the only directory
Vite serves — and into `assets/faces/` as the offline copy. Both are gitignored. Reference only:
the app ships our own glyphs and is complete without any of this.

**Dragon faces are the exception to "per species".** They live under `dragons/sais/` and are keyed
by *form*, not element: all five drakes print the same twelve images, verified by every
`-<element>-` spelling returning 404. They are also drawn in **white**, for a dark die, where the
unit art is black — so the UI flattens them with `brightness(0)` exactly as it does terrain art.

The remote asset set is **sparse, per-species, and not derivable from (icon, count)**. It mirrors
exactly the faces that species actually has: `treefolk/save-4.svg` and `treefolk/magic-4.svg` exist
because Treefolk dice carry those faces, while the same paths under `firewalkers/` are 404 because
no Firewalker die does. Some icons also carry a variant index (`maneuver-1-4`, `cantrip-1-3`,
`trample-1-m` vs `trample-2-m`), and monster faces use a `-m` suffix. So the fetcher tries a
fallback chain per face rather than computing a filename.

A useful consequence: **the asset listing is a weak independent oracle for the face data.**
Probing which `<species>/<icon>-<n>.svg` exist tells you which (icon, count) pairs appear somewhere
in that species — not which die carries them, but enough to catch an invented or mistyped count.
