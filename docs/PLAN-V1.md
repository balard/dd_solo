# Implementation plan — v1

Eleven phases from the playable alpha to the **complete basic game for Treefolk vs Firewalkers**:
every SAI, every basic terrain and all four eighth-face icons, promotion and resurrection, the
five elemental dragons, every spell those two species can cast, and their species abilities. It
opens by replacing the two hand-authored forces with forces rolled from the seed.

Read `PLAN-V0.md` for how the alpha got here and `RULES-V0.md` for the subset it implements. This
document is the *order of work*. Where it and `RULES-V0.md` disagree, that is because v1 removes a
v0 house rule; §10 lists every one of those.

**Scope is two species, not the whole game.** Treefolk (Water & Earth) and Firewalkers (Air & Fire)
between them cover four of the five elements. Everything below is bounded by that: 25 SAIs, 6
terrain types, 18 spells, 4 reachable dragon elements. Adding species later is a data problem, not
a rules problem — and it is not in this plan.

---

## The one idea that makes this a plan and not a list

v0 computes a roll as a **sum**:

```ts
rollArmy(...)  ->  total = Σ faceResults(face, resultType, ruleSet)
```

The rulebook computes a roll as a **ten-step pipeline** (full rules, *Die Roll Resolution*, p. 27):

```
1  roll the dice
2  apply delayed effects           saves against an attack only
3  apply rerolls                   attacker's before defender's
4  apply SAIs                      one at a time, roller chooses order
5  subtotal non-SAI results
6  subtract                        ID results are removed last
7  divide                          round down, at most one per result type
8  add SAI results
9  multiply                        at most one per result type
10 add                             including every "counts as" conversion
```

**Every feature in this plan attaches to a numbered step of that pipeline.** SAIs are steps 3–4 and
8. Spells and dragon breath are steps 6, 7, 9 and 10. Species abilities are step 10. Eighth-face
ID doubling — already implemented — is step 9.

So v1 is not four features bolted onto v0. It is one refactor (Phase 0) followed by nine phases
that fill in a structure that already exists. Do Phase 0 first and alone, or every later phase pays
for it again.

**Dependencies:**

```
G  Golden files: 25 recorded v0 games          DONE  cut before anything moves
|
0b Roll pipeline                               DONE  proven by G
|
0a Setup: random forces + second terrain       DONE  re-proves G through its overrides
|
+--> 1 SAIs A: result generators               DONE
|
+--> 2 DUA, BUA, promotion --------+           DONE
|                                  |
+--> 3 Effects and durations ------+  DONE
                                   |
                        4 SAIs B: targeting     4a 4b 4c DONE; 4d 4e to go
                                   |
                        5 Terrains and eighth faces
                                   |
                        6 Dragons
                                   |
                        7 Spells   -> completes Cantrip, Dispel Magic, Standing Stones
                                   |
                        8 Species abilities
                                   |
                        9 UI and AI for v1
```

Phases 0a and 0b touch different files (`setup.ts` and `roll.ts`) and neither needs the other, so
either order compiles. **Do 0b first anyway.** Its whole value is a golden file proving it changed
no outcome, and that proof is strongest against a world where nothing else is moving; 0a changes
outcomes by construction. So: cut the goldens, land the refactor under them, then land setup and
watch the same goldens stay green through their terrain overrides (§0a, *Keeping the goldens*).

Phases 1, 2 and 3 are independent of each other and can be done in any order. **Tower (Phase 5a)
can be pulled forward to immediately after Phase 0b** — it is one condition in `missileTargets`,
and every terrain in play is a Tower until 0a puts a City at the Frontier, after which it is both
homes.

**Two rules hold for every phase:**

- **Each phase lands its own `Pending` kinds, prompts and AI answers.** `Pending` is a discriminated
  union that `promptFor`, `PassiveAI.decide` and `RandomAI.decide` switch on exhaustively, so a new
  decision is a compile error in all three. That is the design working; do not stub it with a
  `default:` branch and come back later. Phase 9 is for genuinely new *surfaces*, not for catching
  up.
- **The 1000-game fuzz stays green.** `runGame` over 1000 seeds with `RandomAI`, no result with
  `stoppedBecause === 'stuck'`. It is the cheapest bug detector in the project and it gets more
  valuable, not less, as the rules grow.
- **Test against dice that have the rule you are building.** The two hand-authored 30-health
  forces reach only **10 of the 25 SAIs**. The other 15 live almost entirely on the eight monster
  dice neither force takes — Genie, Gorgon, Phoenix, Salamander, Redwood, Satyr, Strangle Vine,
  Unicorn — plus the two h3 magic dice. Each force fields exactly one monster (Darktree,
  Fireshadow), and that single pick is what caps the coverage. The fuzz could run a thousand games
  under those forces and never once execute Firecloud, Flame or Seize.

  **Phase 0a fixes this as a side effect** — a random force draws from all 20 dice of its species,
  so monsters and their SAIs turn up constantly. That makes the fuzz meaningfully better at finding
  bugs and is a real argument for doing 0a early. It does not remove the obligation: a *unit* test
  still has to name the dice it is exercising, because a random force proves nothing about a
  specific SAI on a specific turn.

  For the cases in between, `BESTIARY_FORCES` is a named 35-health pair holding one of every
  monster and every large die of each species, and it reaches **all 25 SAIs** — the shape works
  because the fifteen the starters miss live almost entirely on the monster dice. It is a
  deliberately lopsided force, not a balanced one, and the goldens stay on `STARTER_FORCES`.

---

## Phase G — The golden files

**Deliverable.** 25 recorded v0 games, committed *before* a line of Phase 0 is written, and a test
that replays them.

`src/engine/__golden__/v0-games.json` holds `runGame` records — `RandomAI` on both sides, named
forces — each beside a **digest** of its final state: every unit to its location, the three
terrains, the turn state, `rng.counter`, the pending decision, `winner`, and the whole log as
key-sorted JSON lines. A digest rather than a hash, because a hash mismatch tells you only that
something moved, and the whole point of the file is to say *what*.

Cut them now and they measure both Phase 0 halves: 0b must reproduce them exactly, and 0a must
reproduce them through its overrides. Cut them after 0b and they only ever confirm what they were
generated from.

**The log is not redundant with the outcome fields, which is the thing to know before trimming
this file.** Tripling the eighth-face ID bonus as a test changed no unit's fate in the first golden
game — the attack was already lethal — and the only evidence of it was the per-die results in the
log. A roll that changes without changing an outcome is exactly what a refactor claims not to do,
so the dice stay. They are stored as `unitId@faceIndex=results`, which loses nothing (the face
follows from the unit and the index) and is five times smaller than the `DieRoll` it replaces.

**The 25 games are selected, not the first 25 seeds.** Random self-play mostly does not finish:
two thirds of seeds are still going at 800 decisions and the median winner takes 1100, so seeds
1–25 gave a corpus that was three fifths unfinished games and 6 MB. The recorder scans upward and
keeps the first 25 seeds that reach an ending inside 800 decisions (seeds 1–190, as it turns out),
which buys the two things that were missing: every game exercises capture, the win check and
`game_over`, and the file is 2.4 MB — 136 KB packed — instead. Breadth is not this file's job; the
1000-game fuzz does that, unselected, every run.

`src/cli/goldens.ts`, behind `npm run goldens`, regenerates the file. **Regenerating it is the one
move that can hide a bug**, so a commit that does it says why in its message. Replay is cheap — it
calls no AI — so the whole corpus checks in about 2.5 seconds.

---

## Phase 0a — Setup: random forces and the second terrain

**Deliverable.** Two changes to `setupGame`, each removing a choice the alpha made for you once and
then never again.

### Random forces

The two hand-authored 30-health presets are replaced by a force rolled from the seed. In order,
because the order *is* the RNG stream:

1. **Race.** One draw gives one player Treefolk and the other Firewalkers.
2. **Size.** One draw picks **24 or 36 health, shared by both players.** Rolling a size per player
   would make force size an asymmetry rather than a variety knob, which is a balance decision
   dressed up as a dice roll.
3. **Units.** Draw a unit type of that species at random, add it if its health fits the remaining
   budget, repeat until the budget is exactly zero. Duplicates are allowed — the real game lets you
   field several copies of a die. This always terminates on an exact total because every species
   has 1-health dice, so no backtracking is needed.
4. **Split.** Deal the units randomly into Home, Campaign and Horde under the two constraints
   `presets.ts` already validates: **every army holds at least one unit**, and **no army holds more
   than half the total health rounded down** (12 at 24, 18 at 36). A random deal violates these
   often enough that the repair path is the real work — make it a bounded retry, not a `while` loop
   that can spin.

The data makes step 3 well behaved. Each species has exactly 20 dice — **five at each health from 1
to 4, and four in each of the five classes** — so a uniform draw over types averages 2.5 health,
giving roughly 10 dice at 24 health and 14 at 36, about a quarter of them monsters.

**Uniform over types is not uniform over health**, and that is the knob to turn if forces come out
feeling wrong. Weighting toward the small end yields more, weaker dice and longer games; toward the
large end, a handful of monsters and swingy ones. Choose the distribution deliberately instead of
inheriting whichever one got written first, and keep it in one named function so it can be changed
without touching setup.

**Keep explicit forces as an option.** `SetupOptions.forces` should stay, with randomisation as a
second variant:

```ts
type ForceSpec =
  | { readonly kind: 'named'; readonly forces: Readonly<Record<PlayerId, string>> }
  | { readonly kind: 'random' }
```

This matters more than it looks. A test that wants Gorgon on the board must be able to *say so*,
the golden-file replays in Phase 0b need forces that never change, and `V0_RULES` needs a fixed
configuration to stay a regression baseline. Randomisation is how a game is set up, not how the
engine is tested.

Replay is unaffected either way: `GameRecord` is `{ setup, actions }`, `setup` carries the seed, and
force generation is a pure function of it. A record still reproduces the game die for die — it now
reproduces which race you were given too.

**`kind: 'named'` must consume no generation draws at all.** Not "the same draws", none: if setup
advances the RNG counter before the roll-off, a named force lands on a different board than it did
in v0 and every golden file quietly changes meaning. The generation steps belong inside the random
branch, not before the branch.

### The RNG stream

`CLAUDE.md` records the current order as "roll-off first, then terrain faces". This extends that
rather than reordering it, because the roll-off rolls the **Horde** army and the split is what
decides which dice are in it:

```
race -> size -> p1 units -> p1 split -> p2 units -> p2 split   (random forces only)
     -> Horde roll-off -> Frontier chosen by the loser (no draw) -> terrain faces
```

Choosing the Frontier consumes nothing — it reads the roll-off result — so it can sit between the
two without disturbing anything downstream. Write the order down in `setup.ts` next to the stream,
the way the existing comment does; it is the single easiest thing here to change by accident.

### The second terrain die

Each **species** gets a defined second terrain die, and the **loser of the Horde roll-off puts
theirs at the Frontier**.

`setup.ts` already throws on exactly this situation:

> `the two forces propose different Frontier terrains (...); choosing between them is a setup
> decision that does not exist yet`

This phase is that decision, and the throw goes away.

**This is deliberately not the written rule.** The full rules give the roll-off winner a choice —
take the first turn, *or* pick which proposed Frontier is used, in which case they go second. That
is a genuine strategic decision, and handing it to `PassiveAI` would mean an opponent that either
always picks the same way or picks at random; neither is a game. So v1 splits the two prizes one
each instead: **the winner takes the first march, the loser sets the Frontier.** No decision is
raised and nothing needs an opinion.

The real rule arrives with `GreedyAI` (Phase 9), which is the first thing in the project able to
hold an opinion about which terrain it wants to fight on. Until then this house rule sits in
`RULES-V0.md` §7 alongside the others.

A consequence worth planning for: `Preset` currently mixes two things — a species profile (home
terrain, second terrain) and a force (the unit list). Randomisation takes the force away, so what
remains is a per-species profile. Splitting the type now is cheaper than splitting it in Phase 5,
when six terrain types make the second-terrain choice actually interesting.

**What the two species actually propose.** The mechanism above moves nothing on its own: with three
terrain types in the box, both species already propose Highland. Element-matching leaves Treefolk
(water, earth) only Swampland and Highland and Firewalkers (air, fire) only Wasteland and Highland,
and each already spends one on its Home Terrain — so "the loser sets the Frontier" would set it to
Highland Tower every game, exactly as v0 does.

So each species' second terrain becomes **a second die of its own type**: Treefolk propose
Swampland, Firewalkers propose Wasteland. The roll-off loser fights on their own element, which is
a real consolation for marching second, and the Frontier finally varies by seed. The two dice must
differ from the home dice — the same die cannot stand in two slots — so the eighth-face icon is
what separates them: homes stay Tower, and both second terrains are **City**.

Two consequences, neither a problem here and both worth writing down before Phase 5 meets them:

- **Tower is still the icon to pull forward** (Phase 5a), but it now covers the two homes rather
  than the whole board.
- **The Frontier is always a City**, so from Phase 5 the most contested terrain grants its holder a
  promotion or a recruit every turn. That is a balance question for the phase that implements City,
  not for this one. The icon is one string in `data/presets.json`.

### Keeping the goldens

Changing what the Frontier die is means **named forces no longer reproduce the v0 board**, which is
what Phase G's records were recorded on. The fix is an escape hatch that setup wants for its own
sake:

```ts
readonly terrains?: Partial<Record<TerrainSlot, string>>   // explicit die per slot, applied last
```

The 25 stored setups gain `terrains: { frontier: 'highland_tower' }` and their digests must come
back **byte-identical**. That is a stronger check than the original wording: it proves 0a changed
the board and nothing else. Phase 5 needs the same hatch anyway — a test for Tower has to be able
to say "Tower, here" rather than hope the presets still agree.

**Exit criterion.** A seed alone produces a complete, legal setup: both races assigned, both forces
at the same legal total, all three armies non-empty and within the half-health cap, and a Frontier
die belonging to the roll-off loser. `validateState` accepts every one of 1000 seeded setups, and
the Phase G goldens replay unchanged through their terrain override.

**Tests.**

| Case | Expected |
|---|---|
| The same seed, twice | identical races, sizes, units, split and Frontier |
| 1000 seeded setups | every one passes `validateState`; totals are only ever 24 or 36 |
| Army split | no empty army, and no army over `floor(total / 2)` health across all 1000 |
| Unit draw | total health lands exactly on the budget, never over, never short |
| Roll-off | the Frontier die is the *loser's* second terrain, and the winner marches first |
| An explicit `firstPlayer` | no roll-off happens, so the *other* player is the loser and sets the Frontier |
| Persistent ties | the existing coin-flip fallback still resolves, and still sets a Frontier |
| `kind: 'named'` | consumes no generation draws; with a `terrains` override it is the v0 board |

**Bump `SAVE_VERSION`.** The Frontier die now depends on the roll-off, so an old log replays onto a
different board.

---

## Phase 0b — The roll pipeline

**Deliverable.** `resolveRoll` replaces the sum inside `rollArmy`, with **no change to any game
outcome**. This is a refactor phase and it must land as one.

```ts
interface RollSpec {
  /** One type for an ordinary roll; melee, missile and save for a dragon (Phase 6). */
  readonly kinds: readonly ResultType[]
  readonly modifiers: readonly Modifier[]
  /** Which type each ID counts as. Required, and spent exactly, for a combination roll. */
  readonly idAllocation?: IdAllocation
}

interface RollOutcome {
  readonly dice: readonly DieRoll[]
  readonly totals: Readonly<Partial<Record<ResultType, number>>>
  /** Everything that is not a number: targeting, rerolls, unsavable damage, moves. */
  readonly effects: readonly RollEffect[]
}
```

**`RollContext` — who is rolling, what the save is against, whether it is a counter — is Phase 1's,
not this phase's.** Nothing in 0b reads a field of it: `faceResults` does not take one and
`saiEffects` does not exist yet. Phase 1 has to revisit each call site anyway, because each one
supplies a different context, so declaring it here would buy nothing and fill it with placeholders.
What does have to land now is the *return* shape, which every call site destructures — that is the
argument for `totals` and `effects`, and it does not extend to the argument bundle.

Five changes hide inside this:

- **`totals` is a map, not a number.** A dragon attack is a *combination roll* — one roll counted
  for melee, missile and save at once, with the owner choosing what each ID becomes. v0's
  single-`resultType` roll cannot express that, and retrofitting it during Phase 6 means touching
  every call site twice.
- **`faceResults` keeps its signature and stays three lines.** The context goes to a new
  `saiEffects(face, context)`; the normal-icon path is untouched. Invariant 7 is not weakened —
  the count on the face is still the final answer.
- **`rollArmy` keeps its signature too, and becomes a wrapper.** `roll.test.ts` and
  `combat.test.ts` call it directly, `doubleIds` flag and all, and this phase's exit criterion is
  that every v0 test passes *unmodified*. So `resolveRoll` goes underneath it, not in front of it.
- **The working value is a triple per result type — `{ id, normal, sai }` — not a number.** This is
  what the pipeline's ordering actually requires and it is easy to miss: step 6 removes ID results
  **last**, and step 8 adds SAI results **after** the divide at step 7. Neither can be expressed
  against a single running subtotal, so the subtotal splits three ways and only collapses at
  step 10. Eighth-face ID doubling then stops being a per-die branch and becomes a step-9
  `Modifier` over the `id` share — same numbers out, one fewer special case in `rollArmy`.
- **No modifier reaches the pipeline from `GameState` at all.** The plan used to put an empty
  `Modifier[]` there; a field nothing writes is dead weight, and Phase 3 replaces it with
  `state.effects` regardless. The eighth face builds its own modifier at `rollArmy`'s door, so
  `resolveRoll` stays as free of `GameState` as `faceResults` is, and Phase 3 adds the seam when
  there is something to read through it.

Two divides, or two multiplies, on one result type is a **thrown error**, not a rejected action:
step 7 and step 9 each allow at most one, so a second one means the engine built an illegal
modifier list, which is a bug and not a move. `applyModifiers` takes the result type it is working
on and picks its own modifiers out of the list, rather than trusting the caller to have filtered —
those two rules are only meaningful if one function decides what "per type" means.

**The eighth face counts as its type's one multiplier**, rather than being exempt as an
ID-only one. The rulebook restricts "more than one modifier that multiplies applied to each type of
result" without saying which part of a roll each multiplies, so what a doubling *plus* a spell's
multiplier computes is unanswerable — and unreachable until Phase 7 produces the second. Phase 7
settles it; until then the pipeline refuses rather than inventing arithmetic.

**Per-die `results` keeps the doubling.** `DieRoll.results` is what the log and the roll strip
show, and the goldens record it, so it stays what it was in v0: the die's step-5 contribution with
the eighth-face doubling applied. The aggregate in `totals` is authoritative; this is the same
arithmetic on one die, and five dice that do not add up to the total on screen would be worse than
no dice at all.

**Exit criterion.** Every v0 test passes unmodified. Stash the new tests and the suite is identical.
No `SAVE_VERSION` bump — dice consumption has not changed.

**Tests.**

- The Phase G goldens: 25 recorded v0 games replay to byte-identical digests.
- Pipeline ordering, with hand-built modifier lists: subtract-then-divide differs from
  divide-then-subtract; a subtraction removes ID results last; two dividers on one result type is
  rejected.
- A combination roll counting melee+missile+save lets one ID split across types and never
  double-counts it. Per-die ID provenance is kept in the outcome and a `splitIds` allocator spends
  it, so the test is real rather than a promise Phase 6 has to keep.

---

## Phase 1 — SAIs A: result generators — **landed**

**Delivered.** `ruleSet.sai: 'inert' | 'results' | 'full'`, with `'results'` implemented and
`SAI_RULES` (`V0_RULES` + `sai: 'results'`) now what the browser app and the CLI play. `'full'`
still throws; it is Phase 4. `V0_RULES` is untouched and the 25 goldens replay byte-identical.

**Twelve SAIs, not eleven.** `Counter`, `Volley`, `Fly`, `Hoof`, `Trample`, `Create Fireminions`,
`Smite`, `Surprise`, `Rend`, the maneuver halves of `Firewalking` *and* `Teleport` — two dice, one
line of prose, and the count was wrong in this document and in three others until a test pinned it
— and the save half of `Rise from the Ashes`. The other thirteen are **silently inert** on this
rung, which is what makes `'results'` playable rather than a half-built `'full'`.

The rules themselves live in `src/engine/sai.ts`: a dispatch table over a `RollContext`, taking no
`GameState`, no unit and no RNG, so every one is testable from a face literal the way `faceResults`
is. Everything else in the phase was plumbing.

**`RollContext` is what a roll is *for*; `RollSpec.kinds` is what it *counts*.** Neither derives
from the other — they agree for every roll in this phase and stop agreeing at Phase 6's combination
roll — and the distinction is what makes a Fly on a monster face worth exactly nothing in a melee
attack. This is the field Phase 0b deliberately did not declare, and it was right not to: every
call site supplies a different one.

### Where this section was wrong

- **`CombatState.damage` did not split into `savable` and `unsavable`.** Nothing in Phase 1 reduces
  one and not the other, so a second field would have been a field nothing reads — and an
  always-present one rewrites four golden digests for nothing. `AttackOutcome` reports `unsavable`
  and the log prints it, purely so `3 melee − 5 saves = 4 damage` explains itself.
- **One exchange now produces up to *four* damage assignments, not two.** A counter-attack is a
  melee attack, and Surprise is explicitly excluded from counters while Counter is not — so the
  defender's Counter ripostes, and then the marcher's Counter ripostes back during the
  counter-attack's save roll. `COMBAT_SEQUENCE` and one forward walk replaced the two sites that
  used to decide independently what came next.
- **"Reroll order is fixed by the rules" was only half true.** Attackers-before-defenders was free,
  since the two rolls are already sequential. What actually had to be decided was *two passes, not
  interleaved* — step 1 is every die, step 3 is a separate sweep — and *FIFO, not depth-first*.
  With Rend on one face of one unit type both choices are unobservable today and load-bearing
  forever once a game is recorded, which is exactly how they get made by accident.
- **No new `Pending` kind was needed.** The riposte assignments reuse `assign_damage`, so
  `promptFor`, `PassiveAI` and `RandomAI` needed no new branch. Phase 4 lands two.

### Five things that would have shipped silently

Worth reading before Phase 4, because three of them are the same shape:

1. **`rollArmy` discarded `RollOutcome.effects`, and `combat.ts` only calls `rollArmy`.** Counter,
   Volley, Smite and Surprise would all have been computed correctly and dropped on the floor with
   every test green. `pipeline.ts`'s promise that a real `RollEffect` member becomes "a compile
   error at once" was false — `RollResult` never had the field. It does now, and the rolls with
   nowhere to put an effect (`maneuver`, the roll-off) *refuse* rather than drop: `expectNoEffects`
   and `expectOnly`. That is the guard Phase 4's free-move effects need.
2. **`{ ...combat, damage }` leaked the attack's `riposte` into the counter-attack**, assigning the
   same damage twice. Invisible to the goldens and to any total-checking test. Build the next
   `CombatState` field by field.
3. **`resolveAttack`'s zero-attack early return dropped `unsavable` and `counterSuppressed`.** The
   "no save roll, no randomness consumed" rule keys off the *attack total*, not the damage — a
   Smite-only attack rolls zero melee, earns the defender no save roll, and still kills.
4. **The combat walk stepped straight into the counter-attack's assignments**, which read a
   `combat.damage` the counter had not written yet. `resolve_counter` is a gate, not a step to skip
   past. Caught by a golden replay.
5. **Whether the counter is offered had to stay in `stepMarch`, not in the walk.** When an attack
   wipes out the defender the game is already won, `stepGame` returns on the victory check first,
   and four recorded games end standing on `offer_counter`. Deciding it one step earlier ended the
   march instead and changed a digest.

**The golden constraint, stated once because Phase 4 meets it again.** `digestState` puts
`stableJson(state.turn)` and every log entry verbatim in the digest, and four of the twenty-five
games end with a non-null `combat`. So every new `CombatState` or `combat_resolved` field is
**optional and omitted, never `0` or `false`**, and booleans are typed `?: true` rather than
`?: boolean` so `exactOptionalPropertyTypes` makes the falsy-but-present value a compile error.
`counter_suppressed` is a separate log entry for the same reason. `DieRoll` and `Pending` are free
to grow — the digest renders dice as `unitId@faceIndex=results`, and every golden ends with
`pending: none`.

**Exit criterion.** `sai: 'inert'` still works and still produces the v0 results — the flag is
real, not decorative, and the 25 goldens replay byte-identical to prove it. ✅

> **Landed with the fuzz deliberately skipped.** The original criterion here was "`sai: 'results'`
> plays 1000 fuzz games clean", and no such test was added: the suite still fuzzes `V0_RULES` only.
> A 1000-game run under `'results'` *was* done once, by hand, as verification — 0 stuck, 0 throws,
> every intermediate state through `validateState`, and every one of the twelve SAIs firing (Rend
> rerolled in 111 games, ripostes landed in 424, Surprise in 372) — but it is not in `npm test`, so
> **`'results'` has no standing deadlock, crash or invariant net**. If it is ever added, it needs
> per-SAI trigger counters asserted `> 0` beside `stuck === 0`: Rend is one face on one of forty
> unit types, so a clean run proves nothing about it on its own.

**Tests, as delivered.** `src/engine/sai.test.ts` — the twelve handlers against the reference text,
the rung boundaries, the roll, one exchange, and the combat sequence.

| Case | Expected |
|---|---|
| Trample in a maneuver roll | generates maneuver *and* melee; the roll counts only what it counts |
| Fly and Hoof in an attack roll | **nothing** — four monster icons worth zero, which is the `Applies` column doing its job |
| Counter on a save vs melee | saves counted, and damage back at the attacker, who gets no save roll |
| Volley on a save vs missile | the one riposte that crosses terrains: damage lands where the shot came from |
| Smite alone | no melee results, no save roll, RNG consumed equals the attackers only, damage = X |
| `3 SAI:Smite` on an Oak Lord | 3 damage — the one non-4 count in scope, and a hardcoded 4 fails only here |
| Surprise on a counter-attack | no effect; Counter on the same exchange still fires |
| Rend | two draws for that one unit and one for every other; no reroll on a maneuver roll |
| Rend into an ID face at a captured terrain | the rerolled ID doubles — where step 3 and step 9 meet |
| Every `sai` string in the data | claimed by exactly one of the two rungs, so `npm run data` cannot add a silent one |
| `V0_RULES` after one exchange | `Object.keys(turn.combat)` is exactly `action, damage, targetSlot` |
| `sai: 'inert'` | every SAI face still yields 0 and `faceResults` still throws on `'full'` |

Also changed: `maxArmyResults` **no longer bounds a roll's total**, because Rend puts a die in the
roll that the army does not contain. Bound a roll by its own `dice` instead —
`Σ maxResults(unitType(die.typeId), …)` — which is a better property anyway and stays true under
any future reroll source.

**Bumped `SAVE_VERSION` to 4** — but not for the reason this line used to give. Rerolls do *not*
make an old log replay differently: a record carries `SetupOptions`, the app wrote no `ruleSet`
before this phase, and `setupGame` pins an absent one to `V0_RULES` for good, so every version-3
save replays byte-identically. The real reason is that it would go on replaying the v0 game while
the New Game button starts a `'results'` one, with nothing on screen saying which. A bump justified
by a hazard that does not exist trains reflexive bumping and devalues the discipline, so
`storage.ts` records the true one.

### Landed alongside, and not planned here

Phase 9 owns the v1 surfaces, but three things could not wait without leaving the phase illegible
or untestable:

- **The log explains its own arithmetic.** `combat_resolved` gained optional `unsavable` and
  `riposte`, and `counter_suppressed` is a new entry — without them a march just ends, or a damage
  number appears that the attack and save totals do not account for. Rendered in both
  `LogPanel.tsx` and `src/cli/play.ts`.
- **`BESTIARY_FORCES`** — a named 35-health pair holding one of every monster and every large die,
  which puts **all 25 SAIs** on the board against the starter lists' 10. `FORCE_SETS` in `setup.ts`
  is the shared registry behind the CLI's `--forces` and the app's `?forces=`. This is the standing
  answer to "test against dice that have the rule you are building", for every phase from here on.
- **`?forces=bestiary&seed=7`** in the browser, since named forces were otherwise terminal-only.
  The request is honoured once and stripped from the address bar, so a refresh resumes the game
  rather than restarting it.

### What Phase 4 inherits

- A working reroll sweep (step 3) — Bullseye, Double Strike and Tail plug into it, and the two-pass
  shape is what lets them reroll at a different point than Rend does.
- `RollContext`, which already tells a save roll against melee from one against missile.
- `COMBAT_SEQUENCE`: a new step is an entry plus a `stepHasWork` arm, not another branch.
- The refusal guards, which are what stop a targeting effect being computed and then dropped.
- The golden constraint above, unchanged and still binding.

---

## Phase 2 — DUA, BUA, promotion, recruitment — **landed**

**Delivered.** `Location` gained `bua`; `src/engine/dua.ts` holds `promotionPartners`,
`promotionMatching`, `promote`, `recruit`, `bury` and `exchangeWithDua`; `src/engine/death.ts`
holds `killUnits` and `buryUnits`. A new `ruleSet.dua: 'inert' | 'active'` switches it on, and
`DUA_RULES` (`SAI_RULES` + `dua: 'active'`) is now what the browser app and the CLI play.
`V0_RULES` is untouched and the 25 goldens replay byte-identical, unregenerated.

**Promotion is an exchange, not a stat change.** Invariant 4 says damage kills whole units; the same
logic applies upward. A 2-health Oak promotes by swapping with a 3-health Treefolk unit *in the
DUA* — if the DUA has no such unit, promotion simply does not happen. Nothing gains hit points, and
the swap moves `location` and never `typeId`: a unit id embeds its type's short name, so rewriting
the type would make every id and every golden digest line lie about the die it names.

Three rules from p. 31 are easy to miss and each got a test: multiple exchanges resolve
**simultaneously** (choose all partners, then swap); an army whose every unit is exchanged is still
considered present, so army-targeted effects survive; exchanged units are **never considered
killed**, so no death trigger fires.

### Where this section was wrong

- **Wild Growth is not in this phase. It moved to Phase 4.** "Completes Wild Growth" read it as
  needing only promotion; the rulebook (p. 44) lets the roller *split X between save results and
  promotions*, which is a decision taken between the save roll and the damage calculation.
  `resolveAttack` is a pure roll → saves → damage pass and `resolveExchange` logs `combat_resolved`
  off its result, so the split needs a new `COMBAT_SEQUENCE` step and a `CombatState` that can hold
  a half-finished save roll — the same seam Phase 4 builds for Bullseye, Double Strike, Smother,
  Firecloud, Choke and Confuse. Building it here for one SAI on two Treefolk dice and again there
  for six more was the trade refused. `sai.test.ts`'s pinned 12 / 13 rung split is therefore
  untouched by this phase.
- **The scope flag is `RuleSet.dua`, not a fourth `sai` rung.** What this phase switches on is a
  fact about the DUA, not about roll resolution: the death trigger fires on burial and (Phase 6) on
  dragon breath, in no roll at all, and City, Temple, dragon-slaying and Resurrect Dead all need
  the machinery while keying off their own flags. A fourth `sai` value would have redefined a rung
  that had already landed and re-gated the `'full'` throw.
- **"`validateState` gains a check that no unit is in two places" was a check that cannot fail.**
  A unit's location is one field on the unit and there is no parallel DUA list to drift from —
  `validate.ts` says so in its own header. What Phase 2 *did* make reachable is a unit changing
  sides, since `exchangeWithDua` is the only operation in the game that moves a die between two
  players' areas and `speciesOf` reads the species off whichever unit it finds first. So the check
  added is **every unit of a player shares one species**, plus a location-kind guard.
- **Rise from the Ashes was documented wrong in `sai.ts`.** Its comment said an *ID* sends the unit
  to Reserves; the reference says "If **Rise from the Ashes** is rolled" — 2 faces in 10 on the
  Phoenix, not 1. It also fires on **burial as well as death**, and an effect that both kills and
  buries gives two rolls with the first success preventing the burial. All three are tests.

### Two things that would have shipped silently

1. **`livingUnits` was `location.kind !== 'dua'`** — a negative test. The moment `bua` existed that
   would have counted every buried die as alive, so a player whose last unit was buried would never
   lose, and `validateState`'s winner-has-units check would have agreed with it. It is now stated
   positively over `terrain | reserve`, so a future `Location` member has to be opted *into* it.
2. **The death trigger consumes randomness, on the one path every v0 game takes.** `killUnits` is
   `applyDamage` and nothing else under `dua: 'inert'` — one stray draw there shifts `rng.counter`
   and every die after it in all 25 goldens. That is a first-class test rather than something the
   corpus is left to notice.

**Exit criterion.** A unit can travel army → DUA → army by promotion and by recruitment, and
army → BUA with no way back. ✅

> **Landed with the fuzz deliberately skipped again**, as in Phase 1: `npm test` still fuzzes
> `V0_RULES` only, so `DUA_RULES` has no standing deadlock net. Two runs *were* done by hand as
> verification — 1000 rolled-force games and 400 bestiary ones, 0 stuck, 0 throws, `validateState`
> clean throughout, 57 and 33 rises respectively, and nothing ever buried — but none of it is in the
> suite. The gap is now two phases wide; see Risks.

**Tests, as delivered.** `src/engine/dua.test.ts` (18 cases) and `src/engine/death.test.ts` (13).

| Case | Expected |
|---|---|
| Promote with an empty DUA | no pairs, no-op, no error |
| Three Oaks, two dead Oak Lords | two promote; the third does not, and no Oak demoted by this exchange is used as a partner |
| An Oakling beside a promoting Oak | the Oak's arrival in the DUA is not available to the Oakling — simultaneity, and the case that fails if the implementation loops |
| The same pairs in reverse order | identical `units`, because every location is read off the original state |
| An army of one unit, exchanged | still length 1 at that terrain |
| A partner two health up, or of another species | refused |
| A buried unit | not in the DUA, not a promotion partner, not recruitable, and not in `livingUnits` |
| `recruit` of a 2-health unit | refused: only small units are recruited |
| A Phoenix killed under `dua: 'inert'` | in the DUA, and `rng` is byte-identical — no draw at all |
| A Phoenix seeded onto a Rise face | in Reserves, one draw, `units_risen` logged |
| A Phoenix seeded onto any other face | dead, one draw — the condition is a Rise face, not an ID |
| A Fireshadow killed under `dua: 'active'` | no draw: it does not carry the SAI |
| The same units named in another order | identical result — the roll order is the board's, not the player's |
| Kill-and-bury | two rolls, and a success on the first means there is no second |
| An `assign_damage` answer through `reduce` | `units_killed` then `units_risen`, and nothing logged when nothing rises |

**Bumped `SAVE_VERSION` to 5.** Two reasons, and the second is the stronger: a version-4 record is
a version-4 game with nothing on screen saying so (the Phase 1 reason, again), and it carries a
serialised `ruleSet` object with **no `dua` key**, so replaying it would run the engine against a
`RuleSet` the type says cannot exist — behaving as `'inert'` by accident rather than by decision.

### What later phases inherit

- `exchangeWithDua` and its simultaneity rule, which City, Temple, dragon-slaying and Resurrect
  Dead all sit on. **Nothing calls promotion or recruitment in a game yet** — that starts with the
  City in Phase 5, and the Frontier is always a City.
- `bury` and `buryUnits`, so Phase 4's Flame is one call.
- `killUnits` as the seam every death now passes through, which is where Phase 8's Treefolk
  Replanting and Phase 6's Fire breath plug in.
- A warning for Phase 4: `units_killed` carries a `TerrainSlot`, and a burial out of the DUA has
  none. Either that field widens or burial needs its own log entry.

---

## Phase 3 — Effects and durations — **landed**

**Delivered.** `GameState.effects`, `src/engine/effects.ts`, and the Effects Expire Phase doing
something. `rollArmy`'s `doubleIds: boolean` became `modifiers: readonly Modifier[]`, and
`armyRoll(state, player, ref, resultType)` is now the one door every army roll goes through: it
returns the dice that may be rolled *and* everything modifying the result, together, so a call site
cannot take one and forget the other. `doublesIds` moved out of `combat.ts` and into `effects.ts`
with it. The 25 goldens replay byte-identical and unregenerated.

**Sleep and Galeforce moved to Phase 4**, which is the decision this phase turns on; see *Where this
section was wrong*. So it ships **machinery with no caller**, exactly as Phase 2's `promote` and
`recruit` did, and `state.effects` is empty in every game the project can currently play.

```ts
export type EffectTarget =
  | { kind: 'army'; player: PlayerId; army: ArmyRef }
  | { kind: 'unit'; unitId: UnitId }

export interface Effect {
  readonly source: string                    // spell name, SAI name, breath element
  readonly target: EffectTarget
  readonly modifiers: readonly Modifier[]    // feeds pipeline steps 6, 7, 9, 10
  readonly asleep?: true                     // Sleep: a status, not arithmetic
  readonly expiresAtStartOfTurnOf: PlayerId
}
```

Three rules from *Army Modifiers* (p. 28) determine the shape, and a fourth from *Roll Modifiers* on
the same page determines the entry point's name:

- An army effect is **fixed to a location**, not to the units. If the army marches away, the effect
  does not follow. This is why `target` names an `ArmyRef`, not a unit list.
- An army effect **ends when the army has no units left**, checked at the end of each action — but
  not if every unit was replaced in a single exchange (Phase 2). `pruneEffects` runs from `stepGame`
  beside `syncCaptures`, which *is* "the end of each action", since `applyAction` never sets
  `pending`.
- A unit effect **follows the unit** into another army, which it does for free by naming a `UnitId`.
- "**Modifiers that affect an army do not affect the roll of an individual unit** from that army.
  Modifiers that affect an individual unit do not affect the roll of an army." Hence `armyRoll`
  rather than `rollModifiers`: Phase 4's sub-rolls are the first unit rolls in the game, and they
  must not come through it.

### Where this section was wrong

- **"Completes Sleep and Galeforce" was the whole scope, and it was not deliverable here.** Both are
  *targeting* SAIs — "target one unit in an opponent's army at this terrain", "target an opposing
  army at any terrain" — and both fire during an **attack** roll, so the target is chosen before the
  defender rolls for saves. `resolveAttack` computes attack → saves → damage in one pure pass, so
  resolving either correctly needs a pause in the middle of it: the same seam Phase 4 builds for
  Wild Growth, Bullseye, Choke and Confuse. Phase 2 moved Wild Growth out for exactly this reason;
  building the pause here for two SAIs and again there for six more is the same trade, refused the
  same way. They are in the Phase 4 table below.
- **No `RuleSet` flag, unlike Phases 1 and 2.** With no producer a flag would gate nothing
  observable — the "field nothing reads" this project refuses elsewhere. The machinery is a no-op
  over an empty list, so it simply runs. Phase 4 gates its producers with `sai: 'full'`, which it
  was going to do anyway.
- **`Effect` lost three things the sketch gave it.** No `id`/`EffectId`: nothing removes an effect by
  name — expiry is by player, pruning is by predicate — and Phase 7's Dispel Magic is the first
  thing that would need one. No `terrain` target: the p. 28 rule above has an army side and a unit
  side, so a third member would be a branch nothing gathers. And `expiresAtStartOfTurnOf` is **not
  nullable**: an instantaneous effect never enters the list and nothing in scope is permanent, so
  the null branch was unreachable.
- **`modifier: Modifier` had to become `modifiers: readonly Modifier[]`.** Galeforce is two of them
  — subtract 4 save, subtract 4 maneuver — and a `Modifier` carries exactly one `resultType`.
- **"Two castings of a non-cumulative effect do not combine" describes nothing in scope.** The only
  caps the rules state are one divide and one multiply per result type, which `applyModifiers`
  already enforces; two Galeforces are two subtracts and stack to −8. There is no non-cumulative
  effect to contrast it with until spells arrive.
- **"Rejected as a … reinforce target" is not a reachable case.** Sleep targets a unit in an army at
  a terrain, and the Reinforce Step moves units *out* of Reserves — so retreat is the only mover a
  sleeping unit can be refused by. Phase 4's free moves are the next one.

### One thing that would have shipped silently

**`expireEffects` and `pruneEffects` must return the same object when they drop nothing.** `advance`
loops on `stepGame` until it returns the state it was handed, so an unconditional
`{ ...state, effects }` in either is an infinite loop — and `pruneEffects` is called from `stepGame`
on every step. It fails loudly (`advance` throws after 1000 steps) rather than silently, but it is
the first thing to check if the game stops settling. Both are tests.

Also worth knowing: **the victory check runs before the prune**, so on a board where one side has no
units `stepGame` ends the game and never prunes. That is the right order, and it cost one test its
first draft.

**Exit criterion.** An effect cast on turn N is gone at the start of turn N+1 of its owner and not
before; a sleeping unit contributes no dice to any roll, is refused as a retreat, and still dies
normally. Restated for a phase with no caller: **the machinery does all of that to a hand-built
effect, while a `V0_RULES` game plays die for die as it did before.** ✅

> **The fuzz was skipped a third time**, as in Phases 1 and 2: `npm test` still fuzzes `V0_RULES`
> only. It is doing more than it looks here — it is what proves the `rollArmy` signature change and
> the new `stepGame` prune step broke nothing — but no game it plays can produce an effect, so
> nothing this phase adds has a deadlock net either. The gap is now three phases wide; see Risks.

**Tests, as delivered.** `src/engine/effects.test.ts` (18 cases), plus one in `prompts.test.ts`.

| Case | Expected |
|---|---|
| Cast on p1's turn | survives p2's whole turn; gone at p1's next `effects_expire`, `effects_expired` logged |
| A real turn change through `reduce` | the Retreat Step ends the turn and the next player's Effects Expire Phase does the work |
| `expireEffects` / `pruneEffects` with nothing to drop | the **same object**, or `advance` never settles |
| An army with no units left | its effects are gone by the next `stepGame` |
| An army whose every unit is exchanged | keeps them — `exchangeWithDua` is one pass, so the army is never observed empty |
| A unit effect, unit moved to Reserves | follows it |
| An army effect, a die retreating out from under it | stays at the terrain; the Reserve Army picks nothing up |
| `armyRoll` at a captured terrain under Galeforce | two subtracts **and** the eighth face's one multiplier |
| Two castings on one army | stack; two dividers on one type still throw |
| A sleeping unit in a melee, save or maneuver roll | not in the roll, and **no randomness consumed for it** |
| A sleeping unit in an attacked army | still in `armyAt`, still counts toward the army, still dies |
| Retreating a sleeping unit | `IllegalActionError`; the die beside it still goes |
| `validateState` on an unpruned effect, or one naming a vanished unit | one named complaint each |

**`SAVE_VERSION` stays at 5**, and this is the first phase where the answer is simply "no". Nothing
here changes phases, decision order or dice consumption — modifiers consume no randomness, the prune
step returns the same object, and `setupGame` starts `effects` empty — so a version-5 record replays
byte-identically. The Phase 1 and Phase 2 *second* reason, "an old record goes on playing the old
game with nothing on screen saying which", no longer applies at all: **a save in progress may be
cleared before a phase lands**, which is the standing rule from here on (`CLAUDE.md`, *Saving*), so
the version guards replay correctness and nothing else.

`digestState` gained an `effects` line and `golden.test.ts` reads an absent one as `[]` — the corpus
predates the field, and an absent one means none, which is what a `V0_RULES` game has. That is the
honest alternative to regenerating 25 games for a field empty in all of them.

### What later phases inherit

- `armyRoll`, where Phases 4, 6, 7 and 8 hang everything they add to a roll. A new source of
  modifiers is an entry in `state.effects`, not a new parameter at six call sites.
- The army-versus-unit rule above, already stated in the naming: Phase 4's sub-rolls must **not**
  call `armyRoll`, and that is the first test that rule can have.
- `expireEffects`, the home for every duration in Phases 6, 7 and 8 — dragon breath, and every spell
  lasting "until the beginning of your next turn".
- The `asleep` status and its two consumers — the retreat refusal, and the clients' selection
  filters — waiting for the Sleep that Phase 4 now owns.

---

## Phase 4 — SAIs B: targeting

**Deliverable.** `sai: 'full'`. The SAIs that pick targets, plus the two that move units.

> **Landing in five slices, one commit each. 4a is done.**
>
> | Slice | Scope | State |
> |---|---|---|
> | **4a** | The seam: the roll split four ways, the exchange split in two, `'full'` refusing per name | ✅ landed |
> | **4b** | `sai_target`, `targeting.ts`, **Flame**, and the whole client surface (enemy-selectable board, prompts, CLI, both AIs) | ✅ landed |
> | **4c** | **Sleep** and **Galeforce** — the first `state.effects` producers, and `sai_target_army` | ✅ landed |
> | 4d | The sub-rolls: **Bullseye, Double Strike, Smother, Firecloud, Seize**, via `rollUnits` / `unitRoll` | |
> | 4e | **Wild Growth**, the free moves, **Choke** and **Confuse**, then the flip to `FULL_RULES` | |
>
> One commit per slice rather than one for the phase, against `CLAUDE.md`'s usual rule, for the
> Phase 0b reason: 4a delivers nothing a player can see and its entire value is the 25 goldens
> proving it changed no outcome. That proof is only worth something against a commit where nothing
> else is moving. Every later slice changes outcomes by construction.

### 4a — the seam — **landed**

**Delivered.** `resolveRoll` became the composition of `rollFaces` (step 1), `rerollSweep` (step 3)
and **`resolveFaces` (steps 4-10, pure)**, over a new `RawDie`. An exchange became two march steps
— `resolve_attack` / `resolve_attack_saves`, and the same for the counter — with the attack's raw
dice stashed in `CombatState.attack` between them. `sai: 'full'` stopped throwing for every SAI and
started throwing only for one no handler claims. No SAI changed rung, the app still plays
`DUA_RULES`, and the 25 goldens replay byte-identical and **unregenerated**.

#### Where this section was wrong

- **"Split `resolveRoll` at the step-1 / step-2 seam" was the wrong split.** It gives a delayed
  effect somewhere to stand and nothing else. What every pause in this phase actually needs is a
  **pure recompute** — resolve the same faces once to discover the question and again with the
  answer, drawing nothing in between. Without that, `CombatState` has to carry `DieRoll[]` (fat,
  with a `Face` object, and inside `stableJson(state.turn)`) and Wild Growth's answer has nowhere
  to go but bolted onto the final total, which is step 10 pretending to be step 8. Hence four
  functions rather than two, `RawDie` rather than `DieRoll`, and `RollSpec.saiResults`.
- **The plan did not mention the two early returns, and both would have shipped silently.**
  `resolveAttack` returned before the save roll for magic and for a zero-total attack. Leaving
  either in front of the targeting step means a Galeforce on a magic action ("or a magic action at
  a terrain") or a Flame on a zero-result roll is computed correctly and dropped on the floor with
  every test green. That is Phase 1's bug #3 for the third time, and the third different disguise.
- **Threading a `rung` argument through `SaiHandler` was premature and is not done.** The plan's
  argument for it was Firewalking and Teleport, which are live on both rungs — but their free-move
  half is 4e, so in 4a the parameter would have had no reader. `PLAN-V1.md` Phase 0b refused to
  declare `RollContext` early for exactly this reason; the same answer applies here. What 4a
  actually needed was the *partition* — handler present, `NEEDS_SPELLS`, or refused — which works
  without it. Add the argument in 4e, with its first reader.
- **`rollDice` was already taken.** `rng.ts` exports a `rollDice(rng, faceCounts)` that turns face
  counts into indices, and `sai.test.ts` imports it. The step-1 function is `rollFaces`, which
  pairs with `resolveFaces` and collides with nothing.

#### Two things that would have shipped silently

1. **`saiMaxResults` read `if (ruleSet.sai !== 'results') return 0`.** Correct for `'inert'` and
   wrong for `'full'`, which generates *more* than `'results'` does — so `maxArmyResults` would
   have under-bounded every roll the moment a targeting SAI generated a result, and the symptom
   would have been a ceiling quietly below what the dice can do. It is now `=== 'inert'`, plus an
   unclaimed-name guard so the bound answers instead of tripping the new refusal.
2. **`faceResults` carried a second copy of the `'full'` refusal.** Right while `'full'` threw for
   every SAI alike; wrong the moment one is implemented, because that function cannot tell a
   Counter from a Choke and would have refused the twelve that work. One place refuses now, and it
   is the one that knows the names.

**Exit criterion.** Every existing test passes, the 25 goldens replay byte-identical and
unregenerated, and `resolveRoll` is provably the composition of its three parts. ✅

**Tests, as delivered.** `roll.test.ts` gained a *the roll pipeline, split* block (composition,
step-1 ordering, purity, and step-8 placement); `sai.test.ts` gained *the two halves of an
exchange* (the stash exists mid-exchange, is gone after, is a `validateState` complaint if it
survives, and magic routes through both steps) plus the three-way rung partition, which now checks
its own list against what the engine actually throws.

> The step-8 test was **mutation-checked**: folding `saiResults` in before step 7's divide makes it
> report 4 where the right answer is 6. Worth doing, because the first draft of that test used a
> seed whose raw save total was 0 and would have passed against either implementation.

**Verified by hand, beyond the suite.** 180 `RandomAI` games — 60 each of starter/`DUA_RULES`,
bestiary/`DUA_RULES` and rolled/`SAI_RULES` — 9,200 exchanges through the new two-step path, 0
stuck, `validateState` clean on every final state including the new `combat.attack` lifetime check.
And one missile attack driven through the browser at `?forces=bestiary&seed=7`, which logged
"4 missile − 4 saves = 0 damage" with both terrains named and no console errors.

**No `SAVE_VERSION` bump.** 4a changes no decision, no dice consumption and no phase. The bump
belongs to 4b, where `Pending` gains members an old action log cannot match.

### 4b — `sai_target` and Flame — **landed**

**Delivered.** `RollEffectBody` gained `target_enemy`; `src/engine/targeting.ts` holds `TargetTask`
and `targetTasks`; `MarchStep` gained `sai_target_attack` / `sai_target_counter`; `Pending` and
`GameAction` gained `sai_target`; `LogEntry` gained `sai_resolved` and `units_buried`. **Flame** is
the first targeting SAI and the first caller of `killAndBury`. The whole client surface came with
it: `SelectMode.side: 'theirs'`, an enemy-selectable board, the `ActionBar` sheet, the CLI sheet,
and a branch in both AIs. The 25 goldens replay byte-identical and unregenerated.

**The app still plays `DUA_RULES`**, so Flame is inert in a real game until 4e flips it. That is the
cost of the slicing, and it is stated plainly under *Verification* below.

#### Where this section was wrong

- **"One table with a rung argument" does not work, and 4a's deferral of it was right for the wrong
  reason.** The two rungs do not differ in *what an SAI does*; they differ in **which SAIs exist**.
  Flame must resolve under `'full'` and be **completely inert** under `'results'` — the rung Phase 1
  shipped and the one `SAI_RULES` still names. Put Flame in the shared table and `SAI_RULES` quietly
  starts burying dice. So `sai.ts` has two tables, `FULL_HANDLERS` beside `HANDLERS`, and
  `handlerFor` decides which are in scope. The rung *argument* is still coming, in 4e, for the case
  it is actually for: Firewalking and Teleport, whose maneuver half works on both rungs and whose
  free move works on one.
  - This was caught by the tests rather than by reading: five went red the moment Flame moved into
    `HANDLERS`, four of them saying "this SAI is no longer inert on the results rung".
- **`Pending.sai_target` did not need `remaining`, `limit` or `eligible`.** The plan gave it all
  three. Flame is combinable, so a roll produces at most one Flame task and `remaining` is always 1;
  `limit` has one reachable arm until Sleep; `eligible` has none until Choke. Each arrives with its
  first reader — including the `App.tsx` draft-key bug `remaining` exists to fix, which **needs two
  consecutive same-kind pendings and is therefore not reachable in 4b**. It is Sleep's to fix, with
  Sleep's test.
- **The `targets` queue *is* justified even at one task**, unlike those three. `targetTasks` returns
  a list because the combination rule is about a list, and a single optional task would be a claim
  about the domain that 4c breaks immediately.

#### Two things that would have shipped silently

1. **`expectOnly` would have thrown on the attack roll.** `combat.ts` whitelists the effect kinds a
   roll is allowed to produce, and `target_enemy` was not on it — so the very first Flame would have
   been computed and then refused by the guard that exists to stop it being *dropped*. It fails
   loudly, which is the guard working, but it is one line and easy to miss when the new effect kind
   is consumed a step earlier than the whitelist that names it.
2. **The targeting step reads the faces a second time.** `beginExchange` resolves the attack's faces
   purely to discover the tasks, and `resolveSaves` resolves the same faces again for the totals.
   That is only free because `resolveFaces` draws nothing — which is exactly what 4a was for, and
   the first place it pays.

**Exit criterion.** A Flame picks two health-worth out of the defending army, kills and buries them,
and the log says which SAI did it before the dice die. ✅

**Tests, as delivered.** `src/engine/targeting.test.ts` (11 cases) plus four in `prompts.test.ts`.

| Case | Expected |
|---|---|
| `2 SAI:Flame` against monsters | **no decision raised at all** — the X-is-a-budget test |
| The pending | `player` is the attacker, `target`/`slot` the defenders — the first pending answered by the other side |
| A Flamed Oak | in the **BUA**; `sai_resolved`, `units_killed`, `units_buried`, in that order |
| A non-maximal answer | `IllegalActionError` |
| Two Flame dice | one task of budget 4, which reaches a die neither 2 could |
| Different SAIs in one roll | kept apart, in roll order |
| A Flamed Phoenix | buried ⇒ **2** draws; risen ⇒ 1 draw and no `units_buried`. The `killAndBury` test. |
| Flame taking the last defender | victory, and the save roll never happens |
| Flame under `sai: 'results'` | nothing at all |
| `selectableAt(mode, slot, 'theirs')` | true at the targeted terrain only, and no army of mine is selectable |
| `saiTargetSelection` | tallies the *targeted* army; one of my own dice counts 0 |

**Bumped `SAVE_VERSION` to 6**, and this one is the plainest kind: a `sai_target` decision sits
between the attack roll and the save roll, so a version-5 action log hands its next answer to a
question that did not exist when it was recorded. `reduce` refuses on the kind mismatch — the guard
working — but only after the log has already diverged.

#### Verification, and the gap this slice leaves

The engine path is covered by tests and by 240 `RandomAI` games (starter, bestiary and rolled
forces under `DUA_RULES` and `SAI_RULES`; 12,250 exchanges, 0 stuck, `validateState` clean, and
`units_buried` never logged — which is the check that 4b changed nothing for the rules the app
plays).

**The client surface cannot be reached by playing until 4e.** `'full'` refuses the ten unbuilt
targeting SAIs, so no force in the project can play it: the starters carry Bullseye and Smother, the
bestiary carries everything, and the Gorgon mirror — the one fixture whose only SAI is Flame — is
six 4-health dice, which a 2-health budget can never take. So 4b was verified in the browser against
a **temporary** scaffold (a 24-health preset of Oaks and Oaklings, `FULL_RULES`, both reverted
before commit): the attack stopped at the seam, only the targeted enemy army lit up, Confirm stayed
disabled at 2 of 4 and enabled at 4, and the log read *Flame targets Oak, Oak* → *the enemy loses
Oak, Oak* → *Oak, Oak are buried — no resurrection*. Worth knowing when reading 4c and 4d: their
client surfaces have the same problem, and the same answer.

### 4c — Sleep and Galeforce — **landed**

**Delivered.** `RollEffectBody` gained `sleep` and `galeforce`; `TargetTask` became a union;
`Pending.sai_target` gained `limit` and `remaining`; `sai_target_army` is a new pending and action;
`effect_cast` is a new log entry. **These are the first two things in the project that write to
`state.effects`**, so Phase 3's `Effect`, `expireEffects`, `pruneEffects`, `armyRoll` and the
`asleep` status all get their first caller — three phases after they were built. The 25 goldens
replay byte-identical and unregenerated.

Both are cast during the **attacker's** roll and bite in that same exchange, which is what the 4a
seam was for: a slept die is out of the save roll that follows, and a Galeforced army saves at −4
in the exchange that cast it.

#### Where this section was wrong

- **"Two Galeforces stack to −8" is not reachable, and the test for it would have been a fiction.**
  Galeforce is one of the SAIs p. 32 names as *never* combined — two of them may name two different
  armies, so merging them would silently throw one away. Two Galeforces are therefore two separate
  casts, and they stack only if the roller aims both at the same army. `effects.test.ts` already
  covers two effects stacking on one army from Phase 3; what 4c owes is the non-combination, which
  is a `targetTasks` test.
- **`Pending.sai_target` needed `limit` to be a union, not a bigger number.** Sleep takes one *die*
  — an Oakling and a monster are each one — so it cannot ride on Flame's health budget, and
  `saiTargetSelection` needs a separate branch that counts dice. The plan had this right; 4b's
  decision to defer it was still right, because the alternative was a field with one reachable arm.
- **`remaining` became reachable exactly here**, as predicted: the Satyr carries Sleep on two faces,
  so two Satyrs rolling it produce two consecutive `sai_target` pendings with the same kind and
  player. `pendingKey` in `prompts.ts` is the fix, and it is a pure function with its own test
  rather than a template string in `App`.

#### One thing that would have shipped silently — again

**`expectOnly` did not name `sleep` or `galeforce`.** Exactly the miss 4b's commit message flagged,
one slice later and for two new kinds at once: the effect is computed correctly and the guard that
exists to stop it being *dropped* refuses it instead. It fails loudly and a test caught it
immediately — but that is twice now, so the whitelist comment says what it is for.

**Exit criterion.** A Sleep takes a die out of the save roll of the exchange that cast it and wears
off at the start of the caster's next turn; a Galeforce subtracts four save and four maneuver from
an opposing army at any terrain. ✅

**Tests, as delivered.** `targeting.test.ts` grew to 24 cases; `prompts.test.ts` gained two.

| Case | Expected |
|---|---|
| Sleep's pending | `limit: { kind: 'one' }` — one die, not health-worth |
| The save roll that follows | **one die instead of two, and one draw instead of two** |
| The slept die | still in `armyAt`, still killable, `validateState` clean |
| Expiry | survives the victim's whole turn; gone at the *caster's* |
| Two Satyrs rolling Sleep | two pendings, `remaining` 2 then 1, two different dice slept |
| Two dice, or a die from the wrong army | `IllegalActionError` |
| Galeforce's options | every terrain the opponent holds, not just the one under attack |
| Galeforce at the attacked army | save total 4 → 0, so the 4 melee gets through whole |
| Galeforce aimed elsewhere | the same dice do nothing — the control for the line above |
| Its modifiers | subtract 4 save **and** 4 maneuver, and `armyRoll` gathers both |
| A terrain the opponent has left | refused |
| The army wiped | `pruneEffects` drops the effect |
| `pendingKey` | two consecutive Sleeps give two different draft keys |
| `saiTargetSelection` under `limit: 'one'` | counts dice: 0/1, one die ready whatever its health, two not ready |

**`SAVE_VERSION` stays at 6.** 4b already bumped it for the decision-order change that introduced
`sai_target`; 4c adds another pending to the same seam, and a version-6 record was written by an
app that could not reach either. Nothing replays differently that was not already discarded.

#### Verification

240 `RandomAI` games (starter, bestiary and rolled forces under `DUA_RULES` and `SAI_RULES`),
12,674 exchanges, 0 stuck, `validateState` clean, and `effect_cast` never logged — the check that
4c changed nothing for the rules the app plays.

The client surface again cannot be reached by playing, for the reason 4b recorded, and **this time
the scaffold had to be bigger**: the Satyr also carries Confuse and the Genie carries Cantrip and
Firecloud, all unbuilt, so `'full'` refuses them and the game crashes into the error boundary on the
first one. The temporary scaffold therefore stubbed *both* refusal branches as well as flipping the
ruleset and pairing the two monster fixtures — all reverted before commit. With it: Galeforce
offered all three terrains, was aimed at a terrain other than the one under attack, and logged
"Galeforce catches the enemy army at Enemy home — until the start of your next turn"; Sleep read
"target one die", tallied 0/1, enabled Confirm at 1, logged "Sleep catches Genie — until the start
of your next turn", and left the Genie tile dashed with an `aria-label` ending "— asleep".

> **That scaffold is now load-bearing for 4d too, and it is getting heavier each slice.** Worth
> considering at 4d whether to flip the app to `FULL_RULES` early and let the remaining unbuilt SAIs
> be *inert* rather than refusing — trading the `'full'`-refuses-a-half-built-ruleset discipline for
> a client surface that can actually be played. 4e restores it either way.

### 4d and 4e — what is still owed

Eight SAIs and two free moves: `Bullseye`, `Double Strike`, `Smother`, `Firecloud`, `Seize` (4d);
`Wild Growth`, `Choke`, `Confuse` and the free-move halves of `Firewalking` and `Teleport` (4e).

**What the first three slices already supply**, so this is not the plan's original list of three
new mechanisms any more:

- The pause inside an exchange **exists**: `beginExchange` → `sai_target_*` → `finishExchange`, with
  the raw dice parked in `CombatState.attack`. What 4e needs is a *second* pause, on the far side of
  the save roll rather than before it.
- `targeting.ts`, `Pending.sai_target`, `sai_target_army`, the enemy-selectable board, both CLI
  sheets and both AI branches are built and tested.
- `resolveFaces` is pure, so any mid-roll decision is *stash the faces, ask, recompute* with no
  extra draw. `RollSpec.saiResults` is already the channel for a player-supplied step-8 number,
  which is what Wild Growth's save share needs and the only thing currently using it is a test.

**4d — the sub-rolls.** Smother and Firecloud make their targets take a *maneuver* roll; Bullseye
and Double Strike a *save* roll; Seize an *ID* roll. These are rolls of a chosen subset of units,
outside the attack/save exchange.

- `rollUnits` belongs in `roll.ts` and `unitRoll(state, unitId, resultType)` in `effects.ts` — the
  gatherer being there is what makes *"modifiers that affect an army do not affect the roll of an
  individual unit"* (p. 28) a testable rule rather than a comment. **No eighth-face ID doubling**:
  that is an army bonus.
- The kill test is **per die**, and `DieRoll.results` is the step-5 contribution only. A die showing
  Fly, Hoof, Counter or Rise from the Ashes *did* generate a save result, at step 8 — so
  `resolveFaces` has to stamp each die's SAI share onto `DieRoll` (display-only, like `effects`),
  or every SAI-faced target dies to a Bullseye it should have survived.
- Bullseye's and Double Strike's "roll this unit again" is free: `SaiOutcome.reroll = true`, which
  `rerollSweep` already handles. Seize reads `die.face.icon === 'ID'`, not a total.
- `target_enemy` already carries `escape` and `fate`; `applySaiTarget` throws a named "Phase 4d"
  error for any `escape` other than `'none'`, which is the seam to fill.

**4e — the second pause, and the friendly selection rule.**

- **Wild Growth** splits X between save results and promotions, decided *after* the save roll lands
  and before its total is final. Its X is a **health budget one unit may spend twice** — an Oakling
  to an Oak and on to an Oak Lord costs 2 — which `promotionMatching` deliberately does not model,
  so it needs `promotionPasses` / `promoteWithin` beside it rather than inside it.
- **Choke and Confuse** are true step-2 delayed effects: roll the saves, *then* apply them, then
  rerolls, then the totals. Choke needs the faces to exist before its targets can be chosen ("units
  that rolled an ID icon"), so the save roll has to split the way the attack roll did in 4a — and
  **the attacker chooses, during the defender's roll**, which is what 4b's `'theirs'` selection mode
  was built for.
- **The free moves** are the first *friendly* targets, and the `UP TO` rule (p. 29) is the opposite
  of the one every slice so far has used: any number **including none**, where p. 32 forces the
  maximum against an opponent. `DamageSelection.ready` relaxes from `===` to `<=` for these, and
  `sai_move` is the pending that carries a destination as well as units.

**Then the flip.** `FULL_RULES` exported, `useGame` and the CLI moved to it, the throwing set down
to `{ Cantrip, Dispel Magic }` — which is also the first moment any of Phase 4 can be played or
fuzzed. See Risks.

**Exit criterion.** All 25 SAIs resolve except Cantrip and Dispel Magic, which throw a named
"needs spells" error under `magic: 'simplified'`. 1000 fuzz games clean with `sai: 'full'`.

**Tests still owed** (the ones 4a–4c delivered are listed under their own headings):

- Choke kills only units that rolled an ID, *and* removes their save contribution from the total.
- Confuse rerolls its targets and discards the previous results entirely; the draw order is step 1,
  then Confuse, then step 3.
- Seize: an ID goes to Reserve, anything else dies.
- A sub-roll does **not** call `armyRoll` — a Galeforced army's −4 must not reach a Smother maneuver
  roll (p. 28). This is the first test that rule can have, and 4c's Galeforce is what makes it
  possible to write.
- A target whose SAI face generates the escape result survives — the step-8 stamp, above.
- Wild Growth: the save share joins undivided; an Oakling promoted twice costs 2 and
  `exchangeWithDua` never sees it twice.
- Firewalking on a save roll offers the move; on a maneuver roll it does not; declining moves
  nothing and logs nothing.

**`SAVE_VERSION` is already at 6**, bumped in 4b for the decision-order change. 4d and 4e add more
pendings to the same seam and need no further bump unless one of them changes dice consumption on a
path a version-6 record could have taken — and no version-6 record can reach `sai: 'full'` at all.

### Where each of the 25 SAIs lands

A ✅ means **built**; `n / m` means the SAI lands in two pieces. `sai.test.ts` pins the exact
partition — twelve on `'results'`, three on `'full'`, eight unbuilt, two waiting on spells — **and
checks it against the engine**, so this table cannot quietly disagree with the code.

Fifteen of the twenty-five are built. Note what "built" does *not* mean: the `'full'` rung refuses
the eight unbuilt names, so Flame, Sleep and Galeforce cannot be reached in a playable game until
4e, however finished they are.

| SAI | What it needs | Where |
|---|---|---|
| Counter | roll context; damage back at the attacker | 1 ✅ |
| Volley | roll context; damage back at the attacker | 1 ✅ |
| Fly | roll context | 1 ✅ |
| Hoof | roll context | 1 ✅ |
| Trample | roll context, two result types at once | 1 ✅ |
| Create Fireminions | roll context | 1 ✅ |
| Smite | unsavable damage channel | 1 ✅ |
| Surprise | combat flag suppressing the counter | 1 ✅ |
| Rend | reroll (step 3) | 1 ✅ |
| Rise from the Ashes | 4 saves / death trigger to Reserves | 1 ✅ / 2 ✅ |
| Flame | targeting + burial | 2 ✅ / **4b ✅** |
| Sleep | unit status (3 ✅) + targeting + a pause before the save roll | 3 ✅ / **4c ✅** |
| Galeforce | army effect (3 ✅) + targeting an army at any terrain | 3 ✅ / **4c ✅** |
| Bullseye | targeting + save sub-roll + reroll | 4d |
| Double Strike | targeting + save sub-roll + reroll | 4d |
| Smother | targeting + maneuver sub-roll | 4d |
| Firecloud | targeting + maneuver sub-roll | 4d |
| Seize | targeting + ID sub-roll + move to Reserves | 4d |
| Wild Growth | promotion (2 ✅) **plus a pause mid-roll to split X** | 4e |
| Choke | delayed until after saves; ID detection; save suppression | 4e |
| Confuse | delayed until after saves; reroll of targets | 4e |
| Firewalking | maneuver results / free move on non-maneuver rolls | 1 ✅ / 4e |
| Teleport | maneuver results / free move on non-maneuver rolls | 1 ✅ / 4e |
| Cantrip | spells | 7 |
| Dispel Magic | spells + an announce-before-resolve window | 7 |

---

## Phase 5 — Terrains and the four eighth faces

**Deliverable.** Six terrain types, 24 terrain dice, and `eighthFace: 'full'`.

### 5a — Tower (pull this forward)

One condition in `missileTargets`: the controlling army may make a missile attack against **any**
opposing army, and against a Reserve Army counting only non-ID missile results. Every terrain in
both current presets is a Tower, so this is the only icon power reachable today and it is a day's
work. Do it right after Phase 0 if you want something visible early.

### 5b — The other three icons

| Icon | Effect | Needs |
|---|---|---|
| City | Eighth Face Phase: recruit a 1-health unit to, or promote one unit in, the controlling army | Phase 2 |
| Temple | Controlling army immune to opponents' death magic; Eighth Face Phase: force an opponent to bury one unit from their DUA | Phase 2 |
| Standing Stones | All units in the controlling army may convert any or all magic results to an element this terrain contains | Phase 7 |

The Eighth Face Phase stops being a no-op here. Note it runs **before** the Dragon Attack Phase and
both marches — a City promotion helps the army that is about to fight.

**Standing Stones does nothing until Phase 7.** Magic results have no element under
`magic: 'simplified'`, so there is nothing to convert. Implement it in Phase 7 and say so in the UI
rather than shipping an icon that silently does nothing.

**Half of Temple is inert in this matchup.** Neither Treefolk nor Firewalkers can cast death magic,
so the immunity clause can never fire. The burial clause is the whole of Temple here. Implement
both; expect only one to matter.

### 5c — The terrain data

Currently: Swampland, Highland, Wasteland × 4 icons = 12 dice. Every pair of the four elements in
play is a legal terrain, which is six types:

| Type | Elements | Status |
|---|---|---|
| Swampland | Water & Earth | ✅ in `data/raw/terrains.faces.txt` — Treefolk home |
| Wasteland | Air & Fire | ✅ — Firewalkers home |
| Highland | Fire & Earth | ✅ |
| Coastland | Air & Water | ❌ **faces 1–7 unknown** |
| Flatland | Air & Earth | ❌ **faces 1–7 unknown** |
| Feyland | Water & Fire | ❌ **faces 1–7 unknown** |

Deadland is Death-only and out of scope. Castle, Dragon's Lair, Grove and Vortex are advanced
terrains and out of scope.

> **⚠ Blocking data question.** Neither rulebook contains terrain face layouts — the existing three
> types were transcribed from dice. The three new types need the same treatment. **Do not infer
> them.** The tempting pattern (magic low, melee high, split point varies) holds for all three known
> types but says nothing about where Coastland's split falls, and a wrong split silently changes
> which actions are available at a terrain for the whole game. Leave them `TODO`, add them to
> `data/raw/terrains.faces.txt` when transcribed, re-run `python tools/import_terrains.py`.

Also in this phase: home terrain follows from species elements (Treefolk → Swampland, Firewalkers →
Wasteland), and the second terrain each species proposes becomes a real choice rather than the
second die of its own type that Phase 0a settled for. Three new types mean Treefolk can propose
Coastland or Feyland and Firewalkers Flatland or Feyland, which is the first point at which the
proposal is worth thinking about — and the point at which the Frontier stops always being a City.

**Exit criterion.** All four icons resolve. A captured terrain reverting to face 7 removes the
icon's effect in the same step. `validateState` still enforces `face === 8 ⟺ capturedBy !== null`.

**Tests.**

- City promotes when the DUA can supply a partner and recruits when it cannot, at the player's
  choice.
- Temple's burial is refused when the opponent's DUA is empty.
- Tower against a Reserve Army counts non-ID missile results only.
- Losing the eighth face mid-turn ends the icon's effect immediately, not at end of turn.

---

## Phase 6 — Dragons

**Deliverable.** `dragons: true`. Summoning Pool, Dragon Attack Phase, breath, and slaying.

The shape, from pp. 16–20:

- A dragon has **5 health and 5 automatic saves**, so 10 melee *or* 10 missile kills it. The two may
  not be combined against one dragon, though they may be split across different dragons.
- Each player brings **one dragon per 24 points of force, rounded up**, into their Summoning Pool
  — so **one at 24 health and two at 36**, the sizes Phase 0a rolls. (The starter book's "two
  dragons" for a 30-health force is the same rule, which is a useful check on both readings.) The
  pool is not part of force size and is separate from the DUA and BUA.
- The Dragon Attack Phase fires at every terrain where the **marching** player has an army. Dragons
  attack regardless of who summoned them — including their summoner.
- The army answers with a **combination roll** counting melee, missile and save at once, with each
  ID allocated by its owner. This is the reason `RollOutcome.totals` is a map.
- Damage is simultaneous: a unit killed by the dragon still contributes its results.
- Slaying any dragon lets the army **promote as many units as possible** — including units that did
  not roll. Phase 2.

Dragon icons: Jaws 12 damage, Claws 6, Wing 5 and the dragon flies home, Tail 3 and roll again,
Breath 5 health killed plus an elemental effect, Treasure promotes one unit, Belly disables the
dragon's automatic saves for that attack.

Breath effects need Phase 3, because every one of them is a duration modifier: Air halves melee,
Earth halves maneuver, Water halves missile, Death makes the army ignore its IDs, Fire buries the
units it killed unless they save. "Halving modifiers are not cumulative" is pipeline step 7's
one-divider-per-result-type rule, already built in Phase 0b.

> **⚠ Blocking data question.** The **dragon die face layout is in neither rulebook.** The icon
> *effects* are documented; how many of each appear on the twelve faces is not. The rules do say
> dragons "come in two forms: drakes, which have wings, and wyrms, which have a treasure chest",
> which suggests the same shape as a terrain die — a base layout plus one variant face — but that is
> a hypothesis to verify against real dice, not a fact to encode. Five elements × two forms = ten
> dragon dice to transcribe into `data/raw/dragons.faces.txt`, with a `tools/import_dragons.py`
> alongside the two existing importers. **Do not invent these faces.**

> **Decided: the Death dragon ships, and is unreachable.** A dragon leaves the Summoning Pool only
> via `Summon Dragon`, which requires magic **of that dragon's element**. Neither species can cast
> death magic, so **a Death dragon brought by either player can never be summoned** in this
> matchup. Four of the five elemental dragons are reachable in play; the fifth is a die that would
> sit in the pool all game.
>
> It goes in anyway, for completeness: all five elements are transcribed, validated and present in
> `data/`, and the Death dragon simply has no route onto the board until a species that casts death
> magic arrives. **This is data completeness, not a feature** — so it needs faces and a passing
> validator, and nothing else. Do not build a house rule to make it summonable, and do not drop it
> from the data on the grounds that nothing can reach it.
>
> One thing follows for the engine: it must not assume a die in the pool is reachable.
> `validateState` has to be happy with a dragon that can never leave, and the Dragon Attack Phase
> has to be happy with a pool that never empties. Whether a *preset* should pick Death — and how a
> player is told why it will not appear — is a Phase 9 question, not a rules one.

Ivory dragons (summonable by any single element) and White dragons (a 14-cost spell, 10 health,
doubled damage) are **out of scope**: neither is one of the five base elements.

**Exit criterion.** A dragon can be summoned, attack, kill units, be killed, and fly away. 1000 fuzz
games clean with `dragons: true`.

**Tests.**

- 10 melee kills a dragon; 5 melee + 5 missile does not.
- Belly cancels the 5 automatic saves for that attack only.
- Tail rolls the dragon again and applies both results; RNG consumption is deterministic.
- A dragon that rolls Wing inflicts its 5 damage *and then* returns to the pool — in that order.
- Fire breath buries the units it killed unless they save; those units never enter the DUA.
- Two breath effects halving different result types both apply; two halving the same one do not.
- Killing a dragon promotes every promotable unit in the army simultaneously, including non-rollers.

**Bump `SAVE_VERSION`.**

---

## Phase 7 — Spells

**Deliverable.** `magic: 'spells'`. The v0 magic house rule retires.

**The v0 magic house rule ends here.** `floor(M / 2)`, the same-terrain restriction, the absent
save roll and the absent counter-attack are all replaced, and the rounding question that
`RULES-V0.md` §10 carried since the alpha expires rather than gets answered — there is no rounding
left to tune. `magic: 'simplified'` survives only as the `V0_RULES` regression baseline; it is not
a configuration anyone plays or balances after this phase.

This is also the phase that changes the most existing behaviour, because **magic results gain an
element**. A magic result is elemental according to the species of the unit that rolled it —
Treefolk generate Water and Earth magic, Firewalkers Air and Fire. A spell of a single element may
only be cast with magic of that element; an Elemental spell with magic of any one element.

So `rollArmy`'s magic total becomes a per-element tally, and a magic action becomes: roll, then
spend, casting any number of spells up to the results generated, resolved one at a time in the order
cast. Unused results are lost.

**The eighteen spells in scope.** Exactly the spells castable by these two species — the species
reference sheets (full rules pp. 79, 91) filtered to `Any` plus their own:

| Element | Spells |
|---|---|
| Air | Hailstorm 2, Wind Walk 4, Mirage 5 *(Firewalkers)*, Lightning Strike 6 |
| Fire | Ash Storm 2, Flashfire 3 *(Firewalkers)*, Fiery Weapon 4, Dancing Lights 6 |
| Water | Watery Double 2, Accelerated Growth 3 *(Treefolk)*, Flash Flood 4, Wall of Fog 6 |
| Earth | Stone Skin 2, Path 4, Wall of Thorns 5 *(Treefolk)*, Transmute Rock to Mud 6 |
| Elemental | Resurrect Dead 3, Summon Dragon 7 |

Fourteen of the eighteen are a Phase 3 `Effect` and nothing else. The other four are the work: Flash
Flood moves a terrain, Path moves a unit, Resurrect Dead is a Phase 2 exchange, Summon Dragon is
Phase 6.

Out of scope and worth writing down: **Summon Dragonkin** needs Dragonkin dice (advanced rules);
**Summon White Dragon** at cost 14 is castable but a White Dragon is not a base-element dragon;
**Esfah's Gift**, **Rally**, **Evolve Dragonkin** and **Rise of the Eldarim** are Amazon and Eldarim
spells. Every other single-element spell belongs to a species not in this plan.

Spells are **data, not code** — `data/spells.json` with a schema, validated by
`tools/validate_data.py`, exactly as invariant 6 requires of die faces. An effect is a `Modifier`
plus a target selector; the four exceptions get a named handler.

Three things close here:

- **Cantrip and Dispel Magic.** Cantrip's results cast only spells marked in the `C` column; Dispel
  Magic needs a window after spells are announced but before any resolve, which is the only place in
  the game where announcement and resolution are separate steps.
- **Standing Stones** becomes live — converting magic results to a terrain's element is meaningless
  until results have elements.
- **Reserve magic returns.** v0 cut it, which is why a Reserve Army cannot march at all
  (`RULES-V0.md` §4). Spells marked `R` are castable from Reserves, so the Reserve Army becomes a
  real army again and `marchableArmies` stops being a special case.

**Exit criterion.** All 18 spells cast and resolve. `magic: 'simplified'` still plays the v0 game.
1000 fuzz games clean.

**Tests.**

- A Treefolk army cannot cast Hailstorm — it generates no Air magic.
- Cumulative spells multiply the highlighted number; three Wind Walks add 12 maneuver, not 4.
- Non-cumulative spells cast twice on one target have no extra effect.
- Casting costs are spent against the correct element's tally and leftovers are discarded.
- A spell on an army does not follow it to another terrain; a spell on a unit does.
- Dispel Magic negates only magic targeting that unit, its army or its terrain.

**Bump `SAVE_VERSION`.**

---

## Phase 8 — Species abilities

**Deliverable.** The missing seventh turn phase, and four abilities.

The starter book grants these two species no abilities, which is why `RULES-V0.md` §2 recorded
"nothing to implement". The full rules give each of them two, and a turn phase to apply them in —
and they are the most Treefolk-and-Firewalker thing in the game. Without them the two sides play
almost identically, which is a poor result for a plan whose whole scope is these two species.

| Species | Ability | Effect |
|---|---|---|
| Treefolk | Rapid Growth | At a terrain containing earth, Treefolk that did not roll an SAI may be rerolled once when counter-maneuvering. Selected and rerolled together. |
| Treefolk | Replanting | At a terrain containing water, roll Treefolk before they go to the DUA. Any that roll an ID go to Reserves instead. |
| Firewalkers | Air Flight | During the Retreat Step, Firewalkers may move from any terrain containing air to any other terrain containing air where you have a Firewalker. |
| Firewalkers | Flaming Shields | At a terrain containing fire, Firewalkers may count save results as melee results. Not on a counter-attack. |

Flaming Shields is a **"counts as"** conversion, which is pipeline step 10 and already exists.
Replanting is a death trigger, the same seam as Rise from the Ashes. Rapid Growth is a reroll,
pipeline step 3. All three were built in earlier phases; this phase is mostly wiring.

Add `'species_abilities'` to `Phase`, between `dragon_attack` and `march`.

**Exit criterion.** Each ability fires only at a terrain with the right element and only in the
right roll, and each has a test proving it does *not* fire otherwise.

---

## Phase 9 — UI and AI for v1

**Deliverable.** The surfaces that genuinely did not exist in v0. Every *decision* was already wired
by its own phase; this is for the things a player needs to **see**.

- **A DUA / BUA / Summoning Pool panel.** Three areas that did not exist. The DUA is now a resource
  you spend, so it needs to be as legible as the board.
- **Active effects.** Every spell and breath effect with a duration, shown on the army or terrain it
  targets, with what it does and when it expires. Without this, spells are invisible arithmetic.
- **A spell picker.** Magic results per element, the castable list filtered by what you can afford,
  and a running cost. This is the one genuinely new multi-step interaction and the only place the
  "no wizard state in components" rule will be under real pressure — it belongs in `prompts.ts` as a
  pure function over `pending`, like `damageSelection`.
- **Dragons on the board.** A terrain card shows dragons present; the attack sequence is legible in
  the log.
- **Why a number is what it is.** With modifiers, the totals stop being obvious. The roll strip
  should show the subtotal, each modifier, and the final — the pipeline's ten steps are the
  explanation, so expose them. Phase 1 started this rather than waiting: `combat_resolved` carries
  `unsavable` and `riposte` so the line adds up, and a rerolled die is drawn beside the die it came
  from with an arrow. After Phase 2 the strip also stopped drawing an effect-only die as a blank,
  and the log names the SAI behind each number — "**Counter** sends 4 straight back", "+ 3
  unsavable **from Smite**" — via `saisBehind` / `saiPhrase` over `DieRoll.effects`. **That is the
  pattern to extend, not replace**
 — each phase that can make a
  number unexplainable pays for its own explanation, because a phase that defers it ships a log
  that lies for however long Phase 9 takes.
- **The AI needs a real opinion.** `PassiveAI` answering "cast nothing, target nothing" for 18
  spells and 10 SAIs is not passive any more, it is broken. This is where `GreedyAI` — the next
  rung of the ladder in `OVERVIEW.md` §4 — stops being optional: heuristic scoring over enumerated
  legal actions, extended to cast the cheapest useful spell and target the most health it can kill.

**Exit criterion.** A full Treefolk vs Firewalkers game is playable end to end with every rule on,
on a phone, and the log explains every number in it.

---

## §10 — Every v0 house rule this plan removes

`RULES-V0.md` is the alpha's spec. When v1 lands, these stop being true:

| v0 house rule | Replaced in |
|---|---|
| Magic is a melee variant: same terrain, `floor(total / 2)`, no save, no counter | Phase 7 |
| Elements are stored but ignored | Phase 7 |
| No magic from Reserves, so a Reserve Army cannot march | Phase 7 |
| SAI faces produce zero results | Phases 1 ✅ and 4 |
| Eighth face grants only the two standard advantages | Phase 5 |
| No dragons | Phase 6 |
| No spells | Phase 7 |
| No promotion | Phase 2 ✅ (machinery; first in-game caller is Phase 5's City) |
| No burying | Phase 2 ✅ (machinery; first in-game caller is Phase 4's Flame) |

| Three fixed terrains, all Towers | Phase 5 |
| Two hand-authored 30-health forces, fixed race per player | Phase 0a |
| The Frontier is a constant, and both forces must propose the same die | Phase 0a |

**One of these is replaced by another house rule, not by the real rule.** The Frontier stops being
a constant in Phase 0a, but the rulebook's actual step 4 — the roll-off winner choosing between the
first turn and the Frontier — needs an opponent capable of wanting a particular terrain. Until
`GreedyAI` exists in Phase 9, v1 splits the two prizes one each: winner marches first, loser sets
the Frontier. So §7 of `RULES-V0.md` gains a house rule in v1 and loses it again in Phase 9, which
is the only entry in this table that moves twice.

**Do not delete `RULES-V0.md`, and do not delete the flags.** `V0_RULES` stays a valid, playable
configuration — it is the regression baseline for every phase above, and the reason each of these is
a flag and not a deleted branch (invariant 5).

The v1 ruleset:

```ts
export const V1_RULES: RuleSet = {
  magic: 'spells',
  sai: 'full',
  eighthFace: 'full',
  dua: 'active',            // new flag, Phase 2 -- landed
  dragons: true,
  speciesAbilities: true,   // new flag, Phase 8
}

```

---

## Risks

**Phase 0b is the phase people skip.** It delivers nothing a player can see and every later phase is
cheaper for it. If it gets cut short, the symptom is Phase 6 discovering that combination rolls need
`rollArmy` rewritten anyway — with SAIs and spells already built on top of the old shape.

**Two blocking data gaps, and they are not code.** Terrain faces for Coastland, Flatland and
Feyland; face layouts for ten dragon dice. Both need transcription from physical dice, both are
invariant-6 territory, and Phase 5 and Phase 6 cannot start without them. **Start sourcing these
now** — they are the long pole, and not something to do at the last minute against a half-built
phase.

**The fuzz gets slower and more valuable — and there is now only one of it.** Dragons and spells
make each game longer. `advance` throws after 1000 steps, which is a generous bound for v0 and may
not be for a game with summoning and resurrection — expect to raise it, and be suspicious the first
time you do.

The sharper risk is that the fuzz now covers a configuration **nobody plays, and the gap is three
phases wide.** Phase 1 turned the app over to `SAI_RULES` and did not add a fuzz for it; Phase 2
turned it over to `DUA_RULES` and did not either. Both were verified by a hand-run of the same
harness, which is worth something and is not a test. Phase 3 widened it a third way rather than a
second: it changed every roll call site in the engine, and the only automated proof that it changed
no outcome is a corpus and a fuzz that both run the *old* rules. So the only automated net over the live rules
is the unit tests, while `V0_RULES` keeps the 1000 games *and* the 25 goldens — the one config that
least needs them. Every phase from here widens it further. Closing it is one `it.each` over two
rulesets — and per-rule trigger counters, or a clean run proves nothing about the rare faces.

**Phase 4 widened it a fourth way, and made it worse in a new direction.** 4a, 4b and 4c were each
verified by a hand-run of 240 `RandomAI` games under `DUA_RULES` and `SAI_RULES` — but `sai: 'full'`
**cannot be fuzzed at all** until 4e, because it refuses the unbuilt SAIs and every force in the
project carries at least one. So the rung where the new code lives has no fuzz, not even a hand-run
one, and will not have until the last slice. That is a direct consequence of the "`'full'` refuses
a half-built ruleset" discipline, and it is the strongest argument for the question 4c ends on.

**The verification scaffold is the other new risk, and it compounds.** With no playable `'full'`
force, each slice's client surface has been checked in the browser against a temporary scaffold —
4b needed a preset and a ruleset flip; 4c needed both refusal branches stubbed as well. Every one
was reverted before its commit and the reverts are checked, but the trend is the wrong way: the
scaffold is now larger than the thing it verifies, and a scaffold that big is itself a source of
false confidence. Two ways out, and 4d should pick one deliberately:

- **Flip the app to `FULL_RULES` at 4d** and let the remaining unbuilt SAIs be *inert* rather than
  refusing. Costs the discipline for one slice; buys a playable client surface, a fuzzable rung and
  no scaffold. 4e restores the refusal when the set is complete.
- **Keep refusing** and accept that 4d and 4e are verified by unit tests plus a scaffold, with the
  first real play-through happening only after 4e lands.


**Spells are where the balance stops being ours.** v0's magic house rule was explicitly a guess to
be tuned. Real spells are not tunable — they are the game. Expect Phase 7 to make the game feel
completely different, and do not treat that as a regression.

**`PassiveAI` will quietly stop being a fair opponent.** It is honest in v0 because it has nothing
to decline except attacks. Once it is declining 18 spells and every SAI target, "passive" becomes
"handicapped", and solo play stops being a test of the rules. Phase 9's `GreedyAI` is not optional
polish.

## Not in this plan

- The other twelve species, and any army builder for them. Adding a species is a data problem once
  this plan is done — which is the point of doing it in this order.
- Advanced rules in every form: Dragonkin, Eldarim champions, items (equipment, artifacts,
  medallions, relics), minor terrains, advanced terrains (Castle, Dragon's Lair, Grove, Vortex),
  Deadlands.
- Hybrid, Ivory, Ivory Hybrid and White dragons.
- Multiplayer. `PlayerId` is `'p1' | 'p2'` and every terrain rule in this plan assumes two players.
