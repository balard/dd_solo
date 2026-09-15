# CLAUDE.md

Solo-play app for the dice game **Dragon Dice**. Human plays one side, the app runs the board,
the dice and the opponent.

> **Status: Phase 2 done.** Data layer, engine types, seeded RNG, presets, `setupGame`,
> `validateState` and `rollArmy` are in. The reducer is still a skeleton: it guards actions
> against `state.pending` but no phase is implemented, so nothing is ever pending yet.
> `docs/PLAN-V0.md` Phase 3 (damage) is next.

## Read these first

| File | What it is |
|---|---|
| `docs/RULES-V0.md` | **Normative spec for the alpha.** The exact rule subset, the house rules, and what was cut. This wins over the rulebooks where they differ. |
| `docs/PLAN-V0.md` | **The order of work.** Nine phases to a playable alpha, each with an exit criterion and its tests. Start here when writing code. |
| `docs/OVERVIEW.md` | Technology choice, engine architecture, AI ladder, UI thinking. The *why* behind the plan. |
| `data/ICONS.md` | The die-face vocabulary. Required before touching `data/`. |
| `docs/rules/starter-treefolk-vs-firewalkers.pdf` | The Kickstarter starter rules — the v1.0 release target. |
| `docs/rules/dragon-dice-v4.01-full-rules.pdf` | Full v4.01 rules. Fallback for anything the starter book leaves vague. |

Both PDFs are text-extractable: `pdftotext -layout <file> -` (available in the Git Bash environment).

## Stack

TypeScript + Vite + React, shipped as a PWA; Capacitor wraps the same build into an APK later.
Vitest for tests.

```bash
npm run dev         # dev server on :5173
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production build
npm run data        # regenerate and validate data/starter/ from data/raw/
```

`tsconfig.json` is deliberately strict — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
and `verbatimModuleSyntax` are all on. Keep `vitest` and `vite` on compatible majors: a mismatch
makes vitest install a nested copy of vite, and the two `Plugin` types then conflict under
`exactOptionalPropertyTypes`.

## Layout

```
src/engine/    pure TS rules engine — no React, no DOM, no I/O, no Math.random
src/ai/        pure TS opponents — depends on engine types only
src/ui/        React — depends on engine; engine must never depend on this
data/          die-face JSON + schemas (content, not code)
docs/          specs and rulebooks
tools/         data pipeline (import, validate, fetch reference art)
```

## Invariants

These are the things that break the project if violated:

1. **The engine is a pure reducer.** `reduce(state, action) => state`. No side effects, no clocks,
   no ambient randomness. Randomness comes from a seeded PRNG whose seed *and counter* live in
   `GameState`, so replaying the action log reproduces a game die for die.
2. **The engine never imports from `src/ui/`.** One-way dependency, always.
3. **Every blocked point is an explicit `state.pending`** — `{ player, kind, options }`. The UI
   renders from it, the AI switches on it. Do not add wizard state to components, and do not let
   the AI reach into the engine's internals.
4. **Damage kills whole units; it does not reduce hit points.** The defender picks a subset of
   units whose total health is ≤ the damage and is **maximal**. Excess damage is lost. Any
   non-maximal assignment must be rejected by the reducer. See `RULES-V0.md` §6 — this is the rule
   most often gotten wrong by reflex.
5. **Scope is controlled by the `RuleSet` config**, not by scattered `if`s. Alpha values:
   `magic: 'simplified'`, `sai: 'inert'`, `eighthFace: 'captureOnly'`, `dragons: false`.
   Adding a cut feature means implementing behind its flag, not deleting a condition.
6. **Die faces are data, in `data/`, validated against the schemas.** Never hard-code a die's
   faces in TypeScript.
7. **A face carries a count of icons, not one icon.** The count is already the final answer:
   every ID face's count equals its unit's health and every normal monster face's count is 4
   (verified across all 280). So `rollArmy` never special-cases ID or monsters — if you are
   writing `if (size === 'monster')` in the roller, the data is already doing it for you. `2 MELEE` on a 1-health unit generates two
   `2 MELEE` on a 1-health unit generates two melee results. Counts follow no reliable formula —
   the 2-health Treefolk `Oak` has a `4 SAVE` face. Treating a face as a single result makes every
   damage number in the game wrong.
8. **Never ship SFR's icon or dice art.** Use our own SVG glyphs. See `OVERVIEW.md` §5.

## Alpha house rules (easy to forget)

- **Magic is a melee variant**: same terrain only, roll magic, `damage = floor(total / 2)`. No
  save roll, no counter-attack. Elements ignored.
- **No magic from reserves**, so a Reserve Army cannot march at all in v0.
- **SAI faces produce zero results** — but the face is still stored as `<count> SAI:<Name>`.
  That count is a result count for some SAIs and an X parameter for others (`2 SAI:Flame` targets
  two health-worth of units), so let each SAI interpret its own number.
- **Eighth face captures and wins** (two captures = victory), but grants **no** icon powers and
  **no** ID doubling.
- **No dragons, no spells, no promotion, no burying.**

## Die data

Pipeline — `data/raw/` is the source of truth, `data/starter/units.json` is **generated**:

```bash
python tools/import_faces.py      # data/raw/<species>.faces.txt -> data/starter/units.json
python tools/import_terrains.py   # data/raw/terrains.faces.txt  -> data/starter/terrains.json
python tools/validate_data.py     # schema + semantic checks; exit 1 on error
python tools/fetch_faces.py       # optional: mirror reference art into assets/faces/
```

Never hand-edit `data/starter/units.json` — edit the raw file and re-import. Re-running the
importer is always safe. Format and vocabulary: `data/ICONS.md`.

**Status: complete.** 40 unit dice (280 faces) and 12 terrain dice (3 types × 4 eighth-face
variants), all passing validation. Nothing is `TODO`.

**A terrain die is a type plus an eighth-face icon.** Faces 1–7 come from the type, face 8 from the
icon. Every type runs magic → missile → melee as the face number rises, but the split points differ
(Wasteland has one magic face, Highland three) — that is most of what distinguishes them.

**The leading number means different things in the two raw formats.** In unit files `2 Melee` is an
icon *count*; in the terrain file `7 Melee` is a *face number*. Separate files, separate importers,
easy to confuse.

Neither rulebook contains machine-readable faces, and Dice Commander's face *data* is behind an
authenticated API (`/api/me` → 401) — only the face *art* is public. So: **do not invent face
data, and do not guess the terrain face layout**, including the plausible-sounding assumption that
low faces are magic and high faces are melee. Leave `TODO` and say so.

## Engine notes

- **Armies are derived, not stored.** A unit has a `location`; `armyAt(state, player, slot)` is a
  query. Home/Campaign/Horde are setup vocabulary only. Never add a parallel army or DUA list —
  the absence of one is what makes desync impossible.
- **`rollArmy` has no special case for ID icons or monsters, and must not grow one.** The count
  printed on the face is already the answer. `faceResults` is three lines; keep it that way.
- **`setupGame` runs the Horde roll-off** when `firstPlayer` is omitted, threading one RNG stream
  in rules order: roll-off first, then terrain faces.
- **Not yet in `rollArmy`: the eighth-face ID-doubling bonus.** Cut in v0; it belongs in that
  function when `ruleSet.eighthFace` becomes `'full'`.
- **Terrain `face === 8` and `capturedBy !== null` must always agree.** `validateState` enforces
  it; both the win check and the revert-to-7 rule depend on it.
- **`advance` throws after 1000 steps** rather than hanging. If you hit that, a phase handler is
  failing to either reach a decision or change the state.

## Conventions

- Prefer narrow, named types over primitives — `PlayerId`, `TerrainId`, `Health` — because the
  engine passes a lot of small integers around and mixing them up is silent.
- Rules tests read as scenarios: build a state, apply an action list, assert. Combat and damage
  assignment get tests before implementation.
- Keep `docs/RULES-V0.md` §8 and `docs/OVERVIEW.md` §8 current. When a rules question gets
  answered, move it out of Open Questions and into the body.
