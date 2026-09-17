# CLAUDE.md

Solo-play app for the dice game **Dragon Dice**. Human plays one side, the app runs the board,
the dice and the opponent.

> **Status: v0 alpha complete; v1 Phases 0, 1, 2 and 3 landed.** All nine phases of `docs/PLAN-V0.md` are done.
> The game is playable in the browser (`npm run dev`), in the terminal (`npm run play`),
> and installable as a PWA. It opens on a screen that picks the two forces and the seed; saving is
> switched off while v1 lands, so a reload starts there too. Since the alpha landed, the board grew to
> show every army at once and the eighth face started granting its two standard advantages
> (`eighthFace: 'standard'`).
>
> **Phases 0, 1, 2 and 3 of `docs/PLAN-V1.md` are done.** Phase 0 landed in three commits: a golden
> corpus of 25 recorded games (Phase G), the rulebook's ten-step roll pipeline replacing the sum
> inside `rollArmy` (0b), and forces rolled from the seed with the Frontier placed by the roll-off
> loser (0a). **Phase 1 added `sai: 'results'`** — the twelve SAIs that only add results, plus
> Rend's reroll. **Phase 2 added `dua: 'active'`** — the BUA, the promotion/recruitment/burial
> machinery, and Rise from the Ashes' death trigger. The app and CLI play `DUA_RULES`, which is
> both. **Phase 3 added `state.effects`** — effects with a duration, the Effects Expire Phase, and
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
> **Phase 4 is landing in five slices; 4a, 4b and 4c are done.** 4a was the seam and nothing else:
> the roll split four ways with `resolveFaces` pure, an exchange split into an attack step and a
> save step with the raw dice stashed in `CombatState.attack`, and `sai: 'full'` refusing per *name*
> rather than blanket. **4b added `sai_target` and `Flame`** — the first targeting SAI, the first
> caller of `killAndBury`, and the first decision addressed to somebody other than the owner of the
> dice at stake. **4c added `Sleep` and `Galeforce`** — the first two things in the project that
> write to `state.effects`, so Phase 3's machinery has a caller three phases after it was built. The
> 25 goldens replay byte-identical and unregenerated through all three. Still to come: 4d (the five
> sub-roll SAIs), 4e (Wild Growth, the free moves, Choke and Confuse, then the flip to
> `FULL_RULES`).
>
> **The app still plays `DUA_RULES`, so nothing built in 4b or 4c happens in a real game yet.**
> `'full'` refuses the eight unbuilt targeting SAIs *and* the two that need spells, so no force can
> play it until 4e — not even a monster mirror, since the Satyr also carries Confuse and the Genie
> carries Cantrip and Firecloud. Each slice has been verified in the browser against a **temporary
> scaffold**, reverted before its commit; read `PLAN-V1.md` §4b and §4c *Verification* before
> assuming the client surface is unexercised. **The scaffold is getting heavier each slice, and §4c
> ends with the question of whether 4d should flip the app early instead.**
>
> Worth knowing before picking one up: **both home terrains are Towers and the Frontier is a City**
> (Phase 0a gave each species a second die of its own type). So Tower's "may attack any terrain in
> play during a missile action" is the icon power that covers two of the three terrains here, and
> it is the smallest of the four — one condition inside `missileTargets` — which makes it a cheap
> way to start the eighth face long before Temple and Standing Stones become reachable. The City is
> now the *other* cheap one: Phase 2 built everything it needs, so it is a `Pending` and an
> `eighth_face` phase handler away, and it fires at the Frontier every turn.

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
   `dragons: false`, and stays exactly that -- it is what the golden corpus is recorded against.
   What the app plays is `DUA_RULES` = `SAI_RULES` + `dua: 'active'` = `V0_RULES` +
   `sai: 'results'` + `dua: 'active'`. Adding a cut feature means implementing behind its flag,
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
   mirrors it into the gitignored `public/faces/`; every face falls back to our own glyphs when
   that is missing, so a fresh clone is a complete game. Note that `npm run build` copies
   `public/faces/` into `dist/` — delete it before publishing a build. See `OVERVIEW.md` §5.

## Alpha house rules (easy to forget)

- **Magic is a melee variant**: same terrain only, roll magic, `damage = floor(total / 2)`. No
  save roll, no counter-attack. Elements ignored.
- **No magic from reserves**, so a Reserve Army cannot march at all in v0.
- **SAI faces produce zero results under `sai: 'inert'`** — but the face is still stored as
  `<count> SAI:<Name>`. That count is a result count for some SAIs and an X parameter for others
  (`2 SAI:Flame` targets two health-worth of units), so let each SAI interpret its own number.
  Twelve of the 25 are live under `sai: 'results'`; see `RULES-V0.md` §8 and `src/engine/sai.ts`.
- **`sai: 'full'` adds the SAIs that pick targets**, and on that rung an unbuilt one **throws**
  rather than going quiet -- the opposite of `'results'`. Flame, Sleep and Galeforce are built.
  Resolution order is roll order and multiples of one SAI always combine -- except Sleep and
  Galeforce, which p. 32 names as never combinable. All house rules, `RULES-V0.md` section 11.
  Nothing reaches this rung in a real game until Phase 4e.
- **The DUA is a graveyard under `dua: 'inert'` and a resource under `'active'`** -- promotion,
  recruitment, burial and Rise from the Ashes' death trigger. See `RULES-V0.md` §9. Still true of
  both rungs: **nothing in a game calls promotion or recruitment yet** (Phase 5's City is the first
  caller) and **nothing buries** (Phase 4's Flame).
- **Sleep and Galeforce are the first effects with a duration** (v1 Phase 4c) -- `RULES-V0.md` §10.
  Phase 3 shipped `Effect`, `expireEffects`, `pruneEffects` and the `asleep` status with no caller
  at all, deliberately; these two are it. Both are cast during the *attacker's* roll and bite in
  that same exchange, which is what the Phase 4a seam exists for. Under `DUA_RULES`, which is what
  the app plays, `state.effects` is still always empty -- and that is still not a bug.

- **Eighth face captures and wins** (two captures = victory) **and grants its two standard
  advantages**: the holder's army doubles all ID results when rolling *anything* there — attack,
  save or maneuver — and may take melee, missile or magic, while any army facing them at that
  terrain is restricted to melee. Still cut: the icon powers (City, Standing Stones, Temple,
  Tower), which is what `eighthFace: 'full'` will add.
- **No dragons and no spells.** Promotion and burying exist as machinery from v1 Phase 2, but
  `V0_RULES` still reaches neither.


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
       -> Horde roll-off -> Frontier set by the loser (no draw) -> terrain faces
  ```

  **A named force must consume no generation draws at all** -- not "the same draws", none -- or a
  named game lands on a different board than v0 gave it and the golden corpus quietly changes
  meaning. The generation steps live inside the random branch, not before it.
- **The roll-off's two prizes are split one each**: the winner marches first, the loser places the
  Frontier from the second terrain their species brings. The rules give the winner the choice of
  one *or* the other; that is a real decision and `PassiveAI` could hold no opinion about it, so
  `GreedyAI` gets the real rule in Phase 9. A house rule, recorded in `RULES-V0.md` section 7.
- **`SetupOptions.terrains` pins a die to a slot.** That is how a test says "a Tower, here", and it
  is what lets the golden corpus keep replaying the board it was recorded on now that the Frontier
  moves. Applied last, over whatever the species would have brought.
- **Named forces are `data/presets.json`, which the importers never touch.** `STARTER_FORCES` is
  the 30-health pair the alpha shipped with and the one the goldens are recorded against -- do not
  edit those two lists. `BESTIARY_FORCES` is 35 health and holds one of every monster and every
  large die, which puts **all 25 SAIs** on the board against the starters' 10; reach for it when a
  rule needs a die a rolled force might not draw. Both are in `FORCE_SETS` in `src/cli/play.ts`, so
  a new pair needs adding there to be playable from the terminal.
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
- **A roll is a ten-step pipeline, not a sum** (`pipeline.ts`, full rules p. 27). `resolveRoll`
  rolls the dice and runs steps 5–10; `rollArmy` is the one-type, one-number door onto it that the
  rest of the engine uses. **The running value is a triple per result type — `{ id, normal, sai }`
  — and that is forced, not stylistic**: step 6 removes ID results *last* and step 8 adds SAI
  results *after* step 7's divide, and neither survives a single subtotal.
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
    **The refusal is per *name*, not blanket**: `saiEffects` resolves any SAI that has a handler and
    throws only for one that has none, so a Phase 4 slice moves a name into `HANDLERS` and both
    rungs change together, with no second table to keep in step. Cantrip and Dispel Magic get their
    own message -- they wait on `magic: 'spells'`, not on this flag. `sai.test.ts` pins the exact
    three-way partition *and* checks it against the engine, so `npm run data` cannot add a name that
    falls through unnoticed and the list cannot drift from what actually throws.
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
  `resolveAttack`.
- **One combat exchange is up to nine steps, and `COMBAT_SEQUENCE` is the only thing that knows
  the order.** Four of them assign damage — the attack's, the riposte back at the attacker, the
  counter-attack's, and the riposte back at *that*. `finishExchange` and `applyAssignDamage` both
  route through `afterCombatStep`; they used to decide independently, which was survivable with one
  assignment per exchange and is not with two.
  - **An attack and its save roll are two steps, not one.** `beginExchange` rolls the attack and
    stashes the raw dice in `CombatState.attack`; `finishExchange` resolves those faces, rolls the
    saves and computes the damage. The seam exists so a targeting SAI can be chosen between them —
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
- **Effects with a duration are `state.effects` and `effects.ts`, and nothing produces one yet.**
  An effect targets an army *at a place* (it does not follow the units) or a unit (it does),
  carries `Modifier`s and/or the `asleep` status, and ends at the start of its caster's next turn.
  `expireEffects` runs in the `effects_expire` phase; `pruneEffects` runs from `stepGame` beside
  `syncCaptures`, which is the rules' "checked at the end of each action". **Both must return the
  same object when they drop nothing**, or `advance` never settles. Phase 4's Sleep and Galeforce
  are the first casters, as the City is for promotion.
  - **An army modifier must never reach a unit roll**, nor the reverse (full rules p. 28). That is
    why the entry point is named `armyRoll`: Phase 4's sub-rolls are the first unit rolls in the
    game and must gather their own.
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

  - **It runs `V0_RULES` only**, which is no longer the configuration anyone plays. Phase 1 turned
    the app over to `SAI_RULES` and deliberately did not add a second fuzz, so the live rules have
    no standing deadlock net — only unit tests. Worth knowing before trusting a green suite.
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
- **A die that cannot be picked says why.** A sleeping unit is dimmed and dashed (`.die-asleep`),
  tapping it inspects rather than selects, and its `aria-label` ends "— asleep". The engine refuses
  it as a retreat either way; this is what stops the choice being offered, and `sleepingIds` in
  `prompts.ts` is the one place either client asks. `RandomAI` filters its retreat pool by the same
  rule -- a decision that gains a dimension has to reach the fuzz opponent too.
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
  that have been in the data since transcription. They do nothing in v0 (no spells) but they are
  what makes the board legible at a glance.

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
- **A record written by the app names its ruleset.** `useGame` passes `ruleSet: DUA_RULES`
  explicitly rather than leaning on the default, so a save says which rules it was played under and
  goes on replaying under them.

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
