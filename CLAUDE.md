# CLAUDE.md

Solo-play app for the dice game **Dragon Dice**. Human plays one side, the app runs the board,
the dice and the opponent.

> **Status: v0 alpha complete; v1 Phases 0–8 landed. The app plays every SAI, every eighth-face
> icon power, all five elemental dragons, all eighteen spells and all four species abilities --
> every rule in `PLAN-V1.md`. Phase 9 (UI and rules polish, six slices 9a-9f) has landed too; what
> is left is Phase 10 (`GreedyAI`, a real opponent).**
> All nine phases of `docs/PLAN-V0.md` are done.
> The game is playable in the browser (`npm run dev`), in the terminal (`npm run play`),
> and installable as a PWA. It opens on a screen that picks the two forces and the seed; saving is
> switched off while v1 lands, so a reload starts there too. Since the alpha landed, the board grew to
> show every army at once and the eighth face started granting its two standard advantages, then
> (Phase 5e) the icon powers themselves.
>
> **Phases 0, 1, 2 and 3 of `docs/PLAN-V1.md` are done.** Phase 0 landed in three commits: a golden
> corpus of 25 recorded games (Phase G), the rulebook's ten-step roll pipeline replacing the sum
> inside `rollArmy` (0b), and forces rolled from the seed with the Frontier placed by the roll-off
> loser (0a). **Phase 1 added `sai: 'results'`** — the twelve SAIs that only add results, plus
> Rend's reroll. **Phase 2 added `dua: 'active'`** — the BUA, the promotion/recruitment/burial
> machinery, and Rise from the Ashes' death trigger. **Phase 3 added `state.effects`** — effects with a duration, the Effects Expire Phase, and
> `armyRoll` as the one door an army roll goes through; it is the first phase with **no `RuleSet`
> flag**, because nothing produces an effect until Phase 4 and a flag would have gated nothing. The
> ladder after it is targeting SAIs, eighth-face **icon** powers, spells, then dragons.
>
> **Each landed phase's findings are written up in `PLAN-V1.md` under its own heading** — what that
> section got wrong before it was built, and what would have shipped green. Phase 1's list is the
> one to read before starting Phase 4: three of its five bugs are the same shape, and Phase 4 meets
> all three again. Phase 2's says why Wild Growth moved out of it and into Phase 4, and Phase 3's
> says why Sleep and Galeforce followed — **Phase 4 now owns five SAIs that all need one pause or
> another in the middle of a roll**, which makes that seam the whole of its first half.
>
> **Phase 4 landed in five slices.** 4a was the seam and nothing else: the roll split four ways with
> `resolveFaces` pure, an exchange split into an attack step and a save step, and `sai: 'full'`
> refusing per *name* rather than blanket. **4b added `sai_target` and `Flame`**, the first decision
> addressed to somebody other than the owner of the dice at stake. **4c added `Sleep` and
> `Galeforce`**, the first two things that write to `state.effects`. **4d added the five sub-roll
> SAIs** and with them `unitRoll` / `rollUnits`. **4e added the delayed effects — `Choke` and
> `Confuse` — plus `Wild Growth` and the free moves, and flipped the app to `FULL_RULES`.** The 25
> goldens replay byte-identical and unregenerated through all five.
>
> **The save roll is two steps now, like the attack roll**: the rulebook's step 2 is "when rolling
> for saves against an attack, Delayed Effects are applied now", and Choke's targets are "units that
> rolled an ID icon" -- a question about a roll, which cannot be asked any earlier. Both pauses hang
> off `CombatState`: `attack` from `resolve_*` to `resolve_*_damage`, `saves` from `resolve_*_saves`
> to the same place.
>
> **Nothing in `data/` throws any more.** 4e found that Cantrip and Dispel Magic had been misfiled
> as "needs spells" whole: Cantrip's first sentence is a plain result generator ("during a magic
> action, Cantrip generates X magic results") that belonged in Phase 1, and Dispel Magic's `Applies`
> column is *Special*, so it takes no part in any ordinary roll. Without that the flip would have
> crashed every force but four. The `'full'` refusal survives as the guard against a **new** SAI
> arriving with a new species.
>
> The ladder after this was eighth-face **icon** powers (Phase 5) and dragons (6), both landed
> below; spells (7) are next.

> **Phase 5 landed in five slices.** 5a transcribed Coastland, Feyland and Flatland, so all six
> basic terrain types (24 dice) are in the data. 5b replaced the species terrain profile with a
> draw: each Home Terrain is drawn uniformly from all 24 dice, and the Frontier is drawn from a
> terrain sharing an element with the roll-off loser's species -- so a board is no longer "both
> homes are Towers, the Frontier a City" the way Phase 0a left it, and `SpeciesProfile` is gone.
> `SAVE_VERSION` became 7 here, for dice consumption at setup and the two Eighth Face Phase
> decisions 5e was already known to add. **5c added the seam** -- `iconAt` / `resolvesIcon` -- and
> nothing else, the same shape 4a gave `sai: 'full'`. **5d added Tower**: any army may be missiled,
> including a Reserve Army, which counts no ID results; the cost was widening `TerrainSlot` to
> `ArmyRef` everywhere a defender's slot is named, two fields more than the plan's own table
> predicted (`sai_sub_roll`, `counter_suppressed`). **5e added City and Temple**, turned the Eighth
> Face Phase from a no-op into a single decision with no queue (at most one terrain can fire --
> two captures already win), and flipped `FULL_RULES` to `eighthFace: 'full'`. The 25 goldens
> replay byte-identical and unregenerated through all five slices.

> **Phase 6 landed in one pass** -- the first phase since Phase 3 that needed no slices, because
> the seam it wanted (`resolveFaces` pure, so the same faces resolve twice around a pause) was
> already built. Ten dragon dice are in `data/` behind `import_dragons.py`; `dragons.ts` holds the
> pure rules; `GameState.dragons` sits beside `effects`; `RollPurpose` gained the combination-roll
> member it has been promising since Phase 0b; and the Dragon Attack Phase is a five-step machine
> on `turn.dragonAttack` with four new `Pending` kinds. The app and the CLI played `DRAGON_RULES`
> from here until Phase 7, and the 25 goldens are still byte-identical and unregenerated -- every draw
> the phase adds is gated on `ruleSet.dragons`, which every recorded game has off.
>
> **Only elemental dragons, and only two on the board.** Five elements, drake and wyrm, no Hybrid,
> Ivory or White -- which is what collapses p. 18's six-row targeting table to one rule: attack a
> different-element dragon if one is here, never your own element, otherwise the marching army.
> **Each player seeds one dragon at the Frontier at setup** (a house rule, `RULES-V0.md` §14),
> because `Summon Dragon` is a Phase 7 spell and without a seed nothing could ever reach the board.
> **Retired in Phase 7c** -- gated on `magic !== 'spells'`, not deleted, so `DRAGON_RULES` is still
> playable. The trip is one-way: a dragon that goes home stays home.
>
> The ladder after this was species abilities (Phase 8, landed below), then the greedy AI (9).

> **Phase 7 landed in six slices, and `magic: 'spells'` is what the app plays.** The v0 magic house
> rule is gone: `floor(M / 2)`, the same-terrain restriction, the absent save roll, the absent
> counter-attack and the ban on Reserve magic all retire together, and elements stop being
> stored-but-ignored. `data/spells.json` holds all eighteen spells Treefolk and Firewalkers can
> cast; `magic.ts` holds the pool and `spells.ts` the rules. A magic action is **roll, announce every
> spell and target at once, then resolve them one at a time** -- the rulebook's own three steps, and
> the gap between the last two is where Dispel Magic lives. `SAVE_VERSION` is 9 and the 25 goldens
> are still byte-identical and unregenerated.
>
> **An army's magic is one number, not a per-element tally**, and that is the load-bearing fact of
> the whole system. Each unit's results "may be divided between that unit's elements" and a force is
> one species, so the total splits freely between two elements -- which is why `resolveFaces` is
> still pure and `GameState`-free, and why validating an announcement is a sum rather than a
> knapsack. It collapses the day two units in one army carry different colours, and nothing else does.
>
> **Phase 6's Frontier dragon seed retired in 7c**, gated on `magic !== 'spells'` rather than
> deleted: `Summon Dragon` is the route the base rules intend, but `DRAGON_RULES` is still playable
> and would otherwise ship a Dragon Attack Phase nothing could reach. The two orderings `dragons.ts`
> had been fixing in board order since Phase 6 are real decisions now.

> **Phase 8 landed in three slices, and `SPECIES_RULES` (= `V1_RULES`, every flag on) is what the
> app plays.** Treefolk have Rapid Growth and Replanting; Firewalkers have Air Flight and Flaming
> Shields (`species.ts`, `RULES-V0.md` §16). `SAVE_VERSION` is 10 and the 25 goldens are still
> byte-identical and unregenerated.
>
> **The Species Abilities Phase is a pass-through for this box.** The turn has its seventh phase,
> but none of the four abilities acts there: each fires at a seam that already existed. Rapid Growth
> is a pause inside the contested maneuver, Replanting is first in line in `killUnits`, Air Flight is
> a second destination in the Retreat Step, and Flaming Shields is a step-10 "counts as" on every
> melee roll the army makes at a fire terrain.

## Read these first

| File | What it is |
|---|---|
| `docs/RULES-V0.md` | **Normative spec for the alpha.** The exact rule subset, the house rules, and what was cut. This wins over the rulebooks where they differ. |
| `docs/PLAN-V1.md` | **The order of work now.** Twelve phases from the alpha to the complete basic game, each landed one carrying a write-up of what the plan got wrong. Start here when writing code. |
| `docs/PLAN-V0.md` | How the alpha got here: nine phases, all done. History, not instructions. |
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
npm run art         # optional: mirror real face art into public/faces/ + assets/faces/ (both gitignored)
npm run play        # play a game in the terminal (--seed N, --ai random, --forces starter|bestiary)
npm run goldens     # re-record the golden corpus -- see below before you do
```

**`npm test` is slow on purpose** — tens of seconds, most of it the 1000-game fuzz and the replay
check that replays 25 full games. How slow is very machine-dependent: the figure here was once
30-50s and the same suite now finishes in about 10s on a fast machine, so treat a number in this
file as an order of magnitude and not a baseline to measure against. `vite.config.ts` sets `testTimeout: 30_000` because vitest's 5s
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
5. **Scope is controlled by the `RuleSet` config**, not by scattered `if`s. `V0_RULES` is
   `magic: 'simplified'`, `sai: 'inert'`, `eighthFace: 'standard'`, `dua: 'inert'`,
   `dragons: false`, `speciesAbilities: false`, and stays exactly that -- it is what the golden corpus is recorded against.
   What the app plays is `SPECIES_RULES` (also exported as `V1_RULES`) = `SPELL_RULES` +
   `speciesAbilities: true` (Phase 8); `SPELL_RULES` is `DRAGON_RULES` + `magic: 'spells'` (Phase 7),
   `DRAGON_RULES` is `FULL_RULES` + `dragons: true` (Phase 6), `FULL_RULES` is `DUA_RULES` +
   `sai: 'full'` + `eighthFace: 'full'` (Phase 5e), and `DUA_RULES` is `V0_RULES` + `sai: 'results'`
   + `dua: 'active'`. Adding a cut feature means implementing behind its flag,
   not deleting a condition -- and adding a key to `V0_RULES` is safe for the goldens, because
   `digestState` excludes `ruleSet` and `setupGame` pins an absent one to `V0_RULES`.

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
   mirrors it into the gitignored `public/faces/` and `assets/faces/`; every face falls back to our own glyphs when
   that is missing, so a fresh clone is a complete game. Note that `npm run build` copies
   `public/faces/` into `dist/` — delete it before publishing a build. See `OVERVIEW.md` §5.

## Alpha house rules (easy to forget)

- **Magic is a melee variant** -- *under `magic: 'simplified'` only, which is now just the golden
  corpus's baseline*: same terrain, roll magic, `damage = floor(total / 2)`, no save roll, no
  counter-attack, elements ignored. Under `'spells'` none of that is true; see `RULES-V0.md` §15.
- **No magic from reserves** -- again `'simplified'` only. Under `'spells'` a Reserve Army marches,
  may not maneuver, and casts the eight spells marked `R`.
- **SAI faces produce zero results under `sai: 'inert'`** — but the face is still stored as
  `<count> SAI:<Name>`. That count is a result count for some SAIs and an X parameter for others
  (`2 SAI:Flame` targets two health-worth of units), so let each SAI interpret its own number.
  Fourteen of the 25 are live under `sai: 'results'`; see `RULES-V0.md` §8 and `src/engine/sai.ts`.
- **`sai: 'full'` is what the app plays**, and it resolves all 25. On that rung an SAI no table
  claims **throws** rather than going quiet -- the opposite of `'results'` -- which is now a guard
  against a new species' face rather than against half-built work. Resolution order is roll order
  and multiples of one SAI always combine -- except Sleep, Galeforce and the free moves, which p. 32
  names as never combinable. All house rules, `RULES-V0.md` section 11.
- **Five of those give their targets a roll** (v1 Phase 4d): a save roll for Bullseye and Double
  Strike, a maneuver roll for Smother and Firecloud, and a look for an ID *face* for Seize, whose
  survivors go to Reserves. Four rules, `RULES-V0.md` section 11: no army modifier reaches a unit
  roll (p. 28), a die that cannot be rolled fails and draws nothing, the sub-roll is a save roll
  against **nothing** (so a Counter on it saves but sends no damage back), and targets roll in board
  order rather than the order the roller named them. "Roll this unit again" is the *roller's* die,
  at step 3 -- but **after** the SAI has resolved, not in the sweep with Rend:
  - **Bullseye and Double Strike are step-3 SAIs, applied one at a time** (fixed after Phase 9,
    from a reported Double Strike whose reroll came up Smother and was asked about in the same
    breath). The sweep holds their die (`rerollSweep`'s `hold`), each becomes its own task at the
    front of the targeting queue carrying `rerollAfter`, and answering it leaves
    `attack.rerollDue`. The *next* machine step throws the die again (`rollHeldAgain`), after
    `stepGame` has asked about anything the kills triggered -- an Accelerated Growth offer. The
    new face joins the roll: another Bullseye or Double Strike queues behind the step-3 tasks
    still waiting, a step-4 SAI goes to the back, and Choke or Confuse to the delayed list.
  - A `V0_RULES` roll never holds a die, since nothing targets there, which is why the goldens
    did not move.
- **Choke and Confuse are *delayed*: they are chosen after the defender's dice land** (v1 Phase 4e).
  That is the rulebook's step 2, and it is why the save roll is two march steps. Choke may take only
  the dice that rolled an ID icon -- `Pending.sai_target.eligible`, the one targeting rule that is a
  fact about a roll -- and removes their results as well as the dice. Confuse **replaces** a face
  rather than adding one, which `SaiOutcome.reroll` (step 3, appends) cannot express.
- **Wild Growth and the free moves are the first *friendly* SAIs**, and the first decisions that may
  legally be answered with nothing: p. 29's "up to, including none", against p. 32's forced maximum
  that every earlier targeting SAI is held to. Wild Growth's budget buys **the health a promotion
  gains**, so a promotion may jump several steps at once -- a house rule, `RULES-V0.md` section 11,
  and deliberately not `promotionMatching`'s exactly-one-step rule.
  - **What Wild Growth does not promote becomes save results, but only where a save roll counts
    them.** On an attack roll they are generated in a type the roll does not count, so
    `Pending.sai_promote.saveResultsCount` is false and both clients stop offering them. The split
    stays legal; the app just does not advertise a choice that buys nothing.
- **A sub-roll generates no free move and no promotion**, via `RollContext.isSubRoll`. Phase 4d's
  sub-rolls *are* non-maneuver rolls, so Firewalking and Wild Growth apply to them by the letter --
  but a die rolling for its life has no army to promote into, and the decision would be a pause
  inside a pause. Wild Growth still generates its save results there, which is what stops a die
  holding that face dying to a Bullseye.
- **The DUA is a graveyard under `dua: 'inert'` and a resource under `'active'`** -- promotion,
  recruitment, burial and Rise from the Ashes' death trigger. See `RULES-V0.md` §9. **Wild Growth is
  the first caller of promotion** (Phase 4e), on its own budget rule; **City is the first caller of
  recruitment** (Phase 5e), moving a 1-health unit straight from the DUA. Flame buries, and the app
  reaches it now.
- **Sleep and Galeforce are the first effects with a duration** (v1 Phase 4c) -- `RULES-V0.md` §10.
  Phase 3 shipped `Effect`, `expireEffects`, `pruneEffects` and the `asleep` status with no caller
  at all, deliberately; these two are it. Both are cast during the *attacker's* roll and bite in
  that same exchange, which is what the Phase 4a seam exists for. The app has played them since
  Phase 4e flipped it to `FULL_RULES`.

- **Eighth face captures and wins** (two captures = victory) **and grants its two standard
  advantages**: the holder's army doubles all ID results when rolling *anything* there — attack,
  save or maneuver — and may take melee, missile or magic, while any army facing them at that
  terrain is restricted to melee. **Now in, under `eighthFace: 'full'`** (Phase 5e, `RULES-V0.md`
  §13): Tower, City and Temple. **Standing Stones came live in Phase 7f** -- it converts the
  army's magic to the terrain's elements, which is the whole of what it does and needs spells to
  mean anything. `V0_RULES` stays on `standard`, where the four icons still behave identically.
- **Dragons and spells are both in.** Under `dragons: true` (v1 Phase 6, `RULES-V0.md` §14) the
  Dragon Attack Phase is real; under `magic: 'spells'` (Phase 7, §15) all eighteen spells cast, and
  `Summon Dragon` is how a dragon reaches the board. `V0_RULES` has neither, and promotion and
  burying -- machinery since v1 Phase 2 -- stay out of its reach.
- **Species abilities are in** (`speciesAbilities: true`, v1 Phase 8, `RULES-V0.md` §16). Two
  house rules in §16, and one that 9b retired:
  - **Flaming Shields is automatic wherever it can only help.** In a melee attack and Wall of
    Thorns' roll every rolled save converts. In the dragon combination roll, which counts saves as
    well, converting is a trade, so the owner picks how many in `dragon_allocate`.
  - **Accelerated Growth is a question, not a house rule** (Phase 9b). Replanting rolls, then the
    owner is asked about the exchange with the roll in front of them, so the old "Replanting
    first" rule has nothing left to decide. `killUnits` moves the dying dice to the DUA and
    records a `GrowthOffer` on the turn, and **`stepGame` raises it before pruning and before the
    victory check**, because the answer may refill an army the kill emptied. An exchanged die
    was never killed, so a Flame does not bury it.
  - **Air Flight is judged at the start of the Retreat Step**, and **Rapid Growth is asked only
    while the counter-maneuvering army is losing or tied** and has a die that did not roll an SAI.
- **A beneficial army spell targets only your own armies** (v1 Phase 9a, `RULES-V0.md` §15). It
  lives in the data, not in code: five spells carry `own_army`, and a test says no spell carries
  `army` any more. Terrain spells, Mirage and Summon Dragon stay wide on purpose. One spell at one
  target is **one** announcement with a count -- `stageCast` is the one merge both clients use, and
  `announcementProblem` refuses a duplicate that used to resolve twice.


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

**Status: complete.** 40 unit dice (280 faces) and 24 terrain dice (6 basic types × 4 eighth-face
variants -- Coastland, Feyland and Flatland joined Swampland, Highland and Wasteland in Phase 5a),
all passing validation, plus **10 dragon dice** (5 elements × drake/wyrm, 12 faces each, Phase 6)
and **18 spells** (`data/spells.json`, Phase 7 -- hand-authored like `presets.json`, no importer
touches it). Nothing is `TODO`: every die in scope is transcribed, and `npm run data` reports any
spell that is in the data with no code behind it.

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
  query. Home/Campaign/Horde are setup vocabulary only. Never add a parallel army, DUA or BUA list
  — the absence of one is what makes desync impossible, and it is why `validateState` still does
  not check "every unit is in exactly one place" (`PLAN-V1.md` Phase 2 asked for that check; it
  cannot fail). What it *does* check, since an exchange is the one thing that can move a die
  between two players' areas, is that **every unit of a player shares one species**.

- **`rollArmy` has no special case for ID icons or monsters, and must not grow one.** The count
  printed on the face is already the answer. `faceResults` is three lines; keep it that way.
- **`setupGame` rolls the whole opening from the seed.** One RNG stream, in this order, and the
  order is load-bearing:

  ```
  race -> size -> p1 units -> p1 split -> p2 units -> p2 split   (random forces only)
       -> Horde roll-off
       -> p1 home die -> Frontier element -> Frontier die -> p2 home die   (unpinned slots only)
       -> terrain faces
  ```

  **A named force must consume no generation draws at all** -- not "the same draws", none -- or a
  named game lands on a different board than v0 gave it and the golden corpus quietly changes
  meaning. The generation steps live inside the random branch, not before it. The same rule applies
  to a pinned terrain slot (Phase 5b): it consumes no draw either, which is why the die draws sit
  after the roll-off and before the faces, and why a partly pinned game draws only for what is left
  unpinned.
- **The roll-off's two prizes are split one each**: the winner marches first, the loser draws the
  Frontier (Phase 5b). The rules give the winner the choice of one *or* the other; that is a real
  decision and `PassiveAI` could hold no opinion about it, so `GreedyAI` gets the real rule in
  Phase 10. A house rule, recorded in `RULES-V0.md` section 7.
- **Both Home Terrains and the Frontier are drawn, not chosen by species** (Phase 5b). Each Home
  Terrain is uniform over all 24 dice; the Frontier draws one of the loser's two elements and then
  draws uniformly among the dice carrying it, so the loser's own home type comes up about twice as
  often as a type sharing only one element with them. `SpeciesProfile` and the old per-species
  profile in `data/presets.json` are gone -- there is no second copy of "which terrain a species
  brings" left to drift.
- **`SetupOptions.terrains` pins a die to a slot.** That is how a test says "a Tower, here", and it
  is what lets the golden corpus keep replaying the board it was recorded on now that the terrains
  are drawn rather than fixed. Applied last, over whatever would have been drawn.
- **Named forces are `data/presets.json`, which the importers never touch.** `STARTER_FORCES` is
  the 30-health pair the alpha shipped with and the one the goldens are recorded against -- do not
  edit those two lists. `BESTIARY_FORCES` is 35 health and holds one of every monster and every
  large die, which puts **all 25 SAIs** on the board against the starters' 10; reach for it when a
  rule needs a die a rolled force might not draw. Both are in `FORCE_SETS` in `setup.ts`, which the
  terminal's `--forces` and the app's `?forces=` share.
  - **The ten monster fixtures are in `FORCE_SETS` too, as mirrors** -- `?forces=firewalkers_genie`
    is six Genies against six Genies. They existed from Phase 1 and only a test could reach one,
    which is why a Phase 7 bug report about Flashfire could not be reproduced in a browser at all:
    Flashfire is Firewalkers-only, the human plays p1, and `bestiary` puts Treefolk there. The
    registry is derived from `PRESETS`, so a monster added later is playable in the same edit that
    gives it a fixture.
  - **A preset is not required to be 30 health.** The rule is that the two sides of a *game* bring
    the same total and no army exceeds half of it; "every preset is 30" was a fact about there
    being only two of them, and `setup.test.ts` used to assert it.
- **The ten monster fixtures are one preset per monster die** -- `treefolk_satyr`,
  `firewalkers_gorgon` and so on -- **six copies of that one monster, split 3/2/1** across home,
  Frontier and the enemy home. They exist because a bestiary buries the die you are testing among
  nineteen others that may never roll, and every SAI from Phase 1 on lives on a monster face: six
  of one die against six of another is a game made of nothing but the two faces under test.
  - **Six is the setup cap, not a taste.** No starting army may exceed half the force, so a
    24-health force allows three monsters at home, and six is the smallest force whose half is
    three whole monsters. Four at home needs eight dice; that is the arithmetic, and it is why the
    split is 3/2/1 rather than the 4/1/1 it reads like it wants to be.
  - All ten are 24 health, so **any two of them pair, mirrors included** -- a mirror is the most
    useful board of the lot, being one die read against itself. None of them pairs with a starter
    (30) or a bestiary (35); `newGame.ts` refuses that before `setupGame` can throw.
  - `setup.test.ts` derives the roster from `UNIT_TYPES` rather than listing it, so **a monster
    added to the data later fails there** instead of quietly going without a fixture.
- **Species is derived, like armies are.** `speciesOf(state, player)` reads it off any of that
  player's dice, dead ones included; a rolled force has no preset id to look up, and a second copy
  of the fact could drift.
- **A roll is four functions, and the last of them is pure.** `rollFaces` is step 1, `rerollSweep`
  is step 3, `resolveFaces` is steps 4-10, and `resolveRoll` is their composition. Every mid-roll
  pause in v1 Phase 4 sits at the same joint -- between a step that consumes randomness and a step
  that is pure arithmetic over faces already on the table -- so a pause is *stash the faces, ask,
  recompute*, and the recompute draws nothing. Hence `RawDie` (unit, type, face index, and nothing
  derived): it is what gets stashed, and it keeps a `Face` object out of the golden digest.
  `RollSpec.saiResults` is the other half of that seam -- step-8 results a player supplied rather
  than a face, joining after step 7's divide, which is why it is a spec field and not a number
  added to the final total.
  - Note the name: `rollFaces`, not `rollDice`, because `rng.ts` already has a `rollDice` that
    turns face counts into indices. Two functions of that name in one directory, both imported
    into `sai.test.ts`, is a collision worth avoiding rather than aliasing around.
- **A roll is a ten-step pipeline, not a sum** (`pipeline.ts`, full rules p. 27). `applyModifiers`
  runs steps 6–10; `rollArmy` is the one-type, one-number door onto the whole thing that the
  rest of the engine uses. **The running value is a triple per result type — `{ id, normal, sai }`
  — and that is forced, not stylistic**: step 6 removes ID results *last* and step 8 adds SAI
  results *after* step 7's divide, and neither survives a single subtotal.
  - **`perDieResults` sums across every kind the roll counts, not just the first.** With one
    counted type those are the same number, which is every roll before Phase 6 — so this looked
    right for five phases. In a dragon roll counting melee, missile and save, reading only the
    first meant a die showing `4 SAVE` reported zero, and the roll strip greys on that number:
    a blank die beside a total that was counting it. An ID die's pool is counted *once* however
    many types it could be spent on, which is also what lets a display pass fake the allocation.
- **A `Modifier` that is not arithmetic gets its own kind.** `ignore_ids` (the Death breath,
  Phase 6) zeroes the ID share before step 6. It is deliberately not a `multiply` by zero: that
  would eat the type's one-multiplier budget and make an army holding an eighth face *throw*
  rather than roll. Riding the modifier list is what gets it to every army roll without a single
  call site learning about it.
- **An SAI is a pure function of its face and what the roll is for** (`sai.ts`). No `GameState`, no
  unit, no RNG, so every one is testable from a face literal the way `faceResults` is; `resolveRoll`
  stamps the die onto whatever effects come back. Two rules do most of the work:
  - **`X` is the count printed on the face** (full rules p. 31), which is invariant 7 again —
    nothing looks up a unit's size. `4 SAI:Smite` on a monster is four, `3 SAI:Smite` on an Oak Lord
    is three, and a test uses the Oak Lord precisely because a hardcoded 4 passes everywhere else.
  - **An SAI applies only to the rolls its `Applies` column names.** "If a type of roll is not
    listed ... that SAI has no effect in that type of roll" — so a Fly on a monster face is four
    unmissable icons worth exactly nothing in a melee attack. That is the rule, not a bug.
  - **An SAI this rung does not implement is silently inert, and that is deliberate.** It is what
    makes `'results'` playable rather than a half-built `'full'`; `'full'` is the rung that refuses.
    **Two tables, not one**: `HANDLERS` is the `'results'` rung and `FULL_HANDLERS` is what
    `'full'` adds, because the rungs differ in *which SAIs exist* rather than in what any one of
    them does. Flame in the shared table means `SAI_RULES` — the configuration Phase 1 shipped —
    quietly starts burying dice.
    **The refusal is per *name*, not blanket**: `saiEffects` resolves any SAI either table claims
    and throws only for one neither does, so a Phase 4 slice moves a name into `FULL_HANDLERS` and
    nothing else changes. Cantrip and Dispel Magic get their own message -- they wait on
    `magic: 'spells'`, not on this flag. `sai.test.ts` pins the exact four-way partition
    (`'results'`, `'full'`, unbuilt, needs-spells) *and* checks it against the engine, so
    `npm run data` cannot add a name that falls through unnoticed and the list cannot drift from
    what actually throws.
- **What a roll *counts* and what it is *for* are two questions.** `RollSpec.kinds` is the first;
  `RollSpec.context` (a `RollPurpose` plus `isCounter`) is the second, and it is what decides
  whether an SAI face does anything at all — "if a type of roll is not listed ... that SAI has no
  effect in that type of roll". They agree for every roll in Phase 1 and stop agreeing at Phase 6's
  dragon combination roll, so neither is derived from the other.
- **`rollFaces` rolls every die once, and only then `rerollSweep` rerolls** (steps 1 and 3, in that order). So
  `dice` always begins with one entry per unit in unit order and every entry after it is a reroll,
  marked `reroll: true`. The queue is drained **FIFO**: with Rend on one face of one unit type no
  other order is distinguishable today and a recorded game depends on it forever.
- **`rollArmy` must pass `RollResult.effects` on, and somebody must read them.** `combat.ts` only
  ever calls `rollArmy`, so a riposte or a Smite that `resolveRoll` computed correctly would
  otherwise be dropped on the floor with every test still green. Rolls with nowhere to put an
  effect say so: `expectNoEffects` at the maneuver and roll-off sites, `expectOnly` in
  `resolveSaves`.
  - **`expectOnly`'s whitelist is what each Phase 4 slice forgets.** A new targeting kind is
    consumed a step *earlier* than the whitelist that names it, so the effect resolves correctly and
    the guard that exists to stop it being dropped refuses it instead. Missed in 4b for
    `target_enemy` and again in 4c for `sleep` and `galeforce`. It fails loudly and a test catches
    it in seconds -- but widen it in the same edit that adds the kind.
- **One combat exchange is up to eleven steps, and `COMBAT_SEQUENCE` is the only thing that knows
  the order.** Four of them assign damage — the attack's, the riposte back at the attacker, the
  counter-attack's, and the riposte back at *that*. `finishExchange` and `applyAssignDamage` both
  route through `afterCombatStep`; they used to decide independently, which was survivable with one
  assignment per exchange and is not with two.
  - **An exchange is three steps, not one.** `beginExchange` rolls the attack and stashes the raw
    dice in `CombatState.attack`; `rollSaves` rolls the defender's dice and stashes those in
    `CombatState.saves`; `finishExchange` resolves both and computes the damage. Two pauses, because
    the rulebook has two: a targeting SAI is chosen before the save roll and a **delayed** one after
    it, and Choke cannot be chosen any earlier because its targets are the dice that rolled an ID.
  - **The first of those seams exists so a targeting SAI can be chosen between the rolls** —
    Sleep takes a die out of the very save roll that follows, Galeforce subtracts four from it —
    and invariant 3 means such a decision *must* be a step the machine rests on.
    - **`rollAttack` rolls for magic too**, and the zero-total early return moved to the far side
      of the seam. Both used to return before the save roll was reached; leaving them there would
      make a Galeforce on a magic action, or a Flame on a zero-result roll, compute correctly and
      then get dropped — Phase 1's bug #3 a third time.
    - **`combat.attack` is dropped by omission** when `finishExchange` rebuilds the state field by
      field, and `validateState` checks it is gone. "Cleared in one function" is a claim about one
      function; the four recorded games that end mid-combat are what would pay for it being wrong.
    - `beginExchange` *does* spread the old combat, and that is safe for the opposite reason to the
      rule below: it is the same exchange one step later, not the next one.
  - **A targeting SAI is chosen in the gap, at `sai_target_*`.** `beginExchange` resolves the attack
    faces *purely* to find the tasks, parks them on `combat.attack.targets`, and `stepTargeting`
    drains them one decision at a time; `resolveSaves` then resolves the same faces again for the
    totals. The second read is free only because `resolveFaces` draws nothing, which is what the 4a
    split was for.
    - **A task that can take nothing is dropped, not asked about** — "up to X health-worth" against
      an army whose smallest die is bigger than X. Same rule as damage too small to kill, and the
      normal case for `2 SAI:Flame` against monsters.
    - **`Pending.sai_target` is answered by the roller, about somebody else's army.** `player` is
      who chooses, `target`/`slot` is whose dice are at stake. Every combat decision before it was
      addressed to the owner of the dice, and both clients assumed so — hence `SelectMode.side`
      gaining `'theirs'` and `Board` stopping hard-coding the enemy half unselectable.
    - The selection rule is `damageAssignmentProblem` unchanged: p. 32's "select the maximum number
      of targets" is §6's damage rule word for word. The *friendly* rule ("any number, including
      none") arrives with Wild Growth and has no case before it.
  - **The delayed pause has two askers, and `taskOwner` is the one place that knows which.** Choke
    and Confuse are the attacker's, about the defender's dice; Wild Growth and the free moves belong
    to whoever made the roll, which at that pause is the defender. The attacker's go first -- the
    rulebook's step 2 before its step 4 -- and they share one pause because no save roll in the game
    has a step-3 reroll to come between them.
  - **`taskQueue` / `dropHeadTask` are the two queues behind one set of appliers.** An answer
    arrives at `applyAction` knowing only its own shape, so the march step is what says which queue
    it came from. Add a third pause and this is the only thing that has to learn about it.
  - **`resolve_counter` is a gate, not a step to skip past.** Everything after it belongs to an
    exchange that happens only if the defender accepts, and its assignments read a `combat.damage`
    the counter has not written yet.
  - **Whether the counter is actually offered is decided in `stepMarch`, not in `stepHasWork`.**
    The march reaches `offer_counter` and only then finds nothing to do, which is what v0 did: when
    an attack wipes out the defender the game is already won, `stepGame` returns on the victory
    check first, and four golden games end standing on that step.
  - **Build the next `CombatState` field by field, never `{ ...combat, damage }`.** A stale
    `riposte` carried from the attack into the counter-attack assigns the same damage twice, and no
    golden or total-checking test would see it.
- **New `CombatState` and `combat_resolved` fields are optional and omitted, never `0` or
  `false`.** `digestState` puts `stableJson(state.turn)` and every log entry in the golden digest,
  and four of the twenty-five recorded games end mid-combat. `counterSuppressed` is typed `?: true`
  rather than `?: boolean` so the falsy-but-present value is a compile error.
- **ID doubling is a step-9 modifier, and lives in neither `faceResults` nor the roller.** It is a
  fact about the board, not the face: the same die doubles or not depending on where it stands, so
  `faceResults` stays a pure face-to-results function and the bonus rides in as a `Modifier`. It
  consumes no extra randomness, so a game replays die for die either way; only the totals change.
- **`armyRoll(state, player, ref, resultType)` is the one door an army roll goes through**
  (`effects.ts`). It returns the dice that may be rolled *and* every modifier on them — the eighth
  face's ID doubling and every effect with a duration — because the two are separate questions and
  a site that answers one and forgets the other has no symptom: a sleeping die quietly rolling, or
  a Galeforce quietly not applying. `rollArmy` takes the modifier list; it used to take a
  `doubleIds: boolean`, which was enough while the eighth face was the only thing in the game with
  an opinion about a roll. Attacks, saves and contested maneuvers all count as "rolling the army".
- **A spell is data, a handler, or neither** (`data/spells.json`, `spells.ts`). Seven are an `effect`
  block -- modifiers, a scope and a duration -- and nine name a handler, which means "does something
  at resolution time that is not an `Effect`". **Neither is a legal state**: it means transcribed but
  not implemented, `resolvesSpell` answers false, and `castableSpells` never offers it. That is what
  made every slice of Phase 7 playable rather than a throwing half-build, and it is the
  `sai: 'results'` lesson rather than the `'full'` one. By 7f nothing is in that state and a test
  says so, which is the guard against a spell reaching `data/` with no code behind it.
- **A spell that inflicts damage rolls the target's saves first** (`spellSaveRoll` in `spells.ts`).
  "When a unit takes damage it is permitted to make a save roll unless an effect states otherwise"
  (p. 29), and Hailstorm's own sentence states nothing otherwise -- it shipped in 7c without one,
  which made it the only damage in the game no save could touch. It is an **army** roll, so a Stone
  Skin and an Ash Storm both reach it; its purpose is `save` against `null` so a Counter saves and
  ripostes at nobody; and it carries `isTrigger`, because a spell resolving out of an announced list
  has no exchange to hang a Wild Growth on. Wall of Thorns' roll, one rung along.
- **A rule about "attacking a Reserve Army" has to name the action.** Tower's "only count non-ID
  missile results" was tested as `defenderSlot === 'reserve'`, which said the same thing while a
  missile was the only way to aim at Reserves -- and then Phase 7f let a Reserve Army take a *magic*
  action, whose `targetSlot` is the caster's own ref because magic names no terrain. Every ID result
  in a Reserve Army's own magic roll was thrown away, and the die drew as a blank while it was at
  it. A predicate that happens to be equivalent is not the same as the rule.
- **`SpellTargetOffer.minCount` rides on the offer, not in a rule.** Resurrect Dead's price is a
  property of what it is aimed at -- a 2-health die needs two castings -- so the number travels with
  the target and every chooser respects it for free. A rule the clients do not know is a rule both
  clients will violate, and the fuzz proved exactly that within a hundred games.
- **`MagicState.returnTo` is what lets a casting window nest.** Cantrip's second sentence suspends an
  exchange, announces and resolves spells, and hands the march back where it came from; a magic
  action has no `returnTo` and ends its march instead. That one optional field is the whole of the
  difference, and `validateState` reads it as the claim "this exchange is coming back" when it
  decides whether a parked attack roll has outlived its steps.
- **Three rolls have nowhere to put a decision that is not about the roll** (`noSideDecision` in
  `sai.ts`): a sub-roll, Wall of Thorns' trigger roll, and the dragon combination roll. The third was
  a *silent* drop from Phase 6 until 7f, because `resolveArmyRoll` read the totals and ignored the
  roll's effects entirely -- Wild Growth's `Applies` column is "Non-Maneuver", which a dragon attack
  is. It refuses now, so the house rule is a decision rather than an accident.
- **`iconAt(state, player, slot)` is the eighth-face seam** (Phase 5c, `effects.ts`, beside
  `doublesIds`): non-null exactly when `eighthFace: 'full'`, the terrain is on face 8, and this
  player captured it. Every icon power (Tower, City, Temple) asks this and nothing else, which is
  what makes losing the capture end the power in the same step free -- nothing is stored, so there
  is nothing to revoke. `resolvesIcon` is `resolvesSai`'s twin: ask the ruleset, not a table,
  because a table is right about one rung.
- **At most one terrain fires per Eighth Face Phase.** Two captures win the game, so a player
  holding two has already won before the phase could ask about the second. That is what lets
  `eighthFacePending` be a single decision with no queue -- a future rule that changes what wins
  the game is the one thing that would turn this into one.
- **A dragon's own roll is not the ten-step pipeline** (`dragons.ts`, Phase 6). A dragon face is a
  fixed named ability, not a count of result icons: Jaws is 12 damage whoever rolled it. So there
  is no subtotal, no divide and no modifier -- `rollDragon` picks one of twelve faces and follows
  its rerolls, and `resolveFaces` has nothing to contribute. The army's *answer* is an ordinary
  roll and does go through the pipeline.
  - **Breath rerolls against a dragon and not against an army**, which is why the target has to be
    known before the dice are thrown -- and is exactly why the rulebook designates targets at step
    2 and rolls at step 3.
  - **`turn.dragonAttack` is the phase's `CombatState`**: it holds the rolled faces between the
    throw and the arithmetic, for the same reason an exchange does. Built field by field by
    `withDragonAttack`, so optional fields drop by omission near the digest.
  - **The army does not roll when every dragon is duelling** (p. 18 step 6, "skip this step if no
    army is being attacked"). Missed on the first pass and found in a browser rather than a test:
    the totals were right, the state validated, and the only symptom was a roll's worth of
    randomness spent where the rules spend none. The starter matchup duels on turn one every game.
- **Dragons are `state.dragons`, keyed like units and owned like nothing else.** `DragonInPlay.owner`
  says whose pool it came from and who rolls it -- **not whose side it fights on**, since a dragon
  attacks the marching player's army whoever brought it, its own summoner included. It has no
  health field, because damage does not accumulate between attacks: 10 of one type in one attack
  (5 past a Belly) or it is untouched.
- **Effects with a duration are `state.effects` and `effects.ts`, and Sleep and Galeforce are what
  produce them** (v1 Phase 4c).
  An effect targets an army *at a place* (it does not follow the units) or a unit (it does),
  carries `Modifier`s and/or the `asleep` status, and ends at the start of its caster's next turn.
  `expireEffects` runs in the `effects_expire` phase; `pruneEffects` runs from `stepGame` beside
  `syncCaptures`, which is the rules' "checked at the end of each action". **Both must return the
  same object when they drop nothing**, or `advance` never settles.
  - **"Its caster's next turn" is whoever made the *roll*,** which on a counter-attack is the
    defending player rather than the marching one. `expireEffects` keys on that field, so getting
    it wrong shortens or doubles the effect rather than failing.
  - **An army modifier must never reach a unit roll**, nor the reverse (full rules p. 28). That is
    why the entry point is named `armyRoll`, and why **`unitRoll` is its sibling rather than a call
    into it**: it gathers unit-targeted effects only -- no army effect, no eighth-face ID doubling
    -- and returns `rollable: false` for a sleeping die. The two share no gatherer on purpose.
    `rollUnits` in `roll.ts` then rolls each input once, skipping the unrollable, which **draws
    nothing** for them. `unitRoll` takes no `resultType`: the only thing `armyRoll` needs one for is
    `doubleIdsModifier`, which a unit roll never gathers.
  - **Seize does not go through `rollUnits`.** "If they roll an ID icon" asks about a *face*, not a
    total, so it is `rollFaces` plus `faceOf(die).icon === 'ID'` -- which also keeps an ID roll from
    tripping `'full'`'s refusal on an unbuilt SAI a target happens to show. Two questions in the
    rulebook, two code paths.
  - **A sub-roll's targets roll in board order** (`Object.values(state.units)`), not in the order
    the player named them -- `death.ts`'s rule, for `death.ts`'s reason. Both replay identically, so
    no golden and no fuzz can see this; only a test can.
- **`stepGame` prunes effects before it checks for victory**, and the order is load-bearing: the
  action that wins the game is still an action, and the army it emptied may have been carrying a
  Galeforce. With the check first the effect outlived the army forever and `validateState` called it
  a breach. Found by Phase 4e's fuzz, three phases after the bug landed.
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
- **Every death goes through `killUnits` (`death.ts`), not `applyDamage`.** It is `applyDamage`
  and nothing else under `dua: 'inert'` -- *including consuming no randomness*, which is what keeps
  the 25 goldens byte-identical, and is a test rather than something the corpus is left to notice.
  Under `'active'` it is where Rise from the Ashes fires, and it is the seam Phase 8's Replanting
  and Phase 6's Fire breath plug into. `buryUnits` is its twin for burial.
  - **Replanting runs first, and a replanted unit was never killed** (Phase 8). `DeathOutcome`
    carries three ways out of a death -- `risen` (killed, then moved), `regrown` and `replanted`
    (neither killed at all) -- and `killedIds` / `deathEntries` are what keep the second two out of
    a kill line. **`replantDice` holds every Replanting roll, the misses too**, and the `replanting`
    log entry draws them all: it first shipped listing only the rescued, so a Treefolk that rolled
    and failed looked exactly like one that never rolled. Rise from the Ashes had the same
    silence until after Phase 9: `DeathOutcome.riseDice` now holds every roll and `units_risen`
    carries them, misses included. **Burials log through `buryEntries`**, which names a Phoenix
    that rose on the way rather than calling it buried -- the Temple, Dragon Fire and a declined
    Accelerated Growth under Flame all wrote "buried" over a die in Reserves. **A kill-and-bury must subtract `replanted` as well as `risen`** from what it
    buries, or `bury` throws on a unit standing in Reserves. That was the Phase 8 plan's missed
    crash.
  - **Rise from the Ashes triggers on a *Rise face*, not an ID**, and on **burial as well as
    death**; kill-and-bury gives two rolls, and a success on the first means the unit is never
    buried. `sai.ts` said "an ID" until Phase 2 read the reference again.
  - **Burial is DUA -> BUA, and `bury` throws on a unit that is still in play.** An effect that
    kills and buries -- Flame, Fire breath, the Temple -- calls `killAndBury`, which is two steps
    because the rules are two steps. That is pure bookkeeping for every die except a Phoenix, and
    the short-cut would silently halve its chances with nothing but a probability to show for it.

  - Units that carry no Rise face consume no randomness, and the roll order is the board's order
    (`Object.values(state.units)`), not the order the player typed into `assign_damage`.
- **`livingUnits` is stated positively — `terrain | reserve` — and must stay that way.** It was
  `!== 'dua'`, which would have counted every buried die as alive the moment the BUA existed: a
  player whose last unit was buried would never lose, and `validateState` would have agreed. A new
  `Location` member has to be opted *into* it.
- **The DUA machinery is `dua.ts`, and promotion is an exchange.** A 2-health Oak promotes by
  swapping *places* with a 3-health Treefolk unit in the DUA -- invariant 4 upward, nothing gains
  health. The swap moves `location` and **never `typeId`**: a unit id embeds its type's short name,
  so rewriting the type makes every id and every golden digest line lie.
  - **Every exchange resolves in one pass over the original state**, which is the rules' "choose
    all partners before performing the exchange". It is also what makes an army whose every unit is
    exchanged still present, and why order of `pairs` cannot matter.
  - **Exchanged units are never considered killed** -- no log entry, no death trigger.
  - `promotionMatching` promotes by exactly one step. Health-budget promotion, where one unit may
    spend X twice (1 -> 2 -> 3), belongs to Wild Growth and the City and is deliberately not there.
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
- **`maxArmyResults` no longer bounds a roll's total.** Rend puts a die in the roll that the army
  does not contain, so the ceiling is over the roll's own `dice` —
  `Σ maxResults(unitType(die.typeId), ...)` — which is a better property anyway and survives any
  future reroll source.
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
  - **What it catches is narrow**: deadlock, a `validateState` breach mid-game, and a throw on any
    path a random player can reach. Not rule correctness, and not coverage — Rend is one face on
    one of forty unit types, so a clean 1000-game run can easily never have executed it. A fuzz
    over new rules wants per-SAI trigger counters asserted `> 0` beside `stuck === 0`.
  - **It also only catches what `RandomAI` can express.** `RandomAI` picked one destination for the
    whole batch at `reinforce`, so a thousand games never once produced a reserve arriving at two
    terrains -- and the bug that made the UI unable to do it lived on for exactly as long. When a
    decision gains a dimension, the fuzz opponent has to gain it too or the fuzz quietly narrows.

  - **The 1000-game fuzz runs `V0_RULES` only**, which is no longer the configuration anyone
    plays. Phase 1 turned the app over to `SAI_RULES` and deliberately did not add a second fuzz of
    that size, and every phase since has widened the gap. There are several smaller ones now --
    Phase 5e's eighth-face fuzz, Phase 6's 240-game dragon fuzz, Phase 7's 200-game spell fuzz and
    Phase 8's 200-game species fuzz (`species.test.ts`, which is the one that runs what the app
    plays) -- but the *big* net still guards the one config that least needs it, and the gap is now
    seven phases wide. Worth knowing before trusting a green suite.
  - **A long game needs `maxDecisions` raised, and raising it needs measuring.** Reserve magic
    (Phase 7f) roughly tripled a random game's length -- the Reserve Army can march every turn --
    and 20 of 200 games stopped on `runGame`'s default 5000 with every trigger counter quietly
    under-reporting. The spell fuzz passes `maxDecisions: 20_000` against a longest *observed*
    game of 16,353. A cap raised by guessing is a cap that will be hit again.
- **`src/ai/estimate.ts` is the one place the AI turns faces into numbers** (v1 Phase 10a).
  It computes closed-form expectations: `expectedFace` averages each face, `expectedArmy` goes
  through `armyRoll` and then `applyModifiers`, and `expectedAttack` gives both rolls. A scorer that
  gathers its own modifiers is a second door onto an army roll: a Galeforce or a sleeping die it
  forgets goes silently unseen.
  - **`applyModifiers` ignores `counts_as`, so Flaming Shields is added by hand** from the
    expected rolled saves. Building the estimate the obvious way drops it without a sound.
  - A rerolling face is `E = sum / (faces - rerolls)`.
  - `unitValue` depends on the die type only, never on where the die stands.
  - `leastValuableMaximal` / `mostValuableMaximal` are an exact-sum knapsack over
    `maxAbsorbable`, never largest-first.
- **A game record is `{ setup, actions }` and nothing else.** Replaying it reproduces the game die
  for die. `replayTo(record, n)` is undo.
- **The golden corpus is the guard on "this changed no outcome".** `src/engine/__golden__/` holds
  25 recorded games plus a `digestState` of what each replayed to, and `golden.test.ts` replays
  them. A refactor that claims to be behaviour-preserving is only as good as this file staying
  untouched. **Regenerating it with `npm run goldens` is the one move that can hide a bug**, so a
  commit that does it says why in the message — it is not a snapshot to refresh when it goes red.
  The digest keeps per-die results, because a roll can change without changing who dies.

## UI

- **Every screen renders from `state.pending`.** `promptFor(pending, human, state)` turns it into a
  sentence and the legal buttons; no component decides what is legal or tracks where it is in a
  multi-step move.
- **A prompt button draws the real terrain face art, not a glyph** -- the one place worth breaking
  the 30px floor, because a terrain die has the *number* printed on it as well as the action icon,
  and "go to face 4" is a different answer from "go to a missile face somewhere". `FaceHint` is
  therefore `{ dieId, face }` and the component resolves the art; `describeFace` is the words, for
  `aria-label` and for the no-art fallback. The art is black line work, so `.choice-face` flattens
  it onto the button -- white on the accent, ink on a secondary.
- **A rerolled die is drawn beside the die it came from, joined by an arrow.** `resolveRoll`
  appends rerolls at the end, which is the true throwing order and the RNG order, and read left to
  right that leaves a Rend at the front of the strip and its second face near the back joined by
  nothing. `chainRerolls` groups them for display only -- never reordering *within* a chain, since
  the arrow means "and then this".
- **A die that produced an *effect* is not a blank, and the log names the SAI behind it.** The strip
  greys out anything that contributed nothing, keyed on `results` -- and an effect is not a result,
  so a Fireshadow that Smote for 4 rendered greyed and empty beside a log line reporting damage
  from nowhere. `DieRoll.effects` (display only; `RollOutcome.effects` stays authoritative, and the
  digest renders a die as `unitId@faceIndex=results` either way) carries the attribution, so:
  - the die keeps full opacity, takes an accent border and prints the damage as `+4`;
  - `saisBehind` / `saiPhrase` in `roll.ts` turn the same dice into "**Counter** sends 4 straight
    back" and "+ 3 unsavable **from Smite**". Both live beside `DieRoll` rather than in either
    client, because the first draft wrote the "X and Y" join out twice and that is how the browser
    and the terminal start describing one roll differently.

- **The app opens on a start screen, and `useGame` has two phases.** `null` is the screen, a
  `Session` is a game; `App` is a three-line fork between `NewGameScreen` and `GameView`. The split
  is forced rather than tidy -- `GameView` holds the selection and inspection drafts in hooks, so
  the phase check cannot be an early return inside it.
  - **Every rule the screen applies is in `newGame.ts`**, tested in node the way `prompts.ts` is:
    which forces may face each other, what an empty seed box means, what a setup is built from.
    The component's only job is to *show* the problem -- a disabled Start with no reason beside it
    is the same bug as a crash, slower.
  - **Health parity is checked before the click, not after.** `setupGame` throws when the two sides
    bring different totals, and a throw out of an `onClick` is a blank page. The pickers are
    `<optgroup>`ed by health for the same reason: the legal pairings are visible before anything is
    clicked.
  - **An empty seed box means "roll one"** -- the same rule `parseGameRequest` applies to `?seed=`,
    because `Number('')` is 0, a perfectly legal seed and a silently different game. A seed that is
    *mistyped* is reported, never quietly randomised: that is the one outcome that loses the exact
    run you were trying to repeat.
  - **New Game returns to the screen**; it used to roll a random game on the spot.
- **`?forces=bestiary&seed=7` still starts a named game directly**, bypassing the screen -- a link
  is how you hand someone the exact board you are looking at. Names come from `FORCE_SETS` in
  `setup.ts`, shared with the terminal's `--forces`. An unknown name is reported in the banner
  rather than quietly rolled, because a random force looks exactly like a preset that does not work.
  - **The request is stripped from the address bar in an effect, not in the `useState` initializer.**
    StrictMode runs those twice in development: clearing the query on the first pass left the second
    reading a bare URL. Keep the initializer free of side effects.
  - **It is cleared at all** so a refresh lands on the start screen rather than re-running the link.
    A link you cannot get back out of is a worse feature than no link.
- **The dice grid is also the selection surface** for damage, retreat and reinforce. One gesture,
  no modals.
- **A Reinforce Step sends dice to any and all terrains**, so its destination buttons *stage* into
  the `reinforcePlan` draft rather than dispatching. One action still reaches the engine -- the
  draft is `App` state, cleared with the selection, not wizard state in a component. `GameAction`
  always carried a slot per unit; it was the sheet that sent every chosen die to one destination
  and dispatched on the spot, which is half the Reserves Phase and the half that matters when two
  fronts both need a die. The `reinforced` log entry names each destination for the same reason.

- **Every decision shows the roll behind it, above the sheet** (`RollsBehindBlock` in
  `ActionBar`, v1 Phase 9d). **The same block shows while the enemy is deciding**, which is when a
  Confuse or a Flame is chosen against you. `rollsBehind` in `prompts.ts` has two sources:
  - **live**: `rollsOnTheTable(state)` in the engine, every roll parked mid-decision. At the
    delayed pause that is the attack roll **and** the save roll, and at Rapid Growth it is both
    maneuver rolls. Showing only the save strip there is how Confuse was reported as firing on
    the wrong roll: its face is on the attack, and its targets are on the saves.
  - **logged**: a decision that *answers* a roll already counted -- `assign_damage`,
    `choose_counter_attack`, `choose_direction`, a breath, a damage split, Accelerated Growth. It
    shows the last roll entry in the log, drawn by `LogLine`, the log's own renderer. So the sheet
    and the log cannot show one roll two ways. A dragon's damage brings the dragons' throw with it.
  - **Dice in those strips are answers too** (`pickableIn`): Flashfire and Rapid Growth as
    before, and now a targeting SAI's victims. At the delayed pause, Confuse and Choke pick from
    the save strip, the one place those faces are drawn.
  - `SaiHeader` is only the rule text now. It used to draw one strip itself, above the rule.
- **Confuse logs both faces** (`confused`, Phase 9d): the save dice as they were and as they came
  back. It used to write nothing, on the reasoning that "what they rolled the second time shows up
  in the save strip". That was true, and it was the bug report: the first faces were gone.
- **Roll, then SAIs, then the totals** -- the order the rules resolve in, and the order the
  screen shows.
  - **`rollOnTheTable(state)` is the engine query behind the single strip**, not a log entry: a `dice_rolled`
    entry would appear in every roll of every game and rewrite all 25 golden digests to show
    something `CombatState` already holds. It returns the *save* dice at the delayed pause, the
    *attack* dice at the targeting one and the army's own dice at Phase 6's dragon allocation,
    which is what each decision is actually about.
    - **The dragon case has to fake an allocation to render at all.** A combination roll cannot be
      resolved without one that spends the ID pool exactly (`allocateIds` refuses), and a display
      pass by definition has no answer yet -- so it puts the whole pool on one kind. Safe only
      because `perDieResults` counts an ID die's pool once and never asks which type it became.
      Getting this wrong crashed the very sheet that exists to show the roll.
  - **The rule text is `SAI_TEXT` in `sai.ts`**, beside the handlers rather than in either client,
    because both need it and because a handler that changes beside a sentence that does not is the
    drift this file has been bitten by twice. `X` stays `X`: the sheet's own line says what the
    number is on this die. `sai.test.ts` asserts every SAI that can raise a pending has text, since
    a missing one renders as *nothing at all*.
- **A roll names every modifier that changed it** (v1 Phase 9c): "14 on the dice − 4 Galeforce
  + 2 Stone Skin = 12". `armyRoll` stamps each gathered `Modifier` with its effect's `source`.
  `resolveFaces` then writes a `RollMath` per counted type, and the log entry carries it
  (`attackMath`, `saveMath`, `math`, ...). Two rules make it trustworthy:
  - **The steps are recomputed through `applyModifiers`, one modifier at a time**, and each
    step's `delta` is the change in the total. So `base + Σ delta = total` by construction. A
    second implementation of the pipeline would be how the line and the number stopped agreeing.
  - **The base is what the dice show.** The eighth face's doubled IDs and Flaming Shields'
    conversions are already on the dice, and the golden digest records them there. So they are
    *notes* ("IDs doubled (Eighth face)"), never steps. Wild Growth's save share is not on any
    die, so it is a step, named through `RollSpec.saiResultsSource`.
  - **`digestState` drops every `...Math` key**, because it is presentation derived from totals
    the digest already has. Without that, every golden with a capture would have moved.
  - It replaced a bare `12 → 8`, whose comment said naming the cause was impossible because "a
    log line scrolled back three turns cannot know it". That was true of `state.effects`. It was
    never true of the modifiers in hand at the moment of the roll, which is where the name is
    read now. The arrow stays as the fallback for an entry that has a total and no math.
    `mathPhrase` in `roll.ts` is the one sentence both clients print.
- **The Dragon Attack Phase logs its subtraction** (`dragon_damage`, Phase 9c): "Dragons deal 6
  damage − 2 saves = 4", "4 melee vs 10 → Fire Drake survives", and any duel. The two rolls were
  always logged, but the arithmetic between them happened in `finishDragonDamage` and was
  written nowhere.
- **A decision sheet's roll strip can be the answer, not only the evidence** -- `RollStrip`'s
  `pick`, used by the Flashfire sheet. The sheet said "tap the dice you want back" directly above a
  picture of the dice, and the only thing that answered was the board further up the page; somebody
  who taps the die they are looking at is not making a mistake. The board stays selectable too --
  both toggle the same `App` selection by unit id, so a chain of rerolls picks the die rather than
  one of its faces.
- **One way to pick a die** (v1 Phase 9f): every die a decision asks about is tapped where it is
  drawn, whether on a terrain, in a reserve or in the DUA. The sheet keeps only answers that are
  not dice (terrains, armies, spells, counts) and Confirm. This covers spell unit targets
  (Lightning Strike, Mirage, Path, Resurrect Dead), Wild Growth's partners, City, dragon
  treasure, the Temple's burial and Accelerated Growth.
  - **`pickModeFor`** is which dice respond. It is `selectModeFor` plus a `SelectMode` with
    `side: 'any'` and an `only` set, because a spell's targets can be any die anywhere and a
    promotion pairs a board die with a DUA die. It reads the drafts: a partner lights up only
    once the die growing into it is picked. **`tapMeaning`** is what a tap does -- toggle, a
    radio pick within a group, a Wild Growth pair, or a spell cast -- and `App` just carries it
    out.
  - **Named buttons per die are gone.** They read "Pine, Pine, Pine" and needed grouping by army
    to be usable at all (`targetGroups`, deleted), and a DUA full of one-health dice was a long
    row of look-alikes. A picked answer is named on the Confirm button instead: "Promote
    Hamadryad → Pine".
  - **The Fallen section opens itself** whenever a decision picks from your DUA.
- **The spell picker has a casting count** (Phase 9f): − N + beside the targets, so three Stone
  Skins on one army is one tap. It shows only where the count scales the spell. That is the
  `countScales` flag in `data/spells.json`, false on Path, Mirage and Resurrect Dead, so the
  client knows no spell by name. `castingsFor` in `magic.ts` is the one rule both clients apply,
  and it is never less than the target's own `minCount`.
- **A legal-but-bad answer is drawn small** (`Choice.emphasis: 'low'`, `.choice.minor`). Holding
  the eighth face, "Keep it" is the primary answer and "Maneuver down" the small one, where it used
  to be the green button.
- **Muted text inside a button takes the button's colour** (`.choice .muted`). It was grey on the
  accent green: a spell's cost you could barely read.
- **An effect with a duration is drawn on the army it sits on** (`.army-effects`, from
  `effectsOnArmy`). It is the one thing on the board that is true *between* rolls, and it used to be
  invisible: a Galeforced army saved at minus four with the arithmetic only in a log line that had
  already scrolled away. The modifiers are rendered as arithmetic (`−4 save, −4 maneuver`) rather
  than named, because the name tells you which SAI and the number is what you can plan against.
- **`effectSummary`'s callback is annotated `: string`, and that is load-bearing.** Without it a
  missing `case` returns `undefined`, `join` renders it as nothing, and the roll strip draws
  "Flame — " with an empty half-sentence -- which is what every targeting SAI did from Phase 4b
  until Phase 4e's polish pass, with the compiler silent throughout. Annotated, a new
  `RollEffectBody` kind is a build error there.
- **The two friendly sheets are drafts, like reinforce's.** Wild Growth stages `{army die -> dead
  die}` pairs the way the Reinforce Step stages `{die -> terrain}`: tap one of your dice, then tap
  the lit die in the DUA it grows into (Phase 9f; it was a button). The sheet lists what each
  partner would cost, because a lit die cannot say. A free move tallies passengers against three
  health-worth and gates the destinations, never "Stay put".
- **Logic lives in pure functions in `prompts.ts`, not in components.** `damageSelection` is the
  example: the confirm-button rule is testable without a DOM. Keep it that way rather than
  reaching for jsdom.
- **A selection is a draft answer to one question** — `App` clears it whenever `pending` changes.
- **Glyphs are ours** (`Glyph.tsx`), stroked in `currentColor` on a 24x24 grid, so colour and dark
  mode come from CSS and no glyph needs a second variant.
- **Real face art is used where it is big enough to read**, via `FaceArt` / `useFaceArt`: the die
  inspector and the terrain sheet at 44px, the roll strip at 30px, terrain chips at 28px. Below
  about 30px it is worse than a glyph — measured, not assumed — so small sizes stay glyphs.
  - **`DragonFaceArt` is `FaceArt`'s sibling, not a branch inside it**: a dragon face is an icon
    with no count, so it shares neither `Face` nor `faceLabel`, and folding them together would
    mean a union at every call site to say which kind of die this is. Its manifest key is the
    dragon *form*, since the art carries no element — all five drakes print the same twelve
    images, checked against the live set rather than assumed.
  - **Its 30px floor is a default, and the board chip overrides it with `floor={0}`.** At 18px the
    Jaws mark there is a *label* saying which die is standing at the terrain, not a face to read —
    the same job an ID face does for a unit tile.
  - **Dragon art is white line work and must be tinted**, unlike the black unit art: it is drawn
    for a dark die, so untinted it is white on a white panel. `.dragon-face-art` takes the same
    `brightness(0)` the terrain art does, for the mirror-image reason. It shipped once as blank
    boxes in the log, which is what "the art loaded fine, it was just invisible" looks like.
- **The UI never computes an art filename.** The remote set is sparse and not derivable from
  (icon, count), so `tools/fetch_faces.py` resolves it and writes a manifest keyed by
  `<unitTypeId>#<faceIndex>`. Add a face, re-run `npm run art`.
  - **A face has exactly one image, and the resolver now checks it.** It guesses up to three
    filenames per face and used to take the first that existed, which silently put one generic
    image on several different dice — `trample-m.svg` on both Redwood and Unicorn, then
    `cantrip-m.svg` on all three firewalkers monsters at once. It now probes every candidate with a
    HEAD and **prints any face that matched more than one**, telling you to name the right file in
    `FACE_ART_OVERRIDES`. A silent wrong picture is the one failure mode the glyph fallback does
    not cover: a missing face is obvious, a wrong one is not.
  - **Pin the variant, not the path.** `FACE_ART_VARIANTS` says which numbered image a die uses and
    lets the count come from the face; `FACE_ART_OVERRIDES` names a whole path and is for names the
    generator's rule cannot reach at all — `cantrip-1-m.svg` belongs to Ashbringer, a *large* die,
    so the `-m` there is part of the remote's name and not the monster suffix. A path table alone
    cannot express **a die that prints one icon at two counts**: Nymph maneuvers for 1 on one face
    and 2 on another, which are two files, and only the variant is a fact about the die.
  - Worked example: **Treefolk draw maneuver twice** — variant 1 a bare humanoid footprint,
    variant 2 a clawed root-foot — and the split is by what the creature is, not its class or
    count. The willow and pine lines are trees and take the claw; the nymph/naiad/Lady Nereid line
    are water spirits and keep the foot. Firewalkers have one maneuver image, so nothing there
    needs pinning. All 280 unit faces now resolve with no ambiguity reported.
- **A face's hover label asks the *ruleset*, not a table.** `faceLabel` says "— does nothing in this
  game" for an SAI the rules being played cannot resolve, via `resolvesSai(name, ruleSet)` in
  `sai.ts`. It has been wrong twice by consulting something else: "(inert in v0)" outlived v0, and
  `LIVE_SAIS` -- the `'results'` table -- is right only while the app plays that rung, so it called
  all eight built targeting SAIs unimplemented. **Each table is right about one rung**, which is why
  neither can answer the question.
  - **`useRuleSet` is a context, and the only one in the app.** The readers are a tooltip inside a
    die tile and another inside a roll strip; a prop means fourteen `DiceGrid`/`RollStrip` call
    sites that have no other use for it, and a fifteenth that forgets it fails *silently*. It is
    not a general channel for game state -- everything else still renders from `state.pending` and
    props. `null` means nobody said, and then the label claims nothing at all.

- **A dragon is drawn on its terrain, on neither side** (`.dragon-row`, between the terrain head
  and the two `ArmySide`s). It attacks the marching player's army whoever brought it, so rendering
  it inside an army would say the opposite. The chip is tinted by element, because the element is
  the one thing that decides who it will fight; tapping it opens all twelve faces with their
  counts and rules text, the same gesture a unit tile uses.
- **A dragon roll is one log line per dragon, never one per face.** It began as a flat list and
  read "Fire Wyrm breath, Fire Wyrm breath, Fire Wyrm tail, Fire Wyrm claw, Earth Drake tail,
  Earth Drake claw" — the name six times, no target, no total, and no sign that four of those
  faces were one die rerolling itself. `DragonAttackEntry` carries the target, the faces in
  throwing order and the damage, so the line reads `Water Wyrm → Air Drake  [faces]  6 damage`.
- **A decision sheet shows the roll that caused it**, and the dragon allocation is the case that
  proves why: how many IDs there are to spend *is* the question, and which dice already gave melee
  or saves is what decides where they go. Without it the player is splitting a pool they cannot
  see.
- **A die that cannot be picked says why.** A sleeping unit is dimmed and dashed (`.die-asleep`),
  tapping it inspects rather than selects, and its `aria-label` ends "— asleep". The engine refuses
  it as a retreat either way; this is what stops the choice being offered, and `sleepingIds` in
  `prompts.ts` is the one place either client asks. `RandomAI` filters its retreat pool by the same
  rule -- a decision that gains a dimension has to reach the fuzz opponent too.
- **A unit tile does two jobs.** When a decision needs units chosen it selects; otherwise tapping
  *inspects*, opening the die to show every face it has. Without that the app showed outcomes but
  never capabilities — you could watch a die roll but not find out what it could roll.
- **One floating inspector for every die** (`Inspector.tsx`, v1 Phase 9e): a unit, a dragon or a
  terrain, in one panel over the board. It is centred on a wide screen and a bottom sheet under
  600px, and Esc or a tap outside closes it. `App` holds a single `inspect` target, so opening one
  thing replaces whatever was open. It replaced three inline panels, each with its own state: a
  unit tile's opened as a full-width row that pushed the grid down and sideways, and opening a
  unit never closed a terrain. `UnitDetail`, `DragonDetail` and `TerrainDetail` are the bodies.
  The grids and strips still speak in ids, and `App` maps an id to a unit or a dragon.
  - **A die in a roll strip opens it too** (`RollStrip`'s `onInspect`), in the decision dock.
  - **"Look at dice"** is a toggle in the dock whenever the answer is dice. While it is on,
    `selectMode` is null everywhere, so every tap inspects. The selection draft is left exactly
    as it was. It is cleared, like every draft, when `pending` changes.
- **Everything off the board is on screen** (Phase 9e): a Reserves section with *both* Reserve
  Armies, and both Summoning Pools as dragon chips (`DragonRow`'s `inPool`). The enemy's reserve
  used to appear only while an SAI was aimed at it, and the pools nowhere. So a Reserve Army able
  to march and cast, and the dragons a Summon Dragon could bring out, were invisible.
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
  - **A monster has no class, and reads `MO` everywhere** — badge, tooltip ("Darktree — monster"),
    inspector head. The data gives every monster one because each species fields one monster per
    class line, but that is a fact about how the box is organised, not about the die: **Strangle
    Vine is filed under missile and has no missile face at all** beyond its ID, so `MI` on it was a
    promise its faces do not keep. `classOf` in `DiceGrid.tsx` is the one place either question is
    asked, and it is a display rule only — `unitClass` in the data is untouched and still what
    `npm run data` validates.
  - **A grid is ordered by `orderedForDisplay`**: monsters first as their own group, then by class
    in HM, LM, MI, CA, MA order, heaviest die first inside each group, name as a stable tiebreak so
    identical dice sit together and nothing shuffles between renders. Monsters lead for the same
    reason they lose the badge — sorting one into a class line it does not play is the same false
    claim. Presentation only — selection is by unit id and damage suggestions come from the engine,
    so no rule depends on it.
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
  that have been in the data since transcription. Inert under `magic: 'simplified'`; since Phase 7
  they are what an army's magic may be spent as, so the dots are now a thing you plan against
  rather than decoration.

## Saving

- **Saving is switched off, and the app opens on the start screen instead.** `useGame` calls only
  `clearSave`; `storage.ts` and `storage.test.ts` are kept whole and dormant, so turning it back on
  is `readSave` in the opening and `writeSave` in an effect after every action. The reason is the
  ladder: the rules move under the save format every phase, and a record written on Monday's rules
  and replayed on Friday's is a worse outcome than no record, while "pick the forces again" is two
  clicks. Everything below still holds for whenever it comes back.
  - **`SAVE_VERSION` did not move for this**, and that is the rule working rather than an
    oversight: nothing replays, so nothing can replay wrongly. The version is about replay
    correctness and nothing else -- see "Check the reason before bumping".
  - **`ErrorBoundary` reads the record off `useGame`, not out of storage.** `currentRecord()` is a
    module-level variable because the boundary sits *above* the hook: by the time it renders, the
    tree that held the game is gone. The seed plus the moves is the one thing worth having off a
    crash, so it survives saving being off.
- **A save is `{ setup, actions }` replayed on load, never a serialised state.** A few KB however
  long the game runs, and it doubles as a reproducible bug report.
- **A save in progress may be cleared before a phase lands.** Standing rule from v1 Phase 3 on, and
  it settles what `SAVE_VERSION` is *for*: replay correctness, and nothing else. The Phase 1 and
  Phase 2 second reason — "an old record goes on playing the old game with nothing on screen saying
  which" — is answered by wiping the save, not by the version. If a later phase is ever in doubt,
  bump and clear rather than reason about it.
- **Bump `SAVE_VERSION` in `storage.ts` whenever a change would make old action logs replay
  differently** — new phases, changed decision order, altered dice consumption. A mismatch is
  discarded with a message rather than replayed into a wrong game.
- **Check the reason before bumping, and write the true one down.** A record carries its
  `SetupOptions`, and `setupGame` pins an absent `ruleSet` to `V0_RULES` for good — so a save made
  before a rules flag existed replays under the old flag *correctly*, however much the engine has
  grown. Phase 1 is the worked example: `PLAN-V1.md` said to bump because rerolls change dice
  consumption, which was simply false. It bumped anyway, for the real reason — an old save would go
  on playing the v0 game while New Game starts a `'results'` one, with nothing on screen saying
  which. A bump justified by a hazard that does not exist trains reflexive bumping and devalues the
  discipline.
  - **A `RuleSet` that gains a key gives the next bump a second, harder reason.** A record stores
    its `ruleSet` as JSON, so a save written before the key existed would replay against an object
    the type says cannot exist — the new flag reading `undefined`, behaving as its off value by
    accident rather than by decision. That is the reason `storage.ts` records for version 5, beside
    the version-4 one.
- **A record written by the app names its ruleset.** `useGame` passes `ruleSet: SPECIES_RULES`
  explicitly rather than leaning on the default, so a save says which rules it was played under and
  goes on replaying under them -- which is also why Phase 4e's flip needed no `SAVE_VERSION` bump.
  Phase 6's bump to 8, Phase 7's to 9 and Phase 8's to 10 are for the new decisions and the dice they
  consume, not for the flip. Note what version 9's comment does **not** say: `magic: 'spells'` has
  been in the union since v0, so the "a `RuleSet` key reading `undefined`" hazard does not apply to
  it. Version 10's *does* say it: `speciesAbilities` is a new key, and a version-9 record would read
  it as `undefined`.

- **Wrap every `localStorage` access.** It throws in private windows, with site data blocked, and
  on a full quota. A game that cannot be saved must still be playable.

## Conventions

- Prefer narrow, named types over primitives — `PlayerId`, `TerrainId`, `Health` — because the
  engine passes a lot of small integers around and mixing them up is silent.
- Rules tests read as scenarios: build a state, apply an action list, assert. Combat and damage
  assignment get tests before implementation.
- Keep `docs/RULES-V0.md` §12 and `docs/OVERVIEW.md` §8 current. When a rules question gets
  answered, move it out of Open Questions and into the body.

## Git

- **Commit to `main`. Do not open a branch for a phase.** This is a solo project with a linear
  history and no review step, so a branch per phase buys nothing and costs a merge. Branch only
  when asked for one by name.
- **A phase is one commit**, with a message that carries what a future reader needs rather than a
  file list: what the plan predicted wrongly, anything that would have shipped silently, and
  anything deliberately *not* done — a skipped fuzz or an unregenerated golden file has to be
  visible as a decision, or the next person reads it as an oversight.
