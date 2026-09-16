/**
 * Core engine types.
 *
 * Nothing here knows about React, the DOM, or which player is human. The engine is
 * a pure reducer over these values; see `docs/OVERVIEW.md` section 2.
 */
import { unitType } from '../data/load'

import type { Effect } from './effects'
import type { DieRoll } from './roll'
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
  | 'resolve_attack'
  | 'assign_attack_damage'
  | 'assign_attack_riposte'
  | 'offer_counter'
  | 'resolve_counter'
  | 'assign_counter_damage'
  | 'assign_counter_riposte'

/**
 * The exchange currently being resolved.
 *
 * **The two Phase 1 fields are optional and must be omitted, never written as `0` or
 * `false`.** `digestState` puts `stableJson(state.turn)` in the golden digest and
 * four of the twenty-five recorded games end with a non-null combat, so a field that
 * is always present rewrites those digests for nothing. `counterSuppressed` is typed
 * `?: true` rather than `?: boolean` so that under `exactOptionalPropertyTypes` the
 * falsy-but-present value cannot even be written.
 */
export interface CombatState {
  readonly action: ActionKind
  /** The terrain holding the army under attack. */
  readonly targetSlot: TerrainSlot
  /** Damage awaiting assignment by whoever is about to lose units. */
  readonly damage: number
  /** Counter/Volley damage owed back to whoever made *this* exchange's attack roll. */
  readonly riposte?: number
  /** Surprise, rolled by the attacker: the defender may not counter-attack. */
  readonly counterSuppressed?: true
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
      readonly options: readonly TerrainSlot[]
    }
  | { readonly kind: 'choose_counter_attack'; readonly player: PlayerId; readonly slot: TerrainSlot }
  | {
      readonly kind: 'assign_damage'
      readonly player: PlayerId
      readonly slot: TerrainSlot
      readonly damage: number
    }
  | { readonly kind: 'reinforce'; readonly player: PlayerId }
  | { readonly kind: 'retreat'; readonly player: PlayerId }

/** Actions answer the current `Pending`. Each `kind` matches a `Pending.kind`. */
export type GameAction =
  | { readonly kind: 'choose_march_army'; readonly army: ArmyRef | null }
  | { readonly kind: 'choose_maneuver'; readonly maneuver: boolean }
  | { readonly kind: 'contest_maneuver'; readonly contest: boolean }
  | { readonly kind: 'choose_direction'; readonly direction: Direction }
  | { readonly kind: 'choose_action'; readonly action: ActionKind | null }
  | { readonly kind: 'choose_missile_target'; readonly slot: TerrainSlot }
  | { readonly kind: 'choose_counter_attack'; readonly counter: boolean }
  | { readonly kind: 'assign_damage'; readonly unitIds: readonly UnitId[] }
  | { readonly kind: 'reinforce'; readonly moves: readonly { readonly unitId: UnitId; readonly slot: TerrainSlot }[] }
  | { readonly kind: 'retreat'; readonly unitIds: readonly UnitId[] }

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
      readonly toSlot: TerrainSlot
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
      readonly defenderSlot: TerrainSlot
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
      readonly slot: TerrainSlot
      readonly unitIds: readonly UnitId[]
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
   *  the march simply ends, with no `counter_declined` and no explanation. */
  | { readonly kind: 'counter_suppressed'; readonly player: PlayerId; readonly slot: TerrainSlot }
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
