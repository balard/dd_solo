# Implementation plan — v3

v2 finished **the full game for six species**: mixed forces, built forces of any size, an army
builder over a collection, and a board that shows every roll. v3 turns that into a **run**: pick a
race, start with a 12-health collection, win dice, dragons and terrains, and fight through three
acts whose enemies grow from 12 to 24 to 36 health. A loss ends the run.

Read `PLAN-V2.md` Phase 4 (the collection and the builder) before anything here: v3 is that phase's
`Collection` and `forceProblems` with a game around them. This document is the *order of work*.
**Phases 0 to 3 have landed** (the run model, the encounters, a run in the terminal, run saves), and all of **Phase 4** (the run screens' mockups, the run shell, the force between encounters, and the battle in a run). Phase 5, the playtest, is next.

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
6 each. No monster. **The split is fixed** (Phase 5): the large die and its same-line medium at Home
(5), the other medium at the Frontier (2), and the five small dice in the Horde (5).

**Acts.** Three acts, each with a cap and an enemy size: **Act I 12, Act II 24, Act III 36**. Each act
draws **12 encounters** from its own pool, which holds more than 12. Clearing the twelfth encounter
of Act III wins the run.

**Encounters.** About **70% are battles** and **30% are events**, and **the run's first encounter is
always a battle** (Phase 5).
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

### What 2 found

Landed as `src/cli/runPlay.ts` (the run's menus), `src/cli/arrange.ts` (the arranging commands,
pure and tested), `src/cli/term.ts` (colour and line input, moved out of `play.ts`) and
`src/run/autopilot.ts` (`suggestForce` and `autopilot`, pure and tested). `play.ts`'s game loop
became `playBattle(setup, options)`, which the single game and every battle of a run share. The
engine did not move.

    npm run play -- --run [--seed N] [--race <species>]
    npm run play -- --run --p1-ai greedy --brief      -- watch, a line an encounter

**The exit criterion, met:**
- Watched runs completed for Treefolk, Coral Elves and Dwarves.
- A human run, typed through a pipe, picked a race, arranged by hand and with `auto`, was
  refused a force over half, refused one concession and accepted the second. It then lost the
  run.
- An event upgraded a fielded die over the cap, which benched it, as Phase 0 decided.
- Every run in the terminal ended `won` or `lost`. None stalled.

**What the plan left out, and the code needed:**
- **Somebody has to answer a watched run's own questions.** `--p1-ai` plays the battles, but a
  run also asks for a race, a force, a reward and an event. `src/run/autopilot.ts` answers them
  with plain rules of thumb rather than an AI, since `src/run/` may not import `src/ai/`:
  - the race from the seed;
  - the heaviest legal force;
  - a dragon while it owns fewer than two, otherwise the heaviest unit;
  - upgrade a medium die, then a small one, otherwise skip.
  Its `suggestForce` is also the terminal's `auto`.
- **`--brief`**, so a watched run reads one line per encounter instead of 25 games of log.
- **One input queue.** The run's menus and the game's must read the same buffered stdin, or a
  piped script loses lines between them. `term.ts` holds it, and both import it.
- **The draft is the run's own `force`.** Each arranging command is a `set_force`, so the
  terminal keeps no second copy. The reducer already took any number of them.
- **A watched game stops at 20,000 decisions** with "the game stalled", rather than spinning.
  None did.
- **`--ai` and `--forces` are refused with `--run`**, since each encounter names its own enemy
  and opponent. An unknown `--race` is an error, not a quiet pick.

**Found by playing, for Phase 5:**
- **Greedy against greedy wins about half its battles, so watched runs die in Act I.** Over 90
  watched runs (fifteen seeds of each race), greedy won 81 of 171 battles, and every run ended
  in Act I. The same AI at the same size makes each battle close to a coin flip, and a run needs
  about 25 wins in a row. That is the plan's difficulty curve at its first look, not a bug.
  Phase 5 has to choose what tilts it:
  - Act I enemies below the cap;
  - a gentler opponent early;
  - rewards that outpace the enemy's growth.
- **Played through to the end, every act holds up.** In a second pass every battle was played
  for real, all states validated, but recorded as a win so the run reached Act III. That was
  433 battles over 18 runs, with none capped and none invalid, and greedy won between half and
  three in five per act. So Act II and III battles set up and finish with grown forces, short
  dragon lists and 36-health enemies.
- **In Act I an upgrade of a fielded die always benches it.** The opening fields exactly 12, so
  any heavier die is over the cap. An Act I upgrade only pays once the player trades another die
  out. The autopilot re-fills the force; a human sees the force drop to 10 and the problem
  listed. That is Phase 0's rule working, and a question for the playtest: should an upgrade in
  Act I be offered at all?

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

### What 3 found

Landed as `src/run/save.ts` (the format, pure, shared by both clients), `src/ui/run/runStore.ts`
(the app's `localStorage` edge) and the terminal's own save in `src/cli/runPlay.ts`. The engine,
`storage.ts` and `SAVE_VERSION` did not move.

**The exit criterion is half met, and the other half moves to Phase 4.** There is no run in the
browser yet, so "a browser run survives a reload" cannot be checked until 4b draws one. 4's own
exit criterion already ends "surviving a reload", so that is where it is checked. What can be
checked now is checked twice:
- In node, `runStore.test.ts` saves after every step as the app will, up to a battle, and reads
  back. The run is at that encounter's `arrange_force` with the force as arranged, and `ready`
  rebuilds the identical battle state and `battleSetup`.
- In the terminal, a run was quit mid-battle and carried on with `--continue`. It came back to
  the same encounter and force, the same battle seed and the same roll-off. A new run over it
  asked first and was refused, and the concession that ended it cleared the save.

**What the plan said that the code could not do as written:**
- **"Written at the start of each encounter" loses a won battle.** The reward is a resting point
  after the win, and a reload there would have gone back to the battle and made the player fight
  it again. So a run is written **whenever it rests outside a battle**, every `set_force`
  included, and never inside one (`shouldSave`). The quit rule is unchanged: leaving mid-battle
  comes back to that encounter's start.
- **The plan named only the app's store.** The terminal is the only client that plays runs
  today, so it saves too, to `.run-save.json` in the working directory (gitignored):
  - `--run --continue` carries the saved run on;
  - `--run` over a run in progress asks first, the plan's "New run" rule;
  - `--continue` refuses `--seed`, `--race`, `--ai`, `--forces` and `--p1-ai`, since the saved
    run carries its own;
  - a watched run never saves, so watching a curve cannot overwrite somebody's run.

**Decided while building:**
- **The format is pure and shared** (`src/run/save.ts`): `RUN_VERSION`, `shouldSave`,
  `serializeRun` and `parseRunSave`. The app's `runStore.ts` is the thin, wrapped edge. It takes
  the storage as a parameter, so its tests use a fake one and one that throws on every call.
- **A save is checked for its shape, and for dice the data no longer has.** That is the one thing
  that can rot under a snapshot with no change of shape, and it would otherwise crash the first
  screen to draw the die. Such a save is discarded, with a sentence.
- **A save that cannot be carried on is discarded when read**, and the read says why, for the
  screen to show.
- **A finished run is written, read once, then cleared by the screen.** `runInProgress` is the
  question "New run" asks. The terminal shows the end at once and clears it there.
- **A restarted battle is the same game in the app as well:** `useGame` seeds the AI's stream
  from `setup.seed ^ 0x5eed`, exactly as the terminal does. (Greedy draws nothing anyway.)

**Would have shipped green:**
- **Round-tripping every state of a whole run** (`save.test.ts`, a Coral Elf run to `won`, over
  sixty states) reads each back equal, and the autopilot's next answer from the copy reproduces
  the original's next state. A snapshot that drops a field would pass the shape check and fail
  there.

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

### What 4a found

`docs/mockups/v3-phase-4a.html` draws every screen a run adds, on the three frames v2 measured
(laptop 1366×680, phone sideways 844×390, phone upright 390×844):
- the start screen with a run on it;
- the race pick;
- the force between encounters;
- the reward of five;
- an event;
- a battle inside a run;
- the run's end.

There are seventeen variants in all, and the page measures each, as 9a did. The scenario is one
Treefolk run in Act II, at encounter 5 of 12, fielding 24 against a 24-health Coral Elf enemy.
Every die is a real die with its real faces, read from `data/`. No code moved.

**Measured.** Every screen's answer (Fight, Take, Upgrade, Start) sits in a footer that never
scrolls, so the question is only how much the player scrolls to judge it:
- **The reward, the race pick, the battle dialogs and the start screen fit** almost everywhere.
  Five offers fit even upright, as a list. The battle's dialogs (Concede, both game-overs) take
  41% of the screen at worst, sideways.
- **The force between encounters is the one screen that always scrolls**: 1.1 screens on the
  laptop, 1.4 upright, and 1.9 sideways. Folding two things on short screens brought sideways to
  1.3: the enemy's dice start folded, and terrain and dragons become one line with Change. Both
  rarely change between battles, and the armies and Fight are what the screen is for.
- **The event and the run's end scroll sideways** (1.3 to 1.5 screens) and fit elsewhere.

**Decisions for 4b-4d:**
- **The act strip.** All three acts, the current one wide: a green square for a battle won, a
  diamond for an event, a ring where the run is, a hollow dot ahead. Ahead is never a kind,
  since encounters are drawn as they are reached. The current act names its cap. Upright and on
  short screens it is the current act alone: a line and twelve pips. It sits on every run screen
  but the battle, whose header names the encounter instead ("Act II · 5 of 12 · Tidal legion",
  "II·5" upright).
- **The force screen leads with the next enemy**, its species, health, dice and opponent, because
  `enemyForce` answers at `arrange_force` and a force is built against what it will meet. Then
  the three armies, then the spare dice as the palette. Dice won since the last battle are marked
  *new*. Then terrain and dragons. Fight and Leave run go in the footer. A disabled Fight names
  the first problem beside it, and each problem also sits beside its section.
- **An offer is the die**: its tile, its name, species, health and class, and every face in a
  row with SAI names whole. A tap opens the inspector. The dragon offer says whether it fills the
  two Act III asks for. The terrain offer shows its eight faces. **Pick, then Take**: the footer
  names the pick, so one tap never spends a reward.
- **An event shows the pool as two rows, fielded and spare.** Shading the fielded dice was not
  readable, and Phase 0's rule (an unfielded copy changes first) is only legible when the player
  can see which copies are spare. Then Upgrade names the result **and what happens to the
  force**, and Transform shows all four dice it might become.
- **The battle is the game screen, unchanged**, with Leave run beside Concede in the header. A
  concession opens a dialog: "A lost battle ends the run... to stop for now, use Leave run
  instead", offering Concede and end the run, Leave run, or Keep playing. The game-over card
  leads on, to "Pick your reward" after a win or "See the run" after a loss.
- **The run's end is a page of its own**: how far the run went, battles won, events, the pool's
  health, the force at the end, and every encounter in order. It is shown once, then the save is
  cleared. It offers New run, or Back to start.
- **The start screen** gains a run panel above the single game. Continue names the race, the act
  and encounter, the next encounter, the time saved and the health fielded. New run over a run in
  progress asks, naming what is lost. A save that was discarded is a banner, once.
- **The race pick** is six cards: elements, Home terrain, the two abilities, and a large, a
  medium and a small die of the race. The opening is drawn from the seed, so the card says what
  it is made of rather than which dice. The seed field is optional, as on the start screen.

**What the run does not know yet, and 4b builds first:**
- **Its history.** The act strip's past slots, the end page's list and counts, and the *new*
  marks all need what happened at each encounter. `RunState` keeps only this act's drawn ids, and
  no outcomes at all. 4b adds `history`, one entry per encounter finished:
  - the encounter's id, act and number;
  - won, with the offer taken; lost; or an event's upgrade, transform or skip, with both dice.
  That is a change of shape, so it is **the first `RUN_VERSION` bump**, which is the case the
  start screen's discarded-save banner is drawn for.
- **What an upgrade would do, before it is chosen**: change a spare copy, keep its place, or
  leave the force. That is `replaceDie`'s rule. So it becomes a query in `src/run/`
  (`upgradePreview(run, unit)`), which the reducer's own path calls too, never a second copy in a
  component.

**Found while drawing, for Phase 5:**
- **At a full force, every upgrade of a fielded die benches it, in any act.** Phase 2 saw it in
  Act I, but it is not about Act I. Any force at its cap has no room for a heavier die, and a run
  fields up to its cap whenever the pool allows, which the autopilot always does. So an upgrade
  pays only when the force is short of the cap, or when the player benches something for it. The
  event screen says so before the choice; whether upgrades should behave this way is a playtest
  question.


### What 4b found

Landed as:
- `src/ui/run/`: `useRun`, `RunScreen`, `RunPanel`, and `runView.ts`, the screens' rules, tested
  in node;
- the run's `history` and `eventEffect` / `upgradePreview` in `src/run/`;
- `App`'s fork between a run, the start screen and the game.

The engine did not move. `RUN_VERSION` is 2.

**Checked in the browser, end to end:**
- A Treefolk run on seed 3 opened on the same encounter and force the terminal draws.
- Fight played Lava Elf outriders with the encounter in the header. A reload mid-battle came back
  to the start screen offering Continue, and after Continue and Fight the board read the same,
  terrain for terrain and die for die. That is the second half of Phase 3's exit criterion, now
  in the browser.
- Conceding led to "See the run" and the run's end. A reload reopened that page once, and Back
  to start cleared the save.
- The reward and the event were reached through real saves, written in node by the autopilot and
  continued in the page:
  - picking an offer named it on Take;
  - taking it wrote the history and moved to the next encounter;
  - upgrading a fielded Nymph at 24 of 24 previewed "leaves the force", and the reducer did
    exactly that.
- A phone held upright drew the one-act strip and the fixed footer as the mockup has them.

**What the plan's 4b did not include, and the slice needed:**
- **The two things 4a said 4b builds first**:
  - `history`, recorded by `finishEncounter` and on a battle that ends the run, which is the
    first `RUN_VERSION` bump;
  - `eventEffect`, the one statement of what an event does to the force. `upgradePreview` asks
    it before the choice and the reducer applies it after. The run fuzz now checks every upgrade
    against its preview.
- **Stand-ins, so a run plays end to end in this slice**:
  - **4c's force screen**: the next enemy with its dice, the force read-only, *Fill the force
    from your pool* (`suggestForce`), Leave run, and Fight;
  - **4d's battle**: the game screen with the encounter as its title, New game hidden, and the
    game-over card leading to "Pick your reward" or "See the run";
  - **the run's end**, built whole now, because a lost run had nowhere else to go.
  4c and 4d replace or finish each of these. `useGame` gained `start` on a game in progress, so a
  run's next battle can be asked for from either phase.
- **`readRun` no longer deletes a bad save.** StrictMode reads a `useState` initializer twice. A
  read that discarded the save left the second read finding nothing, and the message saying why
  was lost with it. The screen clears it in an effect, which is safe to run twice.
- **A run does not exist until its race is picked.** The race pick is a screen before the run,
  so nothing is saved for a run never started. `RunScreen` still draws `choose_race`, since its
  switch has no default, but the app never shows it.

**Left as it is, on purpose:**
- "New run" over a run in progress asks through `window.confirm`, as the game's Concede does,
  rather than the mockup's inline question. The app has one way of asking that today, and 4d
  revisits both.
- Leaving a battle without conceding is a reload until 4d's Leave run. The save already holds
  the encounter's start, so a reload is the quit rule working.

**Found while playing, for Phase 5:**
- **The autopilot fields monsters.** A watched Treefolk run reached Act II with five monsters in
  its 24, because the reward rule takes the heaviest unit and the force rule fields the heaviest
  first. That is a property of the rules of thumb, not of the run, but it is what Phase 2's
  curve numbers were measured with.
- **"The same board" needs the same force.** A Treefolk force arranged differently on the same
  seed met a different enemy home: the Horde roll-off rolls the player's own Horde, so the force
  is part of the stream. The quit rule promises the same board for the same play, and arranging
  is play.

**Would have shipped green:** the full suite's 200-game `GreedyAI` self-play test timed out once
(44s against `testTimeout`'s 30s) while the dev server and the browser were busy. Alone it takes
10s, and nothing in `src/ai/` or the engine changed. It is the machine-dependence `CLAUDE.md`
warns about, recorded here rather than answered by raising the limit.


### What 4c found

Landed as `ForceEditor` in `src/ui/game/ArmyBuilder.tsx`, the run's force screen in
`src/ui/run/RunScreen.tsx` on top of it, and `freshDice` in `runView.ts`. The engine, `src/run/`
and `RUN_VERSION` did not move.

**"`ArmyBuilder` over the run's collection" is the builder's middle, not the builder.** The
page around it does not belong in a run:
- the collection picker, since a run's pool is its collection;
- the cap picker, since the act sets the cap;
- the name;
- the kept forces.

So the middle came out as `ForceEditor`: the total, the three armies, the palette with Look at
dice, the terrains, the dragons, every problem beside its section, and the inspector. It takes
the collection, the cap, the force and `onChange`. The builder renders it between its settings
and its kept forces, and behaves as it did; its tests are untouched and green. Three props are
the run's:
- `dragons` passes `'at_most'` to `forceProblems`, where the builder keeps `'exactly'`. The
  dragon line reads "up to 1 for 12 health".
- `fresh` lights the dice won since the last battle. That is `freshDice(run)`, read from the
  history: the last battle's reward and what every event since produced. Dragons are lit too. A
  terrain reward cannot be, because terrains are chosen from a select and an `<option>` has no
  badge.
- `foldExtras` / `foldedAtFirst` put the terrains and dragons in a fold, `<details>` with a
  one-line summary. It starts shut on a short screen, as 4a measured. The enemy's dice fold the
  same way.

The builder's four rules scoped under `.builder` (headings, selects, focus, `.is-over`) now
cover `.force-editor` as well. Without that, the editor lost them outside the builder page.

**The draft is the run's own `force`.** Every edit is a `set_force`, and the reducer took any
number of them from Phase 0. So the screen keeps no draft, every edit is saved as it is made,
and a reload comes back to the force as it was left. Checked: three edits, a reload, and
Continue showed 12 of 12, as edited.

**Checked in the browser**, on a run the autopilot saved in node, standing at a force screen
after a reward and an upgrade:
- The Naiad (that battle's reward) and the Eldar Dryad (the event's) were lit in the palette, and
  dice with no copies left were disabled.
- Adding the Naiad took the force from 10 to 12, ready.
- Adding the Eldar Dryad made it 15: two problems beside their sections, the first beside a
  disabled Fight. Taking it back made Fight live again.
- On a phone held sideways, both folds started shut, with the one-act strip and the fixed footer.
- The single-game builder still drew every section and its settings, with no fold and
  "exactly" dragons.

**Measured against 4a:** the sideways force screen is about 2 screens of page, not the mockup's
1.3. The mockup's palette was the spare dice; the builder's palette is every die the pool
owns, by species, with "×0" tiles kept in place. That is the builder's own rule, so a tile never
moves under the thumb. Fight never scrolls away, so this costs scrolling, not reach. A run-only
palette of spare dice is the lever if the playtest asks for one.

**Kept from 4b:** "Fill from your pool" (`suggestForce`) sits beside "Your force". It is the
quickest way to field a reward, and a pool that has grown past the cap still has to be cut by
hand.

### What 4d found

Landed as:
- the run's header, Leave run and the concede dialog in `src/ui/App.tsx`;
- `AskCard` beside `GameOver` in `src/ui/game/GameOver.tsx`, a question in the dialog;
- `runWhereShort`, `concedeAsk` and `battleOutcome` in `runView.ts`, tested in node;
- the inline New run question in `RunPanel.tsx`.

The engine, `src/run/` and `RUN_VERSION` did not move.

**What the plan's 4d said that was already there.** 4b's stand-in had the encounter in the
header and the game-over card leading to "Pick your reward" or "See the run". 4d gives them their
4a shape: "Act II · 5 of 12" over "Tidal legion · Turn 9", "II·5" upright with no name, and
"II·5 · Turn 9" on a phone held sideways, where the title goes.

**Would have shipped green:**
- **A reload on the game-over card took back a defeat.** 4b reported the winner to the run only
  when the card's button was pressed. A battle is never saved, so until then the save still held
  the encounter's start: a reload after a loss came back to Continue and the same battle, and
  "a defeat ends the run" was one reload deep. A won battle had the mirror bug, and was fought
  again. The result now reaches the run the moment the engine has a winner (an effect in `App`),
  and the save is written then. The board stays up under the card because `App` keeps
  `inRunBattle`, which outlives the run's `battle` pending; it used to be derived from it.
  Checked: a reload on a lost card opened the run's end, and on a won card Continue opened
  the reward.
- **The last battle of Act III would have led to "Pick your reward"**, a reward the run does not
  offer: winning it ends the run. The label was chosen by "did you win". It is read off the run
  after the result now (`battleOutcome`): the reward, the run won, or the run lost, each with a
  line ("The run ends at Act I · 1 of 12."). No browser test reaches III·12, so only the node
  test would ever have seen it.
- **The start panel called a beaten encounter the next one.** It read "next: Bog lurkers" for a
  run resting on Bog lurkers' reward. That save could not exist before the first bug was fixed.
  It reads "Bog lurkers beaten, a reward to pick" now.

**Decided while building:**
- **Concede asks in the dialog**, over everything including a roll card, with the 4a wording.
  In a run there are three answers: Concede and end the run, Leave run, Keep playing. A single
  game gets the same dialog with two. 4b left Concede and New run on `window.confirm` for 4d to
  revisit; both are gone. The single game's New game still confirms, since nothing in a run
  reaches it.
- **Leave run asks once the battle is under way**, from the first march: before that there is
  nothing to lose. It needs no decision of yours, so unlike Concede it is live while the enemy
  thinks, and the question stays up while the enemy moves on.
- **Leaving after the result is in goes on**, to the reward or the run's end, as the card would.
  There is no battle start left to return to.
- **The answer that loses something is drawn in the melee colour** (`.choice.secondary.danger`):
  the header's Concede, "Concede, and end the run" and "Lose it and start over". The accent stays
  on Keep playing.

**Checked in the browser** (laptop, phone upright, phone sideways):
- Leave run at the roll-off went straight to the start screen. Continue and Fight gave the
  same board, terrain for terrain and die for die.
- New run over the saved run asked inline, and Keep it kept it.
- Leave run on turn 2 asked, and Keep playing went back to the decision underneath.
- Concede in a run showed the three answers, and Leave run from there left.
- A single game's Concede showed two answers and ended the game.
- Two battles played to the end by a click loop in the page (the first answer, random dice when
  a pick stalled): one lost, one won. Both are described under the first bug above.
- Sideways, the concede dialog is 152 of 390px (39%; 4a measured 41%).

**The exit criterion, as far as it goes.** A run went from the race pick to lost in the browser,
and a reload at every resting point along it came back where it was (here and in 4b and 4c). A
run *won* in the browser means 36 encounters by hand and was not played. The screens it would
reach are the reward and the run's end, both checked. The one thing particular to winning,
the last battle's card, is the node test above.

---

## Phase 5 — Playtest and tuning

Not code first: the numbers this plan guessed, played.
- **Pool contents**: which species each act meets, and whether built forces earn a place beside
  rolled ones.
- **The odds**: 70/30 battles, 70/30 race dice, monsters in the offers.
- **The same-seed restart**: kept or dropped.
- **Whether a 36-health enemy is beatable** from what three acts of rewards can build.

Each finding goes under *What 5 found*, and a change to a number names the run that prompted it.

### What 5 found

The first playtest notes (2026-10-08), each now in the run:
- **The run's first encounter is always a battle.** `drawEncounter` forces it, so the draw spends
  nothing on the kind: the stream is the battle pick alone. That moved every run seed's first
  encounter, which costs nothing, since a run is a snapshot and a seed promises the same run only
  under the same rules. No run opens on an event now, so the tests that needed one reach the
  first event through won battles (`firstEvent` in `run.test.ts`).
- **The opening split is fixed, not drawn:** the large die and its same-line medium at Home, the
  other medium at the Frontier, and the five small dice in the Horde. `splitForce`'s draw left
  the stream with it. 5 / 2 / 5 is legal for every race, since no army is over half of 12.
- **On an event, Upgrade and Transform weigh the same.** Both are primary (green). Upgrade
  was the only green button, which read as the answer the screen recommends. Transform names its die, as Upgrade
  names its result.
- **The reward shows what it would join.** "Show your force and pool" opens a read-only panel
  above the offers: the three armies with where each stands, the spare dice, the dragons and the
  terrains, each die opening the inspector. It reuses the 4b stand-in's army styles, which
  nothing had used since 4c.

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
