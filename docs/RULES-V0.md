# Dragon Dice — v0 (alpha) rule subset

This is the **normative spec for the alpha**. Where this document and the rulebooks disagree,
this document wins — the differences are deliberate. Everything cut here is cut to get to a
playable loop, not because it is unimportant.

Source of truth for everything else: `docs/rules/starter-treefolk-vs-firewalkers.pdf`
(the Kickstarter starter rules, our release target) with `docs/rules/dragon-dice-v4.01-full-rules.pdf`
as the fallback for anything the starter book leaves vague.

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
- **Dead Unit Area (DUA)**. Units killed go there and stay there.
- Capturing a terrain by maneuvering it to face 8. **Two captures wins.**
- Elimination of all enemy units wins.

## 2. What's out (and why)

| Cut | Rationale | Comes back in |
|---|---|---|
| **Spells / elements** | The entire spell list is the single biggest chunk of rules. Replaced by §4. | v1 |
| **Dragons, Summoning Pool, Dragon Attack phase** | Needs the spell system (Summon Dragon) to even enter play. | v2 |
| **SAIs** | ~30 distinct icons, many with delayed effects and targeting. Faces are *recorded* in the data as `<count> SAI:<Name>` but produce **zero results**. The starter set uses 12: Smite, Counter, Bullseye, Fly, Cantrip, Create Fireminions, Galeforce, Firecloud, Firewalking, Flame, Rise from the Ashes, Seize. | v1 |
| **Eighth-face icon powers** (City, Temple, Standing Stones, Tower) | Each is a separate subsystem. Which icon a die carries **is** recorded in the data; in v0 all four behave identically, so the choice is cosmetic. | v1 |
| **Eighth-face combat bonuses** (ID doubling; opponents restricted to melee) | Capture still wins the game, so the terrain race is intact without them. | v1 |
| **Buried Unit Area (BUA)** | Only reachable via SAIs, spells and Temple. Nothing can bury in v0. | v1 |
| **Promotion / recruitment** | Only reachable via dragon-slaying, Wild Growth and the City. | v1 |
| **Species abilities** | Starter rules grant Treefolk/Firewalkers none. Nothing to implement. | — |
| **Items, minor terrains, Dragonkin, Eldarim, multiplayer** | Advanced rules, far out of scope. | later |
| **Effects Expire phase** | Nothing in v0 creates a lasting effect. Kept as a no-op phase so the turn structure is already correct. | v1 |

## 3. Turn sequence

Per turn, for the **marching player**:

1. **Effects Expire** — no-op in v0. Present as a phase so nothing has to be inserted later.
2. **Eighth Face** — no-op in v0 (no icon powers).
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

The terrain's current face dictates which action is available. Faces run magic → missile → melee
as the number rises, but the split points differ sharply by terrain type:

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

For the alpha, ship **two fixed preset 30-health army lists** (one per species) so a game can be
started in one tap. The army builder is a v1 feature.

Suggested preset terrains, matching each species to its own elements: Treefolk bring **Swampland**
as their Home Terrain, Firewalkers bring **Wasteland**, and **Highland** — the only type sharing an
element with both — is each side's proposed Frontier Terrain. The eighth-face variant is cosmetic
in v0; pick any.

## 8. Open questions

- **Magic rounding.** `floor(M / 2)` is specified. `ceil` would make magic notably stronger;
  worth revisiting once the feel is testable.
- **Army builder** in the alpha, or only the two 30-health presets? (Currently: presets only.)
- **Which terrain dice the presets use** — the suggestion in §7 is a guess at what plays well, not
  a rule. Easy to change once there is something to play.
- **Undo.** Architecturally free, but it lets you re-roll bad dice. Misclick-rewind only, or not
  at all in the alpha?

Resolved so far:

- **All die data is transcribed** — 40 unit dice and 12 terrain dice, passing validation.
- Magic targets **same terrain only** — it is a melee variant in v0 (§4).
- A Reserve Army may **not** take a magic action, and so cannot march in v0 (§3, §4).
- Capturing the eighth face still wins; no icon powers and no ID doubling (§2).
