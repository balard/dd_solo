/**
 * Core engine types.
 *
 * Nothing here knows about React, the DOM, or which player is human. The engine is
 * a pure reducer over these values; see `docs/OVERVIEW.md` section 2.
 */
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
  | 'offer_counter'
  | 'resolve_counter'
  | 'assign_counter_damage'

/** The exchange currently being resolved. */
export interface CombatState {
  readonly action: ActionKind
  /** The terrain holding the army under attack. */
  readonly targetSlot: TerrainSlot
  /** Damage awaiting assignment by whoever is about to lose units. */
  readonly damage: number
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
  | { readonly kind: 'counter_declined'; readonly player: PlayerId }
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
  readonly sai: 'inert' | 'full'
  /**
   * `captureOnly` — a captured terrain wins the game and does nothing else.
   * `standard`    — plus the two advantages the rules grant any holder: ID results
   *                 doubled when rolling that army, and the action restriction
   *                 (holder may melee/missile/magic, everyone else melee only).
   * `full`        — plus the Eighth Face Icon powers (City, Standing Stones,
   *                 Temple, Tower), which are still cut.
   */
  readonly eighthFace: 'captureOnly' | 'standard' | 'full'
  readonly dragons: boolean
}

export const V0_RULES: RuleSet = {
  magic: 'simplified',
  sai: 'inert',
  eighthFace: 'standard',
  dragons: false,
}

export interface GameState {
  readonly ruleSet: RuleSet
  readonly rng: RngState
  readonly units: Readonly<Record<UnitId, UnitInstance>>
  readonly terrains: Readonly<Record<TerrainSlot, TerrainInPlay>>
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

/** Units still in play -- not in the Dead Unit Area. A player with none has lost. */
export function livingUnits(state: GameState, player: PlayerId): readonly UnitInstance[] {
  return Object.values(state.units).filter((u) => u.owner === player && u.location.kind !== 'dua')
}

export function army(state: GameState, player: PlayerId, ref: ArmyRef): readonly UnitInstance[] {
  return ref === 'reserve' ? reserveArmy(state, player) : armyAt(state, player, ref)
}

export function capturedCount(state: GameState, player: PlayerId): number {
  return TERRAIN_SLOTS.filter((slot) => state.terrains[slot].capturedBy === player).length
}
