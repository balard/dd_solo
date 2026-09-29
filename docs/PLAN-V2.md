# Implementation plan — v2

v1 finished the **complete basic game for Treefolk vs Firewalkers**. v2 opens the force up: any
dice, any mix of species, any size down to 12 health, built by hand or drawn from a collection. It
adds the first four species of the original release (Coral Elves, Dwarves, Goblins and Lava Elves),
which bring the fifth element, Death. It also gives the app a second, schematic pass and a
landscape board to try.

Read `PLAN-V1.md` for how the basic game got here, and its per-phase *Where this section was
wrong* write-ups before starting anything that touches the same seam. This document is the *order
of work*. **Phases 0 to 4 have landed** (Phase 3 as slices 3a to 3e, Phase 4 as 4a to 4c), each with its findings below;
the rest is still a draft, with predictions where V1 has findings.

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
3  The schematic board [landed] 5  Coral Elves       (the race pipeline, first run)
|                              |
4  The army builder [landed]   6  Dwarves
                               |
                               7  Death magic, then Goblins
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

## Phase 5 — Coral Elves — in progress

5a has landed: the data. 5b has landed: Hypnotic Glare's duration. 5c is in progress: Tail, Entangle,
Swallow, Ferry and Wave have landed; Hypnotic Glare is next.

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
