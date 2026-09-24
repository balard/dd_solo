# Dragon Dice — v0 (alpha) rule subset

This is the **normative spec for the alpha**. Where this document and the rulebooks disagree,
this document wins — the differences are deliberate. Everything cut here is cut to get to a
playable loop, not because it is unimportant.

Source of truth for everything else: `docs/rules/starter-treefolk-vs-firewalkers.pdf`
(the Kickstarter starter rules, our release target) with `docs/rules/dragon-dice-v4.01-full-rules.pdf`
as the fallback for anything the starter book leaves vague.

[`PLAN-V1.md`](PLAN-V1.md) is the ladder out of this subset, and its §10 lists every house rule
below together with the phase that retires it. **This document stays normative regardless**:
`V0_RULES` remains a playable configuration and is the regression baseline for every v1 phase.

---

## 1. What's in

- Two species: **Treefolk** (water + earth) and **Firewalkers** (air + fire).
- Unit dice: small (1 health), medium (2), large (3) — d6; **monsters** (4 health) — d10.
- Three armies per player: **Home**, **Campaign**, **Horde**, plus a **Reserve Area**.
- Six terrain types — **Swampland** (water+earth), **Highland** (fire+earth), **Wasteland**
  (air+fire), **Coastland** (air+water), **Feyland** (water+fire), **Flatland** (air+earth) — each
  existing in four eighth-face variants (City, Standing Stones, Temple, Tower). The terrain pool
  itself is not behind a `RuleSet` flag (Phase 5a/5b): even a `V0_RULES` game draws all three
  terrains from the seed, from all 24 dice. `eighthFace: 'standard'` is what keeps the icon powers
  themselves inert regardless of which four the board happens to draw.
- Three terrains in play: each player's **Home Terrain** plus one **Frontier Terrain**.
- Maneuver, including **contested maneuver rolls**.
- Melee (with counter-attack), Missile, and **simplified Magic** (§4).
- **Reserves Phase**: Reinforce then Retreat.
- **Dead Unit Area (DUA)**. Units killed go there; under `dua: 'active'` (§9) they can come back
  out of it.

- Capturing a terrain by maneuvering it to face 8. **Two captures wins.**
- Elimination of all enemy units wins.

## 2. What's out (and why)

| Cut | Rationale | Comes back in |
|---|---|---|
| **Spells / elements** | The entire spell list is the single biggest chunk of rules. Replaced by §4. | v1 |
| ~~**Dragons, Summoning Pool, Dragon Attack phase**~~ | **Now in, §14** — under `dragons: true`, which is what the app plays since Phase 6. `V0_RULES` has no dragons and its Dragon Attack Phase stays a no-op. | — |
| **SAIs** | **25** distinct icons, many with delayed effects and targeting. Faces are *recorded* in the data as `<count> SAI:<Name>` but produce **zero results** under `sai: 'inert'` — that is 58 of the 280 faces, so roughly one die in five rolls a blank. **Twelve of the 25 are live under `sai: 'results'`** (§8), which is what the app now plays; `V0_RULES` keeps all 25 inert. | v1 (partly landed) |
| ~~**Eighth-face icon powers**~~ (City, Temple, Standing Stones, Tower) | **Now in, §13** — Tower, City and Temple under `eighthFace: 'full'`, which is what the app plays since Phase 5e. Standing Stones stays inert until spells land in Phase 7; `V0_RULES` stays on `standard`, where all four icons still behave identically. | — |
| ~~Eighth-face combat bonuses~~ | **Now in.** ID doubling and the melee-only restriction are implemented; see §5. | — |
| ~~**Buried Unit Area (BUA)**~~ | **Now in**, under `dua: 'active'` — see §9. `V0_RULES` still has no way to bury anything, and neither does the live rung until Phase 4's Flame. | — |
| ~~**Promotion / recruitment**~~ | **The machinery is in**, under `dua: 'active'` — see §9. Nothing calls it in a game until the City lands in Phase 5. | — |

| ~~**Species abilities**~~ | **Coming in, §16** — under `speciesAbilities: true` (v1 Phase 8). The *starter* book grants Treefolk/Firewalkers none; the full rules give each two, plus a turn phase of their own, which `Phase` now models. `V0_RULES` has none. | — |
| **Items, minor terrains, Dragonkin, Eldarim, multiplayer** | Advanced rules, far out of scope. | later |
| **Effects Expire phase** | Nothing in v0 creates a lasting effect. Kept as a no-op phase so the turn structure is already correct. | v1 |

## 3. Turn sequence

Per turn, for the **marching player**:

1. **Effects Expire** — no longer a no-op: effects with a duration end here, at the beginning of their caster's next turn (§10). Nothing produces one yet, so in practice it still does nothing.
2. **Eighth Face** — no longer a no-op under `eighthFace: 'full'` (§13): a held City may recruit or promote, and a held Temple may force a burial. `V0_RULES` still sees a no-op, since the holder's advantages are passive (§5) and its rung never rises past `standard`.
3. **Dragon Attack** — no longer a no-op under `dragons: true` (§14): every dragon at a terrain where the marching player has an army attacks, whoever owns it. `V0_RULES` still sees a no-op, since it has no dragons at all.
4. **Species Abilities** — added in v1 Phase 8 (§16), and a pass-through for every species in
   this box: none of the four Treefolk and Firewalker abilities acts here. `V0_RULES` passes
   through it too, drawing nothing.
5. **First March** — pick one army, then: Maneuver step (optional) → Action step (optional).
6. **Second March** — pick a *different* army, same two steps.
7. **Reserves Phase** — Reinforce step, then Retreat step.

A march **may not** be taken with the Reserve Army in v0: it cannot maneuver (not at a terrain)
and magic from reserves is disallowed (§4), so it would have nothing to do. Reserve units move
only during the Reserves Phase.

**Win check runs after every state change**, not just at end of turn — capturing a second
terrain wins immediately, and so does killing the last enemy unit.

## 4. Magic — house rule (v0 only)

Replaces spellcasting entirely. Magic behaves like a saveless, uncounterable attack:

1. Choose a target army. **Same terrain as the marching army only.** Magic in v0 is a melee
   variant: same targeting, same restrictions.
2. The marching army rolls for magic results. Total = `M`.
3. **Damage = `floor(M / 2)`.** Two magic symbols per point of damage; a leftover odd symbol is lost.
4. **No save roll.** **No counter-attack.**
5. Resolve damage (§6).

**A Reserve Army may not take a magic action.** Since magic is the only action available to an
army in reserves, a Reserve Army effectively cannot march in v0 — it can neither maneuver (it is
not at a terrain) nor act. Reserves still matter through the Reserves Phase (§3.6).

Elements are ignored. ID icons still generate health-worth of magic results. Monster magic icons
still count as 4.

This lives behind a ruleset flag (`magic: "simplified"`) so switching to real spells is a config
change, not a rewrite.

## 5. Actions in full

The terrain's current face dictates which action is available — **unless the terrain is captured**,
in which case the eighth face overrides it entirely:

- The holding army **doubles all ID results** whenever it rolls at that terrain. This is every
  roll, not only attacks: saves and contested maneuvers double too.
- The holding army may take **melee, missile or magic**; any opposing army at that terrain is
  **restricted to melee**.

An action still needs something to hit, so a holder with no enemy present at the terrain is
offered only missile, and only if it can reach an army elsewhere.

**Now in, under `eighthFace: 'full'`** (the app's rung since Phase 5e): Tower, City and Temple —
§13. `V0_RULES` stays on `standard`, where the icon powers do nothing but the two advantages above
still apply; `RuleSet.eighthFace` runs `captureOnly` → `standard` → `full`.

For an uncaptured terrain, faces run magic → missile → melee as the number rises, but the split
points differ sharply by terrain type:

| Type | Melee faces | Missile faces | Magic faces |
|---|---|---|---|
| Swampland (water, earth) | 5, 6, 7 | 3, 4 | 1, 2 |
| Highland (fire, earth) | 6, 7 | 4, 5 | 1, 2, 3 |
| Wasteland (air, fire) | 4, 5, 6, 7 | 2, 3 | 1 |
| Coastland (air, water) | 6, 7 | 2, 3, 4, 5 | 1 |
| Feyland (water, fire) | 5, 6, 7 | 4 | 1, 2, 3 |
| Flatland (air, earth) | 5, 6, 7 | 2, 3, 4 | 1 |

This matters more in v0 than in the real game. With spells cut, a magic face is strictly weaker
than a melee face (§4 costs two symbols per point of damage and allows no counter-attack), so
**Wasteland plays as a high-lethality terrain and Highland as a slow one**. Worth keeping in mind
when reading early playtest feel — some of it will be the terrain, not the rules.

**Maneuver** (before the action, optional):

1. Marching player declares intent to maneuver, **without** stating the direction.
2. Any opposing army at that terrain may contest.
3. If contested: both armies roll maneuver, highest total wins, **marching army wins ties**.
4. If uncontested or the marcher wins: the marcher moves the terrain up or down one face.
   If the marcher loses, the terrain does not move.

**Melee** (same terrain only):

1. Marching army rolls melee → `A`.
2. If `A ≥ 1`, defending army rolls saves → `S`.
3. Damage = `max(0, A - S)`. Resolve (§6).
4. **Counter-attack**: defending army rolls melee → `B`.
5. If `B ≥ 1`, marching army rolls saves → `T`.
6. Damage = `max(0, B - T)`. Resolve (§6).

A defending army reduced to zero units does not counter-attack.

**Missile** (any enemy army except Reserves; and not from one Home Terrain to the other — **unless
the attacker holds a Tower right where they stand**, §13, which lifts both restrictions):

1. Marching army rolls missile → `A`. Against a Reserve Army, only non-ID results count (§13).
2. If `A ≥ 1`, defending army rolls saves → `S`.
3. Damage = `max(0, A - S)`. Resolve (§6). No counter-attack.

**Magic**: see §4.

## 6. Damage resolution — read this carefully

Dragon Dice does **not** track wounds. Damage kills whole units, and the **defender chooses which**.

> Move that many health worth of units into the Dead Unit Area. You must take as much damage as
> possible, but not more than needed. If a die takes less damage than it has health, the damage is ignored.

Formally: given damage `D` and army units with healths `h₁…hₙ`, the defender picks a subset `K`
such that `sum(K) ≤ D` and `sum(K)` is **maximal** over all such subsets. Excess damage is lost.

So this is a constrained subset-sum, and the defender has a genuine choice between equal-sum
subsets (which particular 2-health unit dies matters). The engine must:

- enumerate the maximal-sum subsets and offer them as a decision, and
- **reject** any assignment that has a legal sum but is not maximal.

Armies are ≤ 15 health and realistically ≤ 10–12 dice, so brute-forcing all subsets is fine.

*Example:* 5 damage against units of health 3, 2, 2, 1 → the maximum achievable is 5 (3+2, or 2+2+1).
Both are legal and the defender picks. Killing only the 3 is **illegal**.

## 7. Setup

1. Each player brings 30 health of units and 2 terrain dice.
2. Units are split into three armies; at setup each army has ≥ 1 die and ≤ 15 health.
   (The cap is lifted once play begins.)
3. One terrain is the player's Home Terrain; the other is their **proposed** Frontier Terrain.
4. Both players roll their Horde Army for maneuver. Most results chooses **either** to go first
   **or** which proposed Frontier Terrain is used; the other player gets the remaining choice.
   The unused proposed terrain leaves the game.
5. Roll each terrain in play: **re-roll 8s, turn 7s down to 6**. Terrains start on 1–6.

**v0 sidesteps step 4's choice entirely** by requiring both forces to propose the same Frontier
die — `setupGame` throws otherwise, saying in as many words that choosing between them is a setup
decision that does not exist yet. v1 Phase 0a makes it: the roll-off **winner marches first and the
loser sets the Frontier** from their own second terrain, which splits step 4's two prizes one each
without raising a decision `PassiveAI` cannot hold an opinion about. The real step 4 comes back
with `GreedyAI` (`PLAN-V1.md` Phase 9).

For the alpha, ship **two fixed preset 30-health army lists** (one per species) so a game can be
started in one tap. **v1 Phase 0a replaced them** with forces rolled from the seed — random race,
24 or 36 health, random units, random split — keeping named forces as the option tests and the
regression baseline use. A hand-driven army builder is still a later feature.

Preset terrains, matching each species to its own elements: Treefolk bring **Swampland** as their
Home Terrain and Firewalkers **Wasteland**. For the alpha both propose **Highland** — the only type
sharing an element with both — as their Frontier, which is what lets v0 sidestep step 4.

v1 Phase 0a needed the two proposals to differ, and with three types in the box element-matching
left no third option for either species, so each proposed a second die of its own type: Swampland
for Treefolk, Wasteland for Firewalkers. **Phase 5b replaced that with a draw**, now that Coastland,
Feyland and Flatland are in the data alongside Swampland, Highland and Wasteland (§5's table): each
Home Terrain is drawn uniformly from all 24 dice, and the Frontier is drawn from a terrain sharing
an element with the roll-off loser's species — one of the loser's two elements, then uniformly among
the dice carrying it, so the loser's own home type comes up about twice as often as the other three
it merely shares an element with. There is no longer a per-species profile to consult; "which
terrain a species brings" is answered by the seed, not by a table.

## 8. SAIs under `sai: 'results'` (v1 Phase 1)

`V0_RULES` is unchanged and still plays with every SAI inert. This section describes the rung
above it, `SAI_RULES`, which is what `npm run dev` and `npm run play` now use.

**X is the number printed on the face**, which is invariant 7 and needs no new machinery: `4
SAI:Smite` on a monster is four, `3 SAI:Smite` on an Oak Lord is three. **Each SAI applies only to
the rolls its `Applies` column names** (full rules p. 32): "If a type of roll is not listed ...
that SAI has no effect in that type of roll." So a Fly on a monster face is four unmissable icons
worth exactly nothing in a melee attack.

Live:

| SAI | What it does |
|---|---|
| Counter | Save vs melee: X saves **and X damage straight back at the attacker, who gets no save roll**. Any other save: X saves. Melee attack: X melee. |
| Volley | The same, one action across: save vs missile hits back; missile attack generates X missile. |
| Fly | X maneuver **or** X save — so nothing in an attack roll. |
| Hoof | X maneuver on a maneuver roll, X save on a save roll. |
| Trample | X maneuver **and** X melee. |
| Create Fireminions | X of whatever the roll is counting. |
| Smite | X damage on a melee attack, no save possible — and **no melee results**. |
| Surprise | The defender may not counter-attack. No effect during a counter-attack. |
| Rend | Melee attack: X melee **and roll the die again**, both faces counting. Maneuver roll: X maneuver, no reroll. |
| Firewalking, Teleport | X maneuver on a maneuver roll. Their free move is Phase 4. |
| Rise from the Ashes | X saves. Its death trigger needs `dua: 'active'` — §9. |
| Cantrip | X magic results **during a magic action**. Its other half — magic results that may only buy spells marked *Cantrip* — waits on Phase 7, and under simplified magic there is nothing to buy. |
| Dispel Magic | Nothing, in any roll: its `Applies` column is **Special**. It answers a spell being announced, and no spell is ever announced under `magic: 'simplified'`. |


Deliberately inert on this rung: Bullseye, Choke, Confuse, Double Strike, Firecloud, Flame,
Galeforce, Seize, Sleep, Smother, Wild Growth. They produce nothing and say nothing, which is what
makes `'results'` playable rather than a half-built `'full'`; `sai: 'full'` is the rung that refuses.

**All eleven are now built** (§11), and are inert here anyway, because the rungs differ in *which
SAIs exist* rather than in what any one of them does. `'results'` is the configuration Phase 1
shipped and it does not change under it. That includes the rerolls: **Bullseye and Double Strike
also say "roll this unit again"**, and on this rung they do not, because on this rung they do not
exist. Rend is still the only reroll `'results'` can produce.

**Cantrip and Dispel Magic moved onto this rung in Phase 4e, and that was a correction rather than
a feature.** Both had been filed as "needs spells" whole. Only Cantrip's *second* sentence does:
its first is "during a magic action, Cantrip generates X magic results", which is a plain result
generator that works under the magic house rule in §4, and it should have landed in Phase 1.

### House rules this rung adds

- **Damage is assigned in a fixed order, not simultaneously.** One melee exchange can now produce
  four separate assignments — the attack's damage, the riposte it drew back, the counter-attack's
  damage, and the riposte *that* drew back — and the rules make damage simultaneous without saying
  who picks first. v1 resolves them in that order. Nothing is lost by it: "if a die's results are
  used and it then leaves the army, its results still stand" (p. 27), so no ordering can change a
  number, only which army is asked first.
- **A riposte is wholly unsavable, and from v1 Phase 7 that is a house rule rather than a scope
  fact.** The rules allow it to be reduced by "save results generated by spells", which Watery
  Double and Stone Skin now are. v1 still applies a Counter's riposte as flat damage. Undoing it
  needs a way to tell a spell's modifiers from an SAI's -- `Effect.source` is a display string, so
  it would be a `fromSpell?: true` written by `spellEffect` -- plus a gather of the *attacker's*
  army's spell save bonus at `finishExchange`. Worth doing; not worth widening a verified slice for.
- **Rerolls are drained first-in, first-out**, in the order they were generated, after every die
  has been rolled once. With one Rend face on one unit type no other order is distinguishable
  today, but a recorded game depends on it forever.

## 9. The DUA under `dua: 'active'` (v1 Phase 2)

`V0_RULES` is unchanged: its DUA is still a graveyard, nothing is ever buried, and **killing a
unit rolls no die**. This section describes `DUA_RULES`, which is what `npm run dev` and
`npm run play` now use — `SAI_RULES` plus `dua: 'active'`.

Four movements exist, and only the last one happens in a game today:

| | Rule |
|---|---|
| **Promotion** | Exchange a unit for one in your DUA of the **same species and exactly one health larger**. With no such unit in the DUA, promotion simply does not happen. It is an exchange, not a stat change: the promoted unit's place in the DUA is taken by the unit it replaced. Class is not a constraint — an Oak may come back as a Noble Willow. |
| **Recruitment** | Move a **one-health** unit from the DUA into an army. Not an exchange; nothing goes back. |
| **Burial** | Move units from the DUA to the **Buried Unit Area**. For these two species there is no route out of it. A live unit is *killed and buried* — it passes through the DUA, which matters only for Rise from the Ashes, which then gets a roll at each step. |

| **Rise from the Ashes** | Whenever a unit carrying the SAI is **killed or buried**, roll it. A Rise from the Ashes face sends it to your **Reserve Area** instead. An effect that both kills and buries gives it two rolls, and a success on the first means it is never buried. |

Three rules govern every exchange with the DUA (full rules p. 31), and each has a test:

- Multiple exchanges resolve **simultaneously**: all partners are chosen before any unit moves, so
  a unit demoted into the DUA by an exchange can never be another pair's partner.
- An army whose **every** unit is exchanged is still considered present at its terrain.
- Exchanged units are **never considered killed**, so no death trigger fires on one.

**Nothing calls promotion or recruitment in a game yet.** The City (Phase 5), Temple (Phase 5),
dragon-slaying (Phase 6) and Resurrect Dead (Phase 7) are the four callers, and Flame (Phase 4) is
the only thing that buries. Rise from the Ashes is the one rule this rung switches on that a
player can actually see.

**Wild Growth is not on this rung**, though `PLAN-V1.md` originally placed it here. It lets the
roller split X between save results and promotions, which is a decision taken in the middle of a
roll — the seam Phase 4 builds for Bullseye, Choke and Confuse. It stays inert until then.

## 10. Effects with a duration (v1 Phase 3)

No ruleset gates this one. Phase 3 shipped it with **no caller at all**; **Phase 4c's Sleep and
Galeforce are the first two casters**, and they are on the `sai: 'full'` rung, so `state.effects` is
still empty in every game the app can currently play. The rules below are what every later duration
— dragon breath, and all eighteen spells — will be read against.

An effect targets **an army at a place** or **one unit**, carries roll modifiers and/or a status,
and ends at the beginning of its caster's next turn.

| | Rule |
|---|---|
| **Where an army effect lives** | At a location, not on the dice. March away and it does not follow you; arrive later and it applies to you anyway. |
| **When an army effect ends** | At the beginning of its caster's next turn — so it is live for the whole of the opponent's turn in between — or as soon as the army has no units left, checked at the end of each action. |
| **The exchange exception** | An army whose every unit is replaced in a single exchange is still present, so its effects survive. Nothing implements this: an exchange resolves in one pass, so no state with the army empty is ever observed. |
| **Where a unit effect lives** | On the unit. It follows it into another army, and ends with the unit if it is killed. |
| **Army modifiers and unit rolls** | "Modifiers that affect an army do not affect the roll of an individual unit from that army", and the reverse. Phase 4d's sub-rolls are the first rolls this can be got wrong on, and they gather through `unitRoll` rather than `armyRoll` for exactly that reason — §11. |
| **Stacking** | Two castings of a subtracting effect both apply — though Galeforce, the only SAI that subtracts, is never *combined*, so two of them stack only when the roller aims both at the same army. The only caps the rules state are **one divide and one multiply per result type**, which the pipeline already enforces — and the eighth face's ID doubling *is* that type's one multiplier. |

**Sleep is a status, not arithmetic.** A sleeping unit cannot be rolled and cannot leave the terrain
it stands on. It is otherwise entirely normal: still in its army, still counted for "the army is
present" and for holding a captured terrain, still a legal target for damage, and still killed like
anything else. Retreat is the only mover that has to refuse it — the Reinforce Step brings units
*out* of Reserves, and a march turns the terrain die rather than moving anybody.

## 11. Targeting SAIs under `sai: 'full'` (v1 Phase 4)

`sai: 'full'` adds the SAIs that pick targets. It is being built a slice at a time, and on this
rung an SAI that is not yet built **throws** rather than going quiet — the opposite of `'results'`,
where an unbuilt SAI is silently inert. That is the difference between a playable rung and a
half-built one: `'results'` is a game, `'full'` is a promise, and a promise that quietly does
nothing is worse than one that refuses.

**All eleven are built, and `FULL_RULES` is what the app and the CLI play** (v1 Phase 4e). Nothing
in `data/` throws on this rung any more; the refusal remains as the guard against a *new* SAI
arriving with a new species and going quietly inert instead.

| SAI | What it does |
|---|---|
| Flame | During a melee attack, target up to two health-worth of units in the defending army. The targets are killed **and buried** — they go to the BUA, not the DUA, and nothing brings them back. |
| Sleep | During a melee attack, target **one unit** in an opposing army at this terrain. It cannot be rolled or leave that terrain until the beginning of the roller's next turn. |
| Galeforce | During a melee or missile attack, or a magic action, target an opposing army at **any** terrain. It subtracts four save and four maneuver results from every roll until the beginning of the roller's next turn. |
| Bullseye | During a **missile** attack, target X health-worth in the defending army. The targets make a **save roll**; those generating no save result are killed. **Roll this unit again** and apply the new result as well. |
| Double Strike | The same, on a **melee** attack, for **four** health-worth — flat, not X, and the one face in the data says 4. |
| Smother | During a melee attack, target up to X health-worth. The targets make a **maneuver roll**; those generating no maneuver result are killed. |
| Firecloud | Smother, on a melee **or missile** attack. |
| Seize | During a missile attack, target up to X health-worth. **Roll the targets**: an **ID icon** moves that die to its owner's Reserve Area, anything else is killed. |

**The last five give their targets a roll of their own** (v1 Phase 4d) — the first unit rolls in the
game that are not the death trigger's. Four rules govern them, and only the first comes from the
rulebook plainly:

| | Rule |
|---|---|
| **No army modifiers** | "Modifiers that affect an army do not affect the roll of an individual unit from that army" (p. 28). A Galeforced army's −4 does not reach a Smother's maneuver roll, and the eighth face's ID doubling does not reach a Bullseye's save roll. |
| **A die that cannot be rolled fails** | A sleeping target generates nothing, so it generates no save either, and it dies. It draws no die on the way. |
| **The sub-roll is a save roll against *nothing*** | House rule. A Counter or Volley face on a Bullseye target generates its saves and sends no damage back — the narrow reading of "any other save roll", chosen because the wide one gives a sub-roll a damage channel the exchange has nowhere to put. |
| **Roll order is the board's** | House rule, and the same one `death.ts` follows: targets roll in the order they stand in, not the order the roller named them, so two players naming the same dice differently get the same game. |

**"Roll this unit again" is the roller's own die**, not the target's — Rend's sentence word for
word, so Bullseye and Double Strike reroll at step 3 of the attack roll, and a reroll showing the
same SAI again adds its budget to the same decision.

**An escapee is not killed**, so no death trigger fires on one. A Seized die that rolls its ID goes
to Reserves untouched; a Seized Phoenix that *fails* is killed like anything else and gets its Rise
from the Ashes roll.

### The delayed effects, and the first friendly SAIs (v1 Phase 4e)

| SAI | What it does |
|---|---|
| Choke | During a melee attack, **after the defender's dice land**: kill up to X health-worth of the units **that rolled an ID icon**, and count none of their results. |
| Confuse | During a melee or missile attack, at the same moment: **reroll** up to X health-worth of the defenders, "ignoring all previous results". |
| Wild Growth | During **any non-maneuver roll**: X save results, or promote X health-worth of units in this army, split however the roller likes. |
| Firewalking, Teleport | During any non-maneuver roll: this die **may move itself and up to three health-worth of its army to any terrain**. |

**The save roll is two steps, like the attack roll.** The rulebook's roll sequence puts Delayed
Effects at step 2 — "when rolling for saves against an attack, Delayed Effects are applied now" —
between the dice landing and anything being counted. Choke's targets are a fact about a *roll*
rather than about an army, and Confuse throws a rolled face away, so neither can be chosen any
earlier. A roll that earns no save roll at all (magic, or a zero attack) has no delayed effects
either: there are no dice to apply them to.

**Two rolls, two askers, one pause.** The attacker's Choke and Confuse are resolved first, then the
*defending* army's own Wild Growth and free moves — the rulebook's order, its step 2 then its step
4. They share one pause because nothing between them can be observed: no save roll in the game has
a step-3 reroll to come between them.

| | Rule |
|---|---|
| **Confuse replaces, it does not add** | Step 3's rerolls append a die and both faces count. Confuse's face is *gone*: the die is rolled again in place, and the first result was never rolled as far as the total is concerned. |
| **Choke's second half** | "None of their results are counted" — the die leaves the save roll as well as the army, and because it leaves before anything is counted there is no subtraction to get wrong. |
| **A promotion costs the health it gains** | House rule, and the one the rulebook leaves open. Wild Growth's "X health-worth" is spent on the *difference*: three buys three 1-health units their 2-health partners, or takes a single 1-health unit all the way to a monster. So a promotion here may jump several steps at once, unlike the ordinary one-step promotion in §9. |
| **What is not promoted is saved** | ...but only if a save roll is there to count it. On an attack roll Wild Growth's save results are generated in a type the roll does not count, so they are worth nothing; the split is still legal, and both clients say plainly that there is nothing to spend it on. |
| **Up to, including none** | The friendly rule (p. 29), and the opposite of the maximum every opponent-targeting SAI is held to (p. 32). A free move may carry nobody, and a Wild Growth may promote nothing. |
| **A free move is never combined** | p. 32 names SAIs "that move units out of the army" among the ones resolved one by one -- and a free move *is* a particular die, so there is nothing to merge it into. Choke, Confuse and Wild Growth all combine by name like the rest. |
| **A sleeping passenger stays** | Sleep is "cannot be rolled **or leave the terrain they currently occupy**". The mover itself can never be asleep, because a sleeping die never rolled the face. |
| **The dice that walk away have already rolled** | "If a die's results are used and it then leaves the army, its results still stand" (p. 27), so a defender may save with a die and march it out before the damage is assigned. |
| **A sub-roll generates no free move, and no promotion** | House rule. Phase 4d's sub-rolls are literally non-maneuver rolls, so Firewalking and Wild Growth apply to them by the letter -- but a die rolling for its own life has no army to promote into and no business marching three friends across the board, and the decision would be a pause inside a pause. Wild Growth still *generates its save results* there, which is what keeps a die holding that face from dying to a Bullseye. |

**All three are cast during the attacker's roll and take hold in that same exchange.** A slept die
is not in the save roll that follows it, and a Galeforced army saves at −4 in the very exchange that
caught it. That is the whole reason the engine splits an attack from its save roll into two steps.

**Sleep counts dice; everything else counts health.** "Target one unit" means one die whatever it
weighs — an Oakling and a monster are each one — so it is the one targeting SAI whose limit is not
a health budget.

### House rules this rung adds

Three, and the first two are about what the rulebook leaves to the roller.

- **Resolution order is roll order.** The rules let the roller choose which SAI to apply first
  ("apply their effects one by one in whatever order you choose", p. 27 step 4). v1 fixes it to the
  order the dice came up in — unit order, then step-3 rerolls, which is the order every other
  roll-derived list in the engine uses. The choice is only ever real when one SAI shrinks an army
  that a later one must then pick maximally from, and a "choose the order" decision would be a
  question `PassiveAI` could hold no opinion about.
- **Multiples of the same SAI always combine.** "Multiples of the same SAI may be combined to
  create a single larger effect" (p. 27) — *may*, and v1 always does. Combining is never worse for
  the roller: two Flames of two health-worth take nothing from a 3-health die where one Flame of
  four takes it, and the roller is forced to a maximum anyway, so the option is not a decision.
  The rulebook's exceptions (p. 32) are SAIs that target an individual unit or move units out of
  the army. **Sleep and Galeforce are both exceptions, for different reasons**: Sleep because p. 32
  names individual-unit SAIs, and Galeforce because two of them may legitimately name two different
  armies, so merging them would throw one away. The two free moves join them in Phase 4e.
- **An SAI that can take nothing raises no decision.** "Up to X health-worth" against an army whose
  smallest die is larger than X can absorb nothing at all, so nothing is asked. That is §6's rule
  about damage too small to kill, applied to the same arithmetic. It is the normal case for
  `2 SAI:Flame` against monsters, which is worth knowing before reading a Gorgon mirror as a bug.

### What is not a house rule, and is easy to misread as one

- **The maximum must be taken.** "When an SAI targets an opponent's army or units you must apply
  the SAI's effect to the fullest extent possible by selecting the maximum number of targets"
  (p. 32) — which is §6's damage rule word for word, so it shares `damageAssignmentProblem` and
  the same maximal-subset arithmetic. The *friendly* rule is the opposite ("any number ...
  including none", p. 29) and has no case on this rung; Wild Growth and the free moves bring it.
- **X is the number printed on the face.** Flame's reference text says "two", and both Flame faces
  in the data are `2 SAI:Flame` — so reading the count off the face agrees with the rulebook
  exactly. It is read rather than hardcoded because invariant 7 says the face already carries the
  answer. Here that number is a *budget*, not a result count.
- **The roller chooses, not the owner of the dice.** A targeting SAI is the first decision in the
  game addressed to somebody other than the player whose units are at stake.

## 12. Open questions


- **Army builder** in the alpha, or only the two 30-health presets? (Currently: presets only.)
  Still open, and deliberately outside `PLAN-V1.md` — an army builder is what makes *more species*
  worth having, so it belongs with them rather than with the rules.
- **Undo.** Architecturally free, but it lets you re-roll bad dice. Misclick-rewind only, or not
  at all in the alpha?
- **How the random force distribution should be shaped.** Phase 0a draws units uniformly over a
  species' 20 types, which is *not* uniform over health — each species has five dice at each of
  health 1–4, so a draw averages 2.5 and a force is ~10 dice at 24 health, ~14 at 36. Weighting
  small gives more, weaker dice and longer games; weighting large gives swingier ones. Untested
  either way until there is something to play.

Answered by `PLAN-V1.md` rather than here:

- **How much of the die data a game reaches.** The two fixed forces field one monster each, capping
  a game at 10 of the 25 SAIs. Phase 0a's random forces draw from all 20 dice of a species, so the
  monsters — and the other 15 SAIs — turn up on their own.

Resolved so far:

- **All unit and terrain die data is transcribed** — 40 unit dice and 24 terrain dice (all six basic
  types, Phase 5a), passing validation. **The dragon die face layouts are no longer an open
  question**: they are in neither rulebook, but both forms are now recorded in `PLAN-V1.md` Phase 6
  (Drake and Wyrm, twelve faces each, the same layout for all five elements). They still have to be
  imported into `data/` before that phase can run, which is work rather than an unknown.
- **Which terrain dice each species brings** — resolved by Phase 5b, and not by a per-species rule:
  each Home Terrain is drawn uniformly from all 24 dice, and the Frontier is drawn from a terrain
  sharing an element with the roll-off loser's species. There is no "should the Frontier go on being
  a City" question either, since which icon it carries is now a draw rather than a species choice.
- Magic targets **same terrain only** — it is a melee variant in v0 (§4).
- A Reserve Army may **not** take a magic action, and so cannot march in v0 (§3, §4).
- Capturing the eighth face wins and grants both standard advantages; no icon powers (§2, §5).
- **Magic rounding** — `floor(M / 2)` stands for `V0_RULES` and will not be revisited. The question
  expires rather than gets answered: v1 Phase 7 replaces the house rule with the real spell system,
  so there is no rounding left to tune. Tune it only if the alpha config is still being played.
- **The scope of "all the SAIs" and "all the spells"** is now exact, not approximate: 25 SAIs
  across 58 faces, and 18 spells castable by these two species. Both are enumerated in
  `PLAN-V1.md`.
- **Species abilities are in for v1.** Rapid Growth and Replanting for Treefolk, Air Flight and
  Flaming Shields for Firewalkers, plus the Species Abilities Phase that `Phase` does not yet
  model. The starter book grants none, so this is the one place v1 deliberately follows the full
  rules over the release target (`PLAN-V1.md` Phase 8).
- **The Death dragon ships and is unreachable, deliberately.** Phase 6 draws each player's pool
  colors from their own species' two elements, and Treefolk (water, earth) and Firewalkers (air,
  fire) cover four of the five between them; `Summon Dragon` could not fetch the fifth either, since
  it needs magic of the dragon's own element and neither species casts death magic. All five
  elements are transcribed anyway, for data completeness — Death becomes playable when a
  death-casting species arrives, and no house rule is added to reach it sooner (`PLAN-V1.md`
  Phase 6).

## 13. Eighth-face icons under `eighthFace: 'full'` (v1 Phase 5)

`V0_RULES` and `DUA_RULES` never see this rung; the app and CLI play it from Phase 5e on.
`resolvesIcon` is what a client asks whether an icon does anything in the game on screen, the same
way `resolvesSai` answers that question for a face — a table can only ever be right about one rung.

**Tower** — "your controlling army may use a missile action to attack any opponent's army. If
attacking a Reserve Army, only count non-ID missile results." Two rules:

- The home-to-home restriction (§5) does not apply, and a Reserve Army becomes a legal target,
  whenever the attacker holds a Tower **at the terrain they are attacking from** — a Tower held
  elsewhere lends nothing.
- Against a Reserve Army, ID results are worth nothing toward the missile total — not reduced, not
  redirected, simply not counted — whether or not the same roll is also doubling IDs for holding
  the eighth face there. The two are independent facts about the roll and do not interact.

**City** — "during the Eighth Face Phase you may recruit a small (1 health) unit to, or promote one
unit in, the controlling army." One or the other, once, and "may": both offers can be empty and the
answer can still be nothing. Recruiting moves a 1-health unit straight from the DUA to the
controlling army; promoting is the ordinary one-step exchange (§9), not Wild Growth's budget rule.

**Temple** — "your controlling army and all units in it cannot be affected by any opponent's death
magic. During the Eighth Face Phase you may force another player to bury one unit of their choice in
their DUA." Two decisions, because two players decide: the holder decides whether to force a burial
at all, and the opponent decides which of their own DUA units pays for it. Forcing is a real choice
and not a formality — an opponent's DUA holding a Phoenix means forcing them hands them a roll at
Rise from the Ashes they would not otherwise have had yet. The death-magic immunity is dormant: no
spell exists under `magic: 'simplified'`, so nothing has needed it yet.

**Standing Stones** does nothing at all on this rung, or any rung before Phase 7 gives magic its
elements back — it is a rules fact, not unbuilt work, and `resolvesIcon` gates it on `magic:
'spells'` rather than on `eighthFace`.

**At most one terrain fires per Eighth Face Phase.** Two captures win the game, so a player holding
two terrains has already won before this phase could ask about the second one. That is what lets the
phase be a single decision with no queue behind it — a future rule that changes what wins the game
is the one thing that would turn this into a queue.

**Losing the capture ends an icon's effect in the same step, because nothing about it is stored.**
Every icon power asks `iconAt(state, player, slot)` fresh each time, which answers non-null only
while the terrain is still on face 8 and still held by that player; there is nothing left over to
revoke when it changes.

House rule, alongside the Frontier draw (§7): both Home Terrains and the Frontier are drawn from all
24 dice rather than chosen by species, so which icon a board's terrains carry is chance rather than
a decision either side made.

## 14. Dragons under `dragons: true` (v1 Phase 6)

Five elements — Air, Earth, Fire, Water, Death — and only the **Elemental** dragon kind. Hybrid,
Ivory, Ivory Hybrid and White dragons are out of scope, which is what collapses the six-row
targeting table on p. 18 to the single rule below. Ten dice: 5 elements × drake and wyrm.

A dragon has **5 health and 5 automatic saves**, so an army needs **10 melee results or 10 missile
results** to kill one — never a combination of the two against the same dragon. Belly drops that to
5 for the attack it appears in.

**Three house rules**, all narrower than the rulebook and all recorded here:

1. **One dragon per player starts on the Frontier — retired in Phase 7c.** The rules keep every
   dragon in the Summoning Pool until `Summon Dragon` brings it out, and that is a spell — so
   without a seed the whole phase was unreachable. Setup drew one dragon at random from each
   player's own pool and placed it at the Frontier, and the trip was one-way, because nothing in
   Phase 6 summoned. **Under `magic: 'spells'` the seed is gone**: the pool keeps everything it
   drew and the base rules stand. It survives on the `dragons: true` rung, which still has no way
   to summon and would otherwise ship a Dragon Attack Phase no legal sequence of actions could
   reach.
2. **Pool colour is drawn from the player's own species elements**, not chosen freely as the rules
   allow. A force brings `ceil(health / 24)` dragons: a 2-dragon force gets exactly one of each of
   its species' two elements, a 1-dragon force draws between them, and the form (drake or wyrm) is
   drawn per dragon. This is why no game of Treefolk against Firewalkers ever fields the Death
   dragon — between them they cover the other four.
3. **Two orderings were fixed rather than chosen — both real since Phase 7c.** A dragon with more
   than one eligible dragon target now asks its owner, and the marching player chooses which
   terrain's dragons attack first. Neither could arise while at most two dragons were on the board;
   `Summon Dragon` is what made both reachable, and both are decisions now. Declarations are
   collected one player at a time and revealed together, in the sense that matters: nothing is
   shown to either client until every target is settled and the dice are thrown.

**Targeting.** A dragon attacks a *different-element* dragon at its terrain if one is there;
**same-element dragons never attack each other**; with no eligible dragon it attacks the marching
player's army — including the army of whoever summoned it.

**The attack**, in the rulebook's nine steps: targets, declarations, the dragons roll, breaths
resolve, treasures resolve, the army answers, damage lands both ways at once, a slaying promotes,
and the wings go home. **The army does not roll at all when every dragon is busy with another
dragon.**

**The Dragon Roll** is the army's answer: one **combination roll** counting melee, missile and save
at once, with the owner choosing what each ID result becomes and splitting it freely between the
three. It is its own listed roll type, so an SAI whose `Applies` column omits Dragon Attack does
nothing in it — Flame and Seize included. Seven SAIs name it and each has its own sentence: Smite
generates melee results here instead of unsavable damage, Bullseye and Double Strike generate
results instead of targeting, and Counter and Volley generate two types at once.

**Icons** (p. 20): Jaws 12 damage, Claws 6, Tail 3 and roll again, Wing 5 and fly home if it
survives, Belly disables that dragon's own automatic saves, Treasure promotes one unit of the army
it is attacking, Breath kills five health-worth plus its element's effect.

**The five breaths.** Air halves the army's melee, Earth its maneuver, Water its missile — each
until the beginning of that army's next turn, and each a `divide`, so two *different* halvings both
apply and two of a kind do not (§10, and pipeline step 7). Death makes the army ignore all its ID
results. **Fire is the odd one**: the five health-worth it kills die unconditionally, and only then
does each of them roll for a save icon — those that fail are buried, those that succeed stay in the
DUA. A Phoenix therefore gets its Rise from the Ashes roll on the way, exactly as §9 requires.

## 15. Spells under `magic: 'spells'` (v1 Phase 7)

`V0_RULES` never sees this rung; §4's magic house rule is what it still plays, and §4 is
**superseded rather than deleted** for exactly that reason -- it is the configuration the golden
corpus is recorded against.

A magic action is now: roll the army for magic, **announce every spell and every target at once**,
then resolve them one at a time in the order announced (full rules p. 13). Announcement and
resolution are separate steps because the rulebook makes them separate, and the gap between them is
where Dispel Magic will live.

**An army's magic is one number, not a per-element tally.** Each unit's magic results "may be
divided between that unit's elements", and a force is one species -- so the whole army's total is a
single pool the caster splits freely between its species' two elements. A single-element spell needs
magic of its own element; an Elemental spell takes any one element. That is the rule as written, not
a simplification of it, and it is what keeps the element out of the roll and in the casting decision.

**A spell no rung can resolve is never offered.** `resolvesSpell` answers for the rules being
played, the way `resolvesSai` and `resolvesIcon` do, and `castableSpells` filters on it -- so a
spell transcribed into `data/spells.json` without code behind it is silently uncastable rather than
a throw. That is the `sai: 'results'` lesson, not the `'full'` one.

**Combined castings are one spell with a bigger number**, not several spells: three Wind Walks add
twelve maneuver results as a single effect. Sixteen of the eighteen spells are cumulative; Lightning
Strike and Accelerated Growth are not, and a second casting of either on the same target does
nothing.

**Cantrip's second sentence opens a casting window inside another roll.** "During other
non-maneuver rolls, Cantrip generates X magic results that only allow you to cast spells marked as
`Cantrip'", and the starter adds "these spells are resolved immediately". So an exchange is
suspended, the spells are announced and resolved on the spot, and the exchange carries on. Six of
the eighteen are `C`-marked.

**Dispel Magic is the reason announcement and resolution are separate steps.** "You may roll this
unit after all spells are announced but before any are resolved" -- the only place in the game where
those come apart. It is on the Unicorn and nowhere else, so Firewalkers can never dispel; a roll
that hits negates every unresolved spell aimed at that unit, its army or its terrain, including the
roller's own side's.

**A Reserve Army marches again.** It may not maneuver -- it is not at a terrain -- and magic is the
only action it has, limited to the eight spells marked `R`. This is the last of section 4's house
rules to go.

### House rules this rung adds

- **Fiery Weapon gives both halves of "melee or missile" on a combination roll.** "Add two melee or
  missile results to any roll the target makes" is a choice, and every roll in the game counts
  exactly one result type -- so on a melee, missile, save or maneuver roll exactly one of the two
  can apply and the choice is made for you by the roll. The one exception is Phase 6's dragon
  combination roll, which counts melee, missile and save at once: there the army gets **both**
  additions rather than picking one. Expressing the real rule would need a fourth thing the roller
  allocates at `dragon_allocate`, for a case the rulebook does not call out.
- **A spell may be cast on a Reserve Army.** "Target any army" names it, and the Reserve Army is an
  army. Wind Walk on one is legal and useless, which is the player's business.
- **A spell whose cumulative number counts *targets* is offered one target at a time.** Path moves
  "one of your units" and Resurrect Dead returns "one health-worth"; combining castings on a single
  named target does nothing extra for Path, and buys a heavier unit for Resurrect Dead. Two units
  are two announcements, which is what the rules already provide for -- "any spell that has a
  cumulative effect may instead be cast multiple separate times, with a different target each
  time" -- so nothing is actually lost.
- **Wall of Thorns' melee roll offers no free move and no promotion.** By the letter Wild
  Growth, Firewalking and Teleport apply to "any non-maneuver roll", and this is one -- but it
  happens in the *maneuver step*, with no exchange to hang a decision on, so a promotion there
  would be a decision with nowhere to live. `RollContext.isTrigger` is what suppresses them, and
  it is a sibling of `isSubRoll` rather than a reuse of it: there a die rolls for its life with no
  army behind it, here an army really is rolling. Only the consequence is shared.
- **Accelerated Growth is taken automatically, not offered.** "You **may** instead exchange it with
  a one health Treefolk unit from your DUA" -- but `killUnits` is a pure transform called from eight
  places, and none of them can stop to ask. The "may" is exercised by choosing to cast the spell.

  Everything else about the spell is the rule as written: the trigger, the partner, one partner per
  dying die, the duration, and that an exchange is **not a death** -- no `units_killed` entry and no
  death trigger, which `deathEntries` enforces at every call site.

  *What undoing this would cost*, recorded so the decision stays legible: `killUnits` would return
  candidates rather than performing the exchange, and the choice would have to be raised by a step
  -- a new parked field, a `MarchStep`, a `DragonAttackStep` (dragon deaths are in that phase), a
  pending, an action, both AIs and both clients, with all eight callers routed through it. Folding
  it into the decision that caused the death is **not** a shortcut: only five of the eight have the
  victim deciding at all (the damage assignments, thorns, Hailstorm, a breath), and the other three
  -- Flame and the targeting sub-rolls, Choke, Lightning Strike -- are chosen by the attacker, so
  that route would leave three sites silently automatic and be worse than doing it uniformly.

  The choice being given up is small: the big die goes to the DUA either way, so the exchange buys a
  1-health die on the board for a 1-health die out of the DUA. That die is never a promotion partner
  (promotion takes one *larger*), only a City recruit or a Resurrect Dead target.
- **The dragon combination roll offers no promotion, free move or cantrip.** Wild Growth's `Applies`
  column is "Non-Maneuver", which a dragon attack is -- but the Dragon Attack Phase has no targeting
  queue to hang a decision on. Wild Growth still generates its save results there (the roll counts
  saves); the promotion half, the free moves and Cantrip's window are dropped. This was a *silent*
  drop from Phase 6 until Phase 7f, because `resolveArmyRoll` read the totals and ignored the roll's
  effects entirely; it refuses now, so the house rule is a decision rather than an accident.
- **A Flashfire reroll does not restart the reroll sweep**, so a Rend that comes up on one does not
  roll again. It is a step-3 reroll arriving after step 3 has finished.
- **Hailstorm's save roll offers no free move, promotion or cantrip either**, for Wall of Thorns'
  reason and by the same `RollContext.isTrigger`: a spell resolving out of an announced list has no
  exchange to hang a decision on. The roll itself is an ordinary army save roll and picks up
  everything sitting on that army -- a Stone Skin, an Ash Storm, the eighth face's ID doubling.
- **Resurrect Dead prices its target rather than its caster.** A unit's health *is* the number of
  castings it needs, so a 2-health unit costs six magic. That number rides on the offer, not in a
  rule the clients have to know, which is what stops either of them showing a target the engine
  will then refuse.

### What is not a house rule, and is easy to misread as one

- **Hailstorm allows a save roll, although its own sentence does not say so.** "When a unit takes
  damage it is permitted to make a save roll unless an effect states otherwise", and "attacks or
  spells that target an army allow the entire army to make a save roll" (p. 29). The general rule
  stands unless an effect displaces it, and every saveless number in this game says so on the face
  of it: a riposte, Smite's unsavable results, Wall of Thorns' melee roll *instead of* a save roll.
  **Phase 7c shipped without it**, which made Hailstorm the only damage in the game no save could
  touch.
- **Cantrip on a magic action opens no casting window, and that is the first sentence of the rule.**
  "During a magic action, Cantrip generates X magic results" -- ordinary magic, spent on the
  announcement like any other. The window is the *second* sentence, for any other non-maneuver roll,
  where there is no announcement to join. A Cantrip face in a magic action that seems to do nothing
  has in fact already added its X to the pool.
- **An announced target that is gone by the time the spell resolves is dropped, not re-aimed.** "If
  for any reason the announced target of a spell is no longer present, then you may not select a new
  target" (p. 13). The same shape as damage too small to kill anything.
- **"A melee roll instead of a save roll" settles two questions, not one.** Wall of Thorns' roll
  *counts* melee and its *purpose* is a save roll against nothing -- the distinction `RollSpec`
  has drawn since Phase 0b. As an attack roll a Smite on those dice would generate unsavable
  damage against an army that is not there; as "any other save roll" Counter and Volley generate
  their saves and no riposte, and those saves are in a type this roll does not count.
- **Flash Flood's red number is the resistance, not the step.** Two castings raise the bar to
  twelve maneuver results; they do not push the terrain down twice. "A terrain may never be reduced
  by more than one step during a player's turn from the effects of Flash Flood", so a second
  casting at the same terrain still rolls and still achieves nothing.
- **Flashfire is once per *roll*, not once in total.** "The target's owner may re-roll any one unit
  in the target army once ... This effect lasts until the beginning of your next turn." The "once"
  governs the reroll inside a roll; the duration governs how many rolls it reaches. So the effect is
  not spent when used, and two separate castings allow two dice in every roll.
- **Accelerated Growth and Rise from the Ashes can never meet.** Both fire on a death, and the rules
  do not order them -- but Rise from the Ashes is on the Phoenix and nowhere else, the Phoenix is a
  Firewalkers die, Accelerated Growth is Treefolk-only, and a force is one species. The ordering
  question cannot arise, and `magic.test.ts` checks that against the data rather than trusting it.
- **A terrain effect never ends early.** "If an army is destroyed ... any spells affecting that army
  end" is a rule about armies. A terrain cannot empty, so Ash Storm and Wall of Fog run their full
  duration whoever is standing there.

## 16. Species abilities under `speciesAbilities: true` (v1 Phase 8)

The full rules (p. 21) give each species two abilities. Treefolk have **Rapid Growth** and
**Replanting**; Firewalkers have **Air Flight** and **Flaming Shields**. Each is keyed on an element
the terrain "contains" -- the terrain die's *type* elements, so a Swampland contains water and
earth whatever its eighth face is. **The Reserve Area contains nothing**: it holds no terrain, so
no ability keyed on an element works there. That is the rule, not a house rule.

"Species abilities are applied to both army rolls and when a unit is rolling individually." In this
box no unit roll counts melee and none is a counter-maneuver, so that sentence adds nothing.

**The Species Abilities Phase does nothing for these two species.** The turn gains its seventh
phase, between Dragon Attack and the first march, but all four abilities fire somewhere else. It is
a pass-through for every ruleset, the goldens included.

**Flaming Shields** -- "when at a terrain that contains fire, Firewalkers may count save results as
if they were melee results. Flaming Shields does not apply when making a counter-attack." A
**"counts as"**, which p. 28 makes a modifier that adds at step 10.

- It applies to every melee roll the army makes at a fire terrain: a melee attack, Wall of Thorns'
  melee roll, and the dragon combination roll. It does not apply to a counter-attack, or to any
  roll that does not count melee.
- Only **rolled** save results convert: save icons, and the save results an SAI on the dice
  generates. "Results generated by spells may never be counted as another type", so a Stone Skin's
  saves never do. IDs never do either: in a melee roll they are already melee, and in a combination
  roll the owner allocates them directly.

**Replanting** -- "when at a terrain that contains water, Treefolk units that are killed should be
rolled before being moved to the DUA. Any units that roll an ID icon are not killed and are instead
moved to your Reserve Area."

- It triggers on every death, whatever the cause: damage, a breath, Flame, Choke, Hailstorm, Wall of
  Thorns. It is a look at a *face* (Seize's question, not a total), and a unit that does not qualify
  draws nothing.
- A replanted unit **was never killed**. No `units_killed` line names it, no other death trigger
  sees it, and a kill-and-bury does not bury it.
- It does **not** trigger on a burial out of the DUA. That unit was killed some time ago.

### House rules this rung adds

- **Flaming Shields is automatic wherever it can only help.** In a melee attack or Wall of Thorns'
  roll, saves do not count, so converting them costs nothing and every rolled save converts. In the
  dragon combination roll, saves defend the army against the dragon, so converting is a real trade:
  there the owner chooses how many, as part of the same decision that splits the ID results.
- **Replanting rolls before Accelerated Growth.** Both say "instead" and the rules do not order
  them. This is the order the owner would pick every time: Replanting costs nothing, and a unit it
  saves keeps the one-health die in the DUA that the exchange would have spent. Accelerated Growth
  itself stays automatic; §15 records what undoing that would cost, and nothing in this phase
  changes it.

### What is not a house rule, and is easy to misread as one

- **A sleeping Treefolk cannot come up.** Sleep is on Treefolk dice only and targets an opponent's
  unit, so no Treefolk is ever asleep, and "does a sleeping die replant?" has no case. `species.test.ts`
  checks that against the data.
