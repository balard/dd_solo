# Implementation plan — v2

v1 finished the **complete basic game for Treefolk vs Firewalkers**. v2 opens the force up: any
dice, any mix of species, any size down to 12 health, built by hand or drawn from a collection. It
adds the first four species of the original release (Coral Elves, Dwarves, Goblins and Lava Elves),
which bring the fifth element, Death. It also gives the app a second, schematic pass and a
landscape board to try.

Read `PLAN-V1.md` for how the basic game got here, and its per-phase *Where this section was
wrong* write-ups before starting anything that touches the same seam. This document is the *order
of work*. **Phases 0 to 7 have landed** (Phase 3 as slices 3a to 3e, Phase 4 as 4a to 4c, Phase 5
as 5a to 5g, Phase 6 as 6a to 6h, Phase 7 as 7a to 7f), each with its findings below. **Phase 8
(Lava Elves) is planned** as slices 8a to 8g, with predictions where the landed phases have findings.

**Why v2 is this and not the roguelike.** v3 is meant to be a roguelike run: start with a 12-health
collection, win dice, dragons and terrains, and raise the force cap to 24 and then 36 at set
points, with battles of about ten minutes against fixed, specialized opponents. Every piece of that
needs something in this plan first:
- a force that is *input* rather than a generator;
- armies that mix species, since a run collects whatever it wins;
- forces of unequal size;
- a builder that picks from what you own;
- and more than two species' worth of dice to win.

v2 is the part of the roguelike that is also the full game. Nothing here is roguelike-only, so
nothing here is wasted if v3 changes shape.

**Scope decisions this plan is built on:**
- **Personal project.** No publication, so SFR's content and art are usable locally (invariant 8
  still holds for the repo).
- **Pacing is tested live, not simulated.** AI self-play runs long because the AI never concedes.
  v2 supplies the tools for live testing (small forces, concede, a turn count and a clock) and does
  not try to measure game length automatically.
- **Species abilities that need minor terrain are out** until minor terrain exists. None of the
  four species in this plan has one, so this rule costs v2 nothing; it is written down for the
  species after them.
- **The landscape board sits alongside the current one**, not in place of it. Whether three
  terrains read well side by side is an open question, and this plan answers it with mockups
  before code (Phase 3a).

---

## The two ideas that make this a plan and not a list

**1. A player is not a species; a unit is.** v1 read species off the player:
`speciesOf(state, player)` has six call sites outside tests, and `ResolvedForce`, `GeneratedForce`,
`homeTerrainType` and `validateState` all assume one species per side. That assumption is the
whole of what stops a mixed army, and it is **narrow**: nearly every species ability in the game
already says "Treefolk *units*", not "the Treefolk player", and the rest say "an army containing
Goblins", which a mixed army answers just as well. Phase 1 moves the question from the player to
the unit and changes nothing else. Its hard part is the magic pool, below.

**2. A force is input, not a generator.** Setup knows two kinds of force today, `named` and
`random`, and both end as a `ResolvedForce`. v2 adds a third, `built`: the exact dice for each of
the three armies, the Home Terrain die, the Frontier proposal and the dragons. After that, **every
force goes through `built`**. A preset is a built force stored in `data/`, a random force is a
built force the RNG wrote, and the builder, the AI's force and v3's encounters all produce one. So
there is one path into a game, and the builder cannot build something setup does not know how to
start.

**Dependencies:**

```
0  Groundwork: a live-rules golden corpus, the 1000-game fuzz on the live rules   [landed]
|
1  Mixed species                      engine only; a single-species game does not move   [landed]
|
2  Built forces                       ForceSpec 'built', any size, unequal totals   [landed]
|
+------------------------------+
|                              |
3  The schematic board [landed] 5  Coral Elves [landed]   (the race pipeline, first run)
|                              |
4  The army builder [landed]   6  Dwarves [landed]
                               |
                               7  Goblins (Death magic inside)   [landed]
                               |
                               8  Lava Elves
```

**The two tracks interleave.** The UI track (3, 4) and the race track (5-8) share no seam after
Phase 2, so a race can land between two UI slices. That is the point of drawing them apart: when
one kind of work gets tiring, the other is always available.

**Phase 1 before Phase 2, even though Phase 2 is what makes a mixed force possible.** Phase 1 is a
refactor whose whole claim is "a single-species game does not move", and that claim is strongest
while nothing else moves. It is the Phase 0b lesson from v1.

**Rules that hold for every phase** (carried from v1, with one addition):
- **Each phase lands its own `Pending` kinds, prompts and AI answers**: `promptFor`, `PassiveAI`,
  `RandomAI` and `GreedyAI` all switch exhaustively. No `default:` branch.
- **The fuzz stays green, and a new rule adds a trigger counter.** A clean run proves nothing about
  a face it never rolled.
- **The V0 goldens stay byte-identical and unregenerated.** Nothing in v2 touches `V0_RULES`.
- **New:** **a new SAI, spell or ability gets a line in `GreedyAI`'s scoring in the same phase.** A
  spell greedy cannot score is a spell it never casts, and nothing fails when that happens: v1 found
  it only by writing a test.

---

## Phase 0 — Groundwork — **landed**

Two things, neither of them visible, each cheaper now than after Phase 1.

**The rulebook stays v4.01, decided before this plan was committed.** A v4.02 rulebook exists and
is kept as a local, gitignored reference (`docs/rules/V4.02 Dragon Dice rules.pdf`, 92 MB). Its
main addition is the Dracolem, which is out of scope, and the differences found by reading it are
editing: Cursed Bullets drops "that would add to a save roll", a clarification it did not need.
Every rule, SAI, spell and ability this plan names is in v4.01 with the same content, checked
while drafting. **Page numbers here are v4.01's**, like everywhere else in the project. Come back
to v4.02 when something in scope is only in it.

### 0a — A golden corpus for the live rules — **landed**

The 25 goldens run `V0_RULES`. Nothing guards `V1_RULES` except unit tests and a 200-game fuzz,
and Phase 1 is exactly the kind of refactor a golden file exists for. So, **before Phase 1**, cut
a second corpus the same way Phase G cut the first:
- `v1-games.json`: 15-20 games under `V1_RULES`, `GreedyAI` against `RandomAI` (greedy draws
  nothing, so the random side is what varies the games), named forces including the bestiary and
  at least two monster mirrors, and the same `digestState`.
- The same discipline as the V0 corpus: regenerating it is a decision with its reason written in
  the commit message.
- **Pin every terrain.** The terrain draw changed after Phase 10, and it may change again in
  Phase 2 for Death species and mixed forces. Games recorded with drawn terrains would move for that reason
  alone.

### 0b — Close the fuzz gap — **landed**

The named follow-up from `PLAN-V1.md` *Risks*: 1000 live-rules games behind an environment flag,
200 in the default suite, with per-rule trigger counters. v2 adds about twenty SAIs, eleven spells
and eight abilities, and the big net should guard what is actually played before any of it lands.

**Exit criterion.** Both golden corpora replay green. The live-rules fuzz runs 1000 games with
`stuck === 0` behind its flag.

> **Landed in one commit.** `v1-games.json` holds 20 games and replays green beside the untouched
> v0 corpus; `src/ai/fuzz.test.ts` runs 200 live-rules games in `npm test` (about 14 s) and 1000
> under `npm run fuzz` (about 55 s), every state validated, `stuck === 0` and no game capped.

### Where this section was wrong

**1. "`GreedyAI` against `RandomAI`" alone makes a thin corpus.** Greedy wins every such game by
capture, in under a hundred decisions: eighteen of them never summoned a dragon, never rolled
Dispel Magic, and never ended by elimination. The armies never stand and fight. The corpus is
therefore ten named pairings, each played **once against random and once by greedy against
itself**. Together they summon five dragons, which attack seventeen times, roll Dispel Magic
sixteen times, and end two games by elimination. Greedy draws nothing from its rng, so a self-play game varies by its seed alone, which
is all a golden needs. Twenty games, 2,110 decisions, 478 KB.

**2. Pinning every terrain costs the roll-off choice.** A pinned Frontier leaves the winner one
prize, so no game in the corpus ever asks `roll_off_choice`. That is the right trade -- the plan's
reason for pinning holds -- but it means the corpus does not guard the choice. The live-rules fuzz
and `rolloff.test.ts` do.

**3. "The same `digestState`" had a hole the v0 corpus could not see.** `state.dragons` had been
outside the digest since v1 Phase 6 put it in `GameState`, and `rollOff` since 10e. Neither cost
the v0 corpus anything, since no dragon exists under `V0_RULES`, but a v1 corpus without them
would have seen a dragon that moved wrongly only through the log. Both are digest fields now; the
v0 corpus lacks them and `golden.test.ts` reads them as empty, the way it already read `effects`.

**4. A recorded `ruleSet` is a snapshot, and the corpus now says so.** A record stores its rules as
JSON and `setupGame` takes them as given, so a key added to `V1_RULES` in a later phase would read
`undefined` in all twenty games: its off value by accident. `golden.test.ts` fails when the
recorded key set and `V1_RULES`' differ. That forces a decision about what the corpus means,
rather than letting it quietly replay a smaller game. `npm run goldens` now also takes the corpus
as a required argument (`-- v0` or `-- v1`), so no command regenerates both.

**5. "Per-rule trigger counters" became a table the compiler keeps honest.** The counters are
`Record<GameAction['kind'], Reach>` and `Record<LogEntry['kind'], Reach>`. A decision or log kind
added in a later phase does not compile until somebody says whether this fuzz reaches it:
`'every'` (in the 200), `'full'` (only in the 1000, for anything under five in the 200), or
`{ elsewhere }` naming the test that does. Every SAI on any die in the data must be rolled, and
every spell the rules resolve must be cast. Both are read from the data, and random forces draw
every species, so a species phase tightens this net without an edit. Branches inside a kind (both
roll-off prizes, both victories, Tower's missile at a Reserve Army, each species ability both
ways, breath in every element a dragon was drawn in) are a hand-kept `RULES` table.

**6. Three decisions are never reached at random, even in 1000 games.** `dragon_order`,
`dragon_target` and `dragon_damage_split` need two dragons at one terrain, or dragons at two terrains
at once, and Summon Dragon is the only way onto the board. All three have named tests in
`dragons.test.ts`, which the table points at. `order_of_play` is the other `elsewhere`: it is the
rung below the roll-off choice.

**7. Measured, not guessed.** The longest game is 17,074 decisions, the same game in the 200 and
the 1000, and the median is about 2,000. The cap is twice that, 35,000, and a capped game fails:
a counter under a game cut short is a lie by omission. `PLAN-V1.md` guessed 45 s for a thousand;
it is 55 s with every state validated.

**8. Two hundred more games in `npm test` found a timeout that was already marginal.** The species
fuzz takes about 25 s alone and had been running on vitest's shared 30 s default. With the live
fuzz running beside it, it failed. It and the spell fuzz now carry their own timeouts, as the
fuzzes in `ai.test.ts` always have. The shared default stays at 30 s. The suite runs in about
32 s on the machine that measured 28 s before this phase.

**Deliberately not done.**
- **The v0 1000-game fuzz stays** in `ai.test.ts`. It is `V0_RULES`' net, and the goldens' rules
  are the one thing v2 promises not to touch. The per-rung fuzzes (eighth face, dragons, spells,
  species, greedy) stay too, for their rung-specific counters.
- **No `PassiveAI` seat in the live fuzz.** A bestiary game of passive against random ran past
  100,000 decisions without ending. That is a slow walk rather than a stall (the species fuzz has
  measured one at 58,784 that ends), and the species fuzz already gives passive a seat.
- **No regeneration of `v0-games.json`**, and its digest was not rewritten for the two new fields.

---

## Phase 1 — Mixed species — **landed**

**Deliverable.** An engine where species belongs to a unit, not a player. **No game changes
outcome**: both golden corpora replay byte-identical and unregenerated. A mixed force cannot be
set up yet (that is Phase 2), so this phase is proven by unit tests that build mixed states
directly, and by the goldens proving nothing else moved.

**No `RuleSet` flag**, for Phase 3's reason in v1: nothing can produce a mixed force until Phase 2,
so a flag would gate nothing.

### What moves

- **`speciesOf(state, player)` goes away.** Each of its six callers asks a narrower question:
  - "does this unit have this ability?" becomes `unitHasAbility(unit, ability)`;
  - "which elements can this army's magic be?" is answered per unit;
  - the CLI and `App` show a force as a list of species, not one name.
  - **Delete the function**, rather than leave it answering "the first die's species": a caller
    that forgets to change then fails to compile instead of being quietly wrong.
- **`validateState`'s "every unit of a player shares one species" check is replaced by
  "promotion and every exchange stay within a species"** (p. 30: "a unit ... of the same
  species"). The old check was the rule enforcing that exchanges kept species; the new one says
  the same thing without also forbidding mixed armies.
- **Species abilities apply per die.** Flaming Shields is the one to watch. Its conversion is
  already done on the dice, so in a mixed army at a fire terrain only the Firewalker dice convert,
  and a Treefolk save beside them stays a save. The v1 code was written when "every die in the
  army" and "every Firewalker die" were the same set, so read each ability for the wider one.
- **`ResolvedForce.species` and `GeneratedForce.species` go away.** A force is its dice; the
  species follow from the dice. `forces_drawn` logs the species present, not one species.
- **`homeTerrainType` stops being setup's rule.** It survives only as a default for a random force
  (Phase 2), and a Death species breaks it anyway: no terrain type carries Death, so "the terrain
  whose elements are exactly the species' two" finds nothing for Goblins or Lava Elves.

### The magic pool

"An army's magic is one number" was the load-bearing fact of Phase 7, and `magic.ts` says itself
where it fails: *the day two units in one army carry different elements*. There are two rules to
honour at once (p. 13):
- *"If a unit generates more than one magic result, the results may be divided between that unit's
  elements."*
- *"A species spell may only be cast with results generated by units from that species."*

So the pool is magic **per species**, each splittable between that species' elements. Validating
an announcement is no longer a sum. It is a small transport problem: species groups supply magic,
spells demand it by element (and, for a species spell, by species). At most three or four species
groups and a handful of spells are ever involved, so an exact max-flow, or even brute force over
the splits, is simpler to get right than a clever greedy check.

- **One validator, `announcementProblem`, and both clients keep calling it.** The allocation lives
  inside it. `stageCast` and the spell picker ask whether an announcement is affordable, never how
  it is paid for.
- **`resolveFaces` stays pure and `GameState`-free.** What changes is what it returns for magic: a
  total per species instead of one number. It already knows each die's unit type, so no state is
  needed.
- **A single-species army is a pool with one supplier**, and it must allocate exactly as today.
  The V1 goldens are what prove that.
- `RollMath` shows the split ("5 Treefolk magic + 3 Firewalkers"), because the question "why can't
  I cast this?" now has an answer the old number could not give.

### What this is likely to get wrong

- **A caller keeping the old question under a new name.** `speciesOf(state, player)` renamed to
  "the species of the first living unit" compiles everywhere and is wrong only for a mixed army,
  which no golden or fuzz can produce until Phase 2. Every call site gets a mixed-army unit test in
  this phase.
- **`GreedyAI` and `estimate.ts`** use `speciesElements(speciesOf(...))` to score spells and
  terrains. They are AI, so nothing breaks; greedy just silently misjudges a mixed army. Its
  scorers move in this phase too.
- **A log entry changing shape.** The digest renders every log entry, so a magic entry that starts
  carrying a per-species pool moves every golden with a magic action, even when the pool has one
  species and nothing changed. Either keep the single-species shape exactly (an optional field,
  omitted when there is one supplier, the `CombatState` rule) or make it display-only and drop it
  from the digest like the `...Math` keys.

> **Landed in one commit.** Both golden corpora replay byte-identical and unregenerated, the suite
> and the 1000-game live fuzz are green, and `src/engine/mixed.test.ts` builds mixed boards
> directly: one test, or a few, per call site that moved (28 in all). No `RuleSet` flag, as
> planned.

### Where this section was wrong

**1. Six callers were really two questions, and four of the six were one function.**
`speciesOf` fed `hasAbility`, which fed Replanting, Flaming Shields, Rapid Growth and Air Flight;
the other callers were the magic pool (twice), greedy's Frontier score, and the two clients'
banners. So the work was `hasAbility(state, player, ...)` becoming `unitHasAbility(ruleSet, unit,
...)` at four seams, plus the pool. `speciesOf` is deleted, as planned, and `forceSpecies` (a
list) is what a client shows.

**2. `resolveFaces` did not need to change.** The plan had it return a magic total per species. A
`DieRoll` already names its type and its own results, so `magicBySpecies(dice)` reads the split
off the dice the roll returns. The pure function is untouched.

**3. The plan forgot army modifiers.** A per-species pool cannot absorb an army-level subtraction
without a rule, and Ash Storm subtracts one from every roll at its terrain, magic included. **House
rule** (`RULES-V0.md` section 15): each supplier holds what its own dice rolled, the roll's total
caps the whole spend, and the caster chooses whose results the modifier took. That is still exactly
Hall's condition plus one total check, which is what `allocationProblem` computes.

**4. "Omitted when there is one supplier" was the wrong trigger.** A single-species pool's species
has to come from somewhere when a spell is checked against it, and the only place is the caster's
force, which is right only if the force is one species. So `suppliers` appears **when the caster's
force holds more than one species**, even if only one species rolled magic, and never otherwise.
That keeps `turn.magic.pool` and the `announce_spells` pending byte-identical for every game there
is.

**5. Cantrip lost its dice before the pool was built.** Two Cantrip faces in one roll combine into
one task by SAI name, and the task keeps the sum, not the dice. A mixed army can roll both a
Treefolk Cantrip (Eldar Dryad) and a Firewalker one. The task sits inside the digest, so rather
than widen it, `cantripPool` reads the split back off the dice parked on the exchange.

**6. Two spells were missing from the list.** Accelerated Growth paired a dying unit of *any*
species with a one-health partner of the same species. Only a Treefolk force could cast it, so that
was harmless until a mixed force would have offered a Firewalker the exchange. It now checks the
dying unit against the spell's own species, read from the data. Resurrect Dead's offer is filtered
to the dead that the offered elements could raise, since a mixed DUA holds dice of more than one
colour.

**7. `validateState` cannot say "every exchange stays within a species".** A state does not know
how it became mixed. The old check was a stand-in, and it is gone. The rule it stood for now lives
in `exchangeWithDua`, the one door every promotion goes through. `promote` and
`promotionBudgetProblem` already checked it; Wild Growth's direct call to `exchangeWithDua` relied
on the second.

**8. "`RollMath` shows the split" was the wrong home.** `RollMath` is per-type arithmetic, and the
split is not arithmetic. `poolSplit` gives the sentence ("5 Treefolk: water or earth; 3
Firewalkers: air or fire"). `magicRolled` opens every mixed magic prompt with it, and both clients
print it for a `magic_rolled` entry that carries `suppliers`.

**9. The AI needed more than a scorer.** `estimate.ts` added Flaming Shields for the whole army,
so it now counts only the converting species' saves. Greedy's announcer now finds an element some
split can pay, not the first on offer. It prices an expected magic action through
`expectedMagicBySpecies` (proportional, largest remainder). Its Frontier score became a
health-weighted mean over the dice, which is exactly v1's number for a one-species force.
`spellPlan` gained `problem` and asks the allocation for `affordable` when the pool is mixed:
three points left over do not buy a spell of the wrong species.

**10. Setup could not stay silent about a mixed force.** `ResolvedForce` and `GeneratedForce` lost
their `species` field. Frontier and dragon draws take the union of the force's elements, which is
the same list in the same order for one species. A Home Terrain, though, is "a die of the species'
own type", which a mixed force does not have. `drawHomeDie` throws for one and asks for a pinned
Home, and Phase 2's built force names its Home die.

**Deliberately not done.**
- **Nothing can set up a mixed force yet.** Presets are validated as one species, and random forces
  are drawn per species. Phase 2 is the first place one can start.
- **An army's heading shows its force's species, not the army's.** In a mixed force every army
  would list every species. The schematic board (Phase 3) is where to decide what an army header
  says.
- **No `SAVE_VERSION` bump.** Saving is off, and no single-species game consumes a draw
  differently. A mixed game has never been recorded.

---

## Phase 2 — Built forces — **landed**

**Deliverable.** `setupGame` accepts a force it did not generate: exact armies, a chosen Home
Terrain, a Frontier proposal and dragons, at any size, with the two sides of unequal size allowed.
There is still no builder screen. A built force comes from a test, a preset or the random
generator.

### The shape

```ts
{ kind: 'built', forces: Record<PlayerId, BuiltForce> }

BuiltForce = {
  armies: Record<'home' | 'campaign' | 'horde', unitTypeId[]>,
  homeTerrain?: terrainDieId,       // absent: drawn, as today
  frontierProposal?: terrainDieId,  // absent: drawn, as today
  dragons?: dragonDieId[],          // absent: drawn, as today
}
```

- **`named` becomes a lookup that returns a `BuiltForce` with only its armies.** The terrains and
  dragons stay optional, and **absent means "draw it exactly as setup does today"**. That is what
  keeps both golden corpora still: the V0 corpus pins its terrains through `SetupOptions.terrains`
  and has no dragons, and the V1 corpus (Phase 0a) was recorded with its dragons *drawn*. A preset
  that suddenly carried a dragon would skip a draw and move every V1 golden, for a reason that has
  nothing to do with the rules. Giving a preset its own terrains and dragons is a later, separate
  decision, with a regeneration and its reason written down.
- **A pinned value draws nothing, not "the same draws"**, the rule `CLAUDE.md` already states for
  named forces and pinned terrain slots. A builder force that names its home consumes no home
  draw.
- **`random` becomes a generator that returns a `BuiltForce`**, armies only, like a preset, so
  setup's own terrain and dragon draws are unchanged. A random force may now also be *mixed*, as
  an option. Its draw order is load-bearing only for fuzz seeds, not goldens (both corpora use named
  forces), but write any new order down.
  - **The drawn home for a force that does not name one** needs a rule once Death exists, and once
    a force can be mixed. **A single-species force whose two elements make a terrain type keeps
    today's draw exactly** (a random die of its own type), so Treefolk and Firewalkers stay where
    Phase 10's revision put them. Everything else (a Death species, whose elements make no
    terrain type, and a mixed force) needs a new rule, and the simplest candidate is one uniform
    draw among the dice sharing an element with the force's largest species. A house rule for
    `RULES-V0.md`, and the builder makes it matter only for forces nobody built.
- **Setup rules checked per force, not per pair** (p. 8):
  - no army holds more than half the force (rounded down);
  - every army holds at least one unit;
  - **exactly one dragon per 24 health, or part of 24.** So a 12-health force brings one dragon,
    not none. The direction dialogue guessed "none" for 12; the rulebook says one.
  - The parity check leaves `setupGame` and moves to `newGame.ts`, which can say "unequal on
    purpose" (v3) or "unequal by mistake" (a typo in the builder).
- **The roll-off works with built forces.** Each player's Frontier proposal is now *their* die,
  not a draw, and `rollOff: 'choice'` already chooses between two proposals. The placeholder board
  and the proposals' eighth faces work unchanged.

### Force size is a game fact now

Two of the new species abilities, Foul Stench and Cursed Bullets, scale with force size (p. 21): *"The limit stated is per
24 points of total force size, or part thereof"*. So Foul Stench's "up to three" is 3 at 12 or 24
health and 6 at 36. With unequal forces there are two sizes, and **each player's limit reads their
own**, which is a house rule for `RULES-V0.md`, since the rulebook assumes one agreed size.

**Derive it if it is invariant, store it if not.** Units never enter or leave the game in this
scope (exchanges swap places, and Dragonkin are out), so a player's force size is the total health
of every unit they own, wherever it stands. That is the rule armies already follow, and species
will after Phase 1: derived, never stored, so it cannot drift. **Check that it really is invariant** before relying on it: an
exchange moving a die between players' areas would break it.

### Exit criterion

A 12-health mixed force plays to the end in the terminal against a 12-health greedy force
(`npm run play --forces built:<file>` or similar). A 12-against-24 game sets up without throwing.
Both golden corpora are unchanged.

> **Landed in one commit.** Both golden corpora replay byte-identical and unregenerated, the suite
> and the 1000-game live fuzz are green, and the fuzz now plays a **mixed** rolled force one game in
> five. `src/engine/built.test.ts` holds the built path; the exit criterion is met in the terminal
> with `npm run play -- --forces built:data/forces/mixed-12.json --p1-ai greedy`, and as tests
> (`data/forces/` holds that file and a 12-against-24 one, both loaded by the tests). No `RuleSet`
> flag: a built force is a way of *specifying* a game, not a rule.

### Where this section was wrong

**1. The first mixed game found two bugs Phase 1 left, and neither was in this section.** Phase 1
could only prove itself on hand-built boards, and said so. The moment the fuzz rolled a mixed force
it threw, twice, on the first game:
- **`RandomAI` announced spells by the pool's one number.** Greedy had learned the per-species pool
  in Phase 1; the fuzz opponent had not, so it bought a Firewalker spell with Treefolk magic. It now
  keeps only an element some split pays for. That filters nothing in a one-species game, so every
  such game draws what it always drew.
- **Resurrect Dead's offer said which dice, not which colour raises which.** Phase 1 filtered the
  dead to those the offered elements could raise *at all*; both AIs then paid for a Firewalker in
  water. `SpellTargetOffer.elements` now carries the narrower list, **present only when it narrows**
  (so never in a one-species game, and never in a golden digest). `elementsFor` reads it for a client
  that picks the target first (both AIs), `targetsFor` for one that picks the element first (the app's
  die picker and the terminal). It is `minCount`'s lesson again: a rule the clients do not know is
  one both clients break.

**2. The candidate home rule would have moved a mixed force off its own terrain.** "One uniform draw
among the dice sharing an element with the largest species" gives a Treefolk-heavy mixed force any
of 20 dice, where a Treefolk force gets one of the four Swamplands. The rule shipped is the largest
species' **own type**, falling back to the element draw only for a species with no own type (every
Death species). One rule, and for a one-species force it is exactly Phase 10's. Largest is by health,
and a tie goes to the first species by id.

**3. `named` becoming "a lookup that returns a `BuiltForce`" was exactly right, and is now a test.**
The starter pair built by hand opens on the same board, die for die and RNG counter included, as the
named pair, under `V0_RULES`, `SPECIES_RULES` and `V1_RULES`. Every force, named, rolled or built, is
checked by `builtForceProblem` in `setupGame`, so a preset and a file from the builder are held to one
statement of the p. 8 rules.

**4. A pinned dragon list is the last draw setup skips, which gave the cleanest test in the phase:**
a game whose forces both name their dragons ends on the same RNG counter, with the same terrains, as
the same game with `dragons: false`.

**5. Force size is invariant, as predicted, and is checked rather than assumed.** `forceSize(state,
player)` is the health of every unit the player owns; nothing in scope changes an owner or adds a
unit. The live fuzz asserts every game ends at the size it started. No rule reads it yet: Foul
Stench and Cursed Bullets arrive with Goblins and Dwarves.

**6. The terminal needed a way to play a game it cannot answer.** "Plays to the end in the terminal"
asks for a whole game, and piping fixed input cannot answer the damage picker. `--p1-ai <name>` lets
an AI play your seat and the terminal narrate: a watch mode, and the first of Phase 3e's live-testing
tools. `--forces mixed` rolls a mixed pair.

**7. `dragonCount` was already right for 12.** `max(1, ceil(h / 24))` gives one at 12. It moved to
`force.ts` beside the validator that uses it, and `setup.ts` re-exports it.

**Deliberately not done.**
- **No route to a built force in the app.** `?forces=` names only `FORCE_SETS`, and the start screen
  pairs presets of equal health and calls anything else a slip. The builder (Phase 4) is where a
  built force and "unequal on purpose" reach the screen.
- **Presets still carry a `species` and are validated as one species.** A mixed preset would also
  become a monster-mirror fixture by the registry's naming rule. The example mixed forces live in
  `data/forces/` instead.
- **A built force ignores its dragons under `dragons: false`**, rather than refusing them: a force
  describes what a player brings, and the ruleset is a separate choice.
- **The roll-off choice still opens when both proposals are the same die.** Choosing between two
  identical dice is a real if pointless decision, and a built force can now make one on purpose.
- **No `SAVE_VERSION` bump.** Saving is off, `ForceSpec` only gained a kind and an optional field,
  and no existing record draws differently.

---

## Phase 3 — The schematic board

**Deliverable.** A cleaner, more schematic app with more on screen and less in the way, plus a
landscape board as an option beside the current one. It is still art-independent (invariant 8), so
real art can drop in later without a layout change.

**The engine does not change**, except for concede (3e). Everything here renders from
`state.pending`, the log and `rollsOnTheTable`, as today.

| Slice | Scope |
|---|---|
| **3a** | Mockups before code: both layouts at 12, 24 and 36 health — **landed** |
| **3b** | The schematic pass: tokens, shapes, the log out of the way — **landed** |
| **3c** | The roll presentation — **landed**: every roll stops, in a dialog floating over the board |
| **3d** | The landscape board — **landed**: the phone's layout, alongside on wide screens, with stacks and a reserves row |
| **3e** | Playtest tools — **landed**: concede, turn count, clock, end-of-game summary |

### 3a — Mockups first — **landed**

The open question is **density**: can three terrains side by side, each with two armies facing
each other, hold a 36-health game on a laptop, or on a phone held sideways? That is answered
fastest by static mockups with real dice counts, not by building the layout and finding out.
- Three mockups for each layout: 12, 24 and 36 health.
- Real counts, including the worst case: a 36-health force with every die still alive and the
  enemy's Horde at your home.
- **Decide 3d's scope from these.** If landscape fails at 36 health, it is still worth having at
  12 and 24, which is what the roguelike's early game plays.

### What 3a found

The mockups are one page, `docs/mockups/phase-3a.html`. It draws both layouts at real pixel sizes,
from the real dice and today's `TILE_SIZE`, and measures how far the board runs past the bottom of
the screen. There are four sets of armies (mid-game, all small, setup worst, pile-up) at 12, 24 and
36 health, and four screens: a laptop (1366×680, a 768px screen less the browser's bars), a desktop
(1920×960), a phone held sideways (844×390, the installed app) and a phone upright. A table on the
page holds every combination. It took three rounds of review, and most of what follows came from
the second and third.

**1. Density is a phone problem, not a laptop one.** At today's tile sizes both layouts fit every
case on a laptop and a desktop, including the 36-health setup worst case. A phone held sideways is
under 900px wide, so today's board stacks the three terrains into one column. That needs two to
four screens of scrolling in every case, even with every tile at its smallest. The landscape board
fits there. So **landscape is the phone's layout**, and on a laptop it is a matter of taste: the
"alongside, a toggle" decision stands for wide screens, and a phone held sideways should open on
landscape.

**2. The plan's worst case was the worst *setup*, not the worst board.** The enemy's Horde at your
home puts 34 dice there at 36 health. In play every die can end at one terrain: both whole forces,
72 small dice, every dragon, and a pile of spells, three on each army and two on the place. The
mockups carry both (*Setup worst* and *Pile-up*), and every rule below was tested against the
pile-up.

**3. Stacking identical dice beats shrinking them.** Identical dice become one tile with ×N on its
corner, which costs barely more width than one die. With stacks, the 36-health pile-up fits a laptop
at today's size and a phone sideways at Compact, 44px, the tap-target floor. The bare-shape tier it
replaced was 22-32px and still over. A stack reads well enough to go *bigger* than today's tile, not
smaller.
- **Identical means the same type in the same state.** A sleeping die is its own tile, and so is a
  die under any effect aimed at that one unit (`effects.ts` has unit targets). The effect follows
  that die, not its twins.
- **A decision that needs one die from a stack unstacks it** in its targeting view: damage, a
  retreat, "a unit in this army". The engine still receives unit ids. Identical dice are
  interchangeable, so which of the stack's ids a count selects does not matter. This is a client
  rule, and `selectableAt`, `pickModeFor` and `tapMeaning` do not learn about stacks.
- **Roll strips never stack.** Each die rolled its own face, and showing that is the strip's job.

**4. The rule is today's size, stacked when crowded, and at most one step down.** The mockup
measured the ladder Today → Today stacked → Compact stacked, which never goes under 44px:
- A laptop fits all twelve cases.
- A phone sideways fits all but one set of armies, a varied mid-game force: +13px at 24 health and
  +127px at 36.
- That force has few twins, so stacking gains it little. The overflow is accepted as a short scroll
  rather than bought back with tiles under the tap target.

**5. Bare class shapes are not a size tier.** They read at 22-32px in the mockups only because the
mockups have no real icons, and a detailed icon at that size is lost. Visibility at small sizes is
part of why better unit icons than the ones printed on the dice are wanted at all. The shapes stay:
they are 3b's class-line token (square HM, diamond LM, triangle MI, chevron CA, circle MA, hexagon
for a monster, which has no class) and what a die draws with no art.

**6. Who owns a terrain goes on the owner's side of the die.** A die in the middle of the row reads
as neutral, which a Home Terrain is not. A tag on the owner's side says so: solid toward you,
outlined toward the enemy. It reads *HOME* for a Home Terrain and *HELD* for a captured eighth face,
which also gives the die a double border.

**7. Dragons: drop the owner, keep the twelve sides.** A dragon behaves the same whoever brought it,
so ownership moves to the inspector. On the board a dragon draws in the units' shape, a square while
every unit is a square, and a dodecahedron where the units are not, because a d12 is what sets a
dragon apart. It keeps its element colour and drake or wyrm. The first mockup's pill was too small
to read.

**8. The reserves need a row, and what is off the board needs only a count.** A Reserve Army
marches most turns, so it gets a fourth row laid out like a terrain. The DUA, the BUA and the
Summoning Pool are counts at each side's outer edge of that row ("DUA 3 · BUA 1 · Pool 1") and open
on a tap. The side rail the first round had is gone, and its width went back to the dice.

**9. Effects are counted chips.** Eight active spells as eight lines is most of a phone screen. As
chips (*Stone Skin ×3 +3 save*) they are two lines, with the duration in the tooltip. A terrain
effect is a dashed chip across its row, on neither army, as `Board.tsx` already reasons.

**10. On a phone sideways every line of chrome counts.** The header and the log ticker share one
line. The terrain column holds the die, the slot's name and the health on each side, and the type and
eighth face move to the inspector. Together these were worth about 80px of a 390px screen.

**Deliberately not done.**
- **No code.** Nothing in `src/` moved. The mockup is static HTML with its own renderer, not a
  component, and nothing in it is meant to be lifted into the app.
- **The mockup still shows the round-3 drawing** of two things the last review changed: dragons as
  diamonds with an owner caption (finding 7), and bare shapes on the Auto ladder (finding 5). The
  page records what was measured. The findings are the decisions, and redrawing the page would
  have measured nothing new.
- **Art density was not measured.** The mockups draw our own glyphs, never SFR's art (invariant 8
  holds for `docs/` too). A real ID face at today's size is what the app already shows.
- **Phones held upright were measured for comparison only.** Landscape is not meant for them, and
  today's board stays their layout.

### 3b — The schematic pass — **landed**

- **Design tokens**: element colours (now five, with Death), shapes for class lines, a type scale.
  One `:root` of tokens, so the art pass later changes values, not components. The shapes are 3a's
  (finding 5), and a dragon's is a square or a dodecahedron (finding 7).
- **Effects as counted chips** (3a finding 9), in both layouts.
- **The ID face as the die's identity, larger.** It is the digital-native move from the direction
  dialogue: a die on the board always shows its ID, which a table die cannot. Today's tiles already
  lean this way; the pass makes it the rule.
- **The log gets out of the way**: collapsed to a one-line ticker (the newest entry) by default,
  expanded on demand, remembered per viewer. The log is still the record of what happened; it just
  stops taking half the page.
- **More functionality where it is cheap**: expected results on a pending attack ("expect about 6,
  they save about 3"), from `estimate.ts`, which exists and is the one place faces become numbers.
  This is a display of the estimator, not a new calculation.

### What 3b found

UI only. The engine, both golden corpora and `SAVE_VERSION` did not move, and no test outside
`src/ui` changed.

**1. The class shapes are the tile with no art, and with art they are not visible.** They shipped
as `ClassShape` in `Glyph.tsx` and are what a die draws when the manifest has no face for it: a
fresh clone, or a face `npm run art` could not resolve. That retired the old fallback, a row-shaped
tile with the die's name in it, so a tile is now always a square die.
- **A monster's hexagon carries two letters of its name.** Class and size pick out one die of a
  species, except among monsters, where all five of a species share the hexagon.
- **With art, the corner keeps its letters (HM, MO).** Putting the shape there instead was
  considered and left alone. The letters are exact for someone who does not know the shapes yet,
  and the new unit icons are the moment to decide what the corner says.

**2. The species band is the change you see with art.** Every tile has a thin strip along the
bottom in its species' two element colours. It is the one fact about a die its ID face does not
carry, and in a mixed army the one that matters. The health digit moved up to clear it.

**3. Twenty-three font sizes became eight.** `--fs-2xs` to `--fs-3xl` on `:root`. Each size moved
by a hair at most, so nothing visibly changed. The gain is for the art pass: a rule now picks a step,
not a number, so one value changes and not twenty rules.

**4. Dragons are square tiles, and the owner went to the inspector** (3a finding 7). The tile is
60px, a large unit's side, tinted and banded by element, with DR or WY where a unit shows its class.
The inspector says "yours" or "the enemy's", so `Inspector` gained a `human` prop. The d12 outline
waits for the day unit tiles stop being squares, which nothing in this plan brings.

**5. Chips count what is identical, and "identical" includes when it ends.** `effectChips` groups by
source, arithmetic *and* expiry, so two Stone Skins cast on different turns stay two chips: they run
out at different times, and that is a difference you plan against.

**6. The ticker is the log's own renderer, cut by CSS.** A plain-text summary of each entry would
have been a second description of some forty entry kinds, the thing the log and the decision sheet
were made to share `LogLine` to avoid. Instead the ticker draws the newest `LogLine`, and CSS keeps a
roll's heading and outcome on one line and drops its dice. `logShows` names the two kinds `LogLine`
draws as nothing, and a comment at each end ties the lists together.
- **Opening the log scrolls to it on the tap, never on load.** The first draft scrolled whenever
  the log was open, which would have yanked the page down for anyone who left it open last time.
- **The open state is a preference, in a new `prefs.ts`**, not in `storage.ts`. That file is the
  dormant save format, whose version means replay correctness; a preference needs no version.

**7. Forecasts are `Choice.detail`, from `estimate.ts`.** Melee, a missile target and a
counter-attack show both rolls ("expect ≈6, they save ≈3"). The Missile and Magic *action* buttons
show the attack alone, because the target is not chosen yet. `plainLabel` gives the forecast to
screen readers too.

**8. What would have shipped silently: NUL bytes in the source.** The chip key's separator was
written into `prompts.ts` as real NUL characters by the script that made the edit. `tsc`, the whole
suite and the running app were all fine with it. The only tool that noticed was `grep`, which
started calling the file binary, and a file `grep` cannot read is a file the next search misses. The
key is `JSON.stringify` of its parts now.

**Deliberately not done.**
- **The larger ID face moved to 3d.** Stacking is what frees the width (3a finding 3), so a bigger
  portrait now would be sized twice.
- **No DOM test of the ticker or the tiles.** By the project's rule the logic is in pure functions
  (`effectChips`, the forecasts, `logShows`), and those are what is tested. The tiles, the no-art
  path, the ticker and dark mode were checked by eye in the running app.
- **The forecast is not on the contest-a-maneuver prompt.** `contestOdds` exists, but it is a
  chance of winning, not an expected roll, and it deserves its own wording.

### 3c — The roll presentation — **landed**

"A different interface to show the dice rolling results." Today a roll's evidence is a strip above
the decision sheet plus a log line. The new presentation is a **panel that walks through what
happened since your last decision**: the attack roll, each SAI, the saves, and the damage in the
pipeline's own order ("roll, then SAIs, then totals", as today).
- **Derived from the log, never stored alongside it.** The events to present are the log entries
  added since the last human action. That is one query over state the app already has, and it
  keeps the golden digests out of it.
- **Built as a queue of presentable events**, one per step, even though v2 shows each step without
  animation. That queue is exactly what an animation pass needs later, so building it now is the
  cheap half.
- **The AI's turn is where this matters most.** A greedy march is several rolls and decisions in a
  row that today arrive as a block of log lines.
- **Dismissable, and skippable.** A live test at ten minutes a game cannot afford a panel that has
  to be clicked through.

### What 3c found

**1. The plan's shape was built first and rejected in review.** It was a panel over the board
listing everything since your last decision, opening by itself after the enemy acted, with a
Recap button on the ticker. It worked, and it was the wrong shape: the evidence was still somewhere
other than the decision, arriving as a block. What shipped instead is the review's own design:
- **The game stops at every roll.** The opponent does not act, and your next decision is not
  offered, until you press Continue. A tap per roll, knowingly: seeing each roll is the point, and
  a faster path (auto-advance, hold to skip) is later work. "Skip N more" is there meanwhile.
- **The decision dialog floats over the terrains** (`.float-dock`), and a roll card takes its place
  until you continue. So the eye stays in one spot for the whole exchange: the dice, then the
  question they lead to. The page is padded by the dialog's measured height, so the last terrain
  can always be scrolled out from under it.

**2. The gate is a client cursor, not an engine pause.** `useGame` holds one `RollCursor` (a log
index and a step within it); the stops are `rollSteps(log.slice(cursor.log), human)`, pure, in
`presentation.ts`. The AI's effect waits while a step waits. The engine did not change, so no
golden can see any of it. The plan's "one query over state the app already has" held, with one
number beside the state, because the log does not record what the player has looked at.

**3. The rules' order, per kind of roll.** A resisted roll -- melee, missile, a contested maneuver
-- is the roller's dice, then the resisting roll (saves, or the opposing maneuver) with what the
two came to. A roll nobody resists -- magic above all -- is one stop, then what it was for (spell
picking). The roll-off, sub-rolls, spell saves, Replanting, Rise from the Ashes and the dragons'
rolls are one stop each. Everything else (a march begun, a terrain turned, a unit killed) is on the
board as it happens and in the ticker, and stops nothing.

**4. An SAI is a stop only when it has something to resolve.** The first cut made every die with an
effect a stop. Review cut it back: Smite, Counter, Surprise and Cantrip only change the numbers, and
the roll's card already marks them (`+4` on the die, named in the sum). A targeting SAI, Sleep,
Galeforce, Choke, Confuse, Wild Growth and the free moves still get their own card, after the attack.

**5. The log writes causes after their consequences, twice, and the steps put them back in
order.** Neither needed an engine change, and an engine change would have moved the v1 goldens:
- **An exchange's SAI resolution is logged before the exchange.** `combat_resolved` is written when
  the exchange ends, so the Flame's `sai_resolved`, its sub-roll and its kills sit *ahead* of the
  attack that rolled it. They are held and carried onto the SAI's own card.
- **A spell's consequences are logged before its `spell_cast`** (`turn.ts` resolves, then logs the
  cast), and `spell_cast` does not say where the spell went at all. So a spell run is read
  backwards from each name, and the card puts each "casts X" first with the lines that say what it
  did and where: "The enemy casts Lightning Strike", its save-or-die roll, "You lose Strangle Vine".

**6. The enemy's spells are a stop; yours are not.** You just chose yours. A roll inside them still
stops (the enemy's saves against your Hailstorm).

**7. One way to draw a roll, still.** The log's combat and maneuver entries are now composed from
`CombatPart` and `ManeuverPart`, and the cards draw the same parts, so a card and the log cannot
describe one roll two ways. The decision dialog stopped drawing a roll already in the log above the
sheet (it was just shown, step by step). A roll still on the table is drawn as before: it is not in
the log yet, and its dice may be the answer.

**8. Two slips that would have shipped quietly.**
- **`Feed.tsx` beside `feed.ts`** is one file to Windows, and `tsc` refused the pair. Moot now, but
  a component and a module must not differ only by case.
- **A scripted edit truncated `index.css`** to the block it replaced, dropping 700 lines. The
  typecheck and the tests cannot see CSS; the line count can. It was rebuilt from the committed file
  plus this slice's block, and the diff checked to be exactly that block.

**Deliberately not done.**
- **A roll shown live at a mid-roll pause is shown again as a card.** Rapid Growth and a targeting
  SAI ask their question with the dice on the table, before the exchange is logged; the cards come
  after it is.
- **The board can run ahead of the card.** When one action kills by itself (a sub-roll, a Flame),
  the board shows the deaths before the card shows the roll.
- **Skipping loses the roll behind the decision.** The ticker still has the latest line.
- **Phone held sideways is cramped** by today's header and banner. 3d's chrome is the fix.
- **The "since your last move" overlay and its Recap are gone**, replaced by the step-through.

### 3d — The landscape board — **landed**

Three rows, one per terrain: **your army on the left, the terrain die in the middle, the enemy on
the right**, so the armies face each other the way the art wants to eventually. 3a settled most of
the rest (see *What 3a found*):
- **The phone's layout, and alongside on wide screens** (finding 1). A phone held sideways opens
  on it. Elsewhere it is a toggle, remembered per viewer, and `?layout=landscape`, which joins the
  link parameters `parseGameRequest` already reads.
- **A fourth row for the Reserve Armies**, with the DUA, BUA and Summoning Pool as counts at its
  outer edges that open on a tap (finding 8).
- **Ownership tags on the owner's side of the terrain die** (finding 6), and dragons under it with
  no owner (finding 7).
- **Stacks of identical dice when a terrain is crowded**, at today's size and at most one step down
  to Compact (findings 3 and 4). A stack is a view over `armyAt`, and a targeting view unstacks it.
- **The ID face larger**, moved here from 3b: stacking is what frees the room for it.
- **The decision dialog already floats over the terrains** (3c), which the 3a mockups drew as a
  docked bar. Landscape takes it as given.
- **`Board` renders from the same data either way.** `selectableAt`, `pickModeFor` and
  `tapMeaning` do not know the layout, and must not start knowing it.
- **Side-facing art later means one drawing per unit, mirrored for the enemy.** Nothing to build
  now, but the layout should leave the tile shape free to widen.

### What 3d found

UI only. The engine, both golden corpora and `SAVE_VERSION` did not move, and no test outside
`src/ui` changed. The new logic is two pure modules, `layout.ts` (which board) and `stacks.ts`
(sizes, stacks, the ladder), with their own tests; `LandscapeBoard.tsx` draws from them.

**1. The ladder is a line count per row, not a fit of the whole screen.** The 3a mockup measured
the board's overflow and stepped the tallest block down until everything fitted. The app cannot
lay a board out three times per render to find that out, and does not need to: a row's height is
its taller side's lines of dice. So `densityFor` takes one measured side width (every side is one
`1fr` of the same grid, so one `ResizeObserver` measures them all) and returns the first rung
(today, today stacked, Compact stacked) whose taller side fits in two lines, or one on a phone held
sideways. A pile-up that fits nowhere stays on the last rung and scrolls. Both sides of a place
take the same rung, so the two armies facing each other are drawn at one scale.

**2. Unstacking lives in `DiceGrid`, not in the board.** A grid with any die that answers the
current decision draws unstacked, whatever it was asked to do. That puts 3a's "a targeting view
unstacks" in the one component every grid goes through, so `selectableAt`, `pickModeFor` and
`tapMeaning` never learn about stacks and no caller can stack a grid being picked from. Checked
in the running app: an enemy counter-attack on a ×3 Satyr stack drew three pickable Satyrs, while
the enemy's own ×3 at its home stayed stacked.
- **"Identical" means the same type and not `singledIds`**: any die under an effect aimed at that
  one unit (Sleep is one) is always its own tile.

**3. The ID face grew inside the same tiles.** Portraits went from 30/34/38/46 to 34/38/44/54;
the tile sides did not move, so no board got taller for it. Compact is 44/46/50/56 with portraits
of at least 32, above the 30px art floor. The corner badge and health overlap the portrait's
margins, and an ID face's figure is in its middle. The tables moved from `DiceGrid` to
`stacks.ts`, since the ladder measures with them.

**4. Which board is a rule with three inputs, and the link is kept apart from the game.**
`layoutFor(viewport, chosen, linked)`: an upright phone always gets the cards and no toggle; a
`?layout=` link beats the viewer's choice, which beats the default; the default is landscape on a
phone held sideways and the cards everywhere else.
- **`?layout=` is not read by `parseGameRequest`**, though the plan said it would join it. A
  layout is how a board is drawn, not which game is played, so on its own it must start nothing,
  and `parseGameRequest` returning non-null *is* starting a game. `parseLayout` reads the same
  query string beside it.
- **It is read once at module load**, because `useGame` clears the query in an effect once a
  linked game starts, and the board mounts after that. A link is never written to the preference:
  it says how to show *this* board, not how the viewer likes boards.

**5. The phone's chrome.** On a phone held sideways in landscape the header and the log ticker
share one line, with the title and the "vs greedy · seed" dropped. The "as the link asked" banner
now shows only until the first march, in both layouts: after that it was a line of chrome the game
had outgrown. On an 800×398 frame the whole board (three terrains and the reserve row) fits under
the header with the dock closed.

**6. The reserve row is always drawn**, and its outer edges carry "DUA n · BUA n · Pool n" for
each side. A tap opens the Fallen section below the board, which in landscape has no heading until
something opens it (the counts, or a decision that picks from the DUA) and holds the Summoning
Pools as well. HOME and HELD tags sit on the owner's side of the die, solid toward you and outlined
toward the enemy; HELD wins over HOME when you hold your own home, and a held face takes a double
edge.

**7. Two things that would have shipped quietly.**
- **Scripted edits on Windows wrote CRLF.** Python's text mode turned every `\n` into `\r\n` in
  the files it rewrote. `.gitattributes` would have normalised them on commit, so nothing would
  have broken; the only sign was git's warning on `diff --stat`. The files were put back to LF.
  (3c's truncation and 3b's NUL bytes were the same class of slip: a scripted edit, and a check
  only a byte-level tool makes.)
- **The browser pane's device emulation fires neither `resize` nor a media-query change, and a
  `ResizeObserver` waits for a painted frame.** So a resized frame kept the old layout until
  something forced a render. A `matchMedia` listener was added as a fallback and then removed:
  nothing in reach could show that it helped, and a rotated phone fires `resize`.

**Deliberately not done.**
- **The cards do not stack.** 3a measured them fitting a laptop at today's size, and a phone
  sideways now opens on landscape. It is one prop on `DiceGrid` if that changes.
- **The mockup's 36-health pile-up was not reproduced in the app**: nothing on the start screen
  builds that board. The ladder is tested in node against constructed armies, and the stacks and
  the unstacking were checked by eye on a monster mirror at 640×360.
- **No real phone was rotated.** The frames checked were 640×360, 800×398 and 1366×680, by
  emulation.
- **Dragons stay square tiles**, 44px in the terrain column. The d12 outline waits for unit tiles
  that are not squares.
- **The tile shape is left free to widen** for side-facing art: every size is a side length in
  one table, and the ladder asks `tileSize` for widths rather than assuming squares.

### 3e — Playtest tools — **landed**

What live testing needs to leave a number behind rather than a feeling.
- **Concede, as an engine action.** `{ kind: 'concede' }`, legal for the player a pending is
  addressed to, which sets the winner. It is an action rather than a UI button that stops the game
  so the record says how the game ended. `applyAction` still sets no pending, so the victory check
  path is unchanged.
- **Turn count and a clock, UI only.** No clock ever enters the engine.
- **An end-of-game summary**: turns, elapsed time, health left on each side, how it ended (two
  captures, wipe-out or concession). That is the data point a pacing test is looking for.
- **Not here: an AI that concedes.** It is a v3 encounter-design question (a boss that never
  yields is a design choice). Noted in *Not in this plan*.

**Exit criterion.** A 12-health game is playable in both layouts on a laptop and on a phone held
sideways. The log is collapsed by default. An AI march is readable from the roll panel alone. A
conceded game shows its summary.

### What 3e found

The engine changed for the first time since Phase 2, by one action and one reason. Both golden
corpora replay byte-identical and unregenerated: no recorded game concedes. `SAVE_VERSION` did not
move either, and not only because saving is off: an old record never holds a `concede`, so it
replays exactly as before, and the version is about nothing else.

**1. `concede` is the one action that matches no `Pending.kind`.** Every other action names the
decision it answers, and `reduce` refuses a mismatch. Concede answers any of them, so it has its own
door there: legal while a pending is open, and the pending's `player` is who concedes, since the
action carries none. `applyAction` sets the winner itself (the board has not changed, so
`findVictory` has nothing to find), logs `victory` with the new reason `'concession'`, and sets no
pending, so `advance` stops before `stepGame` runs. No randomness is drawn, and a test says so.

**2. What would have shipped quietly: a concession at the roll-off failed `validateState`.** The
live rules open on the roll-off choice, so the first decision a player can concede on leaves
`GameState.rollOff` open in a finished game, and the validator held "a roll-off open" to "the setup
phase". Dropping the roll-off would have made both boards draw the placeholder faces as a roll that
never happened; a game given up before anyone chose is exactly a game with the choice still open.
So the validator allows that one case, named by the log (a `concession` victory with no
`roll_off_decided`), and the summary counts it as ended before the first turn.

**3. The exit criterion named a game nothing in the app could start.** The presets are 24, 30 and
35 health, a rolled force is 24 or 36, and the only 12-health pair was `data/forces/mixed-12.json`,
which only the terminal could load. The two example files joined `FORCE_SETS` under their file
names, so `?forces=mixed-12` starts one, and the terminal's `--forces mixed-12` too. The start
screen still pairs presets only; a 12-health game from a menu is the army builder's (Phase 4).
- **Two fuzzes picked their "mirrors" by exclusion** ("every name but starter and bestiary"), so
  the built pairs would have joined them silently and changed which games they play. Both now
  select `isMirror` (one preset on both sides), which is the same set as before.

**4. The clock and the turn count are the client's.** `Session.startedAt` is set when a game
begins and `endedAt` by whichever action produced a winner, the AI's included, so the time is wall
time: roll cards and thinking count, because a pacing test asks how long a game takes to play. The
header shows it beside the turn. The turn is the header's count, finished turns plus the one in
progress, with each player's turn counted on its own, as the rules count them.

**5. The summary replaces the decision in the dialog, after the last roll card.** How it ended,
the turn, the time, and health left of what each side brought (`gameSummary` in `summary.ts`,
pure and tested). The roll that won is always seen first: the summary waits behind the cursor like
any decision. Checked in the app on a 12-health game conceded in landscape at 844×390, and one
played to a capture on the cards at 1366×680.

**6. Concede is in the header, greyed while the enemy decides.** Legal only on your own decision,
so it is disabled rather than hidden while the enemy thinks, and says why on hover; a button that
comes and goes would move New game under the thumb. It asks for confirmation. The terminal takes
`concede` typed at any menu, which every turn passes through.

**Deliberately not done.**
- **No AI concedes**, as planned; the fuzz names `concede.test.ts` for the action and the reason.
- **The summary is not copyable or kept.** Saving is off, and nothing yet collects playtest
  results; the numbers are on screen at the end of every game.
- **The clock does not pause** when the tab is hidden or the player walks away. It measures the
  session, which is honest about what it is and wrong for an interrupted game.
- **No DOM test of the header or the card**, by the project's rule; the logic is `summary.ts`.

---

## Phase 4 — The army builder — **landed**

**Deliverable.** A screen that builds a `BuiltForce`, in two modes over one component:
- **Full**: every die in the data, any quantity.
- **Limited**: only what a **collection** holds, in the quantities it holds.

### The collection

```ts
Collection = {
  units: Record<unitTypeId, count>,
  dragons: Record<dragonDieId, count>,
  terrains: Record<terrainDieId, count>,
}
```

- **The full mode is a collection too**: everything in the data at unlimited count. One builder,
  two sources, and v3 only ever changes which collection it passes in.
- **Dragons and terrains are in it**, because v3 hands them out as rewards. A limited builder
  picks the Home Terrain and the Frontier proposal from the terrains owned, and the dragons from
  the dragons owned.
- **`forceProblem(collection, cap, force)` is pure and lives beside `newGame.ts`**, tested in node
  the way `prompts.ts` is: over the cap, an army over half, an empty army, the wrong number of
  dragons, more copies than owned. The screen *shows* the problem; it never decides one. That is
  the start-screen rule from v1: a disabled button with no reason beside it is the same bug as a
  crash.

### The screen

- Pick dice into the three armies (Home, Campaign, Horde), with a running total against the cap
  and the half-force line visible per army.
- Pick the Home Terrain and the Frontier proposal, each showing its eight faces (`TerrainDetail`
  exists).
- Pick dragons: one per 24 health, or part of 24.
- **Built forces are kept per viewer** (localStorage, wrapped as always) so a playtest can be
  repeated without rebuilding. That is a convenience store, not a save: saving games stays off
  until v3.
- **The AI's force** is chosen on the start screen: a preset, or a random force of the same (or a
  chosen) size, drawn from the full collection, single-species or mixed.

### A starting collection for testing

**A "sorry 12"** fixture in `data/`: a limited collection of about 12 health of small and medium
dice with one dragon and two or three terrains. It is the start of the v3 run in miniature, and
the smallest real test of the limited mode. **Its contents are a v3 design question**, and this
phase only needs *a* plausible one.

**Exit criterion.** A mixed 12-health force built in the limited mode and a 36-health force built
in the full mode both start and play to the end in the browser, against a random AI force of the
same size.

### Slices

Three, in Phase 3's manner: the rules first where node can test them, then the screens that show
them. The engine does not change beyond one pure generator.

| Slice | Scope |
|---|---|
| **4a** (landed) | **The model, no screen.** `Collection` and its loader (`src/data/collections.ts`), the full collection, the "sorry 12" fixture in `data/collections/`, `forceProblems(collection, cap, force)` in `src/ui/game/builder.ts`, and `rollForce(budget, pool, rng)` in `force.ts`: one legal force of any size, single-species or mixed, for the AI's side |
| **4b** (landed) | **The builder screen.** Full and limited modes over one component, the three armies with a running total and the half-force line, the Home Terrain and Frontier proposal with their faces, the dragons; built forces kept per viewer |
| **4c** (landed) | **The start screen.** Your side from a preset or a built force; the AI's from a preset or a random force of the same or a chosen size; "unequal on purpose" said out loud; the exit criterion played in the browser |

**Decided before 4a:**
- **A problem list, not a first problem.** `builtForceProblem` returns the first thing wrong,
  which is right for setup (it throws) and wrong for a builder, where the draft is incomplete for
  most of its life. `forceProblems` returns every one, each tagged with where it belongs (the
  force, an army, the terrains, the dragons), so the screen can put each beside its own section.
  A test holds the two to one statement of p. 8: over the full collection with no cap, a force
  has no problems exactly when `builtForceProblem` finds none.
- **Absent is legal only where a draw cannot leave the collection.** Setup draws an unpinned
  terrain or dragon from the whole data, so a force may leave one unpinned only when the
  collection owns every die of that kind without limit -- which is the full collection, and no
  limited one. Stated as that, not as "limited mode", so v3's collections need no mode flag.
- **The full collection counts `Infinity`.** One type, one `owned(...)`, and arithmetic that
  needs no case for it. It is built in code, never read from JSON, which cannot hold it.
- **The AI's force is rolled by the engine's own generator**, which is why `rollForce` sits in
  `force.ts` beside `drawForce` and `splitForce` rather than in the builder. Whether it is rolled
  inside `setupGame` (a new `ForceSpec`) or before it (a `BuiltForce` in the record) is 4c's
  question; either way the draw is the one function.

### What 4a found

No screen, and the engine gained one pure function that setup does not call, so both golden corpora
replay byte-identical and unregenerated and `SAVE_VERSION` has nothing to be about.

**1. `generateForces`' split is proven only at 24 and 36, and the AI's side can be any size.**
`repairSplit`'s comment proves the heaviest army lands inside the cap "with a force of at least 24";
at 13 health the cap is 6 and that proof says nothing, and at 3 or 4 health a draw can come up with
too few dice to fill three armies. Reusing `generateForces` for the AI's side would have worked at
every size anybody tried first (12, 24, 36) and thrown out of `setupGame` at the first odd one. So
`rollForce` checks its own draw with `builtForceProblem` and redraws, bounded, and a test rolls
every size from 3 to 40 at forty seeds from both pools.

**2. The Home Terrain and the Frontier proposal are two dice, even when they are the same die.**
The plan's "more copies than owned" was written about units. A force that proposes its own Home
die as the Frontier needs two copies of it, which a collection of one each refuses and the full
collection allows.

**3. The plan's `forceProblem` became `forceProblems`, a list with a place per problem**, as
decided above. It restates p. 8 rather than wrapping `builtForceProblem`, and 2000 random drafts
(about half of them legal, the rest wrong in every way the generator can manage) hold the two to
the same answer.

**4. A collection has an `id` and a `name`** beyond the plan's three maps: the builder offers
more than one, and a registry needs a key.

**Deliberately not done.**
- **`npm run data` does not check `data/collections/`.** A collection is hand-authored content, like
  `presets.json`, and is checked at load by `readCollection`, which throws on a die the data does
  not have. The Python validator knows nothing of presets either.
- **Nothing reads `forceProblems` or `rollForce` yet.** 4b and 4c are their callers.

### What 4b found

UI only, plus one shape reader split in two in `force.ts`. Both golden corpora replay
byte-identical and unregenerated. The builder is `ArmyBuilder.tsx`, reached from the start screen's
"Army builder" button; its rules are the draft edits and palettes added to `builder.ts`, and kept
forces are `forceStore.ts`.

**1. Every component that draws a die wanted it in play.** `TerrainDetail` took a `TerrainInPlay`,
`DragonDetail` a `DragonInPlay` and its owner, `Inspector` a whole `GameState`, and the unit tile
lived inside `DiceGrid`'s loop over `UnitInstance`s. A builder has dice on no board, so each gave up
one seam: `UnitTileBody` and `DragonTileBody` are the inside of a tile with the button left to the
caller, `InspectorPanel` is the floating shell with no opinion about what is in it, and the two
details take a die id. The builder draws with the board's own components, so the two cannot draw
one die two ways. Checked in the game afterwards: the terrain inspector still marks its current
face.

**2. The first draft sorted terrain problems by matching words in their text.** "Home Terrain" in
the sentence meant the Home field. `ProblemPlace` gained `homeTerrain` and `frontierProposal`, and
`'terrains'` is left for the one problem that is about both: a die used twice.

**3. A field's own die counts as free for that field** (`terrainChoices`). Otherwise the Home
select would call its current die "0 left" and refuse to let you pick it again, because it is in
use by the Home field itself.

**4. The cap follows the collection.** Switching to sorry-12 drops the cap to 12, the largest it
can fill (it holds 14); the full collection opens on 24. Picked from 12, 24 and 36, v3's steps.

**5. `readBuiltForce` split out of `readBuiltForces`.** `localStorage` is as untrusted as a file,
so a kept force is shape-checked with the reader the terminal's `built:<file>` uses. An entry that
is not a force is dropped alone; one naming a die the data lost is kept, and shows its problems.

**6. Checked in the browser**: the mixed 12 from 4a's test built tap by tap from sorry-12 reads
"12 / 12 health · 10 dice · ready to play", survives a reload as a kept force, loads back for
editing, fits 375px with no sideways scroll, and "Look at dice" opens the inspector as a bottom sheet.

**Deliberately not done.**
- **No route from a kept force into a game.** That is 4c, with the AI's side.
- **Keeping an unfinished force is allowed.** A draft is kept with its problems, and the list says
  "ready" or "N to fix", asked fresh each time. Refusing would lose half-built work.
- **On a phone the collection is below all three armies**, so filling the Horde means scrolling
  between the two. Left as is until someone builds a 36 on a phone and minds.
- **No warning about unsaved changes** on Back, and no DOM test, by the project's rule; the logic
  is in `builder.ts` and `forceStore.ts`, tested in node.

### What 4c found

UI only: `newGame.ts`, the start screen, and one button in the builder. Both golden corpora replay
byte-identical and unregenerated, and `SAVE_VERSION` does not move -- saving is off, and a record of
a game against a random force is an ordinary built-force record.

**1. The question 4a left open: the random opponent is rolled before setup, not inside it.** Inside
would have meant a `ForceSpec` kind for "one side built, one side rolled", a log entry for it (the
`forces_drawn` entry has one health for both sides), and a fuzz counter and a log line for that
entry -- engine surface for a playtest convenience. Before setup, it is `rollForce` in `newGame.ts`
and a built force in the record, which replays without it.
- **It draws from the game's seed XOR a salt**, not the seed itself. "The same seed and the same
  forces replay the same game" stays true, a random opponent included, and setup's roll-off does not
  read the very numbers the force was drawn from. A test checks both: same seed, same force; and not
  the force the unsalted stream gives.

**2. Two presets stay a `named` spec.** Converting every side to a built force would have been one
path, and would have changed every preset game's record to spell its armies out. A preset beside a
kept or rolled force goes in as its armies; two presets are named, as before.

**3. "On purpose" is a checkbox that appears only while the sizes differ.** A problem carries both
healths (`SetupChoice.health`), which is how the screen knows to ask. Ticking it is remembered while
the player changes sides, so it does not vanish from under the pointer when the sizes happen to
match for a moment.

**4. The builder hands its force over: "Keep and play it".** Not in the plan, but without it a
build ended at Back, then finding the force again in a list of names on the start screen. It keeps
the force and returns with it picked as your side. Only a ready force, since Start would refuse it.

**5. The exit criterion, checked two ways.** Headless in `newGame.test.ts`: the mixed 12 kept from
sorry-12 and a 36 from the full collection, set up exactly as the screen sets them up against a
random force of their size, both played to a win by greedy on both seats (about 125-150 decisions
and 17-29 combats each). In the browser: the mixed 12 against a rolled mixed 12 opened on its pinned
Swampland · City with its Feyland · Temple offered at the roll-off, and a 36 built tap by tap in the
full collection, taken to the start screen by "Keep and play it", opened against a rolled 36 with two
dragons a side drawn. The start screen fits 375px and scrolls.

**Deliberately not done.**
- **No human-played game to the end in the browser.** The browser runs were played a few decisions
  in; playing either to the end is the live playtest this phase exists to make possible. The
  headless run is what says they end.
- **A random opponent cannot be seen before Start.** It is drawn from the seed Start rolls, so a
  preview would be a different force whenever the box is empty. Type a seed to repeat one.
- **The terminal has no random-opponent option.** `--forces built:<file>` plays any pair a file
  names, and the terminal is the fuzz's and the watcher's client, not a playtester's.
- **`?forces=` names no kept force.** A kept force lives in one browser; a link that names one is a
  link that works nowhere else.

---

## Phases 5-8 — The four species

**Each species is one phase with the same shape**, and the first one (Coral Elves) is where the
shape gets worked out. The order is the release order, adjusted so that **the first run of the
species pipeline is not also the first run of a new element**: Coral Elves (Air & Water) and
Dwarves (Fire & Earth) use only the four elements v1 already plays; Goblins (Death & Earth) and
Lava Elves (Death & Fire) bring Death.

### The shape of a species phase

| Slice | Scope |
|---|---|
| **a** | Data: 20 dice (15 across the five class lines plus 5 monsters), about 140 faces, from Dice Commander; species entry; `npm run data` green |
| **b** | Seams: any new mechanism the SAIs below need, landed alone first (the Phase 4a lesson) |
| **c** | SAIs |
| **d** | Species abilities |
| **e** | Species spells in `data/spells.json`, each an `effect` block or a handler |
| **f** | Fixtures, AI, fuzz: monster mirrors, a starter and a bestiary preset, greedy scoring, trigger counters |
| **g** | Art: `npm run art` for the new species; any `FACE_ART_VARIANTS` pins it reports |

**The data is the long pole again, four times.** v1's *Risks* said it about terrains, dragons and
spells, and it holds here: roughly 560 faces for the four species. The source is the same as
`data/raw/treefolk.faces.txt`'s (Dice Commander's face-art paths and die info), and **the same rule
applies: do not invent a face.** The rulebook's species pages list the roster and the SAI *texts*;
the faces come from the dice.

**The SAI lists below come from the rulebook's species pages**, extracted mechanically from two-column
text, the layout that paired spell names with the wrong effects in Phase 7. Treat them as a
checklist to confirm against the face data, not as the authority. **The faces decide which SAIs a
species actually has.**

### Twenty new SAIs, by the seam they need

The existing 25 are listed in `sai.ts`. These twenty are new (Rend, Fly, Trample, Bullseye, Smite,
Counter, Cantrip, Confuse, Seize, Sleep, Smother, Surprise, Flame and Dispel Magic are reused
across the four species). Grouped by the v1 seam each one resembles:

| Seam (v1 phase that built it) | New SAIs | What is new |
|---|---|---|
| Results only (1) | **Tail** (2 melee + reroll), **Stone** (unsavable damage, Smite's shape), **Screech** (defender subtracts X saves), **Wave** (Screech, plus −X on every counter-maneuver against a marching maneuver) | Screech and Wave modify the *other* army's roll in the same exchange, like Galeforce but with no duration; Wave's second half reaches into the contested maneuver |
| Targeting before saves (4b) | **Entangle** (kill, Flame without the burial), **Roar** (to Reserves before saves) | Nothing: both are existing shapes |
| Sub-roll (4d) | **Swallow** (look for ID, Seize's shape, then bury), **Poison** (save, then save again or be buried), **Stomp** (maneuver, then save or be buried) | Poison and Stomp roll the same die twice, and the second roll decides burial |
| Sub-roll plus a new status | **Net** (maneuver or be held), **Web** (melee or be held), **Stun** (maneuver or be stunned; ends if the unit leaves the terrain) | A status that stops a die rolling **and** leaving its terrain, plus an end condition that is not "the caster's next turn" |
| Delayed (4e) | **Hypnotic Glare** (units that rolled an ID cannot roll) | An effect that ends when *its source* leaves the terrain, dies or rolls. A new kind of duration |
| Friendly and free (4e) | **Ferry** (free move, 4 health-worth), **Regenerate** (X saves *or* X health back from the DUA) | Regenerate is a choice between two unlike things: a new `Pending`, Wild Growth's shape |
| Effect with a duration (4c) | **Cloak** (X saves until your next turn, also magic), **Illusion** (army cannot be targeted by missiles or opposing spells) | Illusion restricts **targeting**, which no effect does yet |
| Reshapes the exchange | **Charge** (attacker counts maneuver as melee; the defender makes a combined save-and-melee roll instead of saves or a counter, and the attacker takes those melee as damage) | A third shape of exchange beside attack/save and counter-attack |
| Reshapes the exchange | **Bash** (in a save roll against melee, target one attacking unit, which takes damage equal to *its own* melee results and saves against it) | The defender aims at a die in the attacker's roll, by that die's own results |
| Reshapes the exchange | **Charm** (targets do not save; their owner rolls them, and the results join the *attacker's* total) | A die of one player's rolling for the other's total |

**Put the hard seams where they are first needed**, not in one "SAIs" phase:
- Coral Elves: Hypnotic Glare's new duration, and Defensive Volley (below).
- Dwarves: Charge and Bash.
- Goblins: Net, Stun and Regenerate.
- Lava Elves: Web, Charm and Illusion.

This spreads the unknowns out, and each species phase has exactly one or two real problems.

**Damage that only spell saves reduce (Dwarves' seam slice).** Charge's damage back at the
attacker, and later Cursed Bullets, "may only be reduced by save results generated by spells". The
engine cannot express that yet. `RULES-V0.md` §8 records that **Counter's riposte, which the
rulebook words the same way, is applied as wholly unsavable damage**, a house rule kept because
telling a spell's save bonus from an SAI's needs a `fromSpell` mark on the modifier plus a gather of
the attacker's spell saves at `finishExchange`. Build that once, for Charge, and **retire the
riposte house rule in the same slice**, since three rules then share one mechanism. The riposte
change moves no V0 golden (no spells there), but it may move V1 goldens that have a Counter
against a Stone Skin. That is a real rule change, so it is a reason to regenerate, written in the
commit message.

**Effects gain end conditions (Coral Elves' seam slice).** Today an effect ends at the start of its
caster's next turn. The new ones end when *the affected unit leaves its terrain* (Stun, Net, Web)
or when *a source unit leaves, dies or rolls* (Hypnotic Glare). Stun ends "at the beginning of
*your* turn", not your next turn. `pruneEffects` already runs after every action; it gains these
checks. **Every end condition needs a test in which it fires**, because an effect that never ends
still validates.

### Eight species abilities

| Species | Ability | Seam |
|---|---|---|
| Coral Elves | **Coastal Dodge**: at water, maneuver counts as save | A step-10 "counts as", Flaming Shields' shape |
| Coral Elves | **Defensive Volley**: at air, may counter-attack a *missile* action using missile results | A counter-attack after a missile attack. `COMBAT_SEQUENCE` has no such branch, since missile never allowed one |
| Dwarves | **Mountain Mastery**: at earth, melee counts as maneuver | "Counts as" on a maneuver roll |
| Dwarves | **Dwarven Might**: at fire, save counts as melee on a counter-attack | "Counts as"; note Flaming Shields is the exact opposite (never on a counter) |
| Goblins | **Swamp Mastery**: at earth, melee counts as maneuver | Mountain Mastery again |
| Goblins | **Foul Stench**: on a Goblin melee action, the defender picks N units that may not counter-attack; N = Goblins in the Goblin player's DUA, capped at 3 per 24 health | A new `Pending` addressed to the defender, after saves and before the counter |
| Lava Elves | **Volcanic Adaptation**: at fire, maneuver counts as save | Coastal Dodge again |
| Lava Elves | **Cursed Bullets**: at the same terrain, up to N missile results can be reduced only by spell saves; N = Lava Elves in the DUA, capped at 3 per 24 health | Damage in two pools, the second reduced only by spell saves. Uses the seam Charge builds in Dwarves (below) |

All eight are **per unit**, which is exactly what Phase 1 made possible: a Coral Elf in a mixed
army dodges, and a Treefolk beside it does not.

**The DUA-count abilities read the force size**, per player (Phase 2). At 12 health that is the
same cap as 24, so it only starts to scale at 25.

### Eleven new spells

| Element | Spell | Species | Shape |
|---|---|---|---|
| Death | **Palsy** (−1 non-maneuver, cumulative) | Any | `effect` block |
| Death | **Finger of Death** (1 damage to a unit, no save) | Any | Handler (Lightning Strike's shape, without the save) |
| Death | **Soiled Ground** (at a terrain, a unit killed into the DUA saves or is buried) | Any | Handler plus a hook in `killUnits`, which is the one door into the DUA |
| Death | **Decay** (−2 melee) | Goblins | `effect` block |
| Death | **Necromantic Wave** (magic counts as melee or missile) | Lava Elves | `effect` with a "counts as" |
| Air | **Blizzard** (−3 melee at a terrain) | Coral Elves | `effect` block |
| Water | **Deluge** (−3 maneuver and missile at a terrain) | Coral Elves | `effect` block |
| Fire | **Firebolt** (1 damage to a unit, with a save) | Dwarves | Handler, via `spellSaveRoll` |
| Earth | **Higher Ground** (−5 melee) | Dwarves | `effect` block |
| Earth | **Scent of Fear** (3 health-worth of units to Reserves) | Goblins | Handler |
| Fire | **Fearful Flames** (1 damage; a unit that saves saves again or flees to Reserves) | Lava Elves | Handler, two save rolls |

The basic spells of the four existing elements are all already in `data/spells.json`, so nothing
else is needed. Summon Dragonkin and Summon White Dragon stay out with Dragonkin and White dragons.

### Death magic (the first slice of Goblins)

- **The fifth element is already in the vocabulary**: `Element` includes `'death'`, and the Death
  Drake and Wyrm are in `data/`. What is new is Death *magic*: the three basic Death spells above,
  Summon Dragon with Death magic, and Resurrect Dead for Death-species units.
- **No terrain carries Death.** So Standing Stones never converts to it, a Death species has no
  "own" terrain type, and the random-home rule from Phase 2 has to have a Death case.
  Phase 2 settles the rule; this slice is where a test proves it.
- **Death gets an element colour** in the Phase 3 tokens. If Phase 3 lands first, give it one
  there; if a Death species lands first, add it with the species.

### Exit criterion, per species

The species' monster mirrors all fuzz with `stuck === 0` and every one of its SAIs, abilities and
spells fired at least once. A starter preset of the species plays a full game against greedy in
the browser. A mixed force containing it plays a full game. The V0 goldens are untouched, and the
V1 goldens move only with a written reason (the riposte slice in Dwarves is the one expected).

## Phase 5 — Coral Elves — **landed**

All seven slices have landed. The art resolver knows the Coral Elves; running `npm run art` to
mirror their images is the owner's step. 5a has landed: the data. 5b has landed: Hypnotic Glare's duration. 5c has landed: all six SAIs. 5d has
landed: the race draw, Coastal Dodge (which made the Coral Elves playable), and Defensive Volley.
5e has landed: Blizzard and Deluge. 5f has landed: a starter and a bestiary preset, and the
greedy checks. 5g has landed: the art resolver.

### What 5a found

Both golden corpora replay byte-identical and unregenerated; nothing a recorded game can reach
moved, and saving is off, so `SAVE_VERSION` has nothing to be about.

**1. "Species entry; `npm run data` green" was not a slice on its own: it made the species
playable everywhere at once.** The moment twenty Coral Elves dice are in `units.json`, every place
that hands dice out reaches them: the mixed pool of `rollForce` and `generateForces`, the species
race draw (whose `SPECIES.length !== 2` guard would have thrown on every rolled game), the army
builder's palette, the random opponent's pools, the live fuzz's list of SAIs it must roll, and the
monster-fixture test. Each of them rolls a Tail sooner or later, and `sai: 'full'` throws on it. So
**`src/engine/playable.ts` decides which species the engine hands out**: a species is playable when
every SAI on its dice has a handler and `SPECIES_ABILITIES` names it. It is derived, not flagged,
the way `resolvesSpell` is: no switch to forget, and the slice that builds the last missing piece
flips the species in the same edit. `builtForceProblem` refuses an unplayable die, and every force
goes through it, so a `built:` file or a collection naming one gets a sentence, not a throw.

**2. That flip has a cost, and the slice that pays it is whichever completes the set** -- by the
table above, 5d (abilities come after the SAIs). The same edit must: widen the race draw in
`generateForces` past two species (it throws on a third playable one, deliberately); add the five
monster fixtures (`setup.test.ts` requires one per playable monster); and reach all six new SAIs in
the live fuzz. So 5f's fixtures and fuzz counters move forward into 5d, or 5d is sliced so the
ability table entry lands last with them.

**3. The data had two slips, both caught before import.** Sharpshooter was listed with six faces;
the owner of the dice corrected it (3 Maneuver, 4 Missile, 3 Missile, 2 Melee, 4 Bullseye). The
list said "Griffon"; the art path and the v4.01 roster say Gryphon.

**4. Of the six new SAIs, only Entangle and Wave read X.** Tail's two melee, Swallow's one unit,
Ferry's four health-worth and Hypnotic Glare are fixed by their text. Monster faces carry no count
in the art paths (`<icon>-m.svg`), so every one is written 4, and on those four SAIs it is never
read. The raw file said "the count is X" for all six until the rule text was checked.

**5. `KNOWN_SAIS` was the starter rulebook's 25 and nothing else**, so the validator would have
called Tail a typo. It is the starter list plus a per-species list (`SPECIES_SAIS`), which only an
imported species needs. And the `'full'` refusal said "targeting SAIs are not implemented", true of
every name it could meet in v1 and not of Tail; it names the SAI now.

**Deliberately not done.**
- **No preset, fixture or art.** A fixture for an unplayable species could only throw; 5f and 5g.
- **`validate_data.py` still holds spells to two species.** Blizzard and Deluge are 5e.
- **The eight raw files for later species stay unimported**: no entry in `tools/species.py`.

### What 5b found

One seam, landed alone the way 4a was: `Effect` gained `hypnotized`, `glaring` and an `anchor`,
with no caller until 5c. `stepGame` already prunes after every action, so "ends if the glaring unit
leaves the terrain or is killed" is one more check in `pruneEffects`, and the golden digests do not
move because every new field is optional and omitted.

**1. "Effects gain end conditions" was the smaller half; "may be excluded from any roll" is the
larger.** The plan read Hypnotic Glare as a new *duration*. Its last sentence is a new *choice* --
before every roll the glaring unit's army makes, keep the glare or roll the die -- and a choice is a
pause (invariant 3) at every site that throws an army's dice: attack, save, counter-maneuver,
dragon attack, a spell's save roll. None of those has a pause before its roll. So it is a house rule
(`RULES-V0.md` section 17): the glaring die sits out every army roll, and rolls only when made to
roll for its own life, which ends the glare.

**2. So "is rolled" has exactly one door: the sub-roll.** `endGlaresOf` is called from `subRoll` and
nowhere else, and a test drives it through a real Bullseye: the glaring die rolls its save and both
the glare and its victim's hypnosis end.

**3. Hypnotized is half of Sleep, not Sleep.** "May not be rolled" says nothing about leaving, so a
hypnotized die may retreat. `cannotRoll` is the question every roll asks; `isAsleep` stays the one
the retreat and free-move checks ask, and `sitsOutArmyRoll` adds the glaring die for army rolls.

**4. The anchor is a terrain, not a location.** Glare is a melee SAI and melee happens at a terrain,
so the glaring unit always stands on one. The later end conditions (Stun, Net, Web: "leaves its
terrain") are the same shape with the affected unit as its own anchor.

### What 5c found (Tail, Entangle, Swallow, Ferry)

Four SAIs, each an existing shape, and the table above was right about all four. What it did not
say:

**1. Tail's "two" is a constant.** The face prints 4 because it is a monster face; the reference says
"two melee results", flatly, which is Galeforce's case. A results-rung SAI, so it joins `HANDLERS`
and `sai: 'results'` resolves it too.

**2. Swallow is Seize's test on Sleep's count, and the count needed a flag.** `target_enemy` gained
`one`: one die whatever its health, never combined. `Pending.sai_target` already had
`limit: { kind: 'one' }` from Sleep, so neither board changed -- but the terminal said "put one die
to sleep" for any one-unit pending, and greedy preferred a die that can still roll, which is right
for Sleep and backwards for Swallow: a die that cannot roll cannot roll its ID.

**3. Ferry has no maneuver half.** Firewalking and Teleport generate X maneuver results on a maneuver
roll; Ferry's reference names no such sentence, so it does nothing there. Its four health-worth is a
constant, and the free-move machinery already read the limit off the task.

Both golden corpora byte-identical and unregenerated: no Coral Elf can reach a recorded game.

### What 5c found (Wave)

**1. Wave has no duration, so it cannot ride `state.effects`, and it has two targets in two places.**
In an exchange it is the attack's and bites the save roll; in a contest it is the marcher's and bites
the other roll. The save half is `PendingSaves.wave`, written when the save dice land and read by all
three readers of a save roll (the pause, the display, the count), so none can disagree. The contest
half is read straight off the marcher's resolved faces in `contestTotals`, which Rapid Growth's pause
and the decision after it already share.

**2. "While marching" was a question no roll could answer.** Every maneuver roll had one context,
shared by the marcher, the counter-maneuver and the roll-off. `RollPurpose`'s maneuver member gained
`marching`, set on the marcher's roll only.

**3. The estimator would have scored a Swallow at nothing** (its `health` is unread) **and a Wave at
nothing.** A Swallow is now a likely kill of a middling die, and a Wave comes off the expected saves.
The browser's roll strip described every ID-escape as "seized -- an ID goes to reserves", which
Swallow is not.

### What 5c found (Hypnotic Glare)

**1. The first delayed task that owes no decision.** Choke and Confuse ask "which", and every task
before this one either raised a pending or was dropped for having nothing to land on. Glare takes
"all units that roll an ID icon", so `stepTasks` applies it on its own, ahead of `taskHasWork`, and
`taskPending` refuses it outright. It reuses `sai_resolved` for its log line and Choke's eligibility
for its victims.

**2. Two glaring dice make one task with two sources**, combined by name as a union. Each victim then
carries one effect per source, so it stays hypnotized while any of them still glares, and each ends
on its own anchor.

**3. A hypnotized die could not join the board's `asleep` set**, which is also the set of dice that
may not be *picked* -- and a hypnotized die may still retreat. So the boards gained a separate glare
status: a label and a look (dotted and dimmed; the glaring die gets an accent edge), never a lock.

**4. Glare needs a save roll to look at**, like Choke: an attack that rolls no results earns no save
roll, and the Glare on it does nothing. A Leviathan alone that rolls Glare glares at nobody.

### What 5d found (the race draw, Coastal Dodge, the flip)

**1. The race draw widened without reseating anything.** One draw over the `n(n - 1)` ordered pairs
of different species is, at two species, v1's `nextInt(2)` with the same mapping -- so it landed
first, alone, with a test holding the two draws equal, and the flip then only widened it.

**2. The flip came with the ability table's entry, as 5a predicted, and cost what 5a said it
would.** Five monster fixtures (six of one monster, 3/2/1); tests that counted two species (the
race draw, the mixed pool, the builder palette, the opponent's pools, the preset list); fuzz
counters for every new SAI and ability. The playable tests lost their subject -- every species in
the data is playable again -- so the rule moved into a pure `problemFor` and is tested on made-up
species, which is the only way to test it between species phases.

**3. Hypnotic Glare fires too rarely for 200 random games** -- a Leviathan face in ten, in a melee
attack that earns a save roll, and a defender's ID -- so its counter is `'full'`, and the 1000-game
run reaches it. Every other new rule fires in 200.

**4. "Counts as" had one direction, and Coastal Dodge is the other.** `counts_as` was save to melee
and nothing else; it gained maneuver to save, with its own rule for when it applies (a roll that
counts saves and not maneuver) beside Flaming Shields' (a melee roll, not a counter). The dragon
combination roll gathers its modifiers as a *melee* roll, so Coastal Dodge is gathered at every
water terrain and applied only by a roll that counts saves -- keying it on "a save roll" in
`armyRoll` would have missed the dragon roll silently. `countedAs` and the log's `flamingShields`
stay Flaming Shields' alone, since the golden digest records them; Coastal Dodge is a note on the
roll's arithmetic line.

**5. A dev server can serve half an edit.** In the browser pass greedy threw `cannotRoll is not
defined`: Vite had picked up the body of an edit to `greedy.ts` and missed its import line two
seconds later. The file on disk was right and every test passed. Touch the file before believing a
`ReferenceError` from a module that typechecks.

### What 5d found (Defensive Volley)

**1. The counter-attack half of an exchange needed no change at all.** It had always read its action
off `CombatState` and swapped both ends in `exchangeSpec`, so a missile counter is the melee
counter's eleven steps with a different word in them. What changed is the gate: `offer_counter` has
work after a missile too, when `volleyers` finds a Coral Elf that can roll at an air terrain.

**2. "Coral Elves units may counter-attack" names units, so the roll is filtered, not the offer.**
In a mixed army only the Coral Elves throw the volley. The filter is in `attackerRoll`, the one door
every half of an exchange reads, so the roll and each recompute of it agree on who rolled.

**3. The counter lands on the army that shot, wherever it is**, which a melee counter never had to
say: the prompt's forecast read "melee at the army in front of you". `Pending.choose_counter_attack`
gained `volley: { target }`, omitted for a melee counter, so the four golden games that end on that
pending did not move; the board, the terminal and the log each name the volley.

**4. It fires within 200 random games** (Coral Elves at their own Coastland homes, which carry air),
so its counter is `'every'`.

**5. The 1000-game fuzz found a free-move bug a phase older than the Coral Elves.** A Ferry carried a
Unicorn that had rolled Teleport in the same roll, and the Unicorn's own move was then offered
every terrain but the one its *army* rolled at -- including the one the Ferry had just put it on --
and drew its passengers from an army it had left. A free move now starts from where its die stands
and carries from the army it stands in. Reachable since mixed forces (Phase 2) could put two free
movers in one army; the 200-game run never drew it, and Ferry made it common enough to land.

### What 5e found

**1. Two `effect` blocks and no code**, as the table predicted: Ash Storm's shape with three and two
result types. `npm run data` reports no spell without code behind it.

**2. "Cumulative" was read off the page's colours, not its image.** The plan's warning stands --
text extraction drops the red -- but PyMuPDF reports each span's colour, and the page's own
known-cumulative spells (Wind Walk, Watery Double, Wall of Fog) are the check that the red is the
marker. Both Coral spells are cumulative. Worth reusing for every later species' spells.

**3. Two checks were about "the two species", not about spells.** The validator refused a spell of
any third species outright, and the spell fuzz required every resolvable spell to be cast by a fuzz
that only ever fields Treefolk and Firewalkers. The first now checks against the imported species;
the second is scoped to the species it plays, and the live fuzz, which draws Coral Elves, casts both.

### What 5f found

**1. Most of 5f had already happened.** The fixtures, the fuzz counters and greedy's one-unit
preference landed with the flip (5d), as 5a predicted they would have to. What was left is the two
presets and the exit checks.

**2. The presets follow the starter pattern die for die.** `coral_elves_starter` is the Treefolk and
Firewalkers starters' class-and-size layout in Coral Elves dice (30 health: 10 / 11 / 9), and
`coral_elves_bestiary` holds every monster and every large die (35: 14 / 14 / 7). Neither is a
mirror, by `FORCE_SETS`' naming rule, so each appears on the start screen and pairs by health.

**3. The exit criterion, checked.** Every Coral Elves mirror, and the starter and bestiary against
each other species both ways, finish with greedy against passive and against itself. In the browser
a Coral Elves starter force played a full game against a greedy Treefolk starter, twelve turns to a
finish, with no error. A mixed force containing Coral Elves plays in one live-fuzz game in five.

**4. Greedy needed no new scorer.** Every new SAI reaches it through `estimate.ts` (Wave, Swallow,
Coastal Dodge were taught there in 5c and 5d), the free move and the one-unit target were already
decisions it answered, and it counter-attacks whenever offered, a volley included. Whether it plays
the Coral Elves *well* is a v3 question.

### What 5g found

**1. The species id and the remote's folder differ for the first time.** `coral_elves` is
`coral-elves/` on Dice Commander; Treefolk and Firewalkers have no separator, so the resolver had
never had to say which name it meant. `remote_species` says it, and a later species with a
two-word name inherits the rule.

**2. The owner's notes are the pins.** Coral Elves print maneuver and fly in two images each, split
by what the creature is (the notes beside the transcription): maneuver 1 for the melee and missile
lines, the Evoker and the monsters, 2 for the cavalry and the Conjurer; fly 1 for the Eagle Knight,
Gryphon and Sprite Swarm, 2 for the Leviathan. Pinned in `FACE_ART_VARIANTS` before the first run,
rather than waiting for the resolver to report them as ambiguous.

**Deliberately not done: the download.** `npm run art` fetches SFR's images into gitignored
folders, which is the owner's call to make; the candidates were checked offline against the paths in
the notes. The app draws the class shapes until then (invariant 8).

## Phase 6 — Dwarves — **landed**

6a has landed: the data. 6b has landed: the seams. 6c has landed: three old rules corrected, in
three commits. 6d has landed: Roar, Stomp and Bash. 6e has landed: Charge. 6f has landed: the two
abilities, and the Dwarves are playable. 6g has landed: Firebolt and Higher Ground. 6h has
landed: the presets, the exit checks and the art manifest. **All of Phase 6 has landed.**

Fire & Earth, so **Highland is their own terrain type** (`homeTerrainType` derives it; nothing is
tabled) and both species abilities are live at home. The faces are in `data/raw/dwarves.faces.txt`
(20 dice, 140 faces), unimported, and the art resolver already has their pins (commit a1adb4b: all
140 faces resolve to one image each).

**What the faces actually carry.** The rulebook-derived tables above were a checklist; this is the
check. Fourteen SAI names appear on Dwarves dice, and **only four are new**:

| SAI | Dice | Applies | Seam |
|---|---|---|---|
| **Roar** | Androsphinx ×2, Behemoth | Melee | Targeting before saves (4b). Up to X health-worth of defenders go to their Reserve Area, no roll. Seize's destination without Seize's roll |
| **Stomp** | Behemoth | Melee, dragon attack | Sub-roll (4d), twice. Maneuver roll or be killed (Smother), then the dead roll saves or are buried (Fire breath's check). Dragon attack: X melee |
| **Bash** | Behemoth | Save\*, dragon attack | **New.** The defender aims at one die in the *attacker's* roll, which takes damage equal to its own melee results and saves against it; Bash gives the defender that many saves. Any other save roll: X saves. Dragon attack: a dragon takes its own damage back |
| **Charge** | Behemoth | Melee\* | **New.** The attacker counts maneuver as melee; the defender makes one combination save-and-melee roll *instead of* a save roll or a counter-attack; its melee hits the attacker, reducible only by spell saves |

Reused: Smite, Counter, Bullseye, Trample, Cantrip, Rend, Fly, Dispel Magic, Seize, Confuse.
**Four of the five new SAIs sit on one die**, the Behemoth, so its mirror fixture is the whole
laboratory for the hard half of this phase, and Charge and Bash meet each other there: a Behemoth
that Charges into a Behemoth that Bashes.

**Abilities**: Mountain Mastery (at earth, melee counts as maneuver) and Dwarven Might (at fire, save
counts as melee *on a counter-attack*). **Spells**: Firebolt (fire, 3) and Higher Ground (earth, 5),
both Dwarves-only, neither `R` nor `C`, **both cumulative** -- checked with the 5e method: PyMuPDF
reports Firebolt's "one" and Higher Ground's "five" in red (`0xd12229`), as Ash Storm's "one" and
Dancing Lights' "six".

### Where the draft tables above are wrong for Dwarves

- **Firebolt is not `spellSaveRoll`.** That is Hailstorm's *army* save roll. Firebolt aims at a
  unit, so its save is a unit roll, and since it is cumulative its castings add up to N damage on
  one die. That is a new sub-roll shape -- **take N damage, roll saves, die if what is left reaches
  your health** -- and Bash's target makes exactly the same roll. Build it once (6b), not twice.
- **"Mountain Mastery: counts as on a maneuver roll" undersells it.** "Species abilities are applied
  to both army rolls and when a unit is rolling individually" (p. 28), and `RULES-V0.md` §16 records
  that sentence as adding nothing *because no unit roll counted melee or was a counter-maneuver*.
  That stopped being true in 5d: a Coral Elf at water rolling for its life against a Bullseye or a
  Lightning Strike should dodge, and `unitRoll` gathers no species ability at all. Mountain Mastery
  makes the same gap bite again (a Dwarf at earth Smothered or Stomped). So **6c fixes Coastal
  Dodge's sub-roll gap first**, as its own rule fix with its own test, and Mountain Mastery then
  arrives in a door that already works.
- **A `fromSpell` mark on `Effect` would move the goldens for nothing.** `state.effects` is in the
  digest, so a new field on every spell effect rewrites every v1 game that had a Watery Double up
  (21 mentions in `v1-games.json`) whether or not a riposte ever met it. Stamp it on the gathered
  **`Modifier`** instead, derived from the effect's `source` being a spell's name: modifiers never
  reach `GameState`, the same reason `counts_as.species` moved no golden.
- **Bash cannot reuse `PendingSaves.bonus`.** That field is Wild Growth's save share, and the
  roll's arithmetic line names it as Wild Growth (`saiResultsSource`). Bash needs its own field, or
  the line reads "+4 Wild Growth" on a roll with no Wild Growth in it.

### 6a — Data — **landed**

- `tools/species.py` gains `dwarves` (roster p. 72: heavy Footman / Sergeant / Warlord /
  Androsphinx, light Sentry / Patroller / Skirmisher / Behemoth, cavalry Pony / Lizard / Mammoth
  Rider / Gargoyle, missile Crossbowman / Marksman / Crack-Shot / Roc, magic Theurgist /
  Thaumaturgist / Wizard / Umber Hulk). `SPECIES_SAIS` gains Roar, Stomp, Bash, Charge.
- **The Dwarves are unplayable after this slice**, by `playable.ts`'s rule, which is what 5a built
  it for. `sai.test.ts`'s four-way partition gains four unbuilt names.
- **The monster SAI counts are confirmed: all 4.** Every monster face in the raw file said 4 with
  no count in the source, and the Gorgon's `2 Flame` is the proof that a monster's X is not always
  its health. Nine of the SAIs here *read* X -- Roar and Stomp as health-worth, Smite, Rend, Seize,
  Fly, Confuse, Trample, and Bash's "other save rolls" -- so the owner checked them against the
  dice before import (2026-09-30): every one is 4. The raw file's header note that they are
  unconfirmed goes in this slice. Charge and Dispel Magic take no X, and Bash's main sentence takes
  the target's melee instead.

### What 6a found

Both golden corpora replay byte-identical and unregenerated. Saving is off, so `SAVE_VERSION` has
nothing to be about.

**1. What 5a built is what made this slice small.** In 5a, importing the data turned out to make
the species playable everywhere at once, and `playable.ts` was built to stop that. This time the
import touched only the species entry, `SPECIES_SAIS` and the raw file's header. `npm run data`
passes with 35/35 SAIs in the data, and exactly four tests moved, all of them counts of what is in
the data: the unit count, the SAI partition (four names now `deferred`), the playable species, and
one Dispel Magic test.

**2. The half-built gate can be seen again, so its tests came back.** Between species phases every
species is playable, and 5d had moved the rule's tests onto made-up species. Now `playable.test.ts`
checks the real refusal again, with the exact sentence ("the SAIs Bash, Charge, Roar, Stomp and its
species abilities"), a rolled Dwarves force that throws, and a built force with a Dwarf that gets
the sentence. Each of 6d and 6e shortens that sentence, and 6f turns the test back into "all
playable". The builder test that refuses an unplayable die has a subject again as well.

**3. The Gargoyle is the second Dispel Magic die.** A test in `magic.test.ts` said the Unicorn was
the only Dispel Magic die "in the box". That was true with two species, and after 5a it was true by
luck. It now names both dice. Firewalkers and Coral Elves still cannot dispel.

**4. The monster counts were confirmed before import**, so no face reached `units.json` on a guess.
The raw file's header says so, and it no longer says the counts are unconfirmed.

**Deliberately not done.** No fixture, preset or art manifest: a fixture for an unplayable species
could only throw (6f), and the art download is 6h and the owner's step.

### 6b — Seams, and no rule moves — **landed**

Four pieces of machinery, each with no new caller or with callers that give identical answers.
Both golden corpora byte-identical.

1. **`counts_as` becomes a table, not a union of two pairs.** Today it is Flaming Shields' save →
   melee and Coastal Dodge's maneuver → save, each with a hand-written "when" (`convertsSaves`,
   `dodgesManeuver`). This phase adds three: maneuver → melee (Charge, every die in the army),
   melee → maneuver (Mountain Mastery), and save → melee *only on* a counter-attack (Dwarven Might,
   the mirror image of Flaming Shields' "not on" one). A small `{ from, to, applies }` table
   with one resolver, landed with the two existing rows and nothing else.
2. **A damage sub-roll**: `damageSubRoll(state, unitId, damage)` -- `unitRoll`, a save roll, killed
   through `killUnits` when damage minus saves reaches the unit's health. Logged as a
   `sai_sub_roll` with the damage on it. No caller until 6d.
3. **Spell saves, gathered**: `spellSaves(state, player, ref)`, the sum of the positive save `add`s
   from spell effects on that army (Stone Skin, Watery Double), read off modifiers stamped at
   gather time (above). No caller until 6c.
4. **A combination allocation that is not the dragon's.** `dragon_allocate` is the only
   combination roll there is: `ids` and `flexible` spent over `DRAGON_ROLL_KINDS`, plus Flaming
   Shields' trade. Charge's roll is the same question over `[save, melee]`. Pull the allocation
   check and the spec builder (`dragonRollSpec`'s `alsoDoubled` included -- the eighth face doubles
   every counted type, which is the bug that shipped once) into one place parameterised by kinds.

### What 6b found

All four seams landed with no change to any rule. Both golden corpora replay byte-identical and
unregenerated, and 1122 tests pass. The seams' tests are in `dwarves.test.ts`, which the rest of
the phase will fill.

**1. The two existing conversions fit three fields and one exception.** `counts_as` is now
`{ from, resultType, counter: 'never' | 'only' | 'either', species }`, and `conversionsIn` in
`roll.ts` resolves all of them. It replaces `convertsSaves` and `dodgesManeuver`. The exception is
the trade. Only saves-as-melee is ever *asked* about (the dragon roll's Flaming Shields), and any
other pair in a roll that counts both its types is left off. That is Coastal Dodge's old "a roll that
counts saves and not maneuver", so every existing roll gives the same answer. A test adds Mountain
Mastery's and Dwarven Might's rows by hand, and each turns into results and a note with no code of its own.

**2. `countedAs` belongs to Flaming Shields, because the digest says so.** The log's
`flamingShields` field is read from it, and the golden digest records it. A table that summed every
save-to-melee conversion would have put Dwarven Might's counter-attack into it. It is now "saves as
melee, in a roll that is not a counter-attack", which only Flaming Shields makes. A test pins
Dwarven Might outside it. Every other conversion writes a note on the arithmetic line instead,
which Coastal Dodge alone did before.

**3. The estimator had its own copy of each ability's rule.** `expectedArmy` built a `shielded` set
and a `dodging` set by hand, the second door onto a roll that `estimate.ts` warns against. It now
calls `conversionsIn`. `ExpectedDie` carries a `rolled` record per convertible type, where it had a
field per ability, so Mountain Mastery's melee is already there.

**4. The damage sub-roll found a Phase 5 gap.** A die that makes a unit roll should end its
Hypnotic Glare. 5b said "is rolled" has exactly one door, the sub-roll, but that was only true of
the *SAI* sub-roll. Lightning Strike and Mirage roll their targets through `spells.ts`'s own
`saveSubRoll`, which never calls `endGlaresOf`. So a Leviathan struck by lightning keeps glaring.
`damageSubRoll` ends glares, with a test, and the spell rolls join 6c's list.

**5. The spell mark moved three tests and no golden.** `fromSpell` is stamped in `sourced`, where
`armyRoll` gathers an effect, and it is read off the name (`SPELL_NAMES`). Three `magic.test.ts`
tests compare gathered modifiers exactly, and now carry it. A test holds that no SAI on any die
shares a name with a spell, since that is what the name-reading depends on.

**6. The dragon roll moved into `combination.ts` unchanged.** `combinationSpec` builds the same spec
the dragon roll always used: same modifier order, and the eighth face's doubling over the other kinds.
`combinationAnswerProblem` is the check `applyDragonAllocate` used to make inline.

### 6c — Old rules corrected — **landed**

Rule fixes to species that already play, three now, each its own commit, since each may move a
golden and must say why.

- **The riposte stops being wholly unsavable.** Counter and Volley both say "only save results
  generated by spells that would add to a save roll may reduce this damage", and `RULES-V0.md` §8
  applies it flat. `finishSaves` subtracts `spellSaves` of the army the riposte lands on. The v1
  corpus has **four ripostes**; replay says whether any landed on a Watery Double or a Stone Skin.
  If one did, regenerate `v1` with that as the written reason; if none did, say that instead. V0
  cannot move (no spells).
- **A spell's unit roll ends a glare** (found in 6b). Lightning Strike and Mirage's `saveSubRoll`
  never calls `endGlaresOf`. Nothing in the v1 corpus has a Leviathan, so nothing moves.
- **Species abilities reach unit rolls.** `unitRoll` gathers the counts-as rows for the unit's own
  species at the terrain *it* stands on -- none in Reserves or the DUA, so a Stomped die's burial
  roll gets nothing. Coastal Dodge then applies to every save sub-roll at water: Bullseye, Double
  Strike, Lightning Strike, and next Bash and Firebolt. No v1 golden has a Coral Elf, so nothing
  moves; a test drives a Bullseye into a Coral Elf at water.

### What 6c found

**1. The riposte fix moved exactly the one golden game replay said it would.** Of the four ripostes
in the v1 corpus, one landed on a Watery Double: seed 2, action 73. A Counter sends 4 back at p1's
army, which has two castings of Watery Double on it, so 2 come back. The recorded game had assigned
4, and replay stopped there. `v1` was re-recorded for that reason, and only that game changed: it
diverges at action 73, ends four decisions sooner, and p1 still wins. The other nineteen are
byte-identical. `spellReduced` in `combat.ts` does the subtraction, spell by spell, so the log
reads "4 straight back − 2 Watery Double = 2". Charge will reuse it in 6e. The arithmetic rides on
`riposteMath`, which the digest drops like every `...Math` key, so a golden moves only where the
riposte number itself changes. The estimator subtracts the same spell saves, so greedy does not
fear a Counter that a Stone Skin already answers.

**2. A spell's unit roll ends a glare now.** `spells.ts`'s `saveSubRoll` calls `endGlaresOf` for
every die that actually rolled, the same as the SAI sub-roll. Tests cast Lightning Strike and Mirage
at a glaring die and see both the glare and its victim's hypnosis end, and both fail without the fix.
No golden moved: nothing in either corpus has a Leviathan.

**3. Abilities reach unit rolls through the same table that gathers them for armies.** `armyRoll`'s
two hand-written blocks became `COUNTS_AS_ABILITIES` (ability, element, gathered on melee rolls only
or on any) and `abilityPermissions`. `unitRoll` calls it for the unit's own terrain, and
`conversionsIn` then decides as it does for any roll. So 6f adds Mountain Mastery and Dwarven Might as
two rows, and both reach army and unit rolls. Flaming Shields is gathered on unit rolls too and does
nothing there, since no unit roll counts melee. Tests: a Coral Elf at water saves against a damage
sub-roll and a Lightning Strike with its maneuver, and does not at Highland or in Reserves. Both
positive tests fail without the fix. No golden moved: neither corpus has a Coral Elf.

### 6d — Roar, Stomp, Bash — **landed**

- **Roar** is `target_enemy` with a Reserve destination and no roll. It is not a kill: no death
  trigger, no Replanting. A sleeping die is a legal target (Roar moves it; it does not ask it to
  move), and a Roar that empties the defending army leaves nobody to save, which must end the
  exchange as an empty army does, not throw.
- **Stomp** chains two existing sub-rolls, and the second must wait. Its kills can raise an
  Accelerated Growth offer, and an exchanged die was never killed, so it rolls no burial check. So
  the burial check is **parked and made at the next machine step**, exactly the way
  `rerollDue` / `rollHeldAgain` wait for a Bullseye's reroll, and it rolls only the dice actually in
  the DUA by then (`resolveBreathBury`'s `inDua` filter, reused rather than rederived: Phase 8's
  missed crash was a kill-and-bury that forgot what Replanting took out). A Phoenix still gets its
  Rise roll on the way to the BUA.
- **Bash is the first enemy-aimed task the defender owns.** It is chosen at the delayed pause
  (the save dice have to be on the table) but aimed at the *attacker's* army, a combination
  `taskOwner` has never returned. `Pending.sai_target` with `limit: one` and `eligible`: the
  attacking units whose dice produced melee, read by `perDieResults` over the unit's whole reroll
  chain. The target takes that much damage through 6b's sub-roll; its results still count toward
  the attack (p. 27, "its results still stand"); the defender's roll gains the same number of saves
  in Bash's own field. Individual-unit, so never combined. **In the UI the victim is picked from the
  attack strip**, which the delayed pause already shows beside the save strip.
- **Bash in a dragon attack needs a house rule.** "Choose an attacking dragon that has inflicted
  damage" is a decision inside the dragon combination roll, which `noSideDecision` refuses. Proposed:
  automatic, the dragon that did the most damage (tie by board order), because that choice
  maximises both halves -- the saves and the damage sent back. It slays the dragon when that damage
  alone reaches the dragon's threshold (10, or 5 past a Belly); it is neither melee nor missile, so
  it never combines with either pool.
- `expectOnly`'s whitelist in `finishSaves` gains Bash's effect kind **in the same edit**. That is
  the one thing every Phase 4 slice forgot.

### What 6d found

Both golden corpora replay byte-identical and unregenerated: no recorded game has a Dwarf. The rules
are in `RULES-V0.md` section 18, and the tests in `dwarves.test.ts`.

**1. Roar and Stomp were the existing shapes the table said, with one new fate each.**
`target_enemy`'s `fate` gained `'reserve'` (Roar: moved, not killed, so no death trigger) and
`'save_or_bury'` (Stomp). Roar's `sai_resolved` carries `toReserve`, because nothing follows that
line, so it has to say where the dice went.

**2. Stomp's burial roll was Fire breath's roll, and is now the same function.** `saveOrBury` came
out of `resolveBreathBury`, and Stomp parks its dead on `combat.attack.burialDue` the way a Bullseye
parks `rerollDue`. `settleGrowth` trims the list the way it already trimmed Fire breath's `burning`.
A test drives the order: Stomp kills two Oaks, Accelerated Growth is asked, one Oak is exchanged,
and only the other rolls the burial check.

**3. Bash fits the delayed pause with one new answer from `taskOwner`.** It is owned by the
defender and aimed at the attacker: `{ player: defender, army: attacker }`. The pending is the
ordinary `sai_target` with `limit: one` and `eligible`, plus `bash`, the melee each eligible die
would take. Every chooser sees the price without resolving the roll, and greedy picks the biggest.
The victim is picked from the attack strip, which the delayed pause already shows, so neither
board changed.

**4. Bash's saves are a named step-10 add.** `bonus` is Wild Growth's and the arithmetic line names
it so, as predicted. `saveRollSpec` adds `+ N Bash` instead, which needed no new `RollSpec` field.

**5. The dragon roll's guard had to learn one effect.** `resolveArmyRoll` refused every effect
(`expectNoEffects`). It now allows `bash_dragon` (`expectOnly`, now exported), counts the Bashes onto
`DragonAttackState.bashes`, and `finishDragonDamage` spends them. That is the house rule: the
dragon that did most, its damage back, and as many saves. A dragon slain this way counts as slain by
the army, so the army promotes. `dragon_damage` names it ("− 12 Bash", "Bash sends 12 back vs
10"). The dragon self-play's arithmetic check had to subtract it too, or the first Behemoth in a
dragon game would have failed it.

**6. The estimator's switch was not exhaustive.** A new effect kind compiled cleanly and was
priced at nothing, which is how greedy stops casting or using something without anything failing.
It ends in `effect satisfies never` now, and Bash is a middling die's melee in saves.

**7. A Bash that kills the attacking army's last die ends that army's effects before the totals.**
The rules end an army's effects when it has no units left, "checked at the end of each action", and
the Bash is an action that comes before the totals. So a Fiery Weapon on that army adds nothing to
its attack, while the dice's own results still stand. That is written in section 18 as what the
rules say, with a test, rather than left as a surprise.

**8. A temporary fuzz, since the species is not playable yet.** With Charge stubbed to nothing and
an empty ability list, random and greedy self-play ran 1200 games: Behemoth and Androsphinx
mirrors, and Behemoths against Satyrs and Genies. There were no throws, nothing stuck and nothing
capped. They reached Roar 2426 times, Stomp 1210 (853 burial checks), Bash 374, and Bash in a dragon
attack 29. The stubs were reverted. The live fuzz reaches all of this once 6f flips the species.

### 6e — Charge — **landed**

The third shape of exchange, and the phase's one real unknown. In its own slice so the seams it
finds are not tangled with anything else.

- **The attacker's half is a counts-as triggered by a face**, not by `armyRoll`: if any attacking
  die shows Charge on a melee attack that is not a counter, every die's *rolled* maneuver counts as
  melee (`rolledManeuver`, Coastal Dodge's helper). **Fly is the trap**: `choiceOf` keeps only the
  type the roll counts, so in a melee roll Fly's "X maneuver or X save" becomes nothing, and under a
  Charge it should become X melee. Trample's maneuver half survives into `saiResults`; Fly's does not.
  A test with a Gargoyle Flying beside a Charging Behemoth.
- **The defender's half replaces the save roll at the same step.** `PendingSaves.charge` is written
  when the save dice are thrown, as `wave` is, so the pause, the display and the count all see it.
  The roll counts save and melee. **The zero-total early return must not skip it**: Charge replaces
  the counter-attack as well as the save roll, so the defender rolls even against a zero attack.
  `attackFacts.savesNeeded` is the early return Phase 4a already had to move once.
- **Then an allocation pause** (`charge_allocate`, 6b's shared allocation): IDs split between save
  and melee, and Flaming Shields' trade when the defenders are Firewalkers at fire. Skipped when there
  is nothing to allocate. A new `MarchStep` between `sai_delayed_attack` and
  `resolve_attack_damage`, on the attack half only.
- **Damage**: attack minus saves goes to the defender as usual; the combination roll's melee, plus
  any Counter riposte, goes back at `assign_attack_riposte`, less the attacker's spell saves. No
  counter-attack is offered. The log gains optional fields only (`charged`, the melee sent back), so
  no digest moves.
- **House rules to settle and write in `RULES-V0.md`** (proposals):
  - The combination roll **is the save roll against a melee attack** for every SAI and delayed
    effect: Counter, Bash, Wave, Galeforce, Choke, Confuse and Hypnotic Glare all apply to it. An SAI
    whose only melee sentence is "during a melee attack" (Smite, Roar, Stomp, Rend, Tail) adds no
    melee, since the defender is not attacking; an "any roll" SAI (Trample) does.
  - **Counter counts as its save sentence, automatically.** p. 28's combination rule lets the
    roller pick one sentence, and X saves plus X damage back dominates X melee, which only sends the
    same X back.
  - A modifier that could fall on either type is applied **the way the dragon roll already applies
    it**, through the shared spec builder, and the rule is written once for both.
  - Coastal Dodge converts automatically (the roll counts saves and not maneuver); Dwarven Might
    does not apply (it is not a counter-attack); Flaming Shields is a trade and is asked.
  - One Charge or several: the effect is the same, so they combine trivially.
- **Greedy and passive**: allocate IDs to saves until the attack is covered, the rest to melee.
  `estimate.ts` learns both halves -- the maneuver the Charge adds, and the melee the defender will
  send back -- or greedy will march a Behemoth into a Charge it prices at zero.

### What 6e found

Both golden corpora replay byte-identical and unregenerated. 1155 tests pass, and the Charge tests
are in `dwarves.test.ts`.

**1. The attacker's half lives in `resolveFaces`, because a Charge is a fact about the faces.**
`charging()` looks for a Charge face and, if one is there, marks the purpose `charging` and adds a
maneuver-to-melee "counts as" for every species in the roll. 6b's table then applies it and names
it, with no code of its own. That puts it on the one door every reader of an attack roll uses: the
parked roll on screen, the targeting queue and the totals all agree.

**2. Fly was the trap the plan said it would be, and the purpose fixed it rather than a special
case.** `countedTypes` of a charging attack is `[melee, maneuver]`, so Fly's choice offers
maneuver, and the conversion turns it into melee. A test puts a Gargoyle's Fly and a Trample beside
a Charge and counts 12.

**3. The defender's half is the dragon roll's question again, and 6b's `combination.ts` was the
whole of it.** `chargeRollSpec` is `combinationSpec` over `[save, melee]`, plus what an ordinary save
roll carries: Wave, Bash's saves, and Wild Growth's unspent budget as a named add, because
`saiResults` is already the flexible split. `charge_allocate` reuses the dragon sheet in the
browser and the dragon prompt in the terminal, parameterised by the kinds. Every reader of the
parked save dice goes through `defenderRollSpec`.

**4. The zero-attack early return needed the change the plan predicted.** `savesNeeded` is
`total > 0 || charged`. In the temporary self-play, 815 of 1228 charges came against an attack of
nothing, so the plan's "a Charge with nothing else rolled" turned out to be the usual case: a Charge
face gives no melee of its own. Without the change, most charges would have been silent.

**5. The ID split is now checked before anything resolves.** `combinationAnswerProblem` used to
leave the IDs to `allocateIds`, which threw a plain error from deep inside the roll. It checks
every number now, for the dragon roll too, so a bad split is a refused action.

**6. The melee back rides the riposte's channel**, through 6c's `spellReduced`. A Charge's melee
and a Counter's riposte are one number assigned at `assign_attack_riposte`. The log keeps `charge:
{ melee }` beside `riposte`, so the line can say "Charge: 1 melee straight back + 4 from Counter".
`counterSuppressed` is set without Surprise's log line.

**7. A greedy stall that Charge did not cause** -- *corrected in 6h: a dead position, not a
greedy bug. Passive's last dice sit in Reserves after a Roar and never come out, and one die
cannot make two captures.* In 500 temporary greedy-against-passive games on
Behemoth boards, 10 hit the cap. With Charge switched off, 6 still did, with 0 charges in them. Each
is the same endgame: greedy's last die captures its home's eighth face, retreats "to hunt" because
passive's last die hides in Reserves, reinforces back to the same terrain, and repeats. Greedy never
goes for a second terrain. That is 6h's greedy-against-passive re-run, and it will be visible on any
monster mirror once the Dwarves are playable.

**8. The temporary fuzz again.** With an empty ability list (reverted afterwards), 1500 games ran
random, greedy and greedy-against-passive on Behemoth, Gargoyle, Fireshadow, Unicorn and Strangle
Vine boards. No throws and nothing stuck. 1228 charges, 2 of them reduced by a spell.

### 6f — Mountain Mastery, Dwarven Might, and the flip — **landed**

- **Mountain Mastery** is the melee → maneuver row: automatic, since no maneuver roll counts melee.
  It reaches the marching maneuver, the counter-maneuver and (after 6c) a Dwarf's own Smother,
  Firecloud or Stomp roll. **Dwarven Might** is the counter-only save → melee row, automatic for the
  same reason. Both write a note on the arithmetic line, as Coastal Dodge does. `flamingShields` on
  the log stays Flaming Shields' alone, because the digest records it.
- **The flip**: `SPECIES_ABILITIES` names the Dwarves, and with that edit (5a's lesson, paid in 5d)
  come the five monster fixtures, the race draw over four species (already general, so only its
  tests' counts move), every test that counts species, and the live fuzz's counters for the four
  SAIs and two abilities.
- **Predicted fuzz reach**: Roar and Stomp fire in 200 random games; Mountain Mastery and Dwarven
  Might certainly do, since Highland is home. **Charge and Bash are one face each on one monster**,
  and Bash also needs a save roll against melee, so expect `'full'` for both, with a named test in
  the Behemoth mirror standing behind each counter.

### What 6f found

The Dwarves are playable. Both golden corpora replay byte-identical and unregenerated, and 1161
tests pass.

**1. The two abilities were two rows and nothing else.** Each is a `counts_as` factory in
`pipeline.ts` and a row in `COUNTS_AS_ABILITIES`. 6b's table and 6c's unit-roll door did the rest:
Mountain Mastery reaches a Dwarf's own maneuver sub-roll, and Dwarven Might stays out of
`countedAs`, both of which 6b tested by hand before the abilities existed. Those hand-written rows
in `dwarves.test.ts` are the real factories now.

**2. The flip cost what 5a said it would, and nothing more.** Five monster fixtures (`dwarves_*`,
six of one monster, 3/2/1). Tests that counted three species or fifteen monster fixtures: built,
playable, setup, builder palette, the start screen's presets and opponent pools. The playable
tests went back to "every species in the data is playable". The race draw needed nothing, because
5d made it general.

**3. The fuzz reaches more than the plan predicted.** The plan guessed Charge and Bash would need
the 1000-game run. Both fire within 200 random games, as do Roar, Stomp, Stomp's burial check,
Mountain Mastery and Dwarven Might, so all are `'every'`. Bash in a dragon attack never fired in
1000 games (it needs a Behemoth's army attacked by a dragon, rolling that face), so it is
`{ elsewhere: 'dwarves.test.ts' }`, where a named test drives it. The `charge_allocate` decision is
`'every'` too.

**4. Greedy finishes every Dwarves mirror**, seeds 1 to 4, against passive and against itself: the
5d exit check, now in `greedy.test.ts` for the Dwarves. The lone-die stall from 6e does not show on
those 40 games. It is about 1 game in 80 on a Behemoth board, and it stays on 6h's list.

**5. In the browser**, a Behemoth mirror opens on Highland homes, and contesting a maneuver at a
Highland Frontier showed "4 melee counted as maneuver (Mountain Mastery)", the Trample die drawn
as 8. No console errors. Charge and Bash did not come up in the turns played, so they rest on the
engine tests, the fuzz, and the log lines rendered in 6d and 6e.

### 6g — Firebolt and Higher Ground — **landed**

- **Higher Ground** is an `effect` block, Dancing Lights' shape at five: `opposing_army`, subtract 5
  melee, cumulative. No code.
- **Firebolt** is a handler over 6b's damage sub-roll: N castings, N damage, one save roll.
  `countScales` true (two castings kill a two-health die that saves nothing), and one line in
  greedy's `HANDLER_VALUE`. The validator already accepts an imported species' spells (5e).

### What 6g found

Both golden corpora replay byte-identical and unregenerated; the 200-game and 1000-game fuzz runs
pass, and so do 1166 tests.

**1. The table's prediction held, with the correction 6b already made.** Higher Ground is an
`effect` block with no code. Firebolt is a handler of five lines over `damageSubRoll`, the roll 6b
built for Bash, and not `spellSaveRoll` as the draft had it. `npm run data` reports no spell without
code behind it.

**2. Greedy prices Firebolt by the same arithmetic.** `diesTo` in `src/ai/spells.ts` is the chance a
die's own save roll leaves the damage at or above its health. It is zero below the health, which is
why one casting is worth nothing against anything but a 1-health die.

**3. Two counts were about "the species so far".** The validator and `magic.test.ts` both held the
data to twenty spells, and the species test to six species spells; both are 22 and 8 now. That is
the same edit 5e had to make, and the comment says the next species moves it again.

**4. The fuzz casts both within 200 games.** The live fuzz requires every resolvable spell to be
cast, and it is read from the data, so the two spells joined it on their own.

### 6h — Presets, exit checks, art — **landed**

- `dwarves_starter` (the starters' class-and-size layout, 30 health) and `dwarves_bestiary` (every
  monster and every large die, 35), as 5f did.
- **Re-run greedy against passive** with a Dwarves force on both sides: Charge and Higher Ground
  are the two new values most likely to outbid walking a terrain home.
- **Fix greedy's lone-die stall** (found in 6e): its last die holds its home eighth face, retreats
  to hunt a die hiding in Reserves, reinforces back to the same terrain, and repeats. It never goes
  for a second terrain. Behemoth boards hit it in about 1 game in 80. *(6h: not a greedy bug -- a
  dead position against an opponent that never reinforces; see "What 6h found".)*
- Exit criterion as for every species (above). The V1 goldens move only if 6c's riposte fix moved
  them, and the commit that regenerated them says so.
- **Art**: the pins are already in. After import the resolver should report no ambiguity; running
  `npm run art` to download is the owner's step, as in 5g.

### What 6h found

Both golden corpora replay byte-identical and unregenerated. 1167 tests pass, and the
1000-game fuzz passes.

**1. The presets are the pattern, die for die.** `dwarves_starter` is the starters' class-and-size
layout in Dwarves dice (30 health: 10 / 11 / 9), and `dwarves_bestiary` holds every monster and every
large die (35: 14 / 14 / 7). Both were generated from the Coral Elves' lists by class and size, so
neither is a hand count. Neither is a mirror, so both appear on the start screen and pair by health.
The preset-count tests moved again: 28 presets, and four of each of 30 and 35 health.

**2. The 6e "greedy stall" was a dead position, not a greedy bug.** Re-run on the playable
Dwarves, 7 of 700 greedy-against-passive monster games capped. Every one ended the same way: greedy
had one die on the board, and every die passive had left was in Reserves, sent there by a Roar (or a
Seize). PassiveAI never reinforces, so those dice never come back out. One die cannot hold two
captures, and nothing on a Behemoth board can attack a Reserve Army: no missile at Reserves without
a Tower, and no magic face to cast with. No move greedy makes wins that, so nothing in greedy was
changed. The retreat-and-return loop 6e saw is greedy trying the only moves left. It is a fact
about an opponent that never leaves Reserves, which a human does not do, and Roar is new in making
it reachable. The section 6e write-up keeps its finding with this correction.

**3. Greedy against passive and against itself, with Dwarves on both sides, finishes every game.**
200 games over the starter and bestiary mirrors all ended in a win. Greedy cast Firebolt 35 times
and Higher Ground 4, and charged 12 times, so neither spell nor Charge outbids walking a terrain
home. `greedy.test.ts` holds 5f's check for the Dwarves: the starter and bestiary against each other
species, both ways, seeds 1 to 3, against passive and against greedy.

**4. Art: all 140 faces resolve, offline.** The images were already in the gitignored
`assets/faces/dwarves`, which the owner had mirrored with the 6a pins. So `fetch_faces.py
--offline` built the manifest from that local copy, with nothing downloaded: 560 unit faces mapped,
140 of them Dwarves, none ambiguous or missing. In the browser every Dwarves tile draws its
portrait. The tiles that looked blank in a first screenshot had not finished loading.

**Phase 6's exit criterion, checked.**
- Every Dwarves mirror finishes in self-play (6f).
- Every SAI, ability and spell fires within the 200-game live fuzz, except Bash's dragon sentence,
  which a named test drives (6f).
- A mixed force with Dwarves in it plays in one live-fuzz game in five.
- The V0 goldens never moved. The V1 goldens moved once, in 6c, for the riposte rule, and the
  commit says so.
- The one check not made is a full Dwarves starter game played by hand in the browser. The pieces
  were each seen there -- Mountain Mastery on a live roll card, the art, the new log lines and the
  Charge question rendered from real entries -- but no game was played to its end. It is the
  first thing to playtest.

### Deliberately out of this phase

- **Death magic.** Dwarves bring none; it is Phase 7's first slice.
- **Cursed Bullets.** It uses 6b's spell-save gather, but it is Lava Elves' (Phase 8).
- **A player's choice over "may".** Every ability here is automatic because converting can only
  help in the rolls it reaches; if a later species brings a combination roll counting maneuver, the
  question comes back.

## Phase 7 — Goblins — **landed**

7a has landed: the data, and a Replanting rule it uncovered. 7b has landed: the seams. 7c has
landed: Screech, Poison, Net and Stun. 7d has landed: Regenerate and the two abilities, and the
Goblins are playable. 7e has landed: the five spells and the Temple. 7f has landed: the presets,
the exit checks and the art manifest. **All of Phase 7 has landed.**

Death & Earth, the first species carrying Death. **No terrain type in scope carries Death**
(Deadland, the one that does, is out), so the Goblins
have no own type: Phase 2's `drawHomeDie` already draws them a home among the twelve dice carrying
earth (Swampland, Highland, Flatland), and Swamp Mastery is live at every home they can draw. The
faces are in `data/raw/goblins.faces.txt` (20 dice, 140 faces, no `TODO` face), unimported, and the
images are mirrored in the gitignored `assets/faces/goblins` -- **but `fetch_faces.py` has no
Goblins pins yet**, and the set holds two maneuver images (`maneuver-1-*`, `maneuver-2-*`), which is
exactly the Treefolk and Coral Elves case.

The roster matches p. 82: heavy Thug / Cutthroat / Marauder / Cannibal, light Mugger / Ambusher /
Filcher / Death Naga, cavalry Wardog Rider / Wolf Rider / Leopard Rider / Harpy, missile Pelter /
Slingman / Deadeye / Shambler, magic Trickster / Hedge Wizard / Death Mage / Troll.

**What the faces actually carry.** Fifteen SAI names, **five new**:

| SAI | Dice | Applies | Seam |
|---|---|---|---|
| **Screech** | Harpy ×2 | Melee | Wave's melee half exactly: "the defending army subtracts X save results". No targets, no roll |
| **Poison** | Death Naga ×2 | Melee | Sub-roll (4d), twice: "target X health-worth", each makes a **save** roll or is killed, and the dead save again or are buried. Stomp's chain (6d) with a save where Stomp has a maneuver |
| **Net** | Cannibal | Melee, Missile, Individual | Smother's maneuver sub-roll, and a failure is **Sleep's status**: "may not be rolled or leave the terrain ... until the beginning of your next turn". Plus a sentence the draft missed: "when saving against an individual targeting effect, Net generates X save results" |
| **Stun** | Cannibal | Melee | Smother's maneuver sub-roll, and a failure sits out **army** rolls only: "cannot be rolled until the beginning of your turn, unless they are the target of an individual-targeting effect which forces them to". It may leave, and leaving ends it |
| **Regenerate** | Troll ×2 | Non-maneuver | **New.** "Choose one: X save results, OR return up to X health-worth of units from your DUA to the army containing this unit." Wild Growth's friendly pause, with a choice between two unlike things |

Reused: Smite, Counter, Bullseye, Rend, Cantrip, Fly, Smother, Sleep, Surprise, and Swallow (5c).
**The Cannibal is this phase's Behemoth**: Net, Stun, Sleep, Swallow and Surprise on one die, so
its mirror is the laboratory for every status in the game at once -- a Netted die, a Stunned die
and a sleeping one side by side, with a Swallow taking whichever is left.

**Abilities**: Swamp Mastery (at earth, melee counts as maneuver -- Mountain Mastery's row) and
**Foul Stench** (below). **Spells**, checked with PyMuPDF the 5e way (red `0xd12229` is
cumulative; the R and C columns read off word positions on p. 82):

| Spell | Element | Species | Cost | R | C | Cumulative | Shape |
|---|---|---|---|---|---|---|---|
| **Palsy** | death | any | 2 | | X | yes | `effect`: −1 on every non-maneuver roll |
| **Decay** | death | goblins | 3 | | | yes | `effect`: −2 melee, Higher Ground's shape |
| **Finger of Death** | death | any | 4 | | | yes | Handler: N castings, N damage to a unit, no save |
| **Soiled Ground** | death | any | 6 | | | no | Handler: a terrain effect read by `killUnits` |
| **Scent of Fear** | earth | goblins | 5 | | | yes | Handler: Mirage without the save, opposing units only |

### Where the draft tables above are wrong for Goblins

- **"Net, Web and Stun need a status that stops a die rolling and leaving, plus a new end
  condition" is mostly built.** Net's status *is* Sleep's, word for word, and 5b's `Effect.anchor`
  is already the "ends when the unit leaves its terrain" condition Stun needs. What is new is
  narrower: **a status that keeps a die out of army rolls and nowhere else** -- `glaring`'s reach
  without its owner choosing it. The draft's "Stun ends at the beginning of *your* turn, not your
  next turn" is not a distinction: the caster's current turn has already begun, so the next
  beginning of it is the next turn either way, and `expiresAtStartOfTurnOf` already says so.
- **Net is not a new status, and must not become one.** Every "cannot leave its terrain" check --
  the Retreat Step, the free moves, Path, `RandomAI`'s retreat pool, `sleepingIds` -- asks
  `isAsleep`. A `netted` field would have to be taught to each, and the one it was not taught to
  would let a netted die walk away with every test green. So **Net writes `asleep: true` with
  `source: 'Net'`**, and the UI names the status by its source ("— netted"). No `Effect` field, so
  nothing near the digest moves.
- **Net reaches missile attacks, with an exception for the Tower.** "Net does nothing during a
  missile attack targeting an opponent's Reserve Army from a Tower on its eighth face" -- a Reserve
  Army stands on no terrain to be held on. It cannot be decided in `sai.ts`, which sees no
  `GameState`; the targeting queue drops a Net task whose defender is `'reserve'`, the way a task
  that can take nothing is dropped.
- **Poison is not a new seam.** It is `target_enemy` with a save sub-roll (Bullseye's) and 6d's
  `'save_or_bury'` fate (Stomp's), whose burial check already waits for an Accelerated Growth
  offer on `combat.attack.burialDue`.
- **Screech is Wave's melee half, and the risk is only its name.** `PendingSaves.wave` is a number,
  and the arithmetic line calls it Wave. Screech gets its own field beside it (`screech?`), Bash's
  lesson from 6d: a shared field is a line that names the wrong SAI.
- **Regenerate returns units through `returnFromDua`, not `recruit` or an exchange.** "Up to X
  health-worth of units from your DUA" -- any size, **any species** (unlike Resurrect Dead it names
  no element, and unlike promotion it is not an exchange), so `recruit`'s one-health guard is
  wrong for it and Resurrect Dead's door is right.
- **Foul Stench is the first DUA-count ability, and the cap is not "3 per 24 health" flat.** p. 21:
  "per 24 points of total force size, or part thereof" -- 3 up to 24, 6 from 25 to 48. So a 30-health
  starter game already caps at 6, not 3. One helper, `duaCap(state, player, per)` over
  `forceSize`, which Cursed Bullets reuses in Phase 8.
- **Finger of Death is cumulative** ("one" is red), and so is Scent of Fear: the draft's "1
  damage" and "3 health-worth" are per casting. N castings of Finger kill a unit of health ≤ N with
  no roll, and fewer than its health do *nothing*, so the offer carries **`minCount` = the target's
  health** -- Resurrect Dead's mechanism, and the reason it rides on the offer rather than in a rule.
- **Palsy is not "no code".** "Non-maneuver rolls" is a result-type set that `'*'` cannot say, and
  four `subtract` rows would take one per type from a combination roll where Ash Storm's ruling
  (section 18) takes one per *kind counted* -- which is what one `'*'`-style wildcard gives for
  free. So the spell spec gains a wildcard, `'non_maneuver'`, and **it has three expanders, not
  one**: `scaleModifier` in `spells.ts`, the data validator's `RESULT_TYPES`, and greedy's own
  copy in `src/ai/spells.ts`. Miss the third and greedy prices Palsy at nothing.
- **Soiled Ground's burial check cannot park on `combat.attack`.** Stomp's `burialDue` is an
  exchange's, and Fire breath's `burning` the dragon attack's; a Soiled Ground death can come from
  any of them, from a spell (Finger of Death, Lightning Strike, Hailstorm) or from a sub-roll. It
  waits on a **turn-level** list instead, settled at the next machine step after any growth offer,
  rolling only what is still in the DUA by then (`inDua`, Phase 8's missed crash). And it has to be
  settled **before Foul Stench counts the DUA**: a Goblin buried there no longer counts.
- **The Temple's death-magic immunity has been dormant since v1 Phase 5e** ("your controlling army
  and all units in it cannot be affected by any opponent's death magic", `RULES-V0.md` section 13
  says so), and this phase wakes it. The draft did not mention it.
- **Most of "Death magic" is already built.** `Element` has had `'death'` since v0, an elemental
  spell accepts any element (`spellAcceptsElement`), the Death Drake, Wyrm and their breath
  (`ignore_ids`) are in, `--el-death` is a token, and a Death species draws its home without an own
  type. What is left is five spells, the Temple, and tests that prove the rest -- which is why
  Death magic is no longer this phase's *first* slice (7e, below).

### 7a — Data — **landed**

- **Gate: the monster SAI counts.** Every monster face in the raw file says 4 with no count in
  the source. Nine of the monster SAIs here read X -- Swallow, Stun, Net, Poison, Fly, Screech,
  Smother, Smite, Regenerate -- so the owner checked them against the dice before import, as 6a
  did for the Dwarves: **every one is 4** (confirmed 2026-10-02). Sleep and Surprise take no X.
  The raw file's header loses its "unconfirmed" note in this slice.
- `tools/species.py` gains `goblins` (the roster above) and `SPECIES_SAIS` gains Net, Poison,
  Regenerate, Screech, Stun (p. 83). The raw file's header loses its "not imported" note.
- **The Goblins are unplayable after this slice**, by `playable.ts`. `sai.test.ts`'s partition
  gains five deferred names, and `playable.test.ts` gets its real refusal back with the exact
  sentence, as 6a did.
- Expected to move: the unit count (100 dice), the SAI partition, the playable species, and any
  test that names "the only" die with an SAI the Goblins reuse (6a's Dispel Magic lesson; here
  Smother, Sleep, Surprise and Swallow each gain a die).

### What 7a found

Both golden corpora replay byte-identical and unregenerated, and 1168 tests pass. `npm run data`
writes 100 dice and 700 faces with 40/40 SAIs in the data. Saving is off, so `SAVE_VERSION` has
nothing to be about.

**1. Four tests moved, as in 6a.** Three are counts of the data: 100 unit dice and five species,
the SAI partition (five names `deferred`), and the playable species, which is the real refusal
again ("the SAIs Net, Poison, Regenerate, Screech, Stun and its species abilities") with a rolled
Goblins force that throws and a built force with a Cutthroat that gets the sentence. 7c and 7d
shorten it; 7d turns it back into "all playable". Nothing else counted species: the builder
palette, the start screen and the fuzz all read `PLAYABLE_SPECIES`, which still lists four.

**2. The fourth was a fact about the data that stopped being true, and behind it was an
unanswered rule.** `species.test.ts` checked that "does a sleeping Treefolk replant?" could not
come up, because Sleep was only on Treefolk dice and aims at opponents. The Cannibal sleeps (and
nets, which writes the same status) any die, Treefolk included. Reading `death.ts` for the answer
found there was none: **neither Replanting nor Rise from the Ashes asked `cannotRoll`**, so a dying
die that may not be rolled rolled anyway -- reachable for a sleeping Phoenix since v1 and a
hypnotized Treefolk at water since 5b, with nothing saying whether it was a reading or an omission.

**3. Decided, in its own commit, and the claim was false all along.** The owner chose: a die that
cannot be rolled **does not replant** (it rolls while still on the terrain under its status, so
section 11's "fails and draws nothing" applies), and a Phoenix in the same state **still rises**
(it rolls already dead, and the statuses are about a die in play). A glaring die replants. Replay
showed the old claim had never held: **v1 game 13 is a Satyr mirror**, where p1's Satyr sleeps a
p2 Satyr and p2's own Water Drake then kills it at a water home. The recorded game rolled its
Replanting (a miss); the new rule draws nothing, the dice shift, and replay stops at action 131.
`v1` was re-recorded for that reason and only that game changed: 184 decisions became 169, and p1
still wins. The other nineteen are byte-identical. The Treefolk monster mirrors existed since v1
Phase 1, so the test's premise was a fact about two *species*, checked by a test that never asked
about one species against itself.

**4. The art resolver is not run in this slice.** With the Goblins in `units.json`, `npm run art`
would report the seventeen maneuver faces 7f's pins settle; the pins and the manifest are 7f's.

**Deliberately not done.** No fixture, preset or art manifest: a fixture for an unplayable species
could only throw (7d).

### 7b — Seams, and no rule moves — **landed**

1. **`duaCap(state, player, per)`**: `per × ⌈forceSize / 24⌉`. No caller until 7d; tested at 12,
   24, 25 and 36.
2. **A turn-level burial check**, `turn.burialDue` (named, the shape `combat.attack.burialDue`
   already has), settled by the machine step after `stepGame` raises any growth offer. **Stomp
   moves onto it** in the same edit -- no golden has a Dwarf, so nothing recorded moves -- and the
   6d test where Accelerated Growth exchanges one of two Stomped Oaks is the one that proves the
   move. Fire breath's `burning` stays where it is: it is in dragon games, and nothing needs it to
   move.
3. **A stunned status**: `Effect.stunned?: true` with an `anchor` on the stunned unit itself.
   `sitsOutArmyRoll` asks it; `cannotRoll` does not, so a sub-roll still rolls the die. **Replanting
   asks it too** (7a's rule): Stun lets through only a roll an individual-targeting effect forces,
   and Replanting is not one, so a stunned Treefolk does not replant -- the one reader of the
   status that `cannotRoll` will not bring along. No producer.
4. **`'non_maneuver'`** in the spell modifier spec, in all three expanders, with no spell using it.
5. **`deathMagicImmune(state, player, ref)`**: the Temple predicate, through `iconAt`, so losing the
   capture ends it in the same step for free. Read at **gather time** -- an effect from a death
   spell is skipped while the holder holds, read off the effect's `source` against the spell data
   and its caster off `expiresAtStartOfTurnOf`, the way 6b stamps `fromSpell` -- so a Palsy cast
   *before* the capture stops biting the moment it lands, and no `Effect` field is added. Also read
   by spell targeting (a Finger of Death is not offered against it) and by Soiled Ground's hook.
   No caller can reach it until a death spell exists.

### What 7b found

Both golden corpora replay byte-identical and unregenerated. 1184 tests pass, and so does the
1000-game fuzz. The seams' tests are in `goblins.test.ts`, which the rest of the phase will fill;
each of the order and Stun tests was checked to fail with its change undone.

**1. Moving Stomp's burial check found the order it had been getting right by accident.** On
`combat.attack` it was settled at the top of `stepTasks`, which `stepGame` only reaches after
`pruneEffects`. That order is load-bearing: a dead die's own Sleep has to be pruned before it rolls
its burial save, or `unitRoll` calls it unrollable and it fails without a die drawn. In `stepGame`
the check now sits **after the growth offer and after pruning, before the victory check**, and a
test drives a sleeping dead die through it. One thing moved, deliberately: a Stomp whose kill wins
the game now rolls its burial check before the victory, where the old placement never reached it.
No recorded game has a Dwarf, and the 6d test of a Stomp meeting Accelerated Growth proves the move.

**2. There were four copies of the result-type list, not three.** The Python validator holds one
too. And rather than teach greedy's copy the new wildcard, it is gone: **`spellResultTypes` in
`src/data/spells.ts` is the one expander**, which the engine's `scaleModifier` and greedy's spell
scoring both call. The plan's "miss the third and greedy prices Palsy at nothing" can no longer
happen, for any wildcard after this one either.

**3. The Temple predicate landed without its readers, and that is the plan corrected.** The plan
put the gather-time filter, the targeting filter and Soiled Ground's hook in 7b. Each needs a death
spell to tell it a death effect from any other, and none is in the data until 7e, so each would
have been code no test could reach -- the half-built state 7e's tests exist to prevent. 7b ships
`deathMagicImmune` itself (Temple on face 8, this player, not Reserves, ends with the capture) with
its tests, and 7e wires all three readers at once.

**4. Stun reaches the estimator through the one door, as predicted.** `sitsOutArmyRoll` is read by
`armyRoll` alone, so the dice filter carries it to every army roll and to `expectedArmy` with no
second site; a test pins that a stunned die is missing from both, still rolled by `unitRoll`, freed
by moving, and refused Replanting (7a's rule).

**5. `duaCap` reads the holder's own force**, dead and buried dice included, through `forceSize`
-- the reading this plan settled for unequal sides. `capPer24` is its arithmetic, tested at 12, 24,
25, 36, 48 and 49.

### 7c — Screech, Poison, Net, Stun — **landed**

- **Screech**: `{ kind: 'screech', amount }`, read where `wave` is, its own `PendingSaves` field and
  its own name on the line. Applies to a counter-attack's save roll and to a Charge's combination
  roll, as Wave does (section 18).
- **Poison**: `target_enemy`, save sub-roll, `'save_or_bury'`. "Target X health-worth" is p. 32's
  forced maximum, which every enemy-targeting SAI is already held to.
- **Net**: `target_enemy`, maneuver sub-roll, a new fate that writes Sleep's effect with Net's
  name. Missile as well as melee; the Tower-on-Reserves drop. And the **Individual** sentence: X
  saves in any save sub-roll (`isSubRoll` with purpose `save`). House rule (approved): **every** save
  sub-roll is "saving against an individual targeting effect" -- Bullseye, Double Strike, Lightning
  Strike, Firebolt, Bash's victim, Poison's two rolls and a burial check -- because a sub-roll is by
  definition one unit rolling for itself, and splitting them by who aimed would be a second
  question asked of one roll.
- **Stun**: as Net, with 7b's status. A stunned die **may retreat and be moved** (Roar, Path, a
  free move), and that ends the stun.
  - **The UI's one dimming set becomes two.** `sleepingIds` both dims a die and refuses its
    retreat; a stunned die is dimmed and *may* retreat. `RandomAI`'s retreat filter is the
    same split, or the fuzz never retreats a stunned die and never ends a stun that way.
- **The estimator gets Stun and Net for free only if they live in `armyRoll`'s dice filter.** They
  do, by 7b; a test pins that a stunned die is missing from `expectedArmy`.
- `expectOnly`'s whitelist gains each new effect kind in the same edit, as every Phase 4 slice
  had to be told.

### What 7c found

Both golden corpora replay byte-identical and unregenerated. 1196 tests and the 1000-game fuzz
pass. The rules are in `RULES-V0.md` section 19, the tests in `goblins.test.ts`; the Tower drop
and Screech's line were each checked to fail with their change undone.

**1. Net and Stun are two new fates on the existing targeting task, and nothing else.**
`target_enemy` gained `'net'` and `'stun'`; after the maneuver sub-roll, `holdUnits` writes one
effect per failed die instead of killing it. Net writes `asleep` under its own name, as planned, so
every leave-the-terrain check holds a netted die with no edit; Stun writes 7b's `stunned` with its
anchor. Poison needed no code beyond its handler: an escape of `'save'` and Stomp's
`'save_or_bury'` fate were already independent axes.

**2. The static results bound never asked about a sub-roll.** `saiMaxResults` enumerated every
purpose but not `isSubRoll`, so Net's saves -- which exist only in a sub-roll -- would have sat
above the ceiling, and **Wild Growth's save share already did** on every rung without dragons (its
saves outside a sub-roll arrive only in the dragon roll). A test pinned Wild Growth's bound at 0
under `FULL_RULES` as "an unimplemented SAI"; it was the under-bound, and it says 4 now.

**3. Screech's own field ran through about a dozen sites, as predicted.** `screech` sits beside
`wave` on `PendingSaves`, `SaveRollState` and `AttackFacts`, and `attackSaveCuts` is the one place
both save-roll specs (the ordinary one and the Charge roll) turn the two into named subtractions.
The save-roll spec now takes the parked roll whole rather than three loose numbers, which is how
the next such field arrives without another signature change.

**4. The first draft of two tests was hollow.** A lone Cannibal rolling Stun or Net makes no melee,
so no save roll follows, and "the netted die is not in the save roll" passed on an empty list.
Both now carry a Watcher's melee and assert exactly who saved.

**5. The UI's status map is not Hypnotic Glare's any more.** `glareStatuses` is `dieStatuses`,
with `'stunned'` (dimmed, still movable) and `'netted'` (a label only: `sleepingIds` already locks
the die). The log's sub-roll line says "maneuver or be netted / stunned", from a `fate` the entry
gained; the terminal says the same.

**6. A temporary fuzz, since the species is not playable yet.** With the playable gate bypassed for
the run and Trolls left out (Regenerate is 7d's), 576 games of random, greedy and greedy against
passive on Cannibal, Death Naga, Harpy and Shambler boards, against each other and against
Behemoths, Satyrs, Genies and Leviathans: no throws, nothing stuck, nothing capped, every state
valid. Net resolved 365 times (257 dice netted), Stun 183 (135), Poison 331 (214 burial checks),
and Screech cut 148 save rolls. The bypass was reverted. The live fuzz reaches all of this once 7d
flips the species.

**Not checked in the browser**: the Goblins are unplayable, so no game the app can start rolls
these faces. The labels are tested in `prompts.test.ts`; seeing them on a board is 7d's.

### 7d — Regenerate, Swamp Mastery, Foul Stench, and the flip — **landed**

- **Regenerate** joins Wild Growth's friendly queue, owned by whoever rolled it. One pending,
  `sai_regenerate`: X saves, or up to X health-worth of DUA dice tapped where they lie (9f's one
  way to pick a die). Where saves count for nothing -- an attack roll, a magic roll -- only the
  units half is offered, by `saveResultsCount`'s rule. Where there is no room for a decision -- a
  sub-roll, Wall of Thorns' roll, the dragon combination roll (`noSideDecision`) -- it is X saves,
  automatically, as Wild Growth's save share already is there. Returned dice stand in the army
  before damage is assigned, as a Wild Growth promotion does. House rule (approved): **two
  Regenerates combine into one choice of 2X** (p. 32), not a split of saves and units -- Wild
  Growth's split is its own text, and Regenerate says "choose one".
- **Swamp Mastery** is Mountain Mastery's row for the Goblins. `meleeAsManeuver` currently stamps
  `source: 'Mountain Mastery'`, so it becomes a factory taking the ability's name, or a Goblin's
  roll reads "counted as maneuver (Mountain Mastery)".
- **Foul Stench** is a new pending addressed to the **defender**: select exactly
  `min(N, living defenders)` of their units, N = Goblins in the attacker's DUA capped by `duaCap(...,
  3)`. Only on a melee *action* by an army holding a living Goblin -- not on a counter-attack, and
  not when a Charge has already replaced the counter.
  - **House rule (approved): asked only once the counter is accepted**, between `offer_counter` and
    `resolve_counter`. The rule puts it after the save roll and before the counter; the same player
    answers both with nothing rolled in between, so the swap changes no information and removes a
    question from every exchange the defender was never going to answer. The offer shows N, and
    **no offer is raised when N covers the whole army**.
  - Selecting a sleeping, netted or stunned die is legal (the rule says "select their units", and
    picking one that could not roll anyway is the defender's good play, not a loophole).
  - **The bench is read in `armyRoll`, not at the counter site** (`turn.combat.benched`, omitted
    when empty). The counter-attack's "expect ≈6" forecast and greedy's decision to counter go
    through `estimate.ts`, which goes through `armyRoll`; a filter at the counter site is the
    second door, and the forecast would count benched dice.
- **The flip**: `SPECIES_ABILITIES` names the Goblins. Five monster fixtures (`goblins_*`), every
  test that counts species or fixtures, and the live fuzz's counters for the five SAIs and two
  abilities. With the flip the Goblins roll Death magic with only Resurrect Dead and Summon Dragon
  to spend it on -- playable, since `castableSpells` offers only what resolves -- and **Summon
  Dragon reaches the Death dragons**, so the fuzz's `breath:death` (keyed off the board since 0b)
  becomes a requirement on its own.
- **Predicted fuzz reach**: Screech, Poison, Regenerate and Swamp Mastery in 200 games. Net and Stun
  are one face each on one monster, as Charge and Bash were, and those fired in 200; expect the same.
  Foul Stench needs a dead Goblin first, which a long random game always has. The Tower-on-Reserves
  Net drop and the Temple immunity are `{ elsewhere }` with named tests.

### What 7d found

The Goblins are playable. Both golden corpora replay byte-identical and unregenerated; 1210 tests
pass, and so does the 1000-game fuzz. The rules are in `RULES-V0.md` section 19, the tests in
`goblins.test.ts`.

**1. `finishExchange` would have dropped Foul Stench before anyone read it.** The flag is set when
the melee action is chosen ("when an army containing Goblins takes a melee action"), and the attack
half's combat is rebuilt field by field -- so a new field is dropped by omission, as that code's
comment warns. It is carried out of the attack half and only that half, and dropped with the
counter. Undoing the carry fails four tests; undoing `armyRoll`'s bench filter fails the one that
counts the counter's dice.

**2. The bench reaches every reader through `armyRoll`, and the forecast needed an assumption.**
`combat.benched` is read where the army's dice are gathered, so the counter roll and the estimate
of it both leave the dice out with no second site. But the bench is picked *after* the counter is
accepted, so at the offer nothing is benched yet: the "expect ≈N" on the Counter-attack button
assumes the dice that would add least sit out (`foulStenchBench`, greedy's own pick), on a copy of
the state with that bench in place.

**3. Regenerate is Wild Growth's pause with its own field, as planned.** A friendly task, a
`sai_regenerate` pending, `returnFromDua` (Resurrect Dead's door, not `recruit`'s one-health one),
and `PendingSaves.regenerate` so the line says "+ 4 Regenerate" -- Bash's lesson again. The
combined budget showed up live: two Troll faces in one roll asked one question of 8.

**4. The fuzz reaches everything but one status in 200 games.** Regenerate both ways, Poison and
its burial, Net, Screech, Swamp Mastery and Foul Stench are `'every'`. Stun resolves in 200 but no
die failed its maneuver to it, so `effect:Stun` is `'full'` (18 in 1000). Foul Stench benching the
whole army -- planned as rare -- is the common case: 1,078 of 1,214 Foul Stench entries in 1000
games, because a random Goblin force's DUA fills fast and a defending army is often small. The
Death breath, keyed off the board since 0b, is now reached in 1000 games without a line of its own:
the Goblins summon Death dragons.

**5. The flip cost what 6f's did.** Five monster fixtures, and the counts of species, fixtures,
presets and palette dice. One test was a fact about four species: "some mixed force holds exactly
two species" -- with five in the data a 24-health mixed draw usually holds three or more, so it
says "more than one" now.

**6. Greedy finishes every Goblins mirror**, seeds 1 to 4, against passive and against itself: 40
games, all won. The 6f exit check, in `greedy.test.ts`.

**7. In the browser**, a Troll mirror against greedy (`?forces=goblins_troll&seed=3`): the home and
both Frontier proposals were earth dice. Greedy's Goblins attacked with a dead Troll in their DUA;
the offer read "Counter-attack? Foul Stench: you will pick 1 of your dice to sit it out", the sheet
lit only my three Trolls at that terrain and held Confirm until one was picked, the counter rolled
two dice, and the log read "Foul Stench: Troll may not counter-attack". Later my own attack rolled
two Regenerates: one question of 8, units only (an attack counts no saves), the Fallen area opened
on its own, and "Regenerate: You bring Troll back from the DUA to Frontier". No console errors. The
tiles draw their class shapes: the art manifest is 7f's.

**Deliberately not done.** The five spells and the Temple's readers are 7e's: until then the
Goblins roll Death magic with Resurrect Dead and Summon Dragon to spend it on.

### 7e — Death magic: the five spells — **landed**

- **Palsy** and **Decay** are `effect` blocks (Palsy on `'non_maneuver'`). **Finger of Death** is a
  handler straight into `killUnits` -- Firebolt's without `damageSubRoll`, since nothing rolls --
  with `minCount` from the target's health and `countScales` true. **Scent of Fear** is Mirage's
  handler without the save roll, aimed at opposing units only, 3 health-worth per casting, moved
  and not killed (Roar's fate: no death trigger, no Replanting). House rule (approved): its
  targets may stand at **several** terrains, Mirage's "any unit at any terrain" reading (section 15).
- **Soiled Ground** is an `Effect` on a terrain with `trigger: 'soiled_ground'`, Accelerated
  Growth's shape -- read by `killUnits`, which pushes onto 7b's `turn.burialDue` every unit killed
  *at that terrain* that reached the DUA. Both players' units: "any unit killed at that terrain",
  the caster's own included, which greedy's `HANDLER_VALUE` has to price. Not cumulative.
  - Order, all of it existing: Replanting first (never killed), the kill, Rise from the Ashes
    (risen means not in the DUA), the growth offer (exchanged means never killed), then the
    burial check on what is left -- and a Phoenix that fails it rolls Rise again on the way to the
    BUA. A kill-and-bury (Flame, the Temple, Fire breath) buries anyway and rolls nothing here.
- **The Temple wakes**: 7b's predicate gets its readers here, not in 7b (see *What 7b found*):
  the gather in `armyRoll`, spell targeting and Soiled Ground's hook. The death spell's element is
  read off the effect's `source` against the spell data and its caster off
  `expiresAtStartOfTurnOf`, so no `Effect` field is added. A test captures a Temple and aims every death
  spell at the holder: Palsy and Decay gathered and skipped, Finger of Death not offered, Soiled
  Ground's check skipped for the holder's dice and made for the other side's at the same terrain.
  Then the capture is lost and the standing Palsy bites again on the next roll.
- **Not death magic, and easy to misread as it**: a Death dragon summoned with death magic
  attacking the Temple's holder (the dragon's attack is not magic), and Resurrect Dead paid in death
  (it affects the caster's own dice).
- `RULES-V0.md` section 13's "the death-magic immunity is dormant" and section 12's "the Death
  dragon ships and is unreachable" both retire here, rewritten rather than deleted.
- Counts that move: 27 spells in the data, 10 species spells, and greedy's `HANDLER_VALUE` gains
  three lines (a spell greedy cannot score fails a test).

### What 7e found

Both golden corpora replay byte-identical and unregenerated. 1223 tests and the 1000-game fuzz
pass. The rules are in `RULES-V0.md` section 19, the tests in `goblins.test.ts` and one in
`dragons.test.ts`; each of the Temple's three readers was checked to fail its own test with the
reader undone.

**1. There were five copies of the result-type list, not four.** 7b found the Python validator
beside the three TypeScript ones; the JSON schema (`data/schema/spells.schema.json`) is a fifth,
and it refused Palsy's `'non_maneuver'` the first time the data used it.

**2. The spells were the shapes the table said, plus one new target kind.** Palsy and Decay are
`effect` blocks with no code. Finger of Death is a handler straight into `killUnits` with
`minCount` from the target's health. Soiled Ground is a terrain effect with a new scope, `'deaths'`,
which no roll gathers -- `killUnits` reads it and owes the check on 7b's `turn.burialDue`, which is
what that seam was built for. Scent of Fear needed `'opposing_units'`: Mirage's "units at any
terrain", the opponent's only. Greedy prices the three handlers; the two effect blocks it prices
through the one expander 7b made.

**3. Scent of Fear is one unit per casting** (`RULES-V0.md` section 19), Mirage's house rule, so a
monster takes two castings and three small dice take three. Written down rather than left to the
picker: it is a real loss, and the one Mirage already accepted.

**4. The fuzz had two requirements that were luck.** With the spells in, random games take new
paths, and two things that had always fired stopped: `charge_allocate` (0 in 200, 5 in 1000) is
`'full'` now, and the Death breath (reached in 7d's 1000, missed in this one) points at a named
test in `dragons.test.ts` -- a Death Drake breathing on an army, the army paying five health-worth
and keeping Dragon Plague. That test file had called the Death breath "unreachable by design",
which stopped being true at 7d. Soiled Ground is cast 17 times in 1000 games and no die ever died
on the soiled terrain in time, so its burial check is `{ elsewhere: 'goblins.test.ts' }` too.
Scent of Fear is cast once in 200 games: required, and the thinnest margin in the fuzz.

**5. The spell fuzz in `magic.test.ts` assumed "any" meant castable.** It requires every `any`
spell to be cast by Treefolk and Firewalkers, and neither rolls death magic. The death spells are
the live fuzz's, where the Goblins are; the filter says so.

**Not checked in the browser**: reaching a Goblins magic action needs a force with magic dice on a
magic face, which the monster mirrors rarely give; the spell picker is generic over target kinds,
and every new kind it meets is `'units'`, `'army'` or `'terrain'`. 7f's starter preset is the
board for it.

### 7f — Presets, exit checks, art — **landed**

- `goblins_starter` and `goblins_bestiary`, generated from the Dwarves' lists by class and size, as
  6h did.
- **Re-run greedy against passive and against itself** on Goblins mirrors and against every other
  species. Values to watch: Regenerate's units half (a Troll that rebuilds its army every roll),
  Scent of Fear (Roar's dead position again, by spell), and Palsy re-cast every turn (the
  "defensive buff priced as insurance" stall in reverse).
- **Art**: pins for the two maneuver images, from the owner's list of remote paths (2026-10-02):
  variant 1 for the heavy, light, missile and magic lines and the monsters, variant 2 for the
  cavalry. A dry run of `unit_candidates` against `assets/faces/goblins` without pins left 17
  maneuver faces matching both variants; with them, all 140 faces resolve to exactly one image.
  The missile line was missing from the owner's list and answered separately (2026-10-03). Every
  other icon, the SAIs included, has one image per face. Then `fetch_faces.py --offline` and the
  no-ambiguity check over 700 unit faces.
- Exit criterion as for every species, plus: a Goblins home is always an earth die (a test over
  seeds), a death spell is cast in the live fuzz, and the Death breath is reached live.

### What 7f found

Both golden corpora replay byte-identical and unregenerated. 1225 tests pass, and so does the
1000-game fuzz.

**1. The presets are the pattern, die for die.** `goblins_starter` (30 health: 10 / 11 / 9) and
`goblins_bestiary` (35: 14 / 14 / 7) were generated from the Dwarves' lists by class and size, so
neither is a hand count. The preset counts moved again: 35 on the start screen, five each of 30 and
35 health.

**2. Greedy finishes everything.** The starter and bestiary against every other species, both
ways, seeds 1 to 3, against passive and against greedy: 48 games, all won, now in `greedy.test.ts`.
A temporary sweep of 200 more with Goblins on both sides (starter and bestiary mirrors, against
passive and against itself) also ended every game with a winner, the longest at 914 decisions --
so none of the three values the plan worried about stalls a game. What greedy spends: Regenerate
brought dice back 108 times and took the saves 30; it cast Scent of Fear 54 times, Finger of Death
13, Decay 3, and Palsy 2,261 castings -- cheap, a Cantrip spell, cast every turn. It never cast
Soiled Ground: its price is only above nothing where the enemy stands alone, which a 200-game sweep
of mirrors did not offer. The sweep was deleted.

**3. Art: all 140 faces resolve, offline.** With the pins (maneuver variant 1 for every line but
the cavalry's), `fetch_faces.py --offline` mapped 700 unit faces with nothing ambiguous or missing,
from the copy already in `assets/faces/goblins`. In the browser every Goblins tile draws its
portrait, and the roll strip draws the Net face.

**4. Two games in the browser, to the end.** Goblins starter against the Dwarves starter (greedy):
a Swampland proposal for the Frontier (earth), a live Net on the counter-attack ("NET · A MANEUVER
OR BE NETTED", one die escaped, one netted), Swamp Mastery on the arithmetic line, and Foul Stench
benching the enemy's whole army twice -- then a loss, since the driver let every maneuver through.
Goblins bestiary against the Treefolk bestiary: a Death Mage's Cantrip offered Palsy beside Stone
Skin, cast twice at the army it was attacking, which showed its chip ("Palsy −2 melee, −2 missile,
−2 magic, −2 save") and its line on the save roll ("4 on the dice ± 0 Palsy = 4" -- every save
there came from a Counter face, and SAI results join at step 8, after step 6's subtractions). A
full magic action offered Palsy and Decay with water from the Standing Stones; Decay's chip and log
lines rendered. Poison and Regenerate fired too, and the game ended "You win" on turn 5. No script
errors in the console; the only errors were the dev server's reconnect attempts from before it was
running.

**5. One exit check was missing a test, and has one now:** a Goblins home is always an earth die,
over 60 seeds in both seats, and all three earth types turn up.

**Phase 7's exit criterion, checked.**
- Every Goblins mirror finishes in self-play (7d), and the starter and bestiary against every other
  species (7f).
- Every SAI, ability and spell fires in the live fuzz, within 200 games except Stun's status
  (1000). Four things random play does not reach are driven by named tests instead: Soiled
  Ground's burial check, the Death breath, Net's drop against a Tower's missile at Reserves, and
  the Temple's three readers.
- A mixed force with Goblins in it plays in one live-fuzz game in five.
- A Goblins starter game and a bestiary game were played to their end in the browser.
- The V0 goldens never moved. The V1 goldens moved once, in 7a, for the Replanting rule, and the
  commit says so.

### Deliberately out of this phase

- **Lava Elves' Death spells** (Necromantic Wave) and the Death spells of species after them (Evil
  Eye, Magic Drain, Open Grave, Exhume, Swamp Fever) -- each lands with its species.
- **Cursed Bullets** uses `duaCap` and 6b's spell saves, but is Phase 8's.
- **Ivory magic.** The rules let Ivory results cast only Elemental spells; no species in scope
  rolls it.

---

## Phase 8 — Lava Elves

Seven slices: 8a the data, 8b the seams, 8c Stone, Web and Cloak, 8d Charm and Illusion, 8e the two
abilities and the flip, 8f the two spells, 8g presets, exit checks and art. 8a has landed; 8b to 8g
are planned.

Death & Fire, the second species carrying Death. Like the Goblins they have **no own terrain type**,
so `drawHomeDie` draws them a home among the twelve dice carrying fire (Wasteland, Highland,
Feyland), and Volcanic Adaptation is live at every home they can draw. The faces are in
`data/raw/lava_elves.faces.txt` (20 dice, 140 faces, no `TODO` face), unimported. The images are
mirrored in the gitignored `assets/faces/lava-elves`: one ID per die, one image per SAI, and **one
maneuver image** (`maneuver-1-*`) -- the Firewalkers' case, so no maneuver pins are expected.

The roster matches p. 84: heavy Bladesman / Duelist / Conqueror / Beholder, light Scout / Spy /
Infiltrator / Drider, cavalry Spider Rider / Scorpion Knight / Wyvern Rider / Hell Hound, missile
Fusilier / Dead Shot / Assassin / Lurker in the Deep, magic Adept / Warlock / Necromancer /
Rakshasa. (p. 84 prints "Dead-Shot"; the raw file's "Dead Shot" gives the id `dead_shot` either
way, so this is only the display name.)

**What the faces actually carry.** Thirteen SAI names, **five new** (p. 85):

| SAI | Dice | Applies | Seam |
|---|---|---|---|
| **Stone** | Beholder | Dragon Attack, Melee, Missile | Smite's handler on two actions: "X damage to the defending army with no save possible"; X missile in a dragon attack |
| **Web** | Drider ×2 | Melee, Missile | Net with a **melee** sub-roll: "the targets make a melee roll. Those that do not generate a melee result are webbed and cannot be rolled or leave the terrain ... until the beginning of your next turn". Net's Tower-on-Reserves exception, word for word |
| **Cloak** | Lurker in the Deep | Dragon Attack, Individual, Magic, Save | "During a save roll or dragon attack, add X **non-magical** save results to the army containing this unit until the beginning of your next turn." X magic in a magic action; X of any one type "during a roll for an individual-targeting effect" |
| **Charm** | Beholder | Melee | **New.** "Target up to X health-worth of units in the defending army; those units don't roll to save during this march. Instead, the owner rolls these units and adds their results to the attacking army's results. Those units may take damage from the melee attack as normal." |
| **Illusion** | Rakshasa ×2, Beholder | Magic, Melee, Missile | **New.** "Target any of your armies. Until the beginning of your next turn, the target army cannot be targeted by any missile attacks or spells cast by opposing players." |

Reused: Smite, Counter, Bullseye, Cantrip, Flame, Fly, Confuse and **Volley** -- which is a Treefolk
SAI since v1 and needs nothing. Flame is **2** on the Beholder and the Hell Hound (confirmed when
the faces went in, commit a6def0a), so the Hell Hound's two Flame faces combine by name to four
health-worth. **The Beholder is this phase's Cannibal**: Flame, Charm, Stone, Confuse and Illusion on
one die, so its mirror is where Charm meets every other targeting SAI at once.

**Abilities** (p. 84): **Volcanic Adaptation** (at fire, maneuver counts as save -- Coastal Dodge's
row) and **Cursed Bullets** (below). **Spells**, read with PyMuPDF the 5e way (red `0xd12229` is
cumulative; the R and C columns off word positions on p. 84):

| Spell | Element | Species | Cost | R | C | Cumulative | Shape |
|---|---|---|---|---|---|---|---|
| **Necromantic Wave** | death | lava_elves | 5 | X | | no | `effect`: magic counts as melee or missile |
| **Fearful Flames** | fire | lava_elves | 3 | | | yes | Handler: Firebolt's damage, then a second save or flee to Reserves |

The Lava Elves also roll into everything already built for their two elements: Palsy, Finger of
Death and Soiled Ground (death, `any`), and every fire spell the Firewalkers cast. So their magic is
live the moment they are playable, with a far wider list than the Goblins had at 7d.

### Where the draft tables above are wrong for Lava Elves

- **Web is not "a status plus a new end condition".** Net built both: Web writes Sleep's status
  under its own name, exactly as Net does, and the Tower drop already exists. What is new is
  narrower and is shared with Charm: **no sub-roll in the game counts melee yet.** Every 4d sub-roll is
  a save or a maneuver roll, both of which reach SAIs whose effects are harmless there ("a Counter on
  it saves but sends no damage back"). A melee roll reaches Smite, Stone, Flame, Charm and Web
  themselves, every one an *effect* aimed at "the defending army" -- which, for a die rolling for
  its own life or for its enemy's total, is nobody, or its own side.
- **Charm is a sub-roll too, and its results join the attack, not a save roll.** The draft's "a die
  of one player's rolling for the other's total" is right, and it lands on two seams that exist:
  the targeting pause before the save roll (4b), where the charmed dice are chosen and rolled, and
  `RollSpec.saiResults` (step 8), where results that are not on the roller's faces already join a
  roll (Wild Growth's save share, Regenerate's). The new parts are the melee sub-roll above and **a
  bench for the save roll**: Foul Stench's `combat.benched` is read by `armyRoll`, and is the
  counter-attack's only. Charmed dice sit out the save roll (and a Charge's combination roll, which
  is that save roll) and **not** the counter -- "don't roll to save" says nothing about attacking.
- **Illusion's "restricts targeting, which no effect does yet" was true when written and is not
  now.** The Temple (7e) already filters `spellTargets` by a predicate on the target's army. Illusion
  widens that filter rather than starting a second one, and adds the reader the Temple never needed:
  `missileTargets` -- and through it the Tower's missile at Reserves, the forecast on every missile
  button and both AIs' target lists. It also reaches the one missile that is not an action:
  **Defensive Volley's counter** (5d) is a missile attack, so it is not offered against an
  Illusioned attacker. An Illusion on the defender cannot stop the attack it is rolled in -- the
  missile is already aimed -- only the next one.
- **Cloak is the first effect with a duration rolled on a save roll**, and the first written by the
  dragon combination roll. Sleep, Galeforce and the rest come off attack rolls, so `resolveSaves`'
  `expectOnly` and `resolveArmyRoll`'s refusal have never had to let one through: the Phase 4c
  lesson, a sixth time. "Non-magical" means **not a spell save** -- `fromSpell` is read off the
  effect's source, so a Cloak never reduces a riposte, a Charge or a cursed missile, with no field
  added. And the draft missed the Individual sentence, which is Net's from 7c with five types.
- **Cursed Bullets uses spell saves, but not the way Charge does.** Charge and the riposte are
  whole damage with no roll, reduced by `spellSaves`. A cursed missile is **part of** an attack the
  defender does roll saves against, so the damage splits in two pools in `finishExchange`, and the
  spell saves have to be found **inside** the save roll -- the roll's own `fromSpell` additions, from
  its `RollMath`, not a second gather. Three more facts the draft's line does not say: only
  **Lava Elves'** missile results curse, a per-die, per-species count in a mixed army (Flaming
  Shields' `species` key, not the army's); only at **the same terrain**, which a missile from one
  terrain to another, or a Tower's at Reserves, is not; and N counts **units** in the DUA, not health,
  capped by 7b's `duaCap(state, player, 3)`.
- **Volcanic Adaptation is Coastal Dodge's row, and `maneuverAsSaves` stamps "Coastal Dodge".**
  Swamp Mastery's lesson from 7d: the factory takes the ability's name, or a Lava Elf's save roll
  reads "counted as save (Coastal Dodge)".
- **Necromantic Wave is the first "counts as" that is not an ability**, and three things stand in
  its way. `ConvertibleType` is `'melee' | 'save' | 'maneuver'`, so neither magic nor missile can
  be named. A spell's `effect` block has no `counts_as` modifier kind -- and the spell modifier
  spec has **five copies** (7e found the fifth, the JSON schema). And "melee **or** missile" as two
  rows converts every magic result **twice** in a roll that counts both -- the dragon combination
  roll -- because `conversionsIn` applies each row whose target the roll counts. It is also
  beneficial, so it is `own_army` by 9a's rule, which means the Temple's immunity never meets it.
- **Fearful Flames is cumulative** ("one" is red), like Firebolt, whose handler it extends: N
  castings, N damage, `damageSubRoll`, and then a second save roll whose failure is **Roar's fate**
  -- moved to Reserves, not killed: no Replanting, no Rise from the Ashes, no Soiled Ground.
- **The monster SAI counts were unconfirmed** apart from Flame, which made them 8a's gate. The
  owner has since checked them (below).

### 8a — Data — **landed**

- **Gate: the monster SAI counts.** Every monster face in the raw file says 4, with no count in the
  source. Nine of the monster SAIs here read X -- Charm, Stone, Confuse, Web, Counter, Cantrip,
  Volley, Cloak and Fly -- so the owner checked them against the dice before import, as 6a and 7a
  did: **every one is 4** (confirmed 2026-10-05), and Flame is 2. Illusion takes no X. The raw
  file's header already says so; it loses its "not imported" note in this slice.
- `tools/species.py` gains `lava_elves` (the roster above) and `SPECIES_SAIS` gains Charm, Cloak,
  Illusion, Stone, Web (p. 85).
- **The Lava Elves are unplayable after this slice**, by `playable.ts`. `sai.test.ts`'s partition
  gains five deferred names; `playable.test.ts` gets its real refusal back with the exact sentence,
  a rolled Lava Elves force that throws, and a built force with a Bladesman that gets the sentence.
- Expected to move: the unit count (120 dice, 840 faces, six species), the SAI partition (45 in the
  data), the playable species, and any test naming "the only" die with an SAI the Lava Elves reuse
  -- 6a's Dispel Magic lesson; here Flame, Confuse, Volley and Cantrip each gain a die, and Flame a
  second monster printing 2.

### What 8a found

Both golden corpora replay byte-identical and unregenerated, and 1227 tests pass. `npm run data`
writes 120 dice and 840 faces with 45/45 SAIs in the data. Saving is off, so `SAVE_VERSION` has
nothing to be about.

**1. The gate the plan named was not the one that stopped the import.** The monster counts were
settled before the slice began; what failed was `validate_data.py`, which refused six faces as
"an implausible count": `5 MELEE` on the Conqueror and the Infiltrator, `5 MANEUVER` on the
Infiltrator, `5 SAI:Fly` on the Wyvern Rider, `5 MISSILE` on the Assassin and `5 MAGIC` on the
Necromancer. Its ceiling was a flat 4, written at the initial commit from the starter set, where
nothing prints more. **The faces are right and the ceiling was wrong.** It is the species'
signature, not six typos: every large Lava Elf has a 5 face and every medium one a 4 -- "4 on a
2-health die" was a lone Oak until now and is six faces here -- and 8g's own art note already expects a `fly-5` image on the Wyvern Rider. The
ceiling is now **health+2 on a non-monster** (3, 4, 5) and 4 on a monster, which the monster rule
pinned already. That is tighter than before on small dice and passes all six species; the
"more than health+1" warning stays, and now names thirteen faces.

**2. Three tests moved, not four.** All three are counts of the data: 120 unit dice and six
species, the SAI partition (45 names, five `deferred`), and the playable species -- the real
refusal again ("the SAIs Charm, Cloak, Illusion, Stone, Web and its species abilities"), with a
rolled Lava Elves force that throws and a built force with a Bladesman that gets the sentence. 8c
and 8d shorten it; 8e turns it back into "all playable". **No "the only die with" test moved**,
because the two that exist ask about SAIs the Lava Elves do not print (Dispel Magic, Sleep). The
plan's guess that Flame, Confuse, Volley and Cantrip would move a pinned list was a guess about
tests that do not exist: nothing pins those carriers. The fuzz's per-SAI counters read
`PLAYABLE_UNITS`, so they meet the new dice at the 8e flip, not here.

**3. Nothing else counted species.** The builder palette, the start screen, rolled forces and
the fuzz all read `PLAYABLE_SPECIES`, which still lists five, and "all reach a rolled force"
in `playable.test.ts` still expects exactly those five -- so it is now the test that says the
Lava Elves are kept out.

**4. The art resolver is not run in this slice.** `assets/faces/lava-elves` is not on this
machine (`assets/faces/` holds the four earlier species, terrain and dragons), so 8g's dry run
needs it mirrored first. The pins, if any, and the manifest are 8g's.

**Deliberately not done.** No fixture, preset or art manifest: a fixture for an unplayable species
could only throw (8e). No face count was changed to satisfy the validator.

### 8b — Seams, and no rule moves

1. **A melee sub-roll.** `rollUnits` counting melee, with the purpose a melee attack and
   `isSubRoll`, so an SAI's "during a melee attack" *results* apply (Counter's X melee, Rend's melee
   and its reroll). **Every effect it produces is dropped**, by one rule in one place rather than a
   whitelist that grows -- the 4d sub-roll rule ("a save roll against nothing") stated for a roll that
   does have an enemy in its sentence. Tested with a Smite, a Stone-shaped `unsavable` and a
   targeting face on the rolling die, each producing nothing. No caller until 8c.
2. **The save-roll bench.** `combat.benched` learns which roll it benches (the counter's, as now, or
   the save roll's), or a second field beside it -- 8b decides, by which is fewer sites. Read in
   `armyRoll` and nowhere else, so the save roll, a Charge's combination roll and `expectedArmy` all
   leave the dice out with no second door (7d's lesson). Built field by field, dropped with the
   attack half. Tested with a hand-set bench, as Stun's status was in 7b with no producer.
3. **The hold fate takes its SAI's name.** `fate: 'net'` writes `asleep` with `source: 'Net'`; it
   becomes a fate that carries the name, and the Tower-on-Reserves drop asks the fate, not the
   name -- or Web's drop is the one that was forgotten. The Goblins tests are the guard; nothing
   recorded has a Goblin.
4. **One targeting restriction.** An Effect status `illusion?: true` on an army at a place (the
   "army at a place" scope Galeforce uses: it does not follow the units), and one predicate --
   `shielded(state, by, player, ref, how)` for `how` in missile or spell -- that the Temple's death
   filter in `spellTargets` folds into. Readers: `missileTargets` (terrains and the Tower's Reserves),
   `spellTargets` (an army offer, and a unit offer for any die standing in a shielded army), and
   Defensive Volley's counter offer. Terrain offers are untouched. No producer; tested with a
   hand-built effect at each reader, each checked to fail with its reader undone.
5. **`ConvertibleType` gains `magic` and `missile`**, and `maneuverAsSaves` becomes a factory taking
   the ability's name. Both are pure widening: the v1 goldens have Flaming Shields in them and must
   replay byte-identical through it.

The two-pool damage is **not** an 8b seam. It has one caller, it is arithmetic in one function, and
built without Cursed Bullets it would be a pool that is always empty -- 7b's "code no test can reach"
finding. It lands with its ability in 8e.

### 8c — Stone, Web, Cloak

- **Stone**: Smite's handler, on a melee *or* missile attack, X missile in a dragon attack. A test
  that the `unsavable` path works on a missile exchange, where nothing has put it before -- and on
  a Tower's missile at Reserves.
- **Web**: `target_enemy`, escape `'melee'` (8b's sub-roll), the hold fate under Web's name. Melee
  and missile; the Tower drop. The UI's status map gains `'webbed'`, a label only (`sleepingIds`
  already locks the die, as for Net), and the sub-roll's log line says "a melee or be webbed".
  `RandomAI`'s retreat filter needs nothing: it asks `isAsleep`.
- **Cloak**, on three rolls:
  - **A save roll or the dragon roll: X saves now, and an effect for later.** The X joins the roll
    it was rolled in as ordinary SAI results (step 8), and an effect of +X save on "the army
    containing this unit" -- at its place, the roller as caster -- reaches every save roll after it
    until the roller's next turn. Not both on the same roll: the effect is written after the roll is
    resolved, so the roll that made it never gathers it. House rule (approved): **the roll Cloak is
    rolled in counts it.** The other reading -- the effect starts afterwards and this roll gets
    nothing -- makes a Cloak worthless against the attack that provoked it.
  - **A magic action**: X magic results.
  - **An individual-targeting roll** (any sub-roll, 7c's house rule): X of the type the roll counts,
    and no effect -- the specific sentence wins over "a save roll".
  - `expectOnly` in `resolveSaves` and the dragon roll's effect handling both let it through, in
    the same edit. Several Cloaks are several effects, so they stack across rolls; the chip counts them.
- `expectedFace` learns Stone (Smite's line) and Cloak's saves; a test pins both in `expectedArmy`.

### 8d — Charm and Illusion

- **Charm** is a `target_enemy` task with a new fate, `'charm'`, at the targeting pause, the attacker's, "up to X health-worth"
  held to p. 32's forced maximum like every other. Answering it rolls the targets through 8b's melee
  sub-roll, stashes their total on `combat.attack`, benches them for the save roll, and the attack
  is resolved with that total as `saiResults` named Charm -- "9 on the dice + 5 Charm = 14".
  House rules (approved):
  - **A charmed die rolls as a unit** (p. 28): no army modifier reaches it -- not its owner's
    Palsy, not the attacker's Fiery Weapon -- and its species ability does, so a charmed Firewalker
    at fire counts its saves as melee **for the enemy**. That is what "the owner rolls these units"
    gives literally, and it is the only reading that needs no new rule.
  - **Its SAIs give results and nothing else** (8b), so a charmed die's Smite does not strike its
    own army and its Charm charms nobody.
  - **It sits out the save roll and nothing after**: it may counter-attack, take the riposte's
    damage, and be Choked or Confused only if it was in a roll those can see -- which, sitting out the
    save roll, it is not.
  - **A die that cannot be rolled adds nothing**, by 4d's rule, and a stunned die rolls, by Stun's
    own exception for "an individual-targeting effect which forces them to". Charm is one.
  - **Against a Charge**, the charmed dice sit out the combination roll and add their melee to the
    attacker's -- 6e's roll is the save roll, so this needs no case of its own; a test says so.
  - The UI: a Charm is a stop, and its sub-roll is a roll stop of its own (3c's rule).
- **Illusion** is a friendly task, the attacker's (it applies only to attacks, so never the
  defender's), in the queue Wild Growth and the free moves use, and in the magic roll's. One new
  pending, `sai_illusion`: pick one of your armies -- any terrain or the Reserve Army, by 8b's
  "army at a place". It writes 8b's status until the roller's next turn. House rules (approved):
  - **Every Illusion face is its own choice**, not one combined choice: an Illusion has no X to
    combine, so two faces may shield two armies. Sleep's treatment, for Sleep's reason.
  - **No question when there is one army to shield**: the effect lands, and the log says so.
  - **"Cannot be targeted by spells" covers a unit spell aimed at a die in the army** -- Finger of
    Death, Lightning Strike, Firebolt, Mirage, Scent of Fear -- and not a terrain spell, whose
    target is the terrain. The Temple's reading, which is why one predicate serves both.
- `PassiveAI`, `RandomAI` and `GreedyAI` answer `sai_illusion`; the prompt lists armies as buttons,
  since an army is not a die (9f).
- `expectOnly` gains whatever kinds these two add. Every phase since 4b has had to be told.

### 8e — Volcanic Adaptation, Cursed Bullets, and the flip

- **Volcanic Adaptation**: a row in `COUNTS_AS_ABILITIES` at fire, through 8b's factory. A Feyland
  (water and fire) holding Coral Elves and Lava Elves in one army gathers two conversions of one pair
  under two names, each keyed to its species; `conversionsIn` already merges by source, and a test
  pins that the line names both.
- **Cursed Bullets**: automatic, since it can only help the attacker (Flaming Shields' house rule).
  On a missile attack at the attacker's own terrain:
  - **N** = Lava Elves **units** in the attacker's DUA, capped by `duaCap(state, player, 3)`.
  - **The cursed pool** C = min(N, the missile results Lava Elves dice show, the attack's total).
    House rule (approved): **only results on Lava Elves dice curse** -- an ID doubled by the eighth
    face is on the die and counts, a Fiery Weapon's +2 is on no die and does not.
  - **The arithmetic**, with S the defender's saves and P the spell saves inside S:
    damage = max(0, C − P) + max(0, (M − C) − (S − min(P, C))). Spell saves pay the cursed pool
    first, because only they can, and what they do not need joins the rest. When P ≥ C the curse
    changes nothing, which is the test that the formula is not a second rule.
  - `combat_resolved` gains `cursed?` (omitted when zero, the digest rule), and the line reads
    "8 missile − 3 saves, 2 cursed (spell saves only) = 5". `expectedAttack` learns it, so the
    missile forecast and greedy's target choice see it with no second site.
  - It applies to a Defensive Volley counter too -- a missile attack at the same terrain -- so a
    mixed army of Coral Elves and Lava Elves curses its counter. A test, since nothing else would.
- **The flip**: `SPECIES_ABILITIES` names the Lava Elves. Five monster fixtures (`lava_elves_*`),
  every test that counts species or fixtures, and the live fuzz's counters for the five SAIs, the
  new pending and the two abilities. Their death and fire magic is live immediately (above), so the
  Death breath and the death spells gain a second species in the fuzz.
- **Predicted fuzz reach**: Stone, Web and Cloak in 200 games (two Web faces on one monster, and
  Cloak on a monster that rolls often); Charm and Illusion in 200 as one face each on a monster,
  as Net was. Cursed Bullets needs a dead Lava Elf and a missile at the same terrain: expect 200.
  `{ elsewhere }` with named tests: Web's Tower drop, Illusion against a Tower's missile at
  Reserves and against Defensive Volley, Cursed Bullets on a counter, Charm against a Charge.

### 8f — Necromantic Wave and Fearful Flames

- **Necromantic Wave** is an `effect` block with a new modifier kind, `counts_as`, in every copy
  of the spell modifier spec -- the TypeScript type, the Python validator, the JSON schema and
  greedy's scorer at least; 7e found its last copy only when the data refused Palsy. Count them
  before writing the first one. Two rows, magic as melee and magic as missile, every species,
  `counter: 'either'`, `own_army`, castable from Reserves. House rules (approved):
  - **In a roll counting both melee and missile -- the dragon combination roll -- magic is
    flexible**, joining the ID pool that `dragon_allocate` already splits, rather than converting
    twice. Every other roll counts one of the two, and the row for the other does nothing.
  - **Cantrip's magic does not convert.** "Magic results that only allow you to cast Cantrip
    spells" are not magic results to spend on anything else; only a magic icon's count converts.
- **Fearful Flames**: Firebolt's handler, then, if the target is still alive and on a terrain, a
  second save sub-roll; no save result moves it to its Reserve Area. House rules (approved):
  - **"Saves against the damage" means survives it**, so a target with more health than the
    castings always rolls the second save. With fewer castings than its health the first roll
    cannot kill, which is the spell's point: it is a fear spell, not a damage one.
  - **A target already in Reserves rolls no second save**, and draws nothing: it has nowhere to
    flee.
  - Fleeing is Roar's fate, including Roar's ruling on a die that may not leave its terrain.
  - The second roll is a save sub-roll, so Net's and Cloak's Individual saves reach it (7c's rule).
- `HANDLER_VALUE` gains Fearful Flames; greedy's effect scorer learns `counts_as` (the value of the
  army's expected magic, moved into the type it will roll next). A spell greedy cannot score fails a
  test. Counts that move: 29 spells, 12 species spells.

### 8g — Presets, exit checks, art

- `lava_elves_starter` and `lava_elves_bestiary`, generated from the Goblins' lists by class and
  size, as 6h and 7f did.
- **Re-run greedy** against passive and against itself, on Lava Elves mirrors and against every
  other species. Values to watch: Illusion on an army nobody can reach (insurance priced as a gain,
  the 10b stall), Charm's targets (expected melee gained plus saves removed, not either alone), and
  Necromantic Wave re-cast every turn on a magic-heavy army.
- **Art**: a dry run of `unit_candidates` against `assets/faces/lava-elves` first. One maneuver
  image means no maneuver pins; what to check is **`flame-m` on a face printing 2**, the first
  monster SAI whose count is not 4 since the Gorgon, and `fly-1` / `fly-5` on the Wyvern Rider.
  Then `fetch_faces.py --offline` and the no-ambiguity check over 840 unit faces.
- Exit criterion as for every species, plus: a Lava Elves home is always a fire die (a test over
  seeds, all three fire types turning up), a Necromantic Wave is cast in the live fuzz, and an
  Illusioned army is refused a missile in a browser game.

### Deliberately out of this phase

- **The species after Lava Elves** (Amazons, Feral, Frostwings, Scalders, Swamp Stalkers, Undead)
  are not in this plan. Their raw faces are in `data/raw/`, and four of them still carry `TODO` faces
  the owner has to check against the dice before any of them is imported.
- **Ivory magic**, as in Phase 7.

---

## Risks

**The data is the long pole again.** About 560 faces, eleven spells and eight abilities, all read by
hand. Phase 7's traps still apply to the spells: two-column tables that `pdftotext -layout`
interleaves (use `-table`), and the *cumulative* marker in red, which no text extraction keeps.
Transcribe one species ahead of the code that needs it, so a species phase never waits on its data.

**Phase 1 is the phase people skip.** It delivers nothing visible, and Phase 2 is where mixed
forces appear. If Phase 1 is folded into Phase 2, every mixed-army bug arrives together with every
setup change, and the V1 goldens can no longer say which of the two moved them.

**Mixed armies make every "counts as" and every species check a per-die question.** v1 wrote them
when per-army and per-die gave the same answer. They compile either way, and a wrong one is only
visible in a mixed army, which no test built before Phase 1 contains.

**The seams in this plan are guesses from the rule texts.** Charge, Bash, Charm and Defensive Volley
each reshape the exchange, and v1's experience says the plan's table of fields will be short by a
few (Phase 5d's Tower was "two fields more than the plan's own table predicted"). Each species
phase's *b* slice is where to find out, before any SAI is built on top.

**`GreedyAI` gets weaker per species before it gets stronger.** Every new SAI and spell starts at
"score it roughly". A greedy that does not understand Charm is still an opponent, but it is a worse
test of the rules than it was of v1's. Re-run greedy against passive after each species, as v1's
notes say, to catch a scorer that has started to stall games.

**The landscape board may not fit a 36-health game.** Answered by 3a: it fits once identical dice
stack. The risk that is left is a varied force of few twins on a phone held sideways, which scrolls
a little rather than shrinking its tiles under the tap target.

---

## Not in this plan

- **The roguelike run** (v3): run structure, rewards, force-cap milestones, fixed encounters,
  specialized AI, saving turned back on. v2 builds every piece of it that is also the full game.
- **An AI that concedes.** A v3 encounter question.
- **The other species**: Amazons, Feral, Frostwings, Scalders, Swamp Stalkers, Undead, and the
  Eldarim. The pipeline this plan runs four times is meant to make each of them one phase.
- **Advanced rules**: minor terrain (and the species abilities that need it), advanced terrain,
  Dragonkin, Eldarim, equipment and other items.
- **Hybrid, Ivory, Ivory Hybrid and White dragons.** The dragon-targeting rule from v1 Phase 6 is
  still the simplification for elemental dragons only.
- **Art, animation and effects.** 3c builds the event queue an animation pass would consume; the
  unit art and the final look wait until the landscape board has been lived with.
- **Automated game-length measurement.** Pacing is tested live.
