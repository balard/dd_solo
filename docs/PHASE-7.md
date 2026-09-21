# Phase 7 — Spells: working file

**Temporary.** Deleted when 7f lands; its contents become the Phase 7 section of `PLAN-V1.md`.

`magic: 'spells'`. Retires the v0 magic house rule (`floor(M / 2)`, same terrain, no save, no
counter, no Reserve magic, elements ignored). Closes Cantrip's second sentence, Dispel Magic and
Standing Stones, and retires Phase 6's Frontier dragon seed.

## The slices

| | Scope | State |
|---|---|---|
| **7a** | The data and the seam: `data/spells.json`, `magic.ts`, `MagicState`, the march steps. No spell resolves. | **landed** |
| **7b** | The eight declarative spells, `EffectTarget.terrain`, and the whole client surface | |
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

## 7b -- the eight declarative spells

### Checklist

- [ ] `effect` blocks in `data/spells.json` for the eight declarative spells
- [ ] `EffectTarget` gains `terrain` + `TerrainScope`, and `player` waits for 7e
- [ ] `armyRoll` gathers `all_armies`, and gains `against` for Wall of Fog
- [ ] `pruneEffects` switches exhaustively on the new kinds
- [ ] cumulative combining: three Wind Walks are one `add` of 12
- [ ] the spell picker as a pure draft in `prompts.ts` (the `reinforcePlan` pattern)
- [ ] `ActionBar` and CLI sheets; terrain effects drawn on the terrain card
- [ ] `describeModifiers` gains a case per new `Modifier`
- [ ] **`RandomAI` announces a real random subset** -- see 7a's "deliberately not done"
- [ ] tests + fuzz with a per-spell cast counter > 0
