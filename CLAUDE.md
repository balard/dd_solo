# CLAUDE.md

Solo-play app for the dice game **Dragon Dice**. Human plays one side, the app runs the board,
the dice and the opponent.

> **Status: v0 alpha complete.** All nine phases of `docs/PLAN-V0.md` are done. The game is
> playable in the browser (`npm run dev`), in the terminal (`npm run play`), installable as a PWA,
> and resumes where you left off. Since the alpha landed, the board grew to show every army at
> once and the eighth face started granting its two standard advantages (`eighthFace: 'standard'`).
>
> Next is the v1 ladder — SAIs, then the eighth-face **icon** powers, then spells, then dragons —
> each a `RuleSet` flag with a home already prepared. Worth knowing before picking one up: **every
> terrain in both starter presets is a Tower** (`swampland_tower`, `highland_tower`,
> `wasteland_tower`), so Tower's "may attack any terrain in play during a missile action" is the
> *only* icon power reachable in this matchup. It is also the smallest of the four — one condition
> inside `missileTargets` — which makes it a cheap way to finish the eighth face for the starter
> set long before City, Temple and Standing Stones become reachable.

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
npm run art         # optional: mirror real face art into public/faces/ (gitignored)
npm run play        # play a game in the terminal (--seed N, --ai random)
```

**`npm test` is slow on purpose** — around 30-50s, most of it the 1000-game fuzz and the replay
check that replays 25 full games. `vite.config.ts` sets `testTimeout: 30_000` because vitest's 5s
default fails those outright; do not read a long run as a hang, and do not lower it back. A real
hang still fails fast on its own, since `advance` throws after 1000 steps.

On Windows PowerShell these may fail with `npm.ps1 cannot be loaded because running scripts is
disabled`. That is the shell's execution policy, not the project. Use `npm.cmd ...`, or `.\play.cmd`
for the client — the `.cmd` shims bypass it without changing any machine setting.

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
   `magic: 'simplified'`, `sai: 'inert'`, `eighthFace: 'standard'`, `dragons: false`.
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
8. **Never commit SFR's icon or dice art, and never let the app depend on it.** `npm run art`
   mirrors it into the gitignored `public/faces/`; every face falls back to our own glyphs when
   that is missing, so a fresh clone is a complete game. Note that `npm run build` copies
   `public/faces/` into `dist/` — delete it before publishing a build. See `OVERVIEW.md` §5.

## Alpha house rules (easy to forget)

- **Magic is a melee variant**: same terrain only, roll magic, `damage = floor(total / 2)`. No
  save roll, no counter-attack. Elements ignored.
- **No magic from reserves**, so a Reserve Army cannot march at all in v0.
- **SAI faces produce zero results** — but the face is still stored as `<count> SAI:<Name>`.
  That count is a result count for some SAIs and an X parameter for others (`2 SAI:Flame` targets
  two health-worth of units), so let each SAI interpret its own number.
- **Eighth face captures and wins** (two captures = victory) **and grants its two standard
  advantages**: the holder's army doubles all ID results when rolling *anything* there — attack,
  save or maneuver — and may take melee, missile or magic, while any army facing them at that
  terrain is restricted to melee. Still cut: the icon powers (City, Standing Stones, Temple,
  Tower), which is what `eighthFace: 'full'` will add.
- **No dragons, no spells, no promotion, no burying.**

## Die data

Pipeline — `data/raw/` is the source of truth, `data/starter/units.json` is **generated**:

```bash
python tools/import_faces.py      # data/raw/<species>.faces.txt -> data/starter/units.json
python tools/import_terrains.py   # data/raw/terrains.faces.txt  -> data/starter/terrains.json
python tools/validate_data.py     # schema + semantic checks; exit 1 on error
python tools/fetch_faces.py       # optional: mirror reference art into public/faces/ (--offline: from assets/faces/)
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
- **ID doubling lives in `rollArmy`, not `faceResults`.** It is a fact about the board, not the
  face: the same die doubles or not depending on where it stands, so `faceResults` stays a pure
  face-to-results function and the bonus rides in on `rollArmy`'s `doubleIds` flag. Every call site
  that rolls *at a terrain* must pass `doublesIds(state, player, slot)` — attacks, saves and
  contested maneuvers all count as "rolling the army". It consumes no extra randomness, so a game
  replays die for die either way; only the totals change.
- **Terrain `face === 8` and `capturedBy !== null` must always agree.** `validateState` enforces
  it; both the win check and the revert-to-7 rule depend on it.
- **Damage assignment must be maximal, and greedy does not find it.** 4 damage against units of
  3, 2, 2 must kill `{2,2}`, not the 3. Use `maxAbsorbable` / `chooseMaximalSubset` in
  `damage.ts`; never hand-roll a largest-first loop.
- **An attack has two ends, and the log must name both.** `action_chosen` carries `fromSlot` (the
  marching army's own terrain) and `toSlot` (what it is aimed at); `combat_resolved` likewise
  carries `attackerSlot` and `defenderSlot`. They match for melee and magic, which hit the army
  facing them, and differ for missile and for a counter, which reverses them. So the log reads
  "You do a Melee attack at Frontier" or "a Missile attack from Frontier to Your home".
  - **Missile's `action_chosen` is logged in `applyMissileTarget`, not `applyChooseAction`** —
    the target is not chosen yet at declaration time, so logging it there would leave the one
    action that *can* name a second terrain as the only one unable to.
  - These were a single `slot` field, which rendered as "attacks with missile at Enemy home":
    read as the target, meant the origin, and dropped the target entirely. Name both ends.
- **`applyDamage` does not check for victory.** The caller does, because the win check runs after
  every state change.
- **`applyAction` clears `pending` and must never set one; `stepGame` is the only thing that sets
  it.** This is why the victory check runs after every state change: an action leaves `pending`
  null, so `advance` always runs `stepGame` at least once afterwards. Set `pending` inside
  `applyAction` and `advance` returns early, silently skipping the win check.
- **Maneuvering is three steps** — declare, contest, direction — because the opponent must decide
  whether to contest without knowing the direction. Do not collapse them.
- **A zero attack roll makes no save roll at all** (`saveTotal: null`), and consumes no
  randomness. Magic never allows a save whatever it rolls.
- **No `assign_damage` decision is raised when `maxAbsorbable` is 0** — damage too small to kill
  anything is simply dropped.
- **`advance` throws after 1000 steps** rather than hanging. If you hit that, a phase handler is
  failing to either reach a decision or change the state.

## AI and replay

- **`AiPlayer` is `decide(state, pending, rng) => [action, rng]`.** Randomness is threaded, never
  ambient, so a run is reproducible from `{ seed, aiSeed }` alone.
- **`PassiveAI` starts nothing but is not inert** — it answers every forced decision and *does*
  contest maneuvers and counter-attack. Do not "simplify" it into a no-op: that would leave the
  save/damage/counter and contest paths untested, and an opponent that waves every maneuver through
  is not passive, it is surrendering the terrain track. Both answers are free — it never had another
  use for those dice — and the engine only asks when it actually has an army at that terrain.
- **Changing an AI does not need a `SAVE_VERSION` bump.** A record stores the actions the AI
  *produced*; replay applies them and never calls `decide`. Old saves therefore replay identically.
  Bump for changes to phases, decision order or dice consumption — not for strategy.
- **`RandomAI` is a test tool, not an opponent.** `runGame` + 1000 seeded self-play games is the
  cheapest bug detector here; a `stoppedBecause === 'stuck'` result means the machine ran out of
  moves without ending, and is always a bug.
- **A game record is `{ setup, actions }` and nothing else.** Replaying it reproduces the game die
  for die. `replayTo(record, n)` is undo.

## UI

- **Every screen renders from `state.pending`.** `promptFor(pending, human)` turns it into a
  sentence and the legal buttons; no component decides what is legal or tracks where it is in a
  multi-step move.
- **The dice grid is also the selection surface** for damage, retreat and reinforce. One gesture,
  no modals.
- **Logic lives in pure functions in `prompts.ts`, not in components.** `damageSelection` is the
  example: the confirm-button rule is testable without a DOM. Keep it that way rather than
  reaching for jsdom.
- **A selection is a draft answer to one question** — `App` clears it whenever `pending` changes.
- **Glyphs are ours** (`Glyph.tsx`), stroked in `currentColor` on a 24x24 grid, so colour and dark
  mode come from CSS and no glyph needs a second variant.
- **Real face art is used where it is big enough to read**, via `FaceArt` / `useFaceArt`: the die
  inspector and the terrain sheet at 44px, the roll strip at 30px, terrain chips at 28px. Below
  about 30px it is worse than a glyph — measured, not assumed — so small sizes stay glyphs.
- **The UI never computes an art filename.** The remote set is sparse and not derivable from
  (icon, count), so `tools/fetch_faces.py` resolves it and writes a manifest keyed by
  `<unitTypeId>#<faceIndex>`. Add a face, re-run `npm run art`.
- **A unit tile does two jobs.** When a decision needs units chosen it selects; otherwise tapping
  *inspects*, opening the die to show every face it has. Without that the app showed outcomes but
  never capabilities — you could watch a die roll but not find out what it could roll.
- **A tile is identified by its ID face, not its name, and the whole tile is the die.** The button
  goes square and its side scales with die size — `TILE_SIZE` 48/54/60/70 around `PORTRAIT_SIZE`
  30/34/38/46 for small/medium/large/monster — because a big portrait in a name-shaped box does not
  read as a bigger die. Consequences worth knowing:
  - **Class badge and health are corner-positioned**, or their text would set the width and
    flatten the size difference back out.
  - **The badge shows unit class (HM/LM/MI/CA/MA), not size.** It read S/M/L/M+, which the health
    digit already states exactly (size *is* health: 1/2/3/4) and the tile's own size states a
    third time; class is the one thing about a die nothing else on the tile shows. It is **plain
    text, deliberately** — colour on the dice is reserved for the species elements.
  - **A grid is ordered by `orderedForDisplay`**: grouped by class in HM, LM, MI, CA, MA order,
    heaviest die first inside each group, name as a stable tiebreak so identical dice sit together
    and nothing shuffles between renders. Presentation only — selection is by unit id and damage
    suggestions come from the engine, so no rule depends on it.
  - **`.dice-grid` is `align-items: flex-end`.** The default `stretch` equalises heights and erases
    the whole effect; flex-end also makes the dice sit on one line, like on a table.
  - **Two floors box the numbers in**: 30px of art (below that a glyph reads better — measured,
    `OVERVIEW.md` §5) and a 44px tap target. So `small` sits on both floors and the spread comes
    from raising the larger sizes, never from shrinking the small one.
  - **The tooltip says what the die *is*** — `describe()` gives "Darktree — monster heavy melee".
    No health: size *is* health here (small 1, medium 2, large 3, monster 4, across all 40), so
    printing both says it twice. The corner digit stays, where it does arithmetic during damage.
  - **The name still has to reach assistive tech**, so `aria-label` carries the same line.
  - **Without art every ID face draws the same glyph**, which would make the tiles
    indistinguishable — so when `useFaceArt` has no URL the tile falls back to the *name* and its
    original row shape, not to a glyph. Check that path by moving `public/faces/manifest.json`
    aside; it is the fresh-clone experience and invariant 8 depends on it.
  - **`.die-portrait` is a plain `<img>`, not `FaceArt`**, so it must be named explicitly in the
    dark-mode invert rule beside `.face-art`. Miss it and the portraits go dark on dark.
- **A terrain is inspected from the focus heading**, the same gesture a unit tile uses, opening
  `TerrainDetail` — all eight faces, the current one marked, face 8 dashed because it comes from
  the die's eighth-face icon rather than its type. This is the only place the three terrain types
  visibly differ: they all run magic → missile → melee, but Wasteland has one magic face and
  Highland three, and you cannot judge whether turning a terrain up helps you without seeing it.
- **Terrain art is flattened to one ink colour** (`brightness(0)`, inverted in dark mode). SFR
  draws the three terrain *magic* faces in deep pink `#FF1493` while every other terrain face is
  pure black; left alone the pink reads as emphasis the rules do not intend. `brightness(0)`
  collapses any hue, so it needs no per-file targeting and survives re-running `npm run art`.
  Unit art is *not* tinted — it is already black line work.
- **The board shows every army, all the time.** `Board` renders three terrain cards, each with the
  enemy and your dice on it; ≥900px puts them in three columns, narrower stacks them. It replaced
  a compact strip plus one expanded "focused" terrain, where judging a move meant tapping between
  terrains and holding the other two in your head — the thing a board exists to stop.
  - **`focused` is now only a highlight**, marking which terrain the current decision is about.
    There is no "look elsewhere" any more, so the manual-focus state and its reset effect are gone.
  - **Selectability is per terrain**, via `selectableAt` in `prompts.ts`. `slot: null` means "my
    units wherever they stand" (a retreat); a damage assignment names one terrain and must leave
    the other two alone. While only one terrain was on screen, "selectable" and "selectable
    *here*" were the same question and the distinction did not exist.
- **The log is newest-first and sits below the board**, full width, inside the one page scroller
  (`.page`). It had its own column beside the board, which giving every terrain its dice left no
  width for. Newest-first replaced an auto-scroll that had to pin after every commit, again when
  late art changed the height, and again when the grid row resolved: the entry you want is now
  where an unscrolled pane already is. It is reversed in JS, not with
  `flex-direction: column-reverse`, so DOM order matches visual order for a screen reader.
- **Elements are shown, not just stored.** `ElementDots` renders the species and terrain elements
  that have been in the data since transcription. They do nothing in v0 (no spells) but they are
  what makes the board legible at a glance.

## Saving

- **A save is `{ setup, actions }` replayed on load, never a serialised state.** A few KB however
  long the game runs, and it doubles as a reproducible bug report.
- **Bump `SAVE_VERSION` in `storage.ts` whenever a change would make old action logs replay
  differently** — new phases, changed decision order, altered dice consumption. A mismatch is
  discarded with a message rather than replayed into a wrong game.
- **Wrap every `localStorage` access.** It throws in private windows, with site data blocked, and
  on a full quota. A game that cannot be saved must still be playable.

## Conventions

- Prefer narrow, named types over primitives — `PlayerId`, `TerrainId`, `Health` — because the
  engine passes a lot of small integers around and mixing them up is silent.
- Rules tests read as scenarios: build a state, apply an action list, assert. Combat and damage
  assignment get tests before implementation.
- Keep `docs/RULES-V0.md` §8 and `docs/OVERVIEW.md` §8 current. When a rules question gets
  answered, move it out of Open Questions and into the body.
