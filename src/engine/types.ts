/**
 * Core engine types.
 *
 * Nothing here knows about React, the DOM, or which player is human. The engine is
 * a pure reducer over these values; see `docs/OVERVIEW.md` section 2.
 */
import { unitType } from '../data/load'
import type { DragonElement, DragonIcon, Element, ResultType } from '../data/types'

import type { DragonRoll, DragonTarget } from './dragons'
import type { Effect } from './effects'
import type { Castable, MagicPool, MagicSupplier } from './magic'
import type { DieRoll, RawDie, RollMath } from './roll'
import type { TargetTask } from './targeting'
import type { RngState } from './rng'

export type PlayerId = 'p1' | 'p2'

export function opponentOf(player: PlayerId): PlayerId {
  return player === 'p1' ? 'p2' : 'p1'
}

/** The three terrains in play. */
export type TerrainSlot = 'p1_home' | 'frontier' | 'p2_home'

export const TERRAIN_SLOTS: readonly TerrainSlot[] = ['p1_home', 'frontier', 'p2_home']

/**
 * Where an army can be. An army is *derived* from this -- "player P's units at slot
 * S" -- rather than tracked as an entity, which is why Home, Campaign and Horde are
 * setup vocabulary only and cannot drift out of sync with unit positions.
 */
export type Location =
  | { readonly kind: 'terrain'; readonly slot: TerrainSlot }
  | { readonly kind: 'reserve' }
  | { readonly kind: 'dua' }
  /** The Buried Unit Area. Reachable only under `dua: 'active'`, and one-way: for
   *  Treefolk and Firewalkers nothing brings a buried unit back. */
  | { readonly kind: 'bua' }


/** An army for the purpose of marching: a terrain, or the Reserve Area. */
export type ArmyRef = TerrainSlot | 'reserve'

export type UnitId = string

export interface UnitInstance {
  readonly id: UnitId
  /** Key into the unit type data, e.g. `treefolk.oak_lord`. */
  readonly typeId: string
  readonly owner: PlayerId
  readonly location: Location
}

export type DragonId = string

/**
 * Where a dragon is.
 *
 * Not a `Location`: a dragon is never in Reserves, the DUA or the BUA, and a unit is
 * never in a Summoning Pool. Two small unions rather than one wide one, so neither
 * side has members the other has to keep remembering are impossible.
 */
export type DragonLocation =
  | { readonly kind: 'pool' }
  | { readonly kind: 'terrain'; readonly slot: TerrainSlot }

/**
 * A dragon in the game -- in its owner's Summoning Pool or at a terrain.
 *
 * **`owner` is not "whose side it fights on".** A dragon attacks the marching
 * player's army whoever brought it, its own summoner included (full rules p. 17), so
 * this says whose pool it came from and who rolls it, and nothing else. It is
 * deliberately not the `owner` of an army.
 *
 * There is no health field, for the same reason a unit has none: damage does not
 * accumulate between attacks. A dragon takes 10 melee or 10 missile *in one attack*
 * or it is untouched, and when it dies it goes back to the pool.
 */
export interface DragonInPlay {
  readonly id: DragonId
  /** Key into the dragon die data, e.g. `fire_drake`. */
  readonly dieId: string
  readonly owner: PlayerId
  readonly location: DragonLocation
}

export type TerrainFace = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/**
 * The roll-off choice while it is open (v1 Phase 10e). See `GameState.rollOff`.
 *
 * `firstTurnTaken` is the one step it has: the winner took the first turn, so the loser
 * is choosing the Frontier now. Optional-and-omitted, like every field near the digest.
 */
export interface RollOffState {
  readonly winner: PlayerId
  /** Each player's proposed Frontier die, drawn from a terrain sharing an element
   *  with their species. */
  readonly proposals: Readonly<Record<PlayerId, string>>
  readonly firstTurnTaken?: true
}

export interface TerrainInPlay {
  readonly slot: TerrainSlot
  /** Key into the terrain die data, e.g. `swampland_tower`. */
  readonly dieId: string
  readonly face: TerrainFace
  /** Non-null exactly when `face === 8`. */
  readonly capturedBy: PlayerId | null
}

/**
 * Turn phases, including the three that do nothing in v0.
 *
 * The no-ops are real phases rather than omissions: they are where dragons, eighth-
 * face powers and spell expiry land, and leaving holes now would mean restructuring
 * the turn loop later.
 */
export type Phase =
  /**
   * Before the first turn, under `rollOff: 'choice'` only: the roll-off winner is
   * choosing the first turn or the Frontier, and no starting face is rolled yet. See
   * `GameState.rollOff`. Every other game starts on `effects_expire`, as it always did.
   */
  | 'setup'
  | 'effects_expire'
  | 'eighth_face'
  | 'dragon_attack'
  /**
   * The Species Abilities Phase (full rules p. 11, step 4), since v1 Phase 8.
   *
   * **A pass-through for every species in this box.** Treefolk and Firewalkers have
   * four abilities between them and none acts here: Rapid Growth fires on a
   * counter-maneuver, Replanting on a death, Air Flight in the Retreat Step and
   * Flaming Shields in a melee roll. The phase exists because the turn has seven, and
   * because the abilities that *do* live here (Feralization, Winter's Fortitude,
   * Mutate) belong to species outside the plan.
   */
  | 'species_abilities'
  | 'march'
  | 'reserves_reinforce'
  | 'reserves_retreat'
  | 'game_over'

/**
 * Steps within a march.
 *
 * Maneuvering is three separate steps because the rules make it three separate
 * decisions, in this order: the marcher declares intent *without* saying which way,
 * the opponent decides whether to contest, and only then is the direction chosen.
 * Collapsing them would leak the direction to the contesting player.
 */
export type MarchStep =
  | 'select_army'
  | 'declare_maneuver'
  | 'contest_maneuver'
  /**
   * Rapid Growth (v1 Phase 8), between the contest's dice landing and its result.
   *
   * The only pause inside a maneuver. The counter-maneuvering Treefolk may reroll the
   * dice that did not roll an SAI, having seen both rolls -- so both are parked on
   * `turn.contest` and the contest is decided only once the answer is in.
   */
  | 'rapid_growth'
  | 'choose_direction'
  | 'action'
  // Combat, once an action is chosen. The `resolve_*` steps take no decision --
  // they roll and compute -- but are still explicit states so the advance loop has
  // somewhere to stand, and so a v1 SAI with a delayed effect has a seam to occupy.
  | 'choose_target'
  // An exchange is two steps, not one: the attacker rolls, and only then does the
  // defender. A targeting SAI is chosen *between* them -- Sleep takes a die out of
  // the save roll that follows and Galeforce subtracts from it -- so the seam has to
  // be a real state the machine can rest on, not a local variable.
  | 'resolve_attack'
  // Flashfire, step 3: "the target's owner may re-roll any one unit in the target
  // army once, ignoring the previous result". Before the SAIs rather than after,
  // because the rulebook applies rerolls at step 3 and SAIs at step 4 -- and because
  // a die that changes after the targeting queue was built would leave it stale.
  | 'flashfire_attack'
  | 'sai_target_attack'
  // And the save roll is two steps for the same reason the attack was: the rulebook's
  // step 2 is "when rolling for saves against an attack, Delayed Effects are applied
  // now", and Choke's targets are "units that rolled an ID icon" -- a question that
  // cannot be asked until the save dice are on the table and must be answered before
  // anything is counted.
  | 'resolve_attack_saves'
  | 'flashfire_attack_saves'
  | 'sai_delayed_attack'
  // Charge (v2 Phase 6e): the defender's combination save and melee roll is down and
  // its delayed effects resolved; now it says where its IDs go. The attack half only --
  // "Charge has no effect during a counter-attack".
  | 'charge_allocate'
  | 'resolve_attack_damage'
  | 'assign_attack_damage'
  | 'assign_attack_riposte'
  | 'offer_counter'
  | 'resolve_counter'
  | 'flashfire_counter'
  | 'sai_target_counter'
  | 'resolve_counter_saves'
  | 'flashfire_counter_saves'
  | 'sai_delayed_counter'
  | 'resolve_counter_damage'
  | 'assign_counter_damage'
  | 'assign_counter_riposte'
  // A magic action under `magic: 'spells'` (Phase 7). The *roll* is an ordinary
  // attack roll and reuses the steps above -- "during a magic action" is what the SAI
  // reference calls it, so a Galeforce or a Wild Growth on it must resolve exactly the
  // way it does on any other attack. What differs begins where the damage used to:
  // `resolve_attack_damage` hands off to these instead of assigning any.
  //
  // Announcement and resolution are separate steps because the rulebook makes them
  // separate (p. 13): "announce all of the spells you are casting and each of their
  // targets", and only then "cast and resolve the spells one at a time". It is the one
  // place in the game where those come apart, and Dispel Magic lives in the gap.
  | 'announce_spells'
  /**
   * Dispel Magic's window: "you may roll this unit **after all spells are announced
   * but before any are resolved**."
   *
   * The only place in the game where announcement and resolution come apart, which is
   * why the magic action was built as two steps from the start rather than one.
   */
  | 'dispel_magic'
  | 'resolve_spell'
  // A spell that owes a decision parks it on `turn.magic.choice` and rests here, the
  // way a targeting SAI rests on `sai_target_*`. One step for all of them rather than
  // one per spell: what differs is the question, which `SpellChoice` carries, not the
  // place the machine stands while it is asked.
  | 'resolve_spell_choice'
  /**
   * Wall of Thorns, after a maneuver that succeeded (Phase 7d).
   *
   * A step of the *marching* player's turn rather than of any spell's resolution: the
   * ward was cast on somebody else's turn and fires on an event, so there is no
   * `turn.magic` to hang it on.
   */
  | 'thorns_damage'

/**
 * An attack roll that has landed, held while the exchange is paused between the
 * attack roll and the save roll.
 *
 * Raw dice, so nothing derived is stored twice and no `Face` object reaches the
 * golden digest. `resolveFaces` is pure, so the same dice resolve to the same numbers
 * whenever the pause ends.
 */
export interface PendingAttack {
  readonly dice: readonly RawDie[]
  /**
   * Targeting decisions this roll owes, in resolution order, drained one per action.
   *
   * Omitted when the roll owes none, which is every roll in a `V0_RULES` game -- the
   * optional-and-omitted rule again, for the same digest reason as the rest of
   * `CombatState`.
   */
  readonly targets?: readonly TargetTask[]
  /**
   * Choke and Confuse: chosen two steps later than `targets`, once the defender's
   * dice have landed. Parked here rather than on the save roll because they are the
   * *attacker's* SAIs, rolled on this roll, and they exist before there is anything
   * to apply them to.
   */
  readonly delayed?: readonly TargetTask[]
  /**
   * A Bullseye or Double Strike that has just resolved, whose die is owed its second
   * throw. Set when the task is answered and spent on the next machine step -- *after*
   * `stepGame` has raised anything the SAI's deaths triggered, such as an Accelerated
   * Growth offer. Omitted otherwise.
   */
  readonly rerollDue?: UnitId
}

/**
 * The defender's save dice, held while the exchange is paused for delayed effects.
 *
 * Raw dice again, and mutable in the only sense that matters: Choke takes one out of
 * this list and Confuse replaces one, both before a single result has been counted.
 */
export interface PendingSaves {
  readonly dice: readonly RawDie[]
  /** Tasks owed at this pause, in resolution order: the attacker's delayed effects
   *  first, then the defending army's own Wild Growth and free moves. */
  readonly tasks?: readonly TargetTask[]
  /** Wild Growth's save share, chosen by the defender. Omitted when nobody chose
   *  any, which is every save roll but a Wild Growth one. */
  readonly bonus?: number
  /**
   * Charge (v2 Phase 6e): this is the defender's combination save and melee roll rather
   * than a save roll. Written when the dice land, as `wave` is, so every reader of the
   * roll -- the pause, the display, the count -- resolves it the same way. Omitted
   * otherwise.
   */
  readonly charge?: true
  /** The defender's split of that roll, from `charge_allocate`. Omitted until answered,
   *  and never written when there was nothing to split. */
  readonly allocation?: {
    readonly ids: Readonly<Partial<Record<ResultType, number>>>
    readonly flexible: Readonly<Partial<Record<ResultType, number>>>
    readonly savesAsMelee?: number
  }
  /**
   * Bash (v2 Phase 6d): save results equal to the melee of the dice the defender Bashed.
   * Its own field, not `bonus`, because the roll's arithmetic names each -- "+ 4 Bash"
   * and not "+ 4 Wild Growth". Omitted when nobody Bashed.
   */
  readonly bash?: number
  /**
   * Wave (v2 Phase 5c): save results the attack roll takes off this one. Read off the
   * attack's faces when the save dice are thrown and parked beside them, so the three
   * readers of a save roll -- the pause, the display and the count -- cannot disagree.
   * Omitted when no Wave was rolled.
   */
  readonly wave?: number
  /** Screech (v2 Phase 7c): Wave's melee half, in its own field so the arithmetic line
   *  names it. Omitted when no Screech was rolled. */
  readonly screech?: number
}

/**
 * The exchange currently being resolved.
 *
 * **Every optional field is omitted, never written as `0` or `false`.**
 * `digestState` puts `stableJson(state.turn)` in the golden digest and four of the
 * twenty-five recorded games end with a non-null combat, so a field that is always
 * present rewrites those digests for nothing. `counterSuppressed` is typed `?: true`
 * rather than `?: boolean` so that under `exactOptionalPropertyTypes` the
 * falsy-but-present value cannot even be written.
 *
 * `attack` is the one field with a *lifetime* as well as a presence rule: it exists
 * only between the two halves of an exchange and is dropped when the second half
 * rebuilds this object field by field. `validateState` enforces that, because
 * "cleared in `finishExchange`" is a claim about one function and the four recorded
 * games that end mid-combat are what would pay for it being wrong.
 */
export interface CombatState {
  readonly action: ActionKind
  /**
   * The army under attack: a terrain, or (Tower, Phase 5d) a Reserve Army, which
   * holds no terrain and so cannot be named by a `TerrainSlot`.
   */
  readonly targetSlot: ArmyRef
  /** Damage awaiting assignment by whoever is about to lose units. */
  readonly damage: number
  /** Counter/Volley damage owed back to whoever made *this* exchange's attack roll. */
  readonly riposte?: number
  /** Surprise, rolled by the attacker: the defender may not counter-attack. */
  readonly counterSuppressed?: true
  /** Set at `resolve_*`, read and dropped at `resolve_*_damage`. Never present at a
   *  step the machine rests on. */
  readonly attack?: PendingAttack
  /** Set at `resolve_*_saves`, read and dropped at `resolve_*_damage`. Same lifetime
   *  rule as `attack`, one step shorter. */
  readonly saves?: PendingSaves
}

/**
 * A magic action being cast under `magic: 'spells'`: `CombatState`'s opposite number.
 *
 * It begins where the roll ends. The roll itself is a `CombatState` like any other
 * attack roll -- which is what applies every targeting SAI to it for free -- and
 * `finishExchange` hands over to this once the magic total is known.
 *
 * Every optional field is **omitted rather than written as 0, [] or false**:
 * `digestState` renders `stableJson(state.turn)` and four recorded games end
 * mid-march.
 */
export interface MagicState {
  /** Where the casting army stands. `'reserve'` once Reserve magic returns (7f). */
  readonly army: ArmyRef
  /** What the roll came to, and what it may be spent as. */
  readonly pool: MagicPool
  /** Announced and still unresolved, in the order the caster listed them -- which is
   *  the order they resolve in. Omitted once empty. */
  readonly announced?: readonly AnnouncedSpell[]
  /** Dispel Magic rolls still owed, in board order. Omitted once drained. */
  readonly dispels?: readonly UnitId[]
  /** What the spell that is resolving right now is waiting to be told. */
  readonly choice?: SpellChoice
  /**
   * Whose window this is, when it is not the marching player's (Phase 7f).
   *
   * A Cantrip face on a *save* roll belongs to the defender, who is not marching. A
   * magic action's caster always is, so this is omitted there -- the optional-and-
   * omitted rule, for the digest's sake.
   */
  readonly caster?: PlayerId
  /**
   * The march step to go back to when the last announced spell has resolved.
   *
   * Cantrip's second sentence opens a casting window **inside** another roll: the
   * spells are "resolved immediately", and then the exchange that was interrupted
   * carries on. Omitted for a magic action, which ends its march instead.
   */
  readonly returnTo?: MarchStep
}

/**
 * A decision a spell owes in the middle of resolving (Phase 7c).
 *
 * A spell handler cannot set `pending` -- `applyAction` clears it and only `stepGame`
 * sets one -- so a handler hands one of these back instead and `stepMarch` asks. The
 * same shape a targeting SAI's `TargetTask` has, and for the same reason.
 */
export type SpellChoice =
  /** Hailstorm: the defender picks who dies, by the ordinary maximal-subset rule. */
  | {
      readonly kind: 'damage'
      readonly player: PlayerId
      readonly army: ArmyRef
      readonly damage: number
    }
  /** Path: the caster picks where the units it named are going. */
  | {
      readonly kind: 'move'
      readonly unitIds: readonly UnitId[]
      readonly options: readonly TerrainSlot[]
    }
  /** Flash Flood: the terrain goes down a step. No decision, but the spell resolves
   *  after a roll, so it comes back through the same door the others do. */
  | { readonly kind: 'flood'; readonly slot: TerrainSlot }
  /** Summon Dragon: which dragon of that element, from any pool or terrain. Drained
   *  one per answer, because combined castings summon more than one. */
  | {
      readonly kind: 'summon'
      readonly slot: TerrainSlot
      readonly options: readonly DragonId[]
      readonly remaining: number
    }

/**
 * One announced cast.
 *
 * `count` because combining castings is a single spell with one number multiplied,
 * not several spells -- "three castings of Wind Walk add twelve results". `element`
 * because Resurrect Dead ("multiple castings targeting a single unit must all use the
 * same element") and Summon Dragon (summons a dragon of the element that paid) are the
 * two spells that read which element bought them.
 */
export interface AnnouncedSpell {
  /** A `Spell.id` from `data/spells.json`. */
  readonly spell: string
  readonly element: Element
  readonly count: number
  readonly target: SpellTarget
  /**
   * Dispelled, and so never cast.
   *
   * Kept in the list rather than removed from it so the log can say a spell was
   * announced and stopped -- which is the whole of what Dispel Magic does, and
   * invisible if the cast simply vanished. Optional-and-omitted, like everything else
   * near the digest.
   */
  readonly negated?: true
}

/**
 * What a cast was aimed at, fixed at announcement.
 *
 * A target that is gone by the time the spell resolves is **dropped** -- "if for any
 * reason the announced target of a spell is no longer present, then you may not select
 * a new target" (p. 13). Same rule as damage too small to kill anything.
 */
export type SpellTarget =
  | { readonly kind: 'none' }
  | { readonly kind: 'army'; readonly player: PlayerId; readonly army: ArmyRef }
  | { readonly kind: 'units'; readonly unitIds: readonly UnitId[] }
  | { readonly kind: 'terrain'; readonly slot: TerrainSlot }
  /**
   * A player's DUA as an area, not the units in it: Accelerated Growth's "target your
   * DUA". It used to be offered as one dead *unit* per target with Resurrect Dead's
   * price on it, which made a non-cumulative spell cost two castings and throw.
   */
  | { readonly kind: 'dua'; readonly player: PlayerId }

export interface TurnState {
  readonly marching: PlayerId
  readonly phase: Phase
  /** 0 = First March, 1 = Second March. */
  readonly marchIndex: 0 | 1
  readonly marchStep: MarchStep
  /** The army taking the current march, once chosen. */
  readonly marchingArmy: ArmyRef | null
  /** Armies already marched this turn; the second march must differ. */
  readonly armiesMarched: readonly ArmyRef[]
  /** Non-null only while an action is being resolved. */
  readonly combat: CombatState | null
  /**
   * The Eighth Face Phase's own one-value `marchStep` (Phase 5e): Temple's two
   * decisions are two different players answering, so `applyAction` cannot just
   * advance a step the way a march does -- the phase has to remember it already
   * has a "yes" on file when it comes back around. Omitted the rest of the time,
   * like every optional `TurnState` field near the digest.
   */
  readonly eighthFaceStep?: 'temple_bury'
  /**
   * The Dragon Attack Phase's own working state (Phase 6). Non-null only while one
   * is being resolved, exactly like `combat`, and omitted rather than nulled the
   * rest of the time -- `digestState` renders `state.turn`.
   */
  readonly dragonAttack?: DragonAttackState
  /**
   * A magic action being cast (Phase 7). Non-null only between the magic roll and the
   * end of the march, and omitted the rest of the time for `dragonAttack`'s reason.
   */
  readonly magic?: MagicState
  /**
   * Terrains whose dragon attack is finished this turn (Phase 7c).
   *
   * Phase 6 needed no such list: it resolved terrains in board order and "after this
   * one" was a comparison of indices. The marching player picks the order now, so
   * what is left has to be remembered rather than derived.
   */
  readonly dragonsDone?: readonly TerrainSlot[]
  /**
   * Wall of Thorns' damage, between the melee roll that reduced it and the assignment
   * that spends it (Phase 7d).
   */
  readonly thorns?: { readonly slot: TerrainSlot; readonly damage: number }
  /**
   * Terrains Flash Flood has already pushed down this turn.
   *
   * "A terrain may never be reduced by more than one step during a player's turn from
   * the effects of Flash Flood" -- so a second casting at the same terrain rolls and
   * achieves nothing, which is the rule rather than a shortcut. Cleared with the turn,
   * which `endTurn` now does by building rather than spreading.
   */
  readonly floodedSlots?: readonly TerrainSlot[]
  /**
   * A contested maneuver's two rolls, parked while Rapid Growth is asked about
   * (Phase 8). Present only at the `rapid_growth` step -- `validateState` checks --
   * and dropped by omission when the contest is decided.
   */
  readonly contest?: {
    readonly marcher: readonly RawDie[]
    readonly defender: readonly RawDie[]
  }
  /**
   * Accelerated Growth exchanges waiting to be offered (v1 Phase 9b), oldest first.
   *
   * `killUnits` records one per player per kill, and `stepGame` raises them **before
   * anything else** -- before an emptied army's effects are pruned and before the
   * victory check, because the answer may put a unit back where the dead one stood.
   * Omitted when empty, near the digest.
   */
  readonly growthOffers?: readonly GrowthOffer[]
  /**
   * Burial checks owed to dice already dead (v2 Phase 7b), oldest first: "those that do
   * not generate a save result are buried". Stomp's since 6d, which parked on
   * `combat.attack` until a second source arrived whose deaths can come from anywhere --
   * Soiled Ground (7e), at a terrain, from a melee, a spell, a dragon or a sub-roll.
   *
   * `stepGame` settles them **after any growth offer** (an exchanged die was never
   * killed, so `settleGrowth` takes it off) **and after pruning** (a dead die's own Sleep
   * must be gone before it rolls, or it fails a roll it is owed). Each rolls only what
   * is still in the DUA by then. Omitted when empty, near the digest.
   */
  readonly burialDue?: readonly BurialCheck[]
}

/**
 * One kill's worth of Accelerated Growth: the dying dice that could be exchanged, and
 * the one-health dice that were in the DUA before the kill.
 *
 * The dying dice are **already in the DUA** -- `killUnits` moved them there -- so the
 * state is exactly "killed unless exchanged", and an exchange is the partner coming up
 * to `from`. They are left out of the kill's `units_killed` line; the answer writes
 * that line for the ones declined, and `units_regrown` for the rest.
 */
/** One burial check owed (`TurnState.burialDue`): who rolls, where they died, and what
 *  the log names the roll after -- Stomp, or a spell. */
export interface BurialCheck {
  readonly source: string
  readonly player: PlayerId
  readonly slot: ArmyRef
  readonly unitIds: readonly UnitId[]
}

export interface GrowthOffer {
  readonly player: PlayerId
  readonly dying: readonly { readonly unitId: UnitId; readonly from: ArmyRef }[]
  /** Measured before the kill, so a die dying in the same assignment is never its own
   *  partner's replacement. Re-checked against the DUA when asked. */
  readonly partners: readonly UnitId[]
  /** The kill also buries (Flame): what is declined is buried with the answer. An
   *  exchanged die was never killed, so -- like a Phoenix that rose -- it is not. */
  readonly bury?: true
}

/**
 * Where a dragon attack has got to.
 *
 * The rulebook's nine steps (p. 18) collapse to five the machine can rest on, since
 * four of them take no decision from anybody. Breath and treasure each resolve one
 * dragon at a time, which is what `resolved` counts.
 */
export type DragonAttackStep =
  /**
   * Steps 1 and 2: who each dragon is attacking, before anything is thrown.
   *
   * A real step only when a dragon has more than one eligible enemy, which needs a
   * terrain holding three -- unreachable until Phase 7c's `Summon Dragon`. Breath
   * rerolls against a dragon and not against an army, so the target has to be known
   * before the dice are, which is exactly why the rulebook designates at step 2 and
   * rolls at step 3.
   */
  | 'declare'
  /** Step 4: this attack's breaths, one at a time, the defender choosing the dead. */
  | 'breath'
  /** Fire only: the units it just killed roll for their lives before burial. */
  | 'breath_bury'
  /** Step 5: one promotion per treasure rolled. */
  | 'treasure'
  /** Step 6: the army's combination roll, and the allocation the roller owes. */
  | 'army_roll'
  /** Flashfire on the combination roll, between the dice landing and the allocation
   *  that spends them. */
  | 'army_flashfire'
  /** Step 7, outgoing: which dragons the army's melee and missile go to. */
  | 'damage'
  /** Step 7, incoming: the army assigning what the dragons did to it. */
  | 'assign'

export interface DragonAttackState {
  readonly slot: TerrainSlot
  readonly step: DragonAttackStep
  /** Whose army is under attack: the marching player. */
  readonly defender: PlayerId
  /** Every attacking dragon's roll, in board order, rerolls appended. */
  readonly rolls: readonly DragonRoll[]
  /** What each dragon is attacking, by dragon id. */
  readonly targets: Readonly<Record<DragonId, DragonTarget>>
  /** How many of this step's one-at-a-time items are already done. */
  readonly resolved: number
  /** The army's stashed combination roll, between the question and the answer. */
  /** Dragon-vs-dragon declarations still owed, by the player who owes them. Omitted
   *  once every dragon's target is settled. */
  readonly declaring?: readonly PlayerId[]
  readonly armyDice?: readonly RawDie[]
  /** Units a Fire breath just killed and must now roll to avoid burial. */
  readonly burning?: readonly UnitId[]
  /** What the army's combination roll came to, once its allocation is in. */
  readonly totals?: { readonly melee: number; readonly missile: number; readonly save: number }
  /** What the dragons did to the army, once the saves are subtracted. */
  readonly armyDamage?: number
  /**
   * Bash faces in the army's combination roll (v2 Phase 6d), each owed one attacking
   * dragon at step 7: the one that did the most, under the house rule. Omitted when
   * none, which is every dragon attack without a Behemoth in it.
   */
  readonly bashes?: number
}

export type Direction = 'up' | 'down'

export type ActionKind = 'melee' | 'missile' | 'magic'

/**
 * A point where the engine is blocked on a specific decision from a specific player.
 *
 * A discriminated union on purpose: the UI and every AI switch exhaustively on
 * `kind`, so adding a decision later is a compile error everywhere that must handle
 * it. Most of these are unreachable until Phase 4-5; they are declared now so the
 * shape of the game is visible in one place.
 */
export type Pending =
  /**
   * The roll-off winner's choice (v1 Phase 10e): the first turn, or one of the two
   * proposed Frontiers -- which hands the opponent the first turn. Proposals are keyed
   * by who proposed them, because two players can propose the same die.
   */
  | {
      readonly kind: 'roll_off_choice'
      readonly player: PlayerId
      readonly proposals: Readonly<Record<PlayerId, string>>
    }
  /** The roll-off loser picks the Frontier, the winner having taken the first turn. */
  | {
      readonly kind: 'choose_frontier'
      readonly player: PlayerId
      readonly proposals: Readonly<Record<PlayerId, string>>
    }
  | { readonly kind: 'choose_march_army'; readonly player: PlayerId; readonly options: readonly ArmyRef[] }
  | { readonly kind: 'choose_maneuver'; readonly player: PlayerId; readonly slot: TerrainSlot }
  | { readonly kind: 'contest_maneuver'; readonly player: PlayerId; readonly slot: TerrainSlot }
  | {
      readonly kind: 'choose_direction'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      /** Face 1 cannot go down and face 8 cannot go up, so this is not always both. */
      readonly options: readonly Direction[]
    }
  | {
      readonly kind: 'choose_action'
      readonly player: PlayerId
      /** `ArmyRef` since Phase 7f: a Reserve Army marches, and magic is all it may do. */
      readonly slot: ArmyRef
      readonly legal: readonly ActionKind[]
    }
  | {
      readonly kind: 'choose_missile_target'
      readonly player: PlayerId
      /** A Tower (Phase 5d) may add the opponent's Reserve Army, which is why this
       *  is an `ArmyRef` rather than a `TerrainSlot`. */
      readonly options: readonly ArmyRef[]
    }
  | {
      readonly kind: 'choose_counter_attack'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      /**
       * Defensive Volley (v2 Phase 5d): a counter-attack with missile results against a
       * missile action -- at the army that shot, wherever it stands, and thrown only by
       * the Coral Elves. Omitted for the ordinary melee counter, which hits the army in
       * front of it, so a client knows which roll it is being offered.
       */
      readonly volley?: { readonly target: ArmyRef }
    }
  | {
      readonly kind: 'assign_damage'
      readonly player: PlayerId
      /** Whichever army is losing units -- a terrain, or a Reserve Army after a
       *  Tower's missile (Phase 5d). */
      readonly slot: ArmyRef
      readonly damage: number
    }
  /**
   * A targeting SAI picking health-worth of units out of an opposing army.
   *
   * **The first pending answered by someone other than the army's owner.** `player`
   * is the roller, who chooses; `target` and `slot` say whose army is being picked
   * from. Every combat decision before this one was addressed to the player whose
   * dice were at stake, and both clients assumed it.
   *
   * The selection rule is the opponent-targeting one (full rules p. 32): "you must
   * apply the SAI's effect to the fullest extent possible by selecting the maximum
   * number of targets allowed". That is `damageAssignmentProblem` exactly -- same
   * maximal-subset arithmetic as an `assign_damage`, a different player choosing. The
   * friendly "up to, including none" rule (p. 29) has no case until Phase 4e.
   */
  | {
      readonly kind: 'sai_target'
      readonly player: PlayerId
      /** For the prompt and the log. */
      readonly sai: string
      readonly target: PlayerId
      /** Whose army is being picked from -- a terrain, or a Reserve Army after a
       *  Tower's missile (Phase 5d). */
      readonly slot: ArmyRef
      /**
       * What "how many" means for this SAI.
       *
       * Two kinds because the rules use two: Flame takes *health-worth*, and Sleep
       * takes **one unit** whatever its health. An Oakling and a monster are each one
       * die, so a single number could not say both.
       */
      readonly limit:
        | { readonly kind: 'health'; readonly budget: number }
        | { readonly kind: 'one' }
      /**
       * The only units this SAI may take, when it may not take any of them.
       *
       * Choke's alone: "units in that army **that rolled an ID icon**" is the one
       * targeting rule in the game that depends on a roll rather than on an army, and
       * the tally, the confirm gate and the reducer all have to agree about it.
       * Omitted means the whole army is fair game, which is every other SAI.
       */
      readonly eligible?: readonly UnitId[]
      /**
       * Bash (v2 Phase 6d): what each eligible die would take -- its own melee in the
       * attack roll, which is also the saves the Bash would give. On the pending so
       * every chooser sees the price of each answer without resolving the roll itself.
       * Omitted for every other SAI.
       */
      readonly bash?: Readonly<Record<UnitId, number>>
      /**
       * Tasks this roll still owes, counting this one.
       *
       * Rendered when it is more than one, and load-bearing beyond that: `App` clears
       * its selection draft on a key built from the pending, and two Satyrs both
       * rolling Sleep produce two consecutive `sai_target` pendings with the same kind
       * and the same player. Without this the first answer's selection bleeds into the
       * second, which no engine test can see.
       */
      readonly remaining: number
    }
  /**
   * Galeforce: one opposing army, at any terrain.
   *
   * A slot rather than units, so it is `choose_missile_target`'s shape and not
   * `sai_target`'s -- a fat member with a dead `unitIds` reads worse than a second kind.
   */
  | {
      readonly kind: 'sai_target_army'
      readonly player: PlayerId
      readonly sai: string
      readonly options: readonly TerrainSlot[]
      readonly remaining: number
    }
  /**
   * Wild Growth: split a budget between save results and promotions.
   *
   * **The first friendly targeting decision**, and the first that may legally be
   * answered with nothing: "results may be split ... in any way you choose" is p. 29's
   * *up to* rule, the opposite of p. 32's "select the maximum number of targets" that
   * every decision before this one used. Whatever is not spent on promotions is save
   * results, so the engine derives the split from the pairs rather than asking twice.
   */
  | {
      readonly kind: 'sai_promote'
      readonly player: PlayerId
      readonly sai: string
      /** Health-worth of promotion, where a promotion costs the health it *gains*. */
      readonly budget: number
      /**
       * Whether the half of the budget that is *not* spent on promotions will actually
       * be counted.
       *
       * On a save roll it is: that is the roll those results join. On an attack roll it
       * is not -- Wild Growth generates *save* results and an attack roll counts melee,
       * missile or magic -- so the split is still legal and the saves are still worth
       * nothing. The rules permit the bad choice; the sheet should not advertise it.
       */
      readonly saveResultsCount: boolean
      /** Where the army stands, so the board knows which dice to offer -- a
       *  Reserve Army after a Tower's missile (Phase 5d) included: promotion
       *  cares about the DUA, not the terrain. */
      readonly slot: ArmyRef
      readonly remaining: number
    }
  /**
   * Firewalking, Teleport: this die moves, and may take up to three health-worth of
   * its army with it, to any terrain.
   *
   * Also *up to*, and also declinable -- "this unit **may** move itself" -- which is
   * why the action carries a nullable slot rather than a units list that can be empty:
   * moving nobody and moving the mover alone are two different answers.
   */
  | {
      readonly kind: 'sai_move'
      readonly player: PlayerId
      readonly sai: string
      /** The die that rolled it. It moves itself, so it is never a choice. */
      readonly unitId: UnitId
      /** Where it is standing now -- a Reserve Army included (Phase 5d). */
      readonly slot: ArmyRef
      /** Health-worth of *other* units it may take along. */
      readonly health: number
      readonly options: readonly TerrainSlot[]
      readonly remaining: number
    }
  | { readonly kind: 'reinforce'; readonly player: PlayerId }
  | {
      readonly kind: 'retreat'
      readonly player: PlayerId
      /**
       * Air Flight (Phase 8): the units that may fly instead of -- or as well as
       * others -- retreating, and the terrains each may fly to. Judged once, against
       * the board at the start of the step.
       *
       * Omitted when nobody can fly, which is every retreat in every game without
       * Firewalkers at an air terrain -- and so every retreat in the goldens, whose
       * digest carries the pending verbatim.
       */
      readonly flights?: readonly AirFlightOffer[]
    }
  /**
   * Rapid Growth (Phase 8): which of the counter-maneuvering army's dice to throw
   * again, ignoring what they showed. Asked of the counter-maneuvering player, and only
   * while they are not already winning -- a reroll cannot help an army that has won.
   * An empty answer is always legal: "may be re-rolled".
   */
  | {
      readonly kind: 'rapid_growth'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      /** The dice that did not roll an SAI, in board order. */
      readonly options: readonly UnitId[]
      /** Both totals as they stand, so the question can say what it has to beat. */
      readonly marcher: number
      readonly defender: number
    }
  /**
   * City (Phase 5e): recruit a 1-health unit from the DUA, or promote one unit in
   * the controlling army -- one or the other, and "may", so both lists can offer
   * nothing and the answer can still be "do nothing".
   */
  | {
      readonly kind: 'eighth_face_city'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      /** 1-health units in the DUA that could be recruited. */
      readonly recruits: readonly UnitId[]
      /** Every legal one-step promotion of a unit in the controlling army. */
      readonly promotions: readonly PromotionPair[]
    }
  /**
   * Temple's first decision (Phase 5e): the holder decides *whether* to force a
   * burial. Genuinely a decision and not a formality -- forcing an opponent whose
   * DUA holds a Phoenix lets them roll Rise from the Ashes on the way to a burial
   * that would otherwise not have happened yet.
   */
  | { readonly kind: 'eighth_face_temple'; readonly player: PlayerId; readonly slot: TerrainSlot }
  /**
   * A dragon's breath: five health-worth of the attacked army, chosen by its owner
   * (p. 20). The same maximal-subset rule as any damage assignment -- it is the
   * §6 rule again, with a budget that came from a breath rather than a total.
   */
  | {
      readonly kind: 'dragon_breath'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly dragonId: DragonId
      /** Five, or what is left of the army if it is smaller. */
      readonly health: number
    }
  /**
   * A treasure icon: "that army may promote any one unit" (p. 20). *May*, so an
   * empty answer is legal -- and unlike Wild Growth's budget this is one unit and
   * one step, so the pairs are `promotionMatching`'s and nothing else.
   */
  | {
      readonly kind: 'dragon_treasure'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly promotions: readonly PromotionPair[]
    }
  /**
   * The army's answer to the attack: one combination roll counting melee, missile
   * and save, with the roller saying what each ID becomes (p. 18).
   *
   * `flexible` is the other half of the same question -- Create Fireminions'
   * "the player may split those results between those required by the roll" -- and
   * is zero in almost every roll, since it is the only SAI in the box that offers a
   * choice all three kinds can satisfy.
   */
  | {
      readonly kind: 'dragon_allocate'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      /** ID results to spend across melee, missile and save. */
      readonly ids: number
      /** Step-8 results whose type the roller picks. */
      readonly flexible: number
      /**
       * Flaming Shields (Phase 8): rolled save results the owner may count as melee
       * instead. Up to this many, including none -- "may". Omitted when the army has
       * nothing to convert, which is every army but a Firewalker one at a fire
       * terrain.
       */
      readonly shields?: number
    }
  /**
   * Charge (v2 Phase 6e): the defender's combination save and melee roll, split.
   * `dragon_allocate`'s question over two kinds instead of three: where the IDs go,
   * how a Create Fireminions splits, and how many saves Flaming Shields trades for melee
   * -- here the melee goes back at the charging army, so it is a real trade.
   */
  | {
      readonly kind: 'charge_allocate'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly ids: number
      readonly flexible: number
      readonly shields?: number
    }
  /**
   * Which dragons the army's melee and missile go to (p. 18).
   *
   * Two separate pools, because "the damage to slay a dragon must come from either
   * melee or missile results -- they may not be combined". A free choice, not a
   * maximal one: the rules say *may* allocate, and nothing obliges a player to
   * spread results they cannot make lethal anyway.
   */
  | {
      readonly kind: 'dragon_damage_split'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly melee: number
      readonly missile: number
      /** The dragons that can be hit, and what each needs to die this attack. */
      readonly targets: readonly DragonDamageTarget[]
    }
  /**
   * Temple's second decision: the *opponent* picks which of their own DUA units is
   * buried -- "of their choice". Not raised at all when the DUA is empty, the same
   * rule as a damage assignment with nothing to kill.
   */
  | { readonly kind: 'temple_bury'; readonly player: PlayerId; readonly options: readonly UnitId[] }
  /**
   * Every spell and every target, in one decision (Phase 7).
   *
   * One pending rather than one per spell, because the rules announce them all at
   * once and only then choose a resolution order -- asking spell by spell would leak
   * that order into the announcement. It is the `reinforce` shape: a list the client
   * stages as a draft and sends once.
   *
   * **An empty answer is always legal.** "Any number of spells can be cast up to the
   * number of magic results generated"; unused results are simply lost.
   */
  /** Path: where the units this spell named are going. */
  /**
   * Which terrain's dragons attack next, when more than one qualifies (p. 18).
   *
   * Asked of the marching player, whose armies are the ones being attacked -- the
   * rules give them the order because it is their turn, not because the dragons are
   * theirs.
   */
  /**
   * Flashfire: which of your own dice to throw again, ignoring what they showed.
   *
   * Answered by the owner of the army that rolled -- which on a save roll is the
   * defender and on a counter-attack the marching player's opponent. An empty answer
   * is always legal: "may re-roll".
   */
  | {
      readonly kind: 'flashfire'
      readonly player: PlayerId
      readonly slot: ArmyRef
      readonly budget: number
      readonly options: readonly UnitId[]
    }
  /**
   * Accelerated Growth (v1 Phase 9b): "you **may** instead exchange it with a one health
   * Treefolk unit from your DUA". Asked of the dying dice's owner, whoever is marching.
   * An empty answer lets them all die. One partner per dying die, each at most once.
   */
  | {
      readonly kind: 'accelerated_growth'
      readonly player: PlayerId
      readonly dying: readonly UnitId[]
      readonly partners: readonly UnitId[]
    }
  /**
   * Dispel Magic: one unit, one yes-or-no, before any announced spell resolves.
   *
   * Asked of the unit's owner, who need not be the marching player -- most of the time
   * they are the one being cast at. "You **may** roll this unit", so declining is a
   * real answer and costs no randomness.
   */
  | {
      readonly kind: 'dispel_magic'
      readonly player: PlayerId
      readonly unitId: UnitId
      /** The announced spells this roll would stop, for the prompt. */
      readonly spells: readonly string[]
      readonly remaining: number
    }
  | {
      readonly kind: 'dragon_order'
      readonly player: PlayerId
      readonly options: readonly TerrainSlot[]
    }
  /**
   * Which dragon each of yours is attacking, when more than one is eligible.
   *
   * One atomic decision per declaring player rather than one per dragon, because the
   * rules have both owners declare and reveal together: asking dragon by dragon would
   * let a second answer be chosen knowing the first.
   */
  | {
      readonly kind: 'dragon_target'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly choices: readonly {
        readonly dragonId: DragonId
        readonly options: readonly DragonId[]
      }[]
    }
  | {
      readonly kind: 'spell_move'
      readonly player: PlayerId
      readonly spell: string
      readonly unitIds: readonly UnitId[]
      readonly options: readonly TerrainSlot[]
    }
  /** Summon Dragon: which dragon to bring, from any Summoning Pool or terrain. */
  | {
      readonly kind: 'spell_summon'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly options: readonly DragonId[]
      readonly remaining: number
    }
  | {
      readonly kind: 'announce_spells'
      readonly player: PlayerId
      readonly slot: ArmyRef
      readonly pool: MagicPool
      /** Every spell this pool could buy, with the elements each accepts and how many
       *  combined castings it could afford. Empty is possible and means "no spell you
       *  can afford", not an error. */
      readonly castable: readonly Castable[]
    }

/**
 * One dragon's whole roll, as the log renders it. Display only, like `DieRoll`.
 *
 * Grouped per dragon rather than per face, and carrying what the roll *came to*:
 * "Fire Wyrm breath, Fire Wyrm breath, Fire Wyrm tail, Fire Wyrm claw" is six words
 * of repetition that never says who was being attacked or what it added up to.
 */
export interface DragonAttackEntry {
  readonly dragonId: DragonId
  readonly dieId: string
  /** What it went for. A dragon target is named by its die, for the log's words. */
  readonly target: { readonly kind: 'army' } | { readonly kind: 'dragon'; readonly dieId: string }
  /**
   * Every face it showed, in throwing order, rerolls included.
   *
   * The face *number* travels with the icon because the art is keyed by it -- four
   * claws are four different pictures, and a strip that drew the first one four
   * times would be quietly wrong about which face landed.
   */
  readonly faces: readonly { readonly face: number; readonly icon: DragonIcon }[]
  /** Jaws, claws, wing and tail summed -- breath against an army is not damage. */
  readonly damage: number
}

/** One attacking dragon, as a target for the army's results. */
export interface DragonDamageTarget {
  readonly dragonId: DragonId
  /** Ten, or five if this dragon rolled Belly (p. 20). */
  readonly threshold: number
}

/** Actions answer the current `Pending`. Each `kind` matches a `Pending.kind`, except
 *  `concede`, which answers any of them. */
export type GameAction =
  | { readonly kind: 'roll_off_choice'; readonly take: 'first_turn' }
  /** Picking the Frontier outright, which is the winner's other prize. `proposer`
   *  names the proposal, not the die: two players can propose the same die. */
  | { readonly kind: 'roll_off_choice'; readonly take: 'frontier'; readonly proposer: PlayerId }
  | { readonly kind: 'choose_frontier'; readonly proposer: PlayerId }
  | { readonly kind: 'choose_march_army'; readonly army: ArmyRef | null }
  | { readonly kind: 'choose_maneuver'; readonly maneuver: boolean }
  | { readonly kind: 'contest_maneuver'; readonly contest: boolean }
  | { readonly kind: 'choose_direction'; readonly direction: Direction }
  | { readonly kind: 'choose_action'; readonly action: ActionKind | null }
  | { readonly kind: 'choose_missile_target'; readonly slot: ArmyRef }
  | { readonly kind: 'choose_counter_attack'; readonly counter: boolean }
  | { readonly kind: 'assign_damage'; readonly unitIds: readonly UnitId[] }
  | { readonly kind: 'sai_target'; readonly unitIds: readonly UnitId[] }
  | { readonly kind: 'sai_target_army'; readonly slot: TerrainSlot }
  /** Wild Growth. An empty list is a legal answer: it spends the whole budget on
   *  save results. */
  | { readonly kind: 'sai_promote'; readonly pairs: readonly PromotionPair[] }
  /** A free move. `slot: null` declines it, which is not the same answer as moving
   *  the mover alone. */
  | {
      readonly kind: 'sai_move'
      readonly slot: TerrainSlot | null
      /** Units travelling *with* the mover; the mover itself is never named. */
      readonly unitIds: readonly UnitId[]
    }
  | { readonly kind: 'reinforce'; readonly moves: readonly { readonly unitId: UnitId; readonly slot: TerrainSlot }[] }
  | {
      readonly kind: 'retreat'
      readonly unitIds: readonly UnitId[]
      /** Air Flight: units flying to another terrain instead. Optional, so every
       *  retreat ever recorded still parses and replays. */
      readonly flights?: readonly { readonly unitId: UnitId; readonly slot: TerrainSlot }[]
    }
  /** Rapid Growth: the dice rerolled together. Empty keeps the roll as it is. */
  | { readonly kind: 'rapid_growth'; readonly unitIds: readonly UnitId[] }
  /** Accelerated Growth: which dying dice come back as which small ones. Empty lets
   *  every one of them die. */
  | { readonly kind: 'accelerated_growth'; readonly pairs: readonly PromotionPair[] }
  /** City: one or the other, or neither -- "may" both ways. */
  | {
      readonly kind: 'eighth_face_city'
      readonly choice:
        | { readonly kind: 'recruit'; readonly unitId: UnitId }
        | { readonly kind: 'promote'; readonly pair: PromotionPair }
        | null
    }
  | { readonly kind: 'eighth_face_temple'; readonly force: boolean }
  | { readonly kind: 'temple_bury'; readonly unitId: UnitId }
  | { readonly kind: 'announce_spells'; readonly casts: readonly AnnouncedSpell[] }
  | { readonly kind: 'flashfire'; readonly unitIds: readonly UnitId[] }
  | { readonly kind: 'dispel_magic'; readonly roll: boolean }
  | { readonly kind: 'dragon_order'; readonly slot: TerrainSlot }
  | {
      readonly kind: 'dragon_target'
      /** Attacker dragon id to the dragon it declares against. */
      readonly targets: Readonly<Record<DragonId, DragonId>>
    }
  | { readonly kind: 'spell_move'; readonly slot: TerrainSlot }
  | { readonly kind: 'spell_summon'; readonly dragonId: DragonId }
  | { readonly kind: 'dragon_breath'; readonly unitIds: readonly UnitId[] }
  /** `null` declines: the rules say the army *may* promote. */
  | { readonly kind: 'dragon_treasure'; readonly pair: PromotionPair | null }
  | {
      readonly kind: 'dragon_allocate'
      readonly ids: Readonly<Partial<Record<ResultType, number>>>
      readonly flexible: Readonly<Partial<Record<ResultType, number>>>
      /** Flaming Shields: how many of `Pending.shields` become melee. Omitted is none. */
      readonly savesAsMelee?: number
    }
  /** Charge (v2 Phase 6e): `dragon_allocate`'s answer, over save and melee. */
  | {
      readonly kind: 'charge_allocate'
      readonly ids: Readonly<Partial<Record<ResultType, number>>>
      readonly flexible: Readonly<Partial<Record<ResultType, number>>>
      readonly savesAsMelee?: number
    }
  | {
      readonly kind: 'dragon_damage_split'
      /** Melee results sent to each dragon, by dragon id. Need not spend the pool. */
      readonly melee: Readonly<Record<DragonId, number>>
      readonly missile: Readonly<Record<DragonId, number>>
    }
  /**
   * Giving the game up (v2 Phase 3e), and **the one action that matches no
   * `Pending.kind`**: it answers whatever decision is open, by whoever it is addressed
   * to, which is who concedes. An action rather than a button that stops the client,
   * so the record says how the game ended and replays to the same end.
   */
  | { readonly kind: 'concede' }

/** One unit Air Flight could move, and where to. */
export interface AirFlightOffer {
  readonly unitId: UnitId
  readonly options: readonly TerrainSlot[]
}

/**
 * One unit promoted: `unitId` is in the army and goes to the DUA, `partnerId` is in
 * the DUA and takes its place.
 *
 * Structurally `dua.ts`'s `Exchange`, and deliberately declared here instead of
 * imported: `GameAction` is the engine's public vocabulary and nothing in it should
 * depend on which file happens to implement a move.
 */
/**
 * What an army put on one dragon: melee and missile apiece, never combined -- "the
 * damage to slay a dragon must come from either melee or missile results" -- against
 * the dragon's threshold (10, or 5 with its Belly up).
 */
export interface DragonAnswer {
  readonly dragonId: DragonId
  readonly melee: number
  readonly missile: number
  readonly threshold: number
  readonly slain: boolean
}

export interface PromotionPair {
  readonly unitId: UnitId
  readonly partnerId: UnitId
}

export type LogEntry =
  /** `firstPlayer` is absent under `rollOff: 'choice'`, where nobody knows it until the
   *  winner chooses; `roll_off_decided` names it then. */
  | { readonly kind: 'game_start'; readonly seed: number; readonly firstPlayer?: PlayerId }
  /**
   * The Horde roll-off under `rollOff: 'choice'`: who **won**, which is not who marches
   * first. `order_of_play` is the `split` rung's entry and its field says
   * `firstPlayer`; reusing it here would have been a field that means the winner under
   * one rung and the first player under the other.
   */
  | {
      readonly kind: 'roll_off'
      readonly rolls: Readonly<Record<PlayerId, number>>
      readonly winner: PlayerId
      readonly dice: Readonly<Record<PlayerId, readonly DieRoll[]>>
      readonly proposals: Readonly<Record<PlayerId, string>>
    }
  /** What the roll-off winner chose, and so who marches first and where the Frontier is. */
  | {
      readonly kind: 'roll_off_decided'
      readonly winner: PlayerId
      readonly took: 'first_turn' | 'frontier'
      /** Whose proposal became the Frontier, and which die it is. */
      readonly proposer: PlayerId
      readonly frontier: string
      readonly firstPlayer: PlayerId
    }
  | {
      /** Only when the forces were rolled: a named force is a choice, not a draw. */
      readonly kind: 'forces_drawn'
      /** Health per side. A rolled pair is always one size; a built pair need not be
       *  (v2 Phase 2), but a built force is not drawn and logs no entry here. */
      readonly health: number
      /** The species present in each force, read off its dice (v2 Phase 1): one for an
       *  ordinary rolled force, more for a `mixed` one (v2 Phase 2). */
      readonly species: Readonly<Record<PlayerId, readonly string[]>>
      readonly dice: Readonly<Record<PlayerId, number>>
    }
  | {
      readonly kind: 'order_of_play'
      readonly rolls: Readonly<Record<PlayerId, number>>
      readonly firstPlayer: PlayerId
      /** The deciding roll's dice -- empty only when repeated ties forced a coin flip.
       *  Log-only, like `combat_resolved`: a save is `{ setup, actions }`. */
      readonly dice: Readonly<Record<PlayerId, readonly DieRoll[]>>
    }
  | {
      readonly kind: 'terrain_placed'
      readonly slot: TerrainSlot
      readonly dieId: string
      readonly face: TerrainFace
    }
  | {
      /** Only under `dragons: true`. One dragon per 24 points of force, drawn from
       *  the player's own species' elements, and one of them seeded at the Frontier. */
      readonly kind: 'dragons_drawn'
      readonly player: PlayerId
      /** Every dragon die drawn, in pool order, by die id. */
      readonly pool: readonly string[]
      /**
       * The one that starts on the Frontier -- Phase 6's house rule.
       *
       * **Omitted under `magic: 'spells'`**, where the house rule retires: `Summon
       * Dragon` is a real way onto the board, so the pool keeps everything it drew and
       * the base rules stand. Optional-and-omitted, like every field near the digest.
       */
      readonly frontier?: string
    }
  | {
      /** Every dragon at one terrain rolls (p. 18 step 3). */
      readonly kind: 'dragon_attack'
      readonly slot: TerrainSlot
      /** The marching player, whose army is under attack. */
      readonly defender: PlayerId
      /** One entry per dragon, not one per face: a flat list of faces reads as
       *  noise once two dragons and their rerolls are in it. */
      readonly dragons: readonly DragonAttackEntry[]
    }
  /**
   * The Dragon Attack Phase's arithmetic, both ways (v1 Phase 9c): what the dragons did
   * to the army less its saves, what the army put on each dragon against the number that
   * kills it, and any dragon fighting another. The rolls themselves are `dragon_attack`
   * and `dragon_roll`; this is the subtraction nobody could see.
   */
  | {
      readonly kind: 'dragon_damage'
      /** The army's owner -- the marching player. */
      readonly player: PlayerId
      readonly slot: TerrainSlot
      /** Omitted when no dragon attacked the army (every one was duelling). */
      readonly incoming?: {
        readonly inflicted: number
        readonly saves: number
        /** Bash (v2 Phase 6d): saves equal to the damage of the dragons it chose.
         *  Omitted when no Bash was rolled. */
        readonly bash?: number
        readonly damage: number
      }
      /** The dragons a Bash sent their own damage back at (v2 Phase 6d). Omitted when
       *  none. */
      readonly bashed?: readonly {
        readonly dragonId: DragonId
        readonly damage: number
        readonly threshold: number
        readonly slain: boolean
      }[]
      /** Every dragon the army's melee and missile went at. Omitted when none. */
      readonly answered?: readonly DragonAnswer[]
      /** Dragon against dragon. Omitted when none. */
      readonly duels?: readonly {
        readonly dragonId: DragonId
        readonly targetId: DragonId
        readonly damage: number
        readonly threshold: number
        readonly slain: boolean
      }[]
    }
  | {
      readonly kind: 'dragon_breath'
      readonly player: PlayerId
      readonly dragonId: DragonId
      readonly element: DragonElement
      readonly unitIds: readonly UnitId[]
    }
  | {
      /** The four breaths that leave something behind until the army's next turn. */
      readonly kind: 'dragon_breath_effect'
      readonly player: PlayerId
      readonly element: DragonElement
      readonly slot: TerrainSlot
    }
  | {
      /** The army's combination roll: melee, missile and save at once. */
      readonly kind: 'dragon_roll'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly dice: readonly DieRoll[]
      readonly totals: { readonly melee: number; readonly missile: number; readonly save: number }
      /** Flaming Shields: saves the owner moved to melee. Omitted when none. */
      readonly flamingShields?: number
      /** Why the total is what it is (Phase 9c). Display only: `digestState` drops every
       *  `...Math` key, so it never moves a golden. Omitted when there is nothing to say. */
      readonly math?: Readonly<Partial<Record<ResultType, RollMath>>>
    }
  | {
      /** Back to the pool, the only two ways a dragon leaves a terrain. */
      readonly kind: 'dragon_home'
      readonly dragonId: DragonId
      readonly dieId: string
      readonly why: 'slain' | 'flew'
    }
  | { readonly kind: 'march_begin'; readonly player: PlayerId; readonly army: ArmyRef; readonly index: 0 | 1 }
  | { readonly kind: 'march_skipped'; readonly player: PlayerId; readonly index: 0 | 1 }
  | { readonly kind: 'maneuver_declared'; readonly player: PlayerId; readonly slot: TerrainSlot }
  | { readonly kind: 'maneuver_allowed'; readonly slot: TerrainSlot }
  | {
      readonly kind: 'maneuver_contested'
      readonly slot: TerrainSlot
      readonly marcher: number
      readonly defender: number
      readonly marcherWins: boolean
      /** Both sides' dice, so a contest reads like an attack rather than two bare
       *  numbers. Log-only, like `combat_resolved`. */
      readonly marcherDice: readonly DieRoll[]
      readonly defenderDice: readonly DieRoll[]
      /** Why the total is what it is (Phase 9c). Display only: `digestState` drops every
       *  `...Math` key, so it never moves a golden. Omitted when there is nothing to say. */
      readonly marcherMath?: RollMath
      readonly defenderMath?: RollMath
    }
  /**
   * Rapid Growth: dice the counter-maneuvering Treefolk threw again (Phase 8). Logged
   * before the `maneuver_contested` it changed, which shows the faces they landed on
   * -- the first ones are gone, exactly as a Flashfire's are.
   */
  | {
      readonly kind: 'rapid_growth'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly unitIds: readonly UnitId[]
    }
  | {
      readonly kind: 'terrain_moved'
      readonly slot: TerrainSlot
      readonly from: TerrainFace
      readonly to: TerrainFace
      readonly by: PlayerId
    }
  | { readonly kind: 'terrain_captured'; readonly slot: TerrainSlot; readonly by: PlayerId }
  | {
      readonly kind: 'terrain_lost'
      readonly slot: TerrainSlot
      readonly from: PlayerId
      readonly reason: 'maneuvered' | 'abandoned'
    }
  | {
      readonly kind: 'reinforced'
      readonly player: PlayerId
      readonly moves: readonly { readonly unitId: UnitId; readonly slot: TerrainSlot }[]
    }
  | { readonly kind: 'retreated'; readonly player: PlayerId; readonly unitIds: readonly UnitId[] }
  /** Air Flight (Phase 8): Firewalkers who flew between two air terrains during the
   *  Retreat Step. Both ends named, for the reason an attack names both. */
  | {
      readonly kind: 'air_flight'
      readonly player: PlayerId
      readonly moves: readonly {
        readonly unitId: UnitId
        readonly from: TerrainSlot
        readonly to: TerrainSlot
      }[]
    }
  | {
      readonly kind: 'action_chosen'
      readonly player: PlayerId
      /**
       * Where the attack is made *from* — the marching army's own terrain, not the
       * target. Named `fromSlot` rather than `slot` because "at <slot>" read as the
       * target while meaning the origin.
       */
      readonly fromSlot: ArmyRef
      /**
       * What it is aimed at: the same terrain for melee and magic, which hit the army
       * facing them. Missile chooses, so **this entry is written when the target is
       * picked, not when the action is declared** — otherwise the one action that can
       * name a second terrain would be the one unable to.
       */
      readonly toSlot: ArmyRef
      readonly action: ActionKind
    }
  | { readonly kind: 'action_skipped'; readonly player: PlayerId; readonly slot: ArmyRef }
  | {
      readonly kind: 'combat_resolved'
      readonly attacker: PlayerId
      readonly defender: PlayerId
      /**
       * Both ends of the exchange. They are the same terrain for melee and magic,
       * which only ever hit the army facing them; they differ for missile, which
       * shoots at another terrain, and a counter-attack swaps them.
       */
      readonly attackerSlot: ArmyRef
      /** A Reserve Army after a Tower's missile (Phase 5d) -- the attacker always
       *  stands at a terrain, but the defender need not. */
      readonly defenderSlot: ArmyRef
      readonly action: ActionKind
      readonly isCounter: boolean
      readonly attackTotal: number
      /** null when no save roll was made: magic allows none, a zero attack earns none. */
      readonly saveTotal: number | null
      readonly damage: number
      /**
       * Smite: damage inside `damage` that the save total did not reduce. Without it
       * the line reads "3 melee - 5 saves = 4 damage" and looks like broken
       * arithmetic.
       *
       * Optional and **omitted when zero**, like the two `CombatState` fields and for
       * the same reason: every golden digest carries every log entry verbatim.
       */
      readonly unsavable?: number
      /** Counter/Volley: damage this roll sent back the other way, assigned
       *  separately, after the attacking army's spell saves. Omitted when zero. */
      readonly riposte?: number
      /**
       * What spell saves took off the riposte (v2 Phase 6c): its base is what the dice
       * sent, each step a spell. Display only -- `digestState` drops every `...Math`
       * key -- and omitted when no spell took anything, so `riposte` may be absent
       * beside it when the spells took all of it.
       */
      readonly riposteMath?: RollMath
      /**
       * Charge (v2 Phase 6e): the defender made a combination save and melee roll, and
       * these are its melee, sent back at the attacker inside `riposte` (less the
       * attacker's spell saves, in `riposteMath`). Present on every charge, a zero
       * included -- "the attack was a charge" is the fact -- and omitted otherwise.
       */
      readonly charge?: { readonly melee: number }
      /** The melee half's arithmetic. Display only, dropped from the digest. */
      readonly chargeMath?: RollMath
      /**
       * Flaming Shields (Phase 8): melee inside `attackTotal` that the dice rolled as
       * saves. Omitted when zero, like the two above -- and for the same reason: a
       * Firewalker's save face in a melee attack is otherwise a number from nowhere.
       */
      readonly flamingShields?: number
      /** Why the total is what it is (Phase 9c). Display only: `digestState` drops every
       *  `...Math` key, so it never moves a golden. Omitted when there is nothing to say. */
      readonly attackMath?: RollMath
      readonly saveMath?: RollMath
      /** The dice themselves, so the UI can show what landed rather than only the sum.
       *  Log-only: a saved game is `{ setup, actions }`, so this costs nothing on disk. */
      readonly attackDice: readonly DieRoll[]
      readonly saveDice: readonly DieRoll[] | null
    }
  | {
      readonly kind: 'units_killed'
      readonly player: PlayerId
      readonly slot: ArmyRef
      readonly unitIds: readonly UnitId[]
    }
  /**
   * A targeting SAI chose its victims.
   *
   * Written *before* the kills it causes, so the log reads "Flame targets the Oak
   * Lord" and then "the Oak Lord is killed" rather than a die dying from nowhere.
   * That was the Fireshadow-that-Smote-for-4 problem in Phase 1, and it is cheaper to
   * pay for here than to come back for.
   */
  | {
      readonly kind: 'sai_resolved'
      /** The roller, who chose. Not the owner of `unitIds`. */
      readonly player: PlayerId
      readonly sai: string
      readonly slot: ArmyRef
      readonly unitIds: readonly UnitId[]
      /** Roar (v2 Phase 6d): the targets went to their Reserve Area, and that is all
       *  that happened to them -- no roll and no death follows. Omitted otherwise. */
      readonly toReserve?: true
    }
  /**
   * A sub-roll: the targets of a Bullseye, Double Strike, Smother, Firecloud or Seize
   * rolling for their lives (Phase 4d).
   *
   * Written between `sai_resolved` and the `units_killed` it causes, so the log reads
   * *targeted -> rolled -> died* rather than dice dying from a number nobody saw. It
   * carries the dice for the same reason `combat_resolved` does -- a saved game is
   * `{ setup, actions }`, so log-only dice cost nothing on disk -- and because a
   * Smother whose dice are invisible is the Fireshadow-that-Smote-for-4 problem in a
   * fourth disguise.
   */
  | {
      readonly kind: 'sai_sub_roll'
      /** The owner of the dice that rolled. *Not* the roller who targeted them. */
      readonly player: PlayerId
      /** An SAI name, or a spell name from Phase 7d -- Mirage and Lightning Strike
       *  put their targets through exactly the roll Bullseye and Seize do. */
      readonly source: string
      /** A Reserve Army after a Tower's missile (Phase 5d): Bullseye and Seize
       *  both reach one. */
      readonly slot: ArmyRef
      /** What the targets had to produce. `'id'` is a face, the other two a total. */
      readonly test: 'save' | 'maneuver' | 'id'
      /** Empty for a target that could not be rolled at all -- a sleeping die, which
       *  generates nothing and so fails. */
      readonly dice: readonly DieRoll[]
      /** The ones that made it. The rest are the `units_killed` entry that follows. */
      readonly escaped: readonly UnitId[]
      /** Seize: the escapees went to their Reserve Area rather than staying put.
       *  Omitted otherwise, like every other optional field in the log. */
      readonly toReserve?: true
      /**
       * What failing costs, when it is not death: Dragon Fire's dice are already dead,
       * and a failed save buries them. Net and Stun (v2 Phase 7c) hold a failure where it
       * stands. Omitted means "or die".
       */
      readonly fate?: 'bury' | 'net' | 'stun'
      /**
       * Damage the die was rolling saves against (v2 Phase 6b, `damageSubRoll`): it
       * survives when its saves leave less than its health, not on any save at all.
       * Omitted for every roll that only wants a result -- which is every one before
       * Bash and Firebolt, and every one in a golden.
       */
      readonly damage?: number
    }
  /**
   * Wild Growth: what the budget was spent on.
   *
   * Both halves in one entry because they are one decision -- "results may be split
   * between saves and promotions in any way you choose" -- and a reader who sees only
   * the promotions cannot tell whether the rest was wasted or saved.
   */
  | {
      readonly kind: 'units_promoted'
      readonly player: PlayerId
      readonly sai?: string
      readonly pairs: readonly PromotionPair[]
      /** Save results the budget bought instead. Omitted when none. */
      readonly saveResults?: number
      /** City's own promotion (Phase 5e) reuses this entry rather than growing a
       *  second one -- it is the same exchange, on the ordinary one-step rule
       *  instead of Wild Growth's budget. Phase 6 adds the two a dragon attack can
       *  earn. Omitted for Wild Growth's, which is every recorded game so far. */
      readonly source?: 'city' | 'dragon_treasure' | 'dragon_slain'
    }
  /** City recruiting a 1-health unit from the DUA (Phase 5e). */
  | {
      readonly kind: 'units_recruited'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly unitIds: readonly UnitId[]
    }
  /** A free move: Firewalking or Teleport walking part of an army off to another
   *  terrain, mid-roll. */
  | {
      readonly kind: 'units_moved'
      readonly player: PlayerId
      readonly sai: string
      readonly unitIds: readonly UnitId[]
      /** A Ferry rolled in Reserves moves out of them. */
      readonly from: ArmyRef
      readonly to: TerrainSlot
    }
  /**
   * Units moved from the DUA to the BUA, one way and for good.
   *
   * **No slot, deliberately.** A burial happens out of the DUA, which is not at a
   * terrain -- so widening `units_killed`'s required `slot` was the alternative, and
   * it would have made every one of the 25 recorded games carry a nullable field for
   * a rule none of them can reach. Like `units_risen`, this is always a subset of the
   * `units_killed` entry immediately before it.
   */
  | {
      readonly kind: 'units_buried'
      readonly player: PlayerId
      readonly unitIds: readonly UnitId[]
      /** Temple's forced burial (Phase 5e) and Fire breath's (Phase 6). Omitted for
       *  Flame's, which is every recorded burial before those. */
      readonly source?: 'temple' | 'dragon_fire'
    }
  /**
   * An effect with a duration started.
   *
   * Separate from `sai_resolved`, which says who was *targeted*: a Flame is finished
   * once its victims are buried, and a Sleep has only just begun. This is the entry
   * that has to say when it ends, and it is the one every spell in Phase 7 will write.
   */
  | {
      readonly kind: 'effect_cast'
      /** The roller. The effect ends at the start of *their* next turn. */
      readonly player: PlayerId
      /** `Effect.source`: an SAI name today, a spell name from Phase 7. */
      readonly source: string
      /**
       * Whose unit or army it sits on. **Omitted for a terrain effect**, which sits on
       * a place and belongs to nobody -- Ash Storm subtracts from both sides' rolls.
       */
      readonly target?: PlayerId
      /** `ArmyRef`, not `TerrainSlot`: a spell may be cast on a Reserve Army. */
      readonly slot: ArmyRef
      /** Omitted when the effect sits on the whole army rather than one die. */
      readonly unitId?: UnitId
      /**
       * The effect sits on `target`'s DUA, not on an army: Accelerated Growth, whose
       * "target your DUA" names neither. `slot` is then the casting army and says
       * nothing about where the effect is. Optional-and-omitted, near the digest.
       */
      readonly onDua?: true
    }
  /**
   * Rise from the Ashes: units that were killed and then rolled their way into
   * Reserves instead of staying in the DUA.
   *
   * A separate entry rather than a field on `units_killed`, and for the same reason
   * `counter_suppressed` is one: the unit really was killed, and then moved, and the
   * log has to be able to say both. The ids here are always a subset of the
   * `units_killed` entry immediately before it.
   */
  | {
      readonly kind: 'units_risen'
      readonly player: PlayerId
      /** Who rose. May be empty since the fix after Phase 9: the line is written for
       *  every Rise from the Ashes roll, and a miss rises nobody. */
      readonly unitIds: readonly UnitId[]
      /** Every roll, hits and misses, as a strip. Omitted only on entries from before
       *  the rolls were logged. */
      readonly dice?: readonly DieRoll[]
    }
  /**
   * Replanting (Phase 8): every roll dying Treefolk made at a water terrain, and which
   * of them rolled an ID and went to Reserves instead.
   *
   * **Every roll, not only the rescues.** It began as a list of the rescued alone, so a
   * Treefolk that rolled and failed drew a die and left no trace: a player watching a
   * water terrain could not tell "it tried and missed" from "the rule never fired".
   *
   * `rooted` is **not** a subset of `units_killed`, which is what separates it from
   * `units_risen`: those units were never killed, so no kill line names them. The rest
   * of `dice` did die, and the `units_killed` entry after this one says so. `slot` is
   * where they stood, because "a terrain that contains water" is the whole condition.
   */
  | {
      readonly kind: 'replanting'
      readonly player: PlayerId
      readonly slot: ArmyRef
      /** One per unit that rolled, in board order. Display only, like every roll. */
      readonly dice: readonly DieRoll[]
      readonly rooted: readonly UnitId[]
    }
  | { readonly kind: 'counter_declined'; readonly player: PlayerId }
  /**
   * A magic roll under `magic: 'spells'`, which inflicts nothing and buys spells
   * instead. A separate entry rather than a `combat_resolved` with `damage: 0`:
   * there is no defender, no save roll and no damage to explain, and the line the
   * player wants is "you have this much magic, in these elements".
   */
  | {
      readonly kind: 'magic_rolled'
      readonly player: PlayerId
      readonly slot: ArmyRef
      readonly total: number
      readonly elements: readonly Element[]
      /** The pool's per-species split (v2 Phase 1), when the caster's force holds more
       *  than one species -- `MagicPool.suppliers`. Omitted otherwise, near the digest. */
      readonly suppliers?: readonly MagicSupplier[]
      readonly dice: readonly DieRoll[]
      /** Why the total is what it is (Phase 9c). Display only: `digestState` drops every
       *  `...Math` key, so it never moves a golden. Omitted when there is nothing to say. */
      readonly math?: RollMath
    }
  /** One announced cast resolving. `count` is combined castings folded into one. */
  | {
      readonly kind: 'spell_cast'
      readonly player: PlayerId
      readonly spell: string
      readonly element: Element
      readonly count: number
    }
  /** An announced cast whose target was gone by the time it resolved. "You may not
   *  select a new target" (p. 13), so it is dropped and said so. */
  | { readonly kind: 'spell_fizzled'; readonly player: PlayerId; readonly spell: string }
  /**
   * Flash Flood: the terrain went down, or the army there held it.
   *
   * `resisted` and `needed` both, because "the flood failed" and "the flood failed by
   * one result" are different things to read on your opponent's turn.
   */
  | {
      readonly kind: 'flash_flood'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly needed: number
      readonly resisted: number
      readonly moved: boolean
    }
  /**
   * Cantrip's second sentence: a casting window opening in the middle of another roll.
   *
   * Without it the log shows a spell cast mid-exchange with nothing saying where the
   * magic came from -- and a player handed an announcement prompt during a melee
   * attack has every right to ask.
   */
  | {
      readonly kind: 'cantrip'
      readonly player: PlayerId
      readonly slot: ArmyRef
      readonly points: number
    }
  /**
   * Dispel Magic: a unit rolled, and what it stopped.
   *
   * `spells` empty means the roll missed. A separate entry rather than a flag on the
   * casts, because the *attempt* is the news: a Unicorn that rolled and failed is why
   * the spell that follows lands.
   */
  | {
      readonly kind: 'dispel_magic'
      readonly player: PlayerId
      readonly unitId: UnitId
      readonly spells: readonly string[]
    }
  /**
   * Confuse (Phase 9d): the defender's save dice the attacker made roll again, as they
   * were and as they came back. Before this the first faces were gone without a trace,
   * and the replaced strip read as if Confuse had fired on the attack roll.
   */
  | {
      readonly kind: 'confused'
      /** The attacker, who chose. */
      readonly player: PlayerId
      readonly target: PlayerId
      readonly slot: ArmyRef
      readonly sai: string
      readonly before: readonly DieRoll[]
      readonly after: readonly DieRoll[]
    }
  /** Flashfire: dice thrown again, and what they came back as. */
  | {
      readonly kind: 'flashfire'
      readonly player: PlayerId
      readonly slot: ArmyRef
      readonly unitIds: readonly UnitId[]
    }
  /**
   * Accelerated Growth: a die that would have died, swapped for a small one instead.
   *
   * Not a death, so there is no `units_killed` entry beside it and no death trigger
   * fires -- an exchange never kills anybody (`dua.ts`).
   */
  | {
      readonly kind: 'units_regrown'
      readonly player: PlayerId
      readonly pairs: readonly PromotionPair[]
    }
  /** Wall of Thorns: what a successful maneuver cost, after the melee roll that
   *  reduced it. */
  | {
      readonly kind: 'thorns'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly damage: number
      readonly melee: number
      readonly dice: readonly DieRoll[]
      /** Flaming Shields: melee inside `melee` that the dice rolled as saves. */
      readonly flamingShields?: number
      /** Why the total is what it is (Phase 9c). Display only: `digestState` drops every
       *  `...Math` key, so it never moves a golden. Omitted when there is nothing to say. */
      readonly math?: RollMath
    }
  /**
   * The save roll a damaging spell allows its target (p. 29).
   *
   * Its own entry rather than a field on `spell_cast`, because the roll happens even
   * when it stops the damage dead -- and a spell that was survived with nothing in the
   * log reads exactly like a spell that did not resolve. Hailstorm is the only caster
   * in scope; `source` is a string so the next one needs no new entry.
   */
  | {
      readonly kind: 'spell_saves'
      /** The army that rolled -- the spell's *target*, not its caster. */
      readonly player: PlayerId
      readonly source: string
      readonly slot: ArmyRef
      readonly saves: number
      readonly dice: readonly DieRoll[]
      /** Why the total is what it is (Phase 9c). Display only: `digestState` drops every
       *  `...Math` key, so it never moves a golden. Omitted when there is nothing to say. */
      readonly math?: RollMath
    }
  /** Resurrect Dead: units walking back out of the DUA into the casting army. */
  | {
      readonly kind: 'units_resurrected'
      readonly player: PlayerId
      readonly unitIds: readonly UnitId[]
      readonly slot: ArmyRef
    }
  /** Summon Dragon. `from` is where it came from, which may be another terrain: the
   *  spell can pull a dragon off the board as well as out of a pool. */
  | {
      readonly kind: 'dragon_summoned'
      readonly player: PlayerId
      readonly dragonId: DragonId
      readonly dieId: string
      readonly from: TerrainSlot | 'pool'
      readonly slot: TerrainSlot
    }
  /**
   * The Effects Expire Phase actually removing something.
   *
   * Named by `source` rather than by any identity, because that is what a player
   * recognises: "Galeforce wears off", not "effect 3 ends". Nothing writes this
   * until Phase 4 produces the first effect; it is written by `expireEffects` now
   * rather than then, because the machine that silently removes state is worse than
   * the one that says so, and a writer with no renderer is how the browser and the
   * terminal start describing one game differently.
   */
  | { readonly kind: 'effects_expired'; readonly player: PlayerId; readonly sources: readonly string[] }

  /** Surprise. A separate entry rather than a flag on `combat_resolved`: without it
   *  the march simply ends, with no `counter_declined` and no explanation. Surprise
   *  is melee-only, so `slot` is always a terrain in practice, but it mirrors
   *  `combat_resolved.defenderSlot`'s type rather than narrowing it back down. */
  | { readonly kind: 'counter_suppressed'; readonly player: PlayerId; readonly slot: ArmyRef }
  | { readonly kind: 'turn_end'; readonly player: PlayerId }
  | {
      readonly kind: 'victory'
      readonly player: PlayerId
      /** `'concession'` (v2 Phase 3e): `player` won because the other conceded. */
      readonly reason: 'captures' | 'elimination' | 'concession'
    }

/**
 * Which slice of the full game is switched on.
 *
 * Scope lives here rather than in scattered conditionals, so the v0 house rules
 * cannot get quietly welded into the engine and each v1 feature has a named home
 * before anyone writes it.
 */
export interface RuleSet {
  readonly magic: 'simplified' | 'spells'
  /**
   * `inert`   — an SAI face produces nothing at all. The v0 game.
   * `results` — the twelve SAIs that only add results, plus Rend's reroll. The other
   *             thirteen need targeting, a sub-roll, a duration or the DUA, and stay
   *             silently inert here; see `sai.ts`.
   * `full`    — plus those thirteen, which is Phase 4. Throws until then.
   */
  readonly sai: 'inert' | 'results' | 'full'
  /**
   * `captureOnly` — a captured terrain wins the game and does nothing else.
   * `standard`    — plus the two advantages the rules grant any holder: ID results
   *                 doubled when rolling that army, and the action restriction
   *                 (holder may melee/missile/magic, everyone else melee only).
   * `full`        — plus the Eighth Face Icon powers (City, Standing Stones,
   *                 Temple, Tower), which are still cut.
   */
  readonly eighthFace: 'captureOnly' | 'standard' | 'full'
  /**
   * `inert`  -- the Dead Unit Area is a graveyard: nothing leaves it, nothing is ever
   *            buried, no death trigger fires, and killing a unit rolls no die. The
   *            v0 game.
   * `active` -- promotion, recruitment, burial, and Rise from the Ashes' death roll.
   *
   * A flag of its own rather than a fourth `sai` rung, because what it switches on is
   * a fact about the DUA and not about roll resolution: the death trigger fires on
   * burial and (Phase 6) on dragon breath, in no roll at all, and four later features
   * -- City, Temple, dragon-slaying promotion and Resurrect Dead -- need this
   * machinery while keying off their own flags.
   */
  readonly dua: 'inert' | 'active'
  readonly dragons: boolean
  /**
   * The four species abilities Treefolk and Firewalkers bring (v1 Phase 8): Rapid
   * Growth, Replanting, Air Flight and Flaming Shields. See `species.ts`.
   *
   * A flag of its own because two of the four draw dice -- Replanting rolls a dying
   * unit, Rapid Growth rerolls a counter-maneuver -- and a single extra draw in a
   * `V0_RULES` game would shift every die after it in all 25 goldens.
   */
  readonly speciesAbilities: boolean
  /**
   * Setup step 4 (full rules p. 10), and the last house rule `PLAN-V1.md` retires.
   *
   * `split`  -- the roll-off winner marches first and the loser draws the Frontier:
   *             one prize each, and no decision. What every rung below v1 plays.
   * `choice` -- each player proposes a Frontier, and the winner takes *either* the
   *             first turn *or* the pick of the two; the loser gets the other (v1
   *             Phase 10e). A real decision, so the game opens paused in `'setup'`
   *             before a single starting face is rolled.
   *
   * A flag rather than a change to setup because it moves the dice order: a
   * `V0_RULES` game drawing a second proposal would land on a different board, and all
   * 25 goldens with it.
   */
  readonly rollOff: 'split' | 'choice'
}

export const V0_RULES: RuleSet = {
  magic: 'simplified',
  sai: 'inert',
  eighthFace: 'standard',
  dua: 'inert',
  dragons: false,
  speciesAbilities: false,
  rollOff: 'split',
}

/** `V0_RULES` plus the twelve result-generating SAIs. Phase 1's rung. */
export const SAI_RULES: RuleSet = { ...V0_RULES, sai: 'results' }

/**
 * What the app and the CLI actually play from v1 Phase 2 on.
 *
 * `V0_RULES` stays exactly as it was -- it is the regression baseline the golden
 * corpus is recorded against, and invariant 5 is the reason each of these is a flag
 * rather than a deleted branch.
 */
export const DUA_RULES: RuleSet = { ...SAI_RULES, dua: 'active' }

/**
 * Every SAI in the box, targeting ones included: Phase 4's rung, and what the app and
 * the CLI played from Phase 4e through Phase 5d.
 *
 * `magic` is still `'simplified'` -- the eighteen spells are Phase 7 -- and that is
 * not a gap in this rung. Cantrip's magic results are generated and counted, and
 * Dispel Magic's special roll cannot come up because no spell is ever announced to
 * dispel.
 */
const SAI_FULL_RULES: RuleSet = { ...DUA_RULES, sai: 'full' }

/**
 * Every eighth-face icon power (Tower, City, Temple) as well: Phase 5e's rung, and
 * what the app and the CLI play from here on. Standing Stones stays inert regardless
 * -- `resolvesIcon` gates it on `magic: 'spells'`, not on this flag, and that stays
 * true until Phase 7.
 *
 * Nothing here can crash the way `sai: 'full'` could: every board carries a terrain
 * die with an eighth-face icon, so there is no unbuilt-icon problem the way there was
 * an unbuilt-SAI one. The flip needed the Phase 5e fuzz counters, not a refusal path.
 */
export const FULL_RULES: RuleSet = { ...SAI_FULL_RULES, eighthFace: 'full' }

/**
 * Dragons as well: Phase 6's rung, and what the app and the CLI play from here on.
 *
 * `magic` is still `'simplified'`, which matters more here than it did for
 * `FULL_RULES`: `Summon Dragon` is a spell, so without Phase 7 the only dragons that
 * ever reach a terrain are the two this rung seeds there at setup, and a dragon that
 * goes back to a pool stays in it. That is a house rule and not a gap -- see
 * `PLAN-V1.md` Phase 6.
 */
export const DRAGON_RULES: RuleSet = { ...FULL_RULES, dragons: true }

/**
 * Spells as well: Phase 7's rung.
 *
 * The v0 magic house rule retires here -- `floor(M / 2)`, same terrain only, no save
 * roll, no counter-attack and no Reserve magic are all replaced by the real system.
 * `magic: 'simplified'` survives as the `V0_RULES` regression baseline and nothing
 * else; it is not a configuration anyone plays or balances after this.
 *
 * Standing Stones comes live with this flag rather than with `eighthFace`, which is
 * what `resolvesIcon` has said since Phase 5c: converting magic results to an element
 * is meaningless until results have elements to convert to.
 */
export const SPELL_RULES: RuleSet = { ...DRAGON_RULES, magic: 'spells' }

/**
 * Species abilities as well: Phase 8's rung, and the last flag in `PLAN-V1.md`'s
 * `V1_RULES` -- which is why it is exported under that name too.
 */
export const SPECIES_RULES: RuleSet = { ...SPELL_RULES, speciesAbilities: true }

/**
 * The roll-off as the rules have it (v1 Phase 10e): the winner chooses the first turn
 * or the Frontier. A rung of its own rather than a change to `SPECIES_RULES`, because
 * it adds a decision before the first march -- and every test built on
 * `SPECIES_RULES` expects its first pending to be a march.
 */
export const ROLLOFF_RULES: RuleSet = { ...SPECIES_RULES, rollOff: 'choice' }

/** Every rule in the v1 plan switched on: what the app plays. */
export const V1_RULES: RuleSet = ROLLOFF_RULES


export interface GameState {
  readonly ruleSet: RuleSet
  readonly rng: RngState
  readonly units: Readonly<Record<UnitId, UnitInstance>>
  readonly terrains: Readonly<Record<TerrainSlot, TerrainInPlay>>
  /**
   * Effects with a duration, targeting an army or a unit. See `effects.ts`.
   *
   * A flat list rather than a field on the thing affected, for the same reason armies
   * are derived: one place to look, nothing to keep in sync. Empty in every v0 game
   * and in every game so far -- nothing produces one until Phase 4 -- and the
   * machinery over it is a no-op on an empty list, which is why no `RuleSet` flag
   * gates it.
   */
  readonly effects: readonly Effect[]
  /**
   * Every dragon in the game, pooled or on the board. Empty unless `dragons` is on.
   *
   * Keyed like `units` rather than listed like `effects`, because a dragon has an
   * identity that decisions refer to by id -- which dragon a dragon is attacking,
   * which dragon a player is spending melee results on.
   */
  readonly dragons: Readonly<Record<DragonId, DragonInPlay>>
  readonly turn: TurnState
  /**
   * The open roll-off choice (v1 Phase 10e), present exactly while the phase is
   * `'setup'` and omitted the rest of the time.
   *
   * **While it is open, `terrains` is a placeholder**, and `validateState` holds it to
   * exactly that: every face is 1 and nobody holds anything, and the Frontier slot
   * holds p1's proposal. The rules roll the starting faces after the choice, so there
   * is no honest face to show, and a nullable face would reach every one of the
   * hundred places that read one. Nothing reads the placeholder: the phase takes no
   * action but the choice, and the boards draw each Home's eighth face over it.
   */
  readonly rollOff?: RollOffState
  readonly pending: Pending | null
  readonly log: readonly LogEntry[]
  readonly winner: PlayerId | null
}

/** Thrown when an action does not answer the current pending decision. */
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalActionError'
  }
}

// --- selectors ---------------------------------------------------------------
// Armies are queries, not stored entities. Everything that needs "the army at X"
// goes through these.

/**
 * The species among some units: each once, sorted by id.
 *
 * **A player is not a species; a unit is** (v2 Phase 1). There used to be a
 * `speciesOf(state, player)` answering "which species is this force", which was one
 * question while a force was one species and stopped being a question at all the day
 * an army could mix. It was deleted rather than kept answering "the first die's
 * species", so a caller that still asked it failed to compile instead of being quietly
 * wrong about a mixed army. Ask about the dice: a unit's own species for anything a
 * die does, this for anything a group of dice does.
 */
export function speciesIn(units: readonly UnitInstance[]): readonly string[] {
  return [...new Set(units.map((u) => unitType(u.typeId).species))].sort()
}

/**
 * Every species in a player's force, read off their dice -- dead and buried ones
 * included, so a rout does not change what a force *is*. What a client shows as the
 * force's name, and never what a rule asks: a rule asks about the dice it touches.
 */
export function forceSpecies(state: GameState, player: PlayerId): readonly string[] {
  return speciesIn(unitsOf(state, player))
}

/**
 * A player's force size: the total health of every unit they own, wherever it stands --
 * dead and buried included (v2 Phase 2). "Per 24 points of total force size" (p. 21) is
 * a limit some abilities scale by, and with unequal forces each player reads their own.
 *
 * **Derived, never stored**, the rule armies and species follow, and sound only because
 * it is invariant in this scope: no unit enters or leaves the game, an exchange swaps two
 * dice of one owner, and nothing changes a unit's owner. The live-rules fuzz asserts that
 * every game ends at the size it started. Dragonkin, or anything that captures a die,
 * would break it -- store it at setup then.
 */
export function forceSize(state: GameState, player: PlayerId): number {
  return unitsOf(state, player).reduce((sum, u) => sum + unitType(u.typeId).health, 0)
}

export function unitsOf(state: GameState, player: PlayerId): readonly UnitInstance[] {
  return Object.values(state.units).filter((u) => u.owner === player)
}

/** A player's units at a terrain slot. */
export function armyAt(
  state: GameState,
  player: PlayerId,
  slot: TerrainSlot,
): readonly UnitInstance[] {
  return Object.values(state.units).filter(
    (u) => u.owner === player && u.location.kind === 'terrain' && u.location.slot === slot,
  )
}

export function reserveArmy(state: GameState, player: PlayerId): readonly UnitInstance[] {
  return Object.values(state.units).filter(
    (u) => u.owner === player && u.location.kind === 'reserve',
  )
}

export function deadUnits(state: GameState, player: PlayerId): readonly UnitInstance[] {
  return Object.values(state.units).filter((u) => u.owner === player && u.location.kind === 'dua')
}

export function buriedUnits(state: GameState, player: PlayerId): readonly UnitInstance[] {
  return Object.values(state.units).filter((u) => u.owner === player && u.location.kind === 'bua')
}

/**
 * Units still in play -- at a terrain or in Reserves. A player with none has lost.
 *
 * Stated positively, deliberately. This was `!== 'dua'` while the DUA was the only
 * way off the board, and the moment the BUA existed that reading would have counted
 * every buried unit as alive -- so a player whose last die was buried would never
 * lose. A new `Location` member must be opted *into* this list, not out of it.
 */
export function livingUnits(state: GameState, player: PlayerId): readonly UnitInstance[] {
  return Object.values(state.units).filter(
    (u) => u.owner === player && (u.location.kind === 'terrain' || u.location.kind === 'reserve'),
  )
}


export function army(state: GameState, player: PlayerId, ref: ArmyRef): readonly UnitInstance[] {
  return ref === 'reserve' ? reserveArmy(state, player) : armyAt(state, player, ref)
}

/**
 * Which army a unit stands in, or null for one that is off the board -- the DUA or
 * the BUA. `army`'s inverse, and the query behind naming a unit target by its place
 * as well as its name.
 */
export function armyRefOf(state: GameState, id: string): ArmyRef | null {
  const unit = state.units[id]
  if (unit === undefined) return null
  if (unit.location.kind === 'terrain') return unit.location.slot
  return unit.location.kind === 'reserve' ? 'reserve' : null
}

export function capturedCount(state: GameState, player: PlayerId): number {
  return TERRAIN_SLOTS.filter((slot) => state.terrains[slot].capturedBy === player).length
}

/**
 * Every dragon at a terrain, both players' -- because every dragon present attacks,
 * regardless of who owns it, so "whose dragon" is never the question being asked.
 *
 * In board order, like `death.ts`'s roll order: two dragons resolving in the order
 * a player happened to name them would be a replay difference nothing would catch.
 */
export function dragonsAt(state: GameState, slot: TerrainSlot): readonly DragonInPlay[] {
  return Object.values(state.dragons).filter(
    (d) => d.location.kind === 'terrain' && d.location.slot === slot,
  )
}

/** A player's un-summoned dragons. Nothing in Phase 6 takes one out again. */
export function pooledDragons(state: GameState, player: PlayerId): readonly DragonInPlay[] {
  return Object.values(state.dragons).filter(
    (d) => d.owner === player && d.location.kind === 'pool',
  )
}
