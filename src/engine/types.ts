/**
 * Core engine types.
 *
 * Nothing here knows about React, the DOM, or which player is human. The engine is
 * a pure reducer over these values; see `docs/OVERVIEW.md` section 2.
 */
import { unitType } from '../data/load'
import type { DragonElement, DragonIcon, ResultType } from '../data/types'

import type { DragonRoll, DragonTarget } from './dragons'
import type { Effect } from './effects'
import type { DieRoll, RawDie } from './roll'
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
  | 'effects_expire'
  | 'eighth_face'
  | 'dragon_attack'
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
  | 'sai_target_attack'
  // And the save roll is two steps for the same reason the attack was: the rulebook's
  // step 2 is "when rolling for saves against an attack, Delayed Effects are applied
  // now", and Choke's targets are "units that rolled an ID icon" -- a question that
  // cannot be asked until the save dice are on the table and must be answered before
  // anything is counted.
  | 'resolve_attack_saves'
  | 'sai_delayed_attack'
  | 'resolve_attack_damage'
  | 'assign_attack_damage'
  | 'assign_attack_riposte'
  | 'offer_counter'
  | 'resolve_counter'
  | 'sai_target_counter'
  | 'resolve_counter_saves'
  | 'sai_delayed_counter'
  | 'resolve_counter_damage'
  | 'assign_counter_damage'
  | 'assign_counter_riposte'

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
}

/**
 * Where a dragon attack has got to.
 *
 * The rulebook's nine steps (p. 18) collapse to five the machine can rest on, since
 * four of them take no decision from anybody. Breath and treasure each resolve one
 * dragon at a time, which is what `resolved` counts.
 */
export type DragonAttackStep =
  /** Step 4: this attack's breaths, one at a time, the defender choosing the dead. */
  | 'breath'
  /** Fire only: the units it just killed roll for their lives before burial. */
  | 'breath_bury'
  /** Step 5: one promotion per treasure rolled. */
  | 'treasure'
  /** Step 6: the army's combination roll, and the allocation the roller owes. */
  | 'army_roll'
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
  readonly armyDice?: readonly RawDie[]
  /** Units a Fire breath just killed and must now roll to avoid burial. */
  readonly burning?: readonly UnitId[]
  /** What the army's combination roll came to, once its allocation is in. */
  readonly totals?: { readonly melee: number; readonly missile: number; readonly save: number }
  /** What the dragons did to the army, once the saves are subtracted. */
  readonly armyDamage?: number
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
      readonly slot: TerrainSlot
      readonly legal: readonly ActionKind[]
    }
  | {
      readonly kind: 'choose_missile_target'
      readonly player: PlayerId
      /** A Tower (Phase 5d) may add the opponent's Reserve Army, which is why this
       *  is an `ArmyRef` rather than a `TerrainSlot`. */
      readonly options: readonly ArmyRef[]
    }
  | { readonly kind: 'choose_counter_attack'; readonly player: PlayerId; readonly slot: TerrainSlot }
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
  | { readonly kind: 'retreat'; readonly player: PlayerId }
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

/** Actions answer the current `Pending`. Each `kind` matches a `Pending.kind`. */
export type GameAction =
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
  | { readonly kind: 'retreat'; readonly unitIds: readonly UnitId[] }
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
  | { readonly kind: 'dragon_breath'; readonly unitIds: readonly UnitId[] }
  /** `null` declines: the rules say the army *may* promote. */
  | { readonly kind: 'dragon_treasure'; readonly pair: PromotionPair | null }
  | {
      readonly kind: 'dragon_allocate'
      readonly ids: Readonly<Partial<Record<ResultType, number>>>
      readonly flexible: Readonly<Partial<Record<ResultType, number>>>
    }
  | {
      readonly kind: 'dragon_damage_split'
      /** Melee results sent to each dragon, by dragon id. Need not spend the pool. */
      readonly melee: Readonly<Record<DragonId, number>>
      readonly missile: Readonly<Record<DragonId, number>>
    }

/**
 * One unit promoted: `unitId` is in the army and goes to the DUA, `partnerId` is in
 * the DUA and takes its place.
 *
 * Structurally `dua.ts`'s `Exchange`, and deliberately declared here instead of
 * imported: `GameAction` is the engine's public vocabulary and nothing in it should
 * depend on which file happens to implement a move.
 */
export interface PromotionPair {
  readonly unitId: UnitId
  readonly partnerId: UnitId
}

export type LogEntry =
  | { readonly kind: 'game_start'; readonly seed: number; readonly firstPlayer: PlayerId }
  | {
      /** Only when the forces were rolled: a named force is a choice, not a draw. */
      readonly kind: 'forces_drawn'
      /** Health per side. Both sides always bring the same. */
      readonly health: number
      readonly species: Readonly<Record<PlayerId, string>>
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
      /** The one that starts on the Frontier -- the Phase 6 house rule. */
      readonly frontier: string
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
  | {
      readonly kind: 'action_chosen'
      readonly player: PlayerId
      /**
       * Where the attack is made *from* — the marching army's own terrain, not the
       * target. Named `fromSlot` rather than `slot` because "at <slot>" read as the
       * target while meaning the origin.
       */
      readonly fromSlot: TerrainSlot
      /**
       * What it is aimed at: the same terrain for melee and magic, which hit the army
       * facing them. Missile chooses, so **this entry is written when the target is
       * picked, not when the action is declared** — otherwise the one action that can
       * name a second terrain would be the one unable to.
       */
      readonly toSlot: ArmyRef
      readonly action: ActionKind
    }
  | { readonly kind: 'action_skipped'; readonly player: PlayerId; readonly slot: TerrainSlot }
  | {
      readonly kind: 'combat_resolved'
      readonly attacker: PlayerId
      readonly defender: PlayerId
      /**
       * Both ends of the exchange. They are the same terrain for melee and magic,
       * which only ever hit the army facing them; they differ for missile, which
       * shoots at another terrain, and a counter-attack swaps them.
       */
      readonly attackerSlot: TerrainSlot
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
       *  separately. Omitted when zero. */
      readonly riposte?: number
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
      readonly sai: string
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
      readonly from: TerrainSlot
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
      /** Whose unit or army it sits on. */
      readonly target: PlayerId
      readonly slot: TerrainSlot
      /** Omitted when the effect sits on the whole army rather than one die. */
      readonly unitId?: UnitId
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
  | { readonly kind: 'units_risen'; readonly player: PlayerId; readonly unitIds: readonly UnitId[] }
  | { readonly kind: 'counter_declined'; readonly player: PlayerId }
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
      readonly reason: 'captures' | 'elimination'
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
}

export const V0_RULES: RuleSet = {
  magic: 'simplified',
  sai: 'inert',
  eighthFace: 'standard',
  dua: 'inert',
  dragons: false,
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
 * Which species a player is fielding, read off their dice.
 *
 * Derived rather than stored, for the same reason armies are: a force is one
 * species, every unit says which, and a second copy of that fact could drift. Dead
 * units count -- they stay in `state.units` -- so this survives a rout.
 */
export function speciesOf(state: GameState, player: PlayerId): string {
  const unit = Object.values(state.units).find((u) => u.owner === player)
  if (unit === undefined) throw new Error(`${player} has no units at all, not even dead ones`)
  return unitType(unit.typeId).species
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
