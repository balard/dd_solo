# Phase 7 — Spells: working file

**Temporary.** Deleted when 7f lands; its contents become the Phase 7 section of `PLAN-V1.md`.

`magic: 'spells'`. Retires the v0 magic house rule (`floor(M / 2)`, same terrain, no save, no
counter, no Reserve magic, elements ignored). Closes Cantrip's second sentence, Dispel Magic and
Standing Stones, and retires Phase 6's Frontier dragon seed.

## The slices

| | Scope | State |
|---|---|---|
| **7a** | The data and the seam: `data/spells.json`, `magic.ts`, `MagicState`, the march steps. No spell resolves. | **landed** |
| **7b** | The eight declarative spells, `EffectTarget.terrain`, and the whole client surface | **landed** |
| **7c** | The board spells: Hailstorm, Path, Resurrect Dead, Summon Dragon | **landed** |
| **7d** | The sub-roll spells: Mirage, Lightning Strike, Flash Flood, Wall of Thorns | **landed** |
| **7e** | The two triggers: Flashfire and Accelerated Growth | |
| **7f** | Cantrip, Dispel Magic, Standing Stones, Reserve magic, and the flip | |

## Standing rules for every slice

- The 25 goldens replay **byte-identical and unregenerated**. `git diff --stat src/engine/__golden__/`
  must be empty in every commit.
- `V0_RULES` keeps playing the v0 game; `magic: 'simplified'` is untouched.
- Every new field near `state.turn` is **optional-and-omitted**, never `0`/`false`/`[]` --
  `digestState` renders `stableJson(state.turn)` and four recorded games end mid-march.
- Each slice carries a targeted `RandomAI` fuzz: `stuck === 0` plus a trigger counter `> 0` for
  every rule it adds.
- `RandomAI` learns each new decision, or the fuzz narrows the way `reinforce`'s did.

## The eighteen spells

Sixteen are cumulative; Lightning Strike and Accelerated Growth are not.

| El | Cost | Spell | R | C | Slice |
|---|---|---|---|---|---|
| Air | 4 | Wind Walk | X | | 7b |
| Fire | 4 | Fiery Weapon | X | | 7b |
| Fire | 6 | Dancing Lights | | | 7b |
| Water | 2 | Watery Double | X | X | 7b |
| Earth | 2 | Stone Skin | X | X | 7b |
| Earth | 6 | Transmute Rock to Mud | | | 7b |
| Fire | 2 | Ash Storm | | X | 7b |
| Water | 6 | Wall of Fog | | | 7b |
| Air | 2 | Hailstorm | | X | 7c |
| Earth | 4 | Path | X | | 7c |
| Elem | 3 | Resurrect Dead | X | | 7c |
| Elem | 7 | Summon Dragon | | | 7c |
| Air | 5 | Mirage *(Firewalkers)* | | | 7d |
| Air | 6 | Lightning Strike | | | 7d |
| Water | 4 | Flash Flood | | | 7d |
| Earth | 5 | Wall of Thorns *(Treefolk)* | | | 7d |
| Fire | 3 | Flashfire *(Firewalkers)* | X | X | 7e |
| Water | 3 | Accelerated Growth *(Treefolk)* | X | X | 7e |

---

## 7a -- the data and the seam -- **landed**

**Delivered.** All eighteen spells transcribed into `data/spells.json` behind a schema and a
`check_spells()` in the validator; `src/data/spells.ts` as `presets.ts`'s sibling;
`src/engine/magic.ts` (the pool) and `src/engine/spells.ts` (`resolvesSpell`, an empty handler
table); `MagicState` on `turn.magic`; two new `MarchStep`s; the `announce_spells` decision in both
clients and both AIs; three new log entries. **No spell resolves** -- `resolvesSpell` is false for
all eighteen, so nothing is castable and every announcement is empty. The 25 goldens replay
byte-identical and **unregenerated**, and `magic: 'simplified'` plays exactly the v0 game.

### Where the plan was wrong

- **The magic action does not need its own roll.** The plan gave it six march steps of its own --
  `resolve_magic`, `sai_target_magic` and the rest -- on the reasoning that magic should never build
  a `CombatState`. But a magic action **is** an attack roll to the SAI reference ("during a magic
  action"), so a Galeforce, a Wild Growth or a free move on it must resolve exactly as on any other
  attack. Forking before the roll would have meant a second copy of the targeting queue, a second
  `expectOnly` whitelist and a second parked-dice pause -- the machinery Phase 4 built, rebuilt.
  So the roll reuses `resolve_attack` unchanged and the fork is at **`resolve_attack_damage`**:
  `finishExchange` hands off to `beginSpellcasting`, which clears `combat` by the same field-by-field
  rebuild and opens `turn.magic`. Two new march steps instead of six, and `validateState`'s
  `combat.attack` lifetime check still means what it says.
- **`dispel_magic` and `assign_spell_damage` are not 7a's.** Neither has anything to do until a
  spell resolves; they land with the slices that need them (7f and 7c).
- **`data/spells.json` uses `oneOf` on neither, not on both.** The plan wanted a schema `oneOf`
  requiring exactly one of `effect` / `handler`. A spell with **neither** is the honest state of a
  transcribed-but-unbuilt spell, and it is the same deliberate silence `sai: 'results'` gives an SAI
  it does not know -- which is what makes a rung playable instead of throwing. The schema forbids
  *both*; the validator reports how many are still unbuilt; `magic.test.ts` asserts the count, and
  that assertion inverts at 7f.

### What the browser caught that no test did

**"You do a Magic attack at Frontier".** Under `magic: 'spells'` a magic action attacks nothing at
all. Both clients rendered `action_chosen` as "does a `<action>` attack" because in v0 magic *is* a
melee variant. It reads "action" for magic now, in every ruleset -- accurate under the house rule
too, where it is still the magic *action* being taken. Found by flipping `useGame.ts` to
`SPELL_RULES`, playing one magic action at `?forces=bestiary&seed=11`, and reading the log; the
scaffold was reverted before the commit.

### What would have shipped silently

**`legalActions` refuses magic when no enemy is present.** v0 filters every non-missile action on
"is there something to hit", because v0 magic is an attack. Under real spells most spells target
your own army, so Stone Skin or Wind Walk on an army standing alone would have been unreachable --
a legal action quietly missing from the menu, with the game still valid and every test green. Fixed
in this slice and given a test of its own, plus its mirror asserting the v0 rung still refuses.

### Deliberately not done

- **`RandomAI` announces nothing.** `castable` is provably empty in 7a, so the empty announcement is
  the only legal answer rather than a narrowing. **7b must replace this in the same slice that makes
  a spell castable** -- an opponent that always announces nothing would never execute a spell across
  a thousand games, which is how `reinforce` lost its second dimension. The comment in `random.ts`
  says so at the call site.
- **No `SAVE_VERSION` bump.** Nothing the app plays changed: it is still on `DRAGON_RULES`, no
  recorded game can reach a magic action under `'spells'`, and the goldens prove dice consumption is
  untouched. The bump belongs to 7f, with the flip.
- The 1000-game fuzz still runs `V0_RULES`; this slice adds a 200-game `SPELL_RULES` one beside it.

### Verification

`npm test` 630 passed (25 files, was 611/24). `npm run typecheck` clean.
`git diff --stat src/engine/__golden__/` empty. `python tools/validate_data.py` OK, reporting all 18
spells transcribed and unimplemented. Fuzz: 200 `SPELL_RULES` games, `stuck === 0`, magic actions
> 0, and every magic action reaching an announcement.

---

## 7b -- the eight declarative spells -- **landed**

**Delivered.** `effect` blocks in `data/spells.json` for the eight spells that are a `Modifier` plus
a target; `EffectTarget` gained `terrain` with a `TerrainScope`; `armyRoll` gained `against` so Wall
of Fog can reach an attacker's roll; `spellEffect` folds combined castings into one scaled effect;
the whole client surface -- a two-tap spell picker in both clients, terrain effects on the terrain
card, three log lines. `RandomAI` announces a real random subset. 641 tests (was 630), goldens
byte-identical and unregenerated, `magic: 'simplified'` unchanged.

Ten spells remain transcribed-but-unbuilt, which the validator prints on every `npm run data`.

### Where the plan was wrong

- **`spellPlan` does not belong in `prompts.ts`.** The plan put the picker draft there, beside
  `reinforcePlan`. But `src/cli` has never imported from `src/ui`, and the terminal needs the same
  draft -- so `spellPlan`, `sameSpellTarget` and the `spellTargetLabel` join live in `magic.ts`
  instead, which is `saiPhrase`'s precedent exactly. What stayed in each client is only how it
  *names* a terrain, which is the one thing the two genuinely disagree about.
- **`TerrainScope` has two members, not three.** `'maneuverers'` is Wall of Thorns' and waits for
  7d with the code that gathers it -- the same rule that kept `terrain` itself out of `EffectTarget`
  until this slice.
- **Cumulative scaling is not "several effects".** Three Wind Walks are **one** `add` of 12, folded
  at cast time. Three separate effects would be arithmetically identical for `add` and `subtract`
  and would *throw* for a `divide` or `multiply`, which the pipeline caps at one per result type.
  Nothing in scope divides, so only the shape is load-bearing -- but it is the shape that stays
  right when something does.

### Two things that would have shipped silently

1. **`describeModifiers` had no `ignore_ids` case and an unannotated callback.** A missing `case`
   returned `undefined`, `join` rendered it as nothing, and the army header printed a source name
   followed by an empty half-sentence -- the exact bug `CLAUDE.md` records against `effectSummary`,
   repeated in the function next door. It has been wrong since Phase 6 and never showed, because the
   Death breath is unreachable in this plan's scope. The callback is annotated `: string` now, so a
   new `Modifier` kind is a build error there, and there is a test.
2. **`armyRoll`'s new `against` argument had four call sites and needed one.** All four attack rolls
   in `combat.ts` built the same `armyRoll(...)` call by hand; adding a fifth argument to four
   copies is three chances to forget it, and forgetting has no symptom -- the ward simply does not
   apply. They go through `attackerRoll(state, spec)` now, which is the only thing in the codebase
   that passes `against`.

### What the browser caught that no test did

- **"Stone Skin catches your army at Frontier".** The `effect_cast` verb was written for Sleep and
  Galeforce and reads as an ambush. Half the spells in Phase 7 are cast on your *own* army, so it
  says "settles on" now, in both clients.
- **"Cast 1" beside a staged "Stone Skin x2"** read as though the second casting had been dropped.
  It is "Cast 1 spell" now, which is the rules' own arithmetic: combined castings are one spell with
  a bigger number.
- **A stale `data/spells.json` in Vite's module graph.** Adding `effect` blocks to the JSON did not
  invalidate the transformed module, so the running app kept serving the version with none and the
  picker was empty while every test passed. Worth knowing in a project whose dice, terrains, dragons
  and now spells are all JSON: **a data-only edit may not reach the dev server.** Touching the
  importing `.ts` file forces it.

### Deliberately not done

- **Element is not yet a choice.** Every castable spell on this rung accepts exactly one of the
  caster's elements, so the picker takes `elements[0]`. The two Elemental spells that can offer a
  choice are 7c's, and the element picker lands with them.
- No `SAVE_VERSION` bump: the app still plays `DRAGON_RULES`.

### Verification

`npm test` 641 passed (25 files). `npm run typecheck` clean. `git diff --stat src/engine/__golden__/`
empty. `python tools/validate_data.py` OK, 10 spells still unbuilt. Fuzz: 200 `SPELL_RULES` games
across **both** force sets -- Treefolk can never cast an air or fire spell and Firewalkers never a
water or earth one, so a one-sided fuzz could only ever fire half the table -- `stuck === 0`, and a
per-spell counter `> 0` for every one of the eight, with nothing else ever cast.

Browser pass at `?forces=bestiary&seed=11` with `useGame.ts` flipped to `SPELL_RULES`: cast Stone
Skin twice at one army (combined to `+2 save` on the army header) and Wall of Fog at a terrain (drawn
on the terrain card as "-6 missile for anyone attacking here"). Console clean. The flip was reverted
before the commit.

---

## 7c -- the board spells -- **landed**

**Delivered.** Hailstorm, Path, Resurrect Dead and Summon Dragon -- the four that touch existing
subsystems rather than adding one. `SpellOutcome` lets a handler hand back a decision it cannot
raise itself; one new march step (`resolve_spell_choice`) rests on it. `returnFromDua` is `recruit`'s
health-budget sibling. **Phase 6's Frontier dragon seed retires** under `magic: 'spells'`, and the
two simplifications `dragons.ts` had been deferring since Phase 6 are real decisions now. The
element picker arrived with the two Elemental spells that first need it. 660 tests (was 641),
goldens byte-identical and unregenerated.

Six spells left: Mirage, Lightning Strike, Flash Flood, Wall of Thorns (7d), Flashfire, Accelerated
Growth (7e).

### Where the plan was wrong

- **A spell that owes a decision needs one march step, not one per spell.** The plan implied a step
  each for damage, movement and summoning. What differs between them is the *question*, which
  `SpellChoice` carries; where the machine stands while it is asked is the same place. So
  `resolve_spell_choice` is one member and `spellChoicePending` is the switch.
- **Hailstorm needed no new pending at all.** It reuses `assign_damage`, with `applyAssignDamage`
  branching on `turn.magic.choice` exactly as it already branches on `turn.dragonAttack`. One army,
  one number, the maximal-subset rule -- a second pending of that shape is one both clients would
  have had to learn twice.
- **`minCount` belongs on the offer, not in a validation rule.** The plan had Resurrect Dead's health
  budget as an announcement check. That is a rule the clients do not know, so both would happily
  show a target the engine then refuses -- and the fuzz proved it within a hundred games, throwing
  `Resurrect Dead returns 1 health-worth, and that is 2`. A unit's health *is* the castings it
  needs, so `SpellTargetOffer` carries it and every chooser respects it for free.
- **`spellTargets` is not the whole of "what may I aim at".** p. 13 says the target "**or the
  conditions for a spell's effect to occur**" must exist when it is selected. Summon Dragon is the
  first spell with a condition beyond its target: a terrain is only a target if a dragon of a colour
  this pool can pay for could actually reach it. Without that it was offered on a board with no
  matching dragon anywhere, quietly wasting seven magic.

### Two things that would have shipped silently

1. **`endTurn` spread the old turn state, so `dragonsDone` survived the turn that made it.** Turn two
   was told every terrain's dragons had already attacked, and they never attacked again for the rest
   of the game. Two Phase 6 fuzz counters caught it -- nothing else would have, because a dragon
   attack that does not happen is not an invalid state and breaks no total. `endTurn` **builds** the
   next turn now rather than spreading the last one: every transient field belongs to the turn that
   is ending.
2. **The four handlers existed and the data never named them.** `resolvesSpell` asks the data for a
   `handler`, and `data/spells.json` had none -- so all four were silently uncastable, with the
   engine, the clients and the AI all correct and a green suite. Caught by a fuzz counter that
   stayed at zero, which is the argument for per-rule counters in one line.

### What the browser caught, and what it could not reach

The whole Summon Dragon flow was played at `?forces=bestiary&seed=1` with `useGame.ts` flipped to
`SPELL_RULES`: the element picker ("pay for Summon Dragon with which element?"), the target, the
staged line, the summon sheet, and the log reading `Water Drake is summoned to Frontier from the
Summoning Pool` with the dragon appearing on the board row. Console clean; the flip was reverted
before the commit. No new bugs this time -- the sheets all render through the generic button path
that 7b already exercised, and the only new JSX was the element step.

**The two dragon decisions are not reachable by the fuzz** -- `dragon_order` needs two terrains
holding dragons with the marching player at both, and `dragon_target` needs three dragons of mixed
elements at one terrain, which two hundred games never produced. They have named tests instead,
which is what the plan's own rule asks for when a fuzz cannot reach a rule.

### Deliberately not done

- **Path moves the units it named to one destination.** Combining castings on a single target does
  nothing extra; two units are two announcements, which is what the rules already provide for.
  Recorded in `RULES-V0.md` section 15.
- No `SAVE_VERSION` bump: the app still plays `DRAGON_RULES`.

### Verification

`npm test` 660 passed (25 files). `npm run typecheck` clean. `git diff --stat src/engine/__golden__/`
empty. `python tools/validate_data.py` OK, 6 spells still unbuilt. Fuzz: 200 `SPELL_RULES` games
across both force sets, `stuck === 0`, **a counter `> 0` for every one of the twelve spells this
build resolves** -- an assertion that tightens on its own as each later slice moves a name out of the
unbuilt set -- plus a dragon summoned, a unit resurrected and a unit moved by Path.

---

## 7d -- the sub-roll spells -- **landed**

**Delivered.** Mirage and Lightning Strike put their targets through Phase 4d's sub-roll unchanged;
Flash Flood rolls the defending army against a threshold; Wall of Thorns is a ward that fires on an
event rather than on dice. `TerrainScope` gained `'maneuverers'` and `Effect` gained `thorns`, the
first field since `asleep` that is a status rather than arithmetic. **Sixteen of the eighteen spells
resolve**; only Flashfire and Accelerated Growth are left. 669 tests (was 660), goldens
byte-identical and unregenerated.

### Where the plan was wrong

- **Wall of Thorns' roll needed a `RollContext` flag, not just a purpose.** The plan asked which
  `RollPurpose` "a melee roll instead of a save roll" is, and the answer turned out to be *both
  halves separately*: it **counts** melee and its **purpose** is a save roll against nothing. That
  is not pedantry -- as an attack roll a Smite on those dice generates unsavable damage against an
  army that does not exist. But the purpose alone was not enough; see below.
- **`sai_sub_roll.sai` became `source`.** A spell can cause one now, and a field called `sai`
  holding `"Mirage"` is a small lie of exactly the kind this project keeps finding in its own log
  entries. Same rename the `Effect.source` field already carries.
- **Flash Flood needed no pending.** Its roll is the *defender's*, and by the time it has happened
  there is nothing left to decide -- so it returns a `SpellChoice` that is applied rather than
  asked about. Worth the one odd-looking member: the alternative was a handler reaching into
  `moveTerrain`, which lives in `turn.ts` for good reasons.

### What the browser caught, and no test did

**`Wall of Thorns' melee roll produced a wild_growth effect, which nothing reads`** -- a crash, on
the first game that actually maneuvered a warded terrain. By the letter Wild Growth applies to any
non-maneuver roll and this is one, but it happens in the *maneuver step*, where there is no exchange
to hang a promotion on. `RollContext.isTrigger` suppresses it and the free moves, and it is a
**sibling of `isSubRoll` rather than a reuse**: there a single die rolls for its life with no army
behind it, here an army really is rolling, and only the consequence is shared. House rule,
`RULES-V0.md` section 15.

That this got as far as a browser is the point. The engine tests all passed, the fuzz ran 200 clean
games, and Wall of Thorns fired in **two** of them -- neither with a Wild Growth face in the army.

**And the ward drew as `Wall of Thorns ·` with nothing after it.** It carries no modifiers at all, so
the generic `describeModifiers` path printed a source name and an empty half-sentence -- the same
shape 7b's missing `ignore_ids` case printed, arriving from the opposite direction. A ward whose
damage is invisible is a ward you cannot plan around, which is the entire reason effects are drawn
on the board. `describeTerrainEffect` switches exhaustively on the scope now.

### Deliberately not done

- **One unit per casting still**, for Mirage as for Path and Resurrect Dead. Mirage is the case
  where it costs something real -- "up to five health-worth" in a single casting could take two
  small dice, and here it takes one. Recorded in `RULES-V0.md` section 15 rather than left silent;
  the rules' own "cast multiple separate times, with a different target each time" is what makes it
  survivable.
- No `SAVE_VERSION` bump: the app still plays `DRAGON_RULES`.

### Verification

`npm test` 669 passed (25 files). `npm run typecheck` clean. `git diff --stat src/engine/__golden__/`
empty. `python tools/validate_data.py` OK, 2 spells still unbuilt. Fuzz: 200 `SPELL_RULES` games
across both force sets, `stuck === 0`, a counter `> 0` for **every one of the sixteen spells this
build resolves**, and both Flash Flood branches -- a terrain going down and an army holding one.

Wall of Thorns fired only twice in 200 games, so it has named tests instead: the ward modifies no
roll, separate castings sum, it bites an army that maneuvers the terrain, and it does not fire on a
terrain nobody warded. Browser pass at `?forces=bestiary&seed=1` with `useGame.ts` flipped to
`SPELL_RULES`, reverted before the commit; the flip also tripped `useGame.test.ts`'s "never starts a
game on a different ruleset", which is that test doing its job.

---

## 7e -- the two triggers

**Flashfire and Accelerated Growth**, and then 7f flips the app.

### Checklist

- [ ] Flashfire: the reroll **replaces** a parked face, `applyConfuse`'s mechanism pointed at the
      roller's own dice -- and it needs a pause wherever an army roll is parked (`combat.attack`,
      the save roll's delayed pause, `dragonAttack.armyDice`, and the magic roll)
- [ ] the effect is **spent**: `applyFlashfire` drops it from `state.effects`, so "used this roll"
      needs no flag on four parked objects
- [ ] the house rule: a Flashfire reroll does not restart the reroll sweep
- [ ] Accelerated Growth: a death trigger at `killUnits`, beside Rise from the Ashes;
      `exchangeWithDua` used *downward*, which `promote` forbids and the primitive allows
- [ ] it is **not a death**: no `units_killed`, no second trigger
- [ ] **open question:** it and Rise from the Ashes both fire on the same death, and the rules do
      not order them
- [ ] `EffectTarget` gains `player` (Accelerated Growth targets "your DUA")
- [ ] tests + fuzz with a per-spell counter > 0
