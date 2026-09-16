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
- Three terrain types — **Swampland** (water+earth), **Highland** (fire+earth), **Wasteland**
  (air+fire) — each existing in four eighth-face variants (City, Standing Stones, Temple, Tower).
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
| **Dragons, Summoning Pool, Dragon Attack phase** | Needs the spell system (Summon Dragon) to even enter play. Phase 6 builds the dragon machinery and Phase 7 supplies the only way to summon one, so dragons are not actually reachable in a game until spells land. | v1 |
| **SAIs** | **25** distinct icons, many with delayed effects and targeting. Faces are *recorded* in the data as `<count> SAI:<Name>` but produce **zero results** under `sai: 'inert'` — that is 58 of the 280 faces, so roughly one die in five rolls a blank. **Twelve of the 25 are live under `sai: 'results'`** (§8), which is what the app now plays; `V0_RULES` keeps all 25 inert. | v1 (partly landed) |
| **Eighth-face icon powers** (City, Temple, Standing Stones, Tower) | Each is a separate subsystem. Which icon a die carries **is** recorded in the data; in v0 all four behave identically, so the choice is cosmetic. | v1 |
| ~~Eighth-face combat bonuses~~ | **Now in.** ID doubling and the melee-only restriction are implemented; see §5. | — |
| ~~**Buried Unit Area (BUA)**~~ | **Now in**, under `dua: 'active'` — see §9. `V0_RULES` still has no way to bury anything, and neither does the live rung until Phase 4's Flame. | — |
| ~~**Promotion / recruitment**~~ | **The machinery is in**, under `dua: 'active'` — see §9. Nothing calls it in a game until the City lands in Phase 5. | — |

| **Species abilities** | The *starter* book grants Treefolk/Firewalkers none, so against our release target there is nothing to implement. The full rules give each species two, plus a turn phase of their own that `Phase` does not model. | v1 |
| **Items, minor terrains, Dragonkin, Eldarim, multiplayer** | Advanced rules, far out of scope. | later |
| **Effects Expire phase** | Nothing in v0 creates a lasting effect. Kept as a no-op phase so the turn structure is already correct. | v1 |

## 3. Turn sequence

Per turn, for the **marching player**:

1. **Effects Expire** — no-op in v0. Present as a phase so nothing has to be inserted later.
2. **Eighth Face** — still a no-op *phase*: the holder's advantages are passive (§5), and the icon powers that would trigger here are cut.
3. **Dragon Attack** — no-op in v0 (no dragons).
4. **First March** — pick one army, then: Maneuver step (optional) → Action step (optional).
5. **Second March** — pick a *different* army, same two steps.
6. **Reserves Phase** — Reinforce step, then Retreat step.

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

Still cut: the Eighth Face Icon powers (City, Standing Stones, Temple, Tower) — `RuleSet.eighthFace`
runs `captureOnly` → `standard` (where v0 now sits) → `full`.

For an uncaptured terrain, faces run magic → missile → melee as the number rises, but the split
points differ sharply by terrain type:

| Type | Melee faces | Missile faces | Magic faces |
|---|---|---|---|
| Swampland | 5, 6, 7 | 3, 4 | 1, 2 |
| Highland | 6, 7 | 4, 5 | 1, 2, 3 |
| Wasteland | 4, 5, 6, 7 | 2, 3 | 1 |

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

**Missile** (any enemy army except Reserves; and not from one Home Terrain to the other):

1. Marching army rolls missile → `A`.
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

v1 Phase 0a needs the two proposals to differ, and with three types in the box element-matching
leaves no third option for either species, so each proposes **a second die of its own type**:
Swampland for Treefolk, Wasteland for Firewalkers, with the eighth-face icon (Tower at home, City
at the Frontier) separating the dice. Cosmetic until Phase 5 implements the icons.

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


Deliberately inert on this rung, each waiting on machinery a later phase builds: Bullseye, Cantrip,
Choke, Confuse, Dispel Magic, Double Strike, Firecloud, Flame, Galeforce, Seize, Sleep, Smother,
Wild Growth. They produce nothing and say nothing, which is what makes `'results'` playable rather
than a half-built `'full'`; `sai: 'full'` is the rung that refuses. **Bullseye and Double Strike
also say "roll this unit again"** — Rend is the only reroll implemented, so do not read Phase 1 as
having finished rerolls.

### House rules this rung adds

- **Damage is assigned in a fixed order, not simultaneously.** One melee exchange can now produce
  four separate assignments — the attack's damage, the riposte it drew back, the counter-attack's
  damage, and the riposte *that* drew back — and the rules make damage simultaneous without saying
  who picks first. v1 resolves them in that order. Nothing is lost by it: "if a die's results are
  used and it then leaves the army, its results still stand" (p. 27), so no ordering can change a
  number, only which army is asked first.
- **A riposte is wholly unsavable.** The rules allow it to be reduced by "save results generated by
  spells", and there are no spells until Phase 7, so there is nothing to reduce it by.
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
| **Burial** | Move units to the **Buried Unit Area**, from the DUA or straight off the board. For these two species there is no route out of it. |
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

## 10. Open questions


- **Army builder** in the alpha, or only the two 30-health presets? (Currently: presets only.)
  Still open, and deliberately outside `PLAN-V1.md` — an army builder is what makes *more species*
  worth having, so it belongs with them rather than with the rules.
- **Which terrain dice each species brings** — the choice in §7 is a guess at what plays well, not
  a rule, and Phase 0a's second-die-of-your-own-type is forced by there being only three types
  rather than chosen. Phase 5 adds three more and makes the eighth-face icon matter, at which point
  both halves become real decisions — including whether the Frontier should go on being a City.
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

- **All unit and terrain die data is transcribed** — 40 unit dice and 12 terrain dice, passing
  validation. **Two data gaps are now known and named**: terrain faces 1–7 for Coastland, Flatland
  and Feyland, and the dragon die face layouts. Neither is in either rulebook; both block v1 phases
  and neither may be inferred (`PLAN-V1.md` §5c, §6).
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
- **The Death dragon ships and is unreachable, deliberately.** `Summon Dragon` needs magic of the
  dragon's own element and neither species casts death magic, so it has no route onto the board in
  this matchup. All five elements are transcribed anyway, for data completeness — it becomes
  playable when a death-casting species arrives, and no house rule is added to reach it sooner
  (`PLAN-V1.md` Phase 6).
