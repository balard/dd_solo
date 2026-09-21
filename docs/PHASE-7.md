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
| **7c** | The board spells: Hailstorm, Path, Resurrect Dead, Summon Dragon | |
| **7d** | The sub-roll spells: Mirage, Lightning Strike, Flash Flood, Wall of Thorns | |
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

## 7c -- the board spells

**Hailstorm, Path, Resurrect Dead, Summon Dragon** -- the four that touch existing subsystems rather
than adding one.

### Checklist

- [ ] the element picker: Resurrect Dead and Summon Dragon are the first spells with a choice of
      element, which 7b deliberately deferred
- [ ] Hailstorm: `assign_spell_damage`, reusing `assign_damage` and `applyAssignDamage`
- [ ] Path: `applySaiMove`'s movement shape, and the `own_unit` target
- [ ] Resurrect Dead: `recruit` is 1-health-only and the spell is cumulative -- a health-budget
      sibling, **not** a relaxed guard
- [ ] Summon Dragon: pool **or terrain** -> terrain, element must match; retires Phase 6's Frontier
      seed and the two `dragons.ts` simplifications (`:135`, `:171`)
- [ ] a vanished target is **dropped, not thrown on** -- first reachable here, when Hailstorm can
      empty the army a later cast named
- [ ] tests + fuzz with a per-spell counter > 0
