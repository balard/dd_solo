# Implementation plan — v3

v2 finished **the full game for six species**: mixed forces, built forces of any size, an army
builder over a collection, and a board that shows every roll. v3 turns that into a **run**: pick a
race, start with a 12-health collection, win dice, dragons and terrains, and fight through three
acts whose enemies grow from 12 to 24 to 36 health. A loss ends the run.

Read `PLAN-V2.md` Phase 4 (the collection and the builder) before anything here: v3 is that phase's
`Collection` and `forceProblems` with a game around them. This document is the *order of work*.
**Phases 0 and 1 have landed** (the run model, and the encounters); nothing after them has.

**Scope decisions this plan is built on** (agreed 2026-10-07):
- **A mode in this repo, not a fork.** The single game stays exactly what it is. The run is a
  layer *above* the engine that produces ordinary `SetupOptions` and reads ordinary finished games.
- **The rules are the rules.** Every battle is a `V1_RULES` game. v3 adds no `RuleSet` flag, no
  engine phase and no log entry, so **both golden corpora stay byte-identical and unregenerated**
  and `SAVE_VERSION` has nothing to be about.
- **Ten minutes a battle is a target, and a low priority for this build.** Pacing is tested live,
  never simulated (the v2 rule).
- **Enemies use the dice we have, for now.** Enemy-only units, spell lists and races are welcome
  later, for focused and interesting battles. This plan keeps the door open (data, not code) and
  builds none of them.
- **Events are deliberately thin.** One event (upgrade or transform) is enough for a first
  playtest. More interesting events come after the playtest shows what is missing.

---

## The run, as agreed

**Start.** The player picks a race (any playable species). The starting collection is:
- **one random large die** of that race;
- **one medium die of the same class line** (Oak Lord → Oak);
- **one medium die of a different class line**, random;
- **one of each of the race's five small dice**;
- **one random dragon** sharing an element with the race;
- **two terrains**: one for the Home, a random die of the race's own terrain type (as setup draws
  a Home today), and one for the Frontier proposal, a random die sharing an element with the race.

That is 3 + 2 + 2 + 5 = **exactly 12 health**, eight dice, which split into three armies of at most
6 each. No monster.

**Acts.** Three acts, each with a cap and an enemy size: **Act I 12, Act II 24, Act III 36**. Each act
draws **12 encounters** from its own pool, which holds more than 12. Clearing the twelfth encounter
of Act III wins the run.

**Encounters.** About **70% are battles** and **30% are events**.
- **A battle** is one game against an enemy force at the act's size, played by the AI.
- **An event** offers the player a choice between two actions on one die they pick, or to skip:
  - **Upgrade**: swap the die for the next one up its class line (small → medium → large). A large
    die or a monster cannot be upgraded.
  - **Transform**: swap the die for a random *different* die of the same species and health.

**Rewards.** After every battle won, the player **picks one of five offers**:
- **three units**, each rolled independently: **70%** a random die of the player's race, **30%** a
  random die of any playable species;
- **one dragon** sharing an element with the force;
- **one terrain** sharing an element with the force.

"The force" there means **every element of every species in it**: a Goblin force that fields a
Coral Elf matches death, earth, air and water. Death counts for dragons, since the Death Drake
and Death Wyrm are in the data. It does not count for terrains: the six basic terrain types are
the six pairs of air, water, earth and fire, so no terrain die carries death.

**The force.** The player owns a **pool** (the collection) and fields a **force** from it, under the
act's cap. **The force is kept between encounters**: a reward goes into the pool and changes nothing
in the force, and the player may reorganise the force from the pool after each reward.

**A force may fall short, and plays at a disadvantage.** The two sides need not be equal, and a
force under the cap is legal. So is a force with **fewer dragons** than its size asks for (one per
24 health): a run that reaches Act III owning one dragon fields one. The rules that stay are the
ones without which there is no game: each of the three armies holds at least one die and at most
half the force, and the force brings at least one dragon.

**Saving.** The run is **saved at the start of each encounter**. The player may quit and come back to
that encounter, **with the same seed**: the same board, the same enemy, and the same dice for the
same play. A **defeat ends the run**, and a concession is a defeat. The same seed is a first
decision, and the playtest may overturn it.

---

## The ideas that make this a plan and not a list

**1. A run is a reducer too.** `reduceRun(run, action) => run`, pure and seeded, with the RNG in the
run state and never `Math.random`. It is the engine's invariant 1 one level up, for the engine's
reason: a run that cannot be reproduced cannot be debugged. Its next decision is an explicit
`run.pending` that the screens render from, the engine's invariant 3 one level up. A battle is not
inside the run's state. The run asks for one (`pending: battle`, carrying the `SetupOptions`) and
is told how it ended (`{ kind: 'battle_ended', winner }`).

**2. The run never reaches into a game.** It builds `SetupOptions` from its state and reads only
`winner` back. The engine does not learn that runs exist, and `src/run/` depends on `src/engine/`
and `src/data/`, **never on `src/ui/` or `src/ai/`**. The opponent is named by its string
(`OpponentName`), which the client resolves through `OPPONENTS`, as the start screen does today.

**3. A run is saved as a state, not replayed from a record.** This is the one place v3 departs
from "a save is `{ setup, actions }`", and on purpose:
- **Replay buys nothing here.** A run's actions include battle outcomes, which replay cannot
  recompute without replaying every battle.
- **The run's own rules will change every playtest** (odds, pools, events). A replayed record
  would be invalidated by each tweak, while a snapshot survives anything that keeps its shape.

So the save is the run state plus a `RUN_VERSION` that guards its *shape*, wrapped like every
`localStorage` access. A battle in progress is never saved: a reload goes back to the encounter's
start, which is exactly the agreed quit rule. The single-game save stays switched off.

**Dependencies:**

```
0  The run model                  src/run/, pure; no screen, no battle
|
1  Encounters                     data/encounters.json, the enemy forces, the battle's SetupOptions
|
2  The battle bridge              a run played end to end in the terminal
|
+--------------------+
|                    |
3  Run saves         4  Run screens     (4a mockups, then code)
|                    |
+--------------------+
|
5  Playtest and tuning            pool contents, odds, the first difficulty curve
```

**Rules that hold for every phase:**
- **The engine does not move.** Any change v3 needs from it is a seam with no rule behind it, and
  a phase that needs one says so in its findings. One is known already: a force that names fewer
  dragons than its size asks for (Phase 0, below).
- **Every random thing in a run is a draw from the run's RNG**, in an order the tests pin, so
  a run seed reproduces a run's offers and events exactly.
- **`run.pending` switches exhaustively**, in the screens and in the terminal. No `default:`.
- **Each phase ends with its findings written under its own heading**, *What Na found*, as v2 did.

---

## Phase 0 — The run model

**Deliverable.** `src/run/`: the run state, its actions, `reduceRun`, and every draw the run makes.
No screen, no battle. Battles are stubbed by a test that answers `battle_ended` directly.

### The state

```ts
RunState = {
  seed, rng,                        // the run's own stream, as GameState carries its own
  race: SpeciesId,
  collection: Collection,           // the pool: finite counts, never Infinity
  force: BuiltForce,                // what is fielded; kept between encounters
  act: 1 | 2 | 3,
  encounter: number,                // 0..11 within the act
  current: Encounter | null,        // the encounter in hand, drawn when reached
  drawn: readonly EncounterId[],    // this act's draws so far, so the pool is drawn without replacement
  pending: RunPending,
  status: 'playing' | 'won' | 'lost',
}
```

### The pendings

| `kind` | Answered by |
|---|---|
| `choose_race` | `pick_race` (starts the run, rolls the starting collection) |
| `arrange_force` | `set_force` (any number of times), then `ready` |
| `battle` | `battle_ended { winner }`, from the client, carrying the battle's `SetupOptions` |
| `reward` | `take_offer { index }`, one of five |
| `event` | `upgrade { unit }`, `transform { unit }` or `skip` |
| `over` | nothing: the run is won or lost |

`arrange_force` follows every reward and every event, and comes before the first battle. It never
appears in the middle of an encounter, which is why the save at the start of each encounter is
also a save at a decision.

### The draws, in order

```
pick_race  -> large die -> second medium's line -> dragon element -> dragon form
           -> Home terrain -> Frontier proposal -> split
encounter  -> battle or event (70/30) -> which one, from the act's pool, without replacement
reward     -> unit 1 (race or any, then which die) -> unit 2 -> unit 3
              -> dragon element -> dragon form -> terrain
              (the dragon and terrain from the elements of the force that won)
transform  -> which die of the same species and health
```

The split uses `splitForce`/`repairSplit` from `force.ts`, so the opening force is legal by the
same rule setup uses. Each step is a test, as the setup draw order is.

### Decided before 0

- **`forceProblems` moves out of `src/ui/game/builder.ts`.** It is already pure and tested in
  node, but `src/run/` may not import `src/ui/`, and `ready` must refuse an illegal force by the
  same statement the builder shows. The draft functions (`addUnit`, `setTerrain`, ...) stay in the
  UI. The move changes no behaviour, and `builder.test.ts` follows it.
- **A run force names everything; setup draws nothing for it.** A limited collection must say
  which terrain die is the Home and which is the Frontier proposal, and which dragons come (the
  v2 4a rule, unchanged: setup's own draw would pick from dice the player does not own). The
  starting two terrains and one dragon are what make that possible from the first battle.
- **Fewer dragons than the size asks for is legal in a run**, and that is **the one engine seam**
  v3 knows of. `builtForceProblem` holds a named list to *exactly* `dragonCount` (1 at 12 and 24
  health, 2 at 36). It becomes **at least one, at most `dragonCount`**: at least one because the
  Phase 6 Frontier seed throws on an empty pool, and because a run always owns its starting
  dragon. The free builder's `forceProblems` keeps asking for exactly the count outside a run, so
  a normal game does not change. No recorded game names a short list, so no golden moves, and
  the seam gets a setup test of its own.
- **A force under the cap needs nothing new**: unequal sides have been legal since v2 Phase 2.
- **Upgrade and transform act on a die in the pool.** If that die is in the force:
  - **a transform** replaces it in place, in the same army (same health, so nothing can break);
  - **an upgrade** replaces it in place **only if the force stays legal** under the cap. If the
    stronger die no longer fits, it **leaves the force** and stays in the pool, and the player
    fights without it until they reorganise. If leaving empties an army, `ready` waits for the
    player to fill it.
- **An event can be skipped.** It always offers skip, and a die that cannot be upgraded (large,
  monster) can still be transformed.
- **The units offered in one reward are distinct**, so the pick is a real choice of three. The
  draw redraws a duplicate from where the stream left off.
- **"The player's race" is the race picked at the start**, even after the pool has gathered other
  species. It is what the 70% reads, so a run keeps feeling like *a* race's run.
- **The dragon and terrain offers read the force that won the battle**, not the pool: every
  element of every species fielded. A die sitting in the pool widens nothing until it fights.
  Every element has its dragons, so the dragon offer always has a die to draw. The terrain offer
  draws from the force's non-death elements, and every species has at least one; a test says so.
- **Monsters are in the offers**: a race's 20 dice include its five monsters, at 1 in 4 of the
  70% draws. At Act I a 4-health monster is a third of a 12-health force, which is a real choice
  rather than a mistake.

### A fuzz for runs

`src/run/run.test.ts` plays a few hundred seeded runs with random answers and random battle
outcomes. It asserts:
- no run sticks;
- every `ready` force passes `forceProblems`;
- the pool's health only grows except by a transform, which keeps it;
- every pending kind and action kind is reached, keyed by type like the live fuzz's counters, so a
  new kind does not compile until it is counted.

It plays no real battle and costs milliseconds.

**Exit criterion.** A run plays from `pick_race` to `won` and to `lost` in a test, with stubbed
battles, and the same seed and answers give the same run.

### What 0 found

Landed as `src/run/` (`types.ts`, `draws.ts`, `reduce.ts`, `run.test.ts`) and
`src/engine/forceProblems.ts`. The engine's rules moved in one place, the dragon count; both
golden corpora are byte-identical and unregenerated, and `SAVE_VERSION` did not move.

**What the plan said that the code could not do as written:**
- **`arrange_force` is the first step of every battle encounter, and nowhere else.** "Follows
  every reward and every event, and comes before the first battle", read literally, asks twice in
  a row whenever a reward is followed by a battle: once after the reward and once at the battle.
  Arranging matters only for the battle it is fielded in, so the run asks it there. A reward or an
  event followed by an event does not ask at all, since events act on the pool. The save rule is
  unchanged: an encounter still starts at its first `arrange_force` or `event`.
- **The `battle` pending carries the encounter, not `SetupOptions`.** Phase 0 has no enemies to
  build a setup from, and Phase 1's `battleSetup(run)` is a function of the run anyway. Keeping
  the setup out of the pending also keeps it out of the snapshot Phase 3 saves, so a run saved
  before a change to how battles are built picks the change up.
- **No reward after the last battle of Act III.** Winning it ends the run, `won`, with nothing
  left to spend a reward on.
- **An upgrade "only if the force stays legal" is two checks, not `forceProblems`.** The force
  can already be illegal when an event arrives: an earlier upgrade emptied an army, and an event
  followed with no `ready` between. "Stays legal" would then always throw the die out. So an
  upgrade stays in place when the two rules a heavier die can break still hold: the act's cap,
  and half the force for the army it stands in. A heavier die cannot break any other rule.
- **An event changes an unfielded copy first.** The pool counts copies, not dice, so "upgrade
  this Oakling" names a type. When some copy is not fielded, that copy changes and the force is
  untouched. Only when every copy is fielded does a fielded one change. The player can swap it in
  at the next battle either way.
- **`RunState.race` is `string | null`**, null until `pick_race`: a run exists before its race.
- **The encounter pools are an argument**, `reduceRun(run, action, content)`. Phase 0 has no
  `data/encounters.json`, so the tests pass sixteen encounters an act (eleven battles, five
  events), and Phase 1 supplies the real ones. The draw sorts the pool by id, like every other
  list the run draws from.

**Seams, none with a rule behind it:**
- **`forceProblems` went to `src/engine/`, not `src/data/`.** It needs `dragonCount`,
  `BuiltForce` and `playable.ts`, and `src/data/` imports nothing from the engine. It gained a
  fourth argument, `'exactly' | 'at_most'`. The builder passes nothing and keeps `'exactly'`. The
  test that holds it equal to `builtForceProblem` runs under `'at_most'` now, because that is what
  setup accepts. Its tests moved to `src/engine/forceProblems.test.ts`.
- **`setup.ts` exports two lists it already computed**: `homeDiceFor(species)` and
  `terrainDiceSharing(elements)`. The run's opening Home and Frontier, and every terrain reward,
  draw from them, so "a Home of the race's own type" cannot mean two things. No draw moved.
- **`purity.test.ts` covers `src/run/`**, with a rule of its own: a run file may not import
  `src/ai/`. The opponent stays a string.

**Would have shipped green:**
- **The fuzz first took five seconds, not milliseconds.** About 150,000 `expect` calls in the
  per-action loop were most of it, measured, not the reducer, which is about 25µs an action. The
  loop checks with plain `if`s now, and 300 runs take about 1.8s. A slower machine will take
  longer.
- **A 12-health opening is below the size `repairSplit`'s proof covers** (24 and up). The opening
  is always 3 + 2 + 2 + 1×5, which the repair deals 4/4/4, and the random deal usually succeeds
  first. A test checks 25 seeds of every race against `forceProblems` and `builtForceProblem`,
  and every race's opening sets up against itself.
- **A Death race's starting dragon can be Death**, which is what "sharing an element with the
  race" says, and the Death Drake and Wyrm are in the data. A dragon is drawn element first, then
  form, both at the start and in a reward, so every element the force carries is equally likely.

---

## Phase 1 — Encounters

**Deliverable.** `data/encounters.json`, its loader and validator, and `battleSetup(run)`: the
`SetupOptions` for the encounter in hand.

### The data

One list per act, hand-authored like `presets.json`; no importer touches it.

```jsonc
{
  "id": "act1.coral-skirmish",
  "act": 1,
  "kind": "battle",
  "name": "Coral skirmish",
  "enemy": { "pool": { "kind": "species", "species": "coral_elves" } },  // rolled at the act's size
  "opponent": "greedy"
}
// or an exact force:  "enemy": { "built": "act3-goblin-horde" }  -> data/forces/
// an event:           { "id": "act1.shrine", "act": 1, "kind": "event", "name": "Shrine" }
```

- **An enemy is a pool or a built force.** A pool is `rollForce(actSize, pool, rng)`, drawn from
  the *battle's* seed, so a restarted encounter meets the same enemy. A built force is a file in
  `data/forces/`, checked at load by `builtForceProblem` and against the act's size.
- **The pool holds more than 12 per act**, battles and events listed apart. The draw is 70/30
  first and then one encounter from that half, without replacement. That way the agreed odds hold
  however the pool is filled. If a half runs out (an act with 12 events and only 5 in the pool), the
  draw takes from the other half and a test says so.
- **The validator** checks:
  - ids are unique;
  - every species is playable;
  - every built force is legal and the act's size;
  - every opponent is an `OPPONENTS` name, `random` refused (it is the fuzz opponent, not an
    opponent);
  - each act has more than 12 encounters and at least one of each kind.
- **Room for later**: an `enemy` may one day name enemy-only dice, a spell list or a ruleset
  override. None exists yet, and the schema does not pretend they do.

### The battle

`battleSetup(run)` returns ordinary `SetupOptions`:
- `ruleSet: V1_RULES`, written out explicitly as `useGame` does;
- the human as `p1`;
- the player's `force` as a `built` spec, the enemy's beside it;
- **the battle seed, derived from the run seed, the act and the encounter number**, so it is the
  same on every restart and independent of how many draws the run's own stream has made. A
  restart is the same game until the player plays differently.

The sizes may differ, since the player's force is *up to* the cap. The run says so explicitly
through the same "unequal on purpose" path `newGame.ts` already uses. The player is never asked,
because in a run it is always meant.

**Exit criterion.** Every encounter in the data produces a setup that `setupGame` accepts, for
every playable race, in a test.

### What 1 found

Landed as `data/encounters.json`, four enemy forces in `data/forces/enemies/`,
`src/run/encounters.ts` (the loader and validator, `RUN_CONTENT`), `src/run/battle.ts`
(`battleSeed`, `enemyForce`, `battleSetup`) and `src/run/encounters.test.ts`. The engine did
not move. Both golden corpora are byte-identical and unregenerated.

**The pools, as first filled:** 17 encounters an act, 12 battles and 5 events, all against
`greedy`. Each act meets every playable species from a rolled pool, plus two `mixed` pools.
There are four built enemies: a Dwarf and a Coral Elf force in Act I, Lava Elves in Act II and
the Goblin horde in Act III. A built enemy names only its armies, and setup draws its terrains
and dragons, since the AI owns every die. The events differ only in name.

**What the plan said that the code could not do as written:**
- **The loader cannot check an opponent against `OPPONENTS`.** `src/run/` may not import
  `src/ai/`, which was Phase 0's own rule. So the loader refuses `random` by name, and
  `encounters.test.ts` checks every name against the registry. A typo fails the suite, not the
  load. The client already has to resolve the name through `opponentNamed`, which is where a
  bad one would surface in play.
- **"The same 'unequal on purpose' path `newGame.ts` uses" does not exist below the UI.** That
  path is a start-screen rule; `setupGame` has not cared about parity since v2 Phase 2. So
  `battleSetup` passes nothing, and a 12-health force against a 36-health enemy simply sets up.
  The exit test checks both sizes.
- **An enemy force is one file, in `data/forces/enemies/`, not `data/forces/`.** That
  directory holds pairs, which is what the terminal's `built:<file>` reads, and a single force
  there would be a file the flag cannot play. The directory is read by `import.meta.glob`, the
  first glob in the project, so a new enemy is a data edit. It works under vitest and
  `vite-node` alike; checked for both.
- **One list per act, and no `act` on the entries.** The plan's example carried both. Since the
  list says the act, the field could only disagree with it, so the loader derives it.

**Decided while building:**
- **A built enemy is held by name** (`{ built: 'act3-goblin-horde' }`) and resolved when the
  battle is set up, through `RunContent.forces`. A run saved in Phase 3 then picks up an edit to
  the file, as the plan wants for odds and pools.
- **The battle seed is the RNG at a counter**, `(act - 1) × 12 + encounter`, of the run's seed
  salted. The RNG is a pure function of `{ seed, counter }`, so no draw is needed to reach a
  battle's seed, and nothing the run's own stream did can move it. A test bumps the run's counter
  by 1234 and gets the same game. The enemy is rolled from the battle seed salted again, onto its
  own stream, as `newGame.ts` does for a random opponent.
- **`enemyForce(run)` is apart from `battleSetup`** and answers whenever a battle is in hand, at
  `arrange_force` included. Phase 4 can show the enemy while the player arranges their own force.
- **The validator is stricter than the plan in one place:** an enemy file no encounter meets is a
  problem. A force nobody meets is a misspelt name in waiting.
- **The run fuzz now plays the real data** rather than Phase 0's fixture, which stays for the
  tests that pin draws.

**Would have shipped green:**
- **Five events against twelve battles runs the event half dry in about one act in eight.**
  Drawing six or more events in twelve, at three in ten, is about 12%. Phase 0's fallback then
  draws a battle, so those acts meet exactly five events. That is a property of the pool's
  contents, not a bug, and it is Phase 5's number to tune.

---

## Phase 2 — The battle bridge, in the terminal

**Deliverable.** `npm run play -- --run [--seed N] [--race <species>]`: a whole run in the
terminal, every battle a real game against the encounter's AI. The terminal came before the app in
v0, and it is the cheapest place to find out whether a run is any fun before a screen is drawn.

- The terminal answers `run.pending` with menus, and a `battle` pending starts the existing game
  loop with the encounter's setup. When the game ends, the bridge sends `battle_ended` with the
  winner.
- **A concession ends the run.** The terminal already takes `concede`. In a run it says what it
  costs before it asks.
- **`--p1-ai greedy` watches a run play itself**, which is how a curve gets its first look without
  hours at a keyboard. It is not pacing data: the AI never concedes.

**Exit criterion.** One whole run, won or lost, in the terminal, for two different races.

---

## Phase 3 — Run saves

**Deliverable.** `src/ui/run/runStore.ts`: one run, saved at the start of each encounter, read on
launch.

- **Written at the start of each encounter**, at its first `arrange_force` or `event`, and **when
  the run ends** (so a finished run is shown once and then cleared). Never mid-battle.
- **`RUN_VERSION` guards the shape**, and a mismatch is discarded with a message, as `SAVE_VERSION`
  does. It is bumped when the shape changes. Odds and pools are read from the code and the data
  each time, so a tweak needs no bump: a run saved before it simply goes on under the new odds.
- **One run at a time.** "New run" over a run in progress asks first.
- **"Leave run" and "Concede" are two buttons**, and only the second is a defeat. Leaving goes back
  to the start screen and the saved encounter. Concede asks first, and says it ends the run.
- **The single-game save stays off.** Nothing here touches `storage.ts` or `SAVE_VERSION`.

**Exit criterion.** A browser run survives a reload at every pending, and a reload mid-battle
returns to that encounter's start with the same board.

---

## Phase 4 — Run screens

**Deliverable.** The run in the browser. Slices in Phase 3's (v2) manner, mockups first:

| Slice | Scope |
|---|---|
| **4a** | **Mockups, no code.** The race pick, the act strip (where the run is, what is left), the reward of five, the event, the force between encounters, and the run's end, on laptop and phone frames |
| **4b** | **The run shell.** The start screen gains New run and Continue run; race pick; the act strip; reward and event screens drawing dice with the board's own components (`UnitTileBody`, `DragonTileBody`, `TerrainDetail`), as the builder does |
| **4c** | **The force between encounters.** `ArmyBuilder` over the run's collection and cap. The kept force is the draft, new rewards are lit in the palette, and Ready is refused with each problem beside its section |
| **4d** | **The battle in a run.** `GameView` with Leave run beside Concede, the game summary leading to the reward or to the run's end, and the encounter named in the header |

- **An offer is shown as what it is**: a unit tile that opens its faces, a dragon tile, a terrain
  with its eight faces. A pick of five that has to be taken on a name alone is a worse game.
- **An event says what each choice does to the die** before it is chosen. Upgrade names the
  result. Transform lists the dice it might become, since the result is random.

**Exit criterion.** A whole run in the browser, from race pick to won or lost, surviving a reload.

---

## Phase 5 — Playtest and tuning

Not code first: the numbers this plan guessed, played.
- **Pool contents**: which species each act meets, and whether built forces earn a place beside
  rolled ones.
- **The odds**: 70/30 battles, 70/30 race dice, monsters in the offers.
- **The same-seed restart**: kept or dropped.
- **Whether a 36-health enemy is beatable** from what three acts of rewards can build.

Each finding goes under *What 5 found*, and a change to a number names the run that prompted it.

---

## Deliberately out of v3 (for now)

- **Enemy-only dice, spells and races.** The encounter schema leaves room for them. They need
  their own data and their own playable check, which is a phase of their own.
- **A specialised AI per encounter.** `GreedyAI` plays every battle. The encounter names its
  opponent, so a new AI is a registry entry and a data edit.
- **More events.** Upgrade/transform is the first one. Shops, curses and boons come after the
  playtest.
- **A map.** Encounters are drawn as they are reached. The intended next step is a schematic map
  with hints of what each encounter is, which needs the act's draws made up front; that is a
  change to one draw step, and nothing here prevents it.
- **Pacing** below a rough ten minutes.
- **Meta-progression between runs.** Nothing carries from one run to the next.

---

## Open questions

None before Phase 0. The questions raised while drafting were answered on 2026-10-07 and are in
the body: the starting terrains, short forces playing at a disadvantage, an upgrade that no longer
fits leaving the force, skippable events, offers matching the force's elements, and encounters
drawn as reached. A lost die is never lost: a battle costs nothing but the run.
