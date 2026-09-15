/**
 * Melee, missile and magic: what is legal, and what a single exchange produces.
 *
 * Pure helpers only -- the step machine that sequences attack, saves, damage and
 * counter-attack lives in `turn.ts`.
 */
import { terrainFaceAction } from '../data/load'
import type { TerrainFaceNumber } from '../data/types'

import { rollArmy, type RollResult } from './roll'
import type { RngState } from './rng'
import {
  TERRAIN_SLOTS,
  armyAt,
  opponentOf,
  type ActionKind,
  type GameState,
  type PlayerId,
  type RuleSet,
  type TerrainSlot,
} from './types'

/** RULES-V0.md section 4: two magic symbols per point of damage. */
const MAGIC_RESULTS_PER_DAMAGE = 2

/** The action a terrain's current face permits, or null on the eighth face. */
export function terrainAction(state: GameState, slot: TerrainSlot): ActionKind | null {
  const terrain = state.terrains[slot]
  if (terrain.face === 8) return null
  return terrainFaceAction(terrain.dieId, terrain.face as TerrainFaceNumber).toLowerCase() as ActionKind
}

/** A Home Terrain, as opposed to the Frontier. */
const isHome = (slot: TerrainSlot): boolean => slot !== 'frontier'

/**
 * Armies a missile action from `fromSlot` may target.
 *
 * "You cannot target the opponent's Reserves Army or attack from one Home Terrain
 * to the other Home Terrain." Reserves fall out for free, since a reserve army is
 * not at a terrain and so cannot be named by a slot.
 */
export function missileTargets(
  state: GameState,
  attacker: PlayerId,
  fromSlot: TerrainSlot,
): readonly TerrainSlot[] {
  const defender = opponentOf(attacker)
  return TERRAIN_SLOTS.filter((slot) => {
    if (armyAt(state, defender, slot).length === 0) return false
    if (isHome(fromSlot) && isHome(slot) && slot !== fromSlot) return false
    return true
  })
}

/**
 * What the marching army may actually do at this terrain.
 *
 * The terrain face dictates *which* action, but an action with nothing to hit is
 * not on offer: melee and magic need an opposing army at the same terrain, and
 * missile needs at least one reachable target. Returning an empty list is how the
 * engine says "you may only pass".
 *
 * Kept as an array rather than a single value because the v1 eighth face lets the
 * controlling army choose between all three.
 */
export function legalActions(
  state: GameState,
  player: PlayerId,
  slot: TerrainSlot,
): readonly ActionKind[] {
  const action = terrainAction(state, slot)
  if (action === null) return []

  const defender = opponentOf(player)
  switch (action) {
    case 'melee':
    case 'magic':
      return armyAt(state, defender, slot).length > 0 ? [action] : []
    case 'missile':
      return missileTargets(state, player, slot).length > 0 ? [action] : []
  }
}

/** Damage from a magic action. RULES-V0.md section 4; `floor` is deliberate. */
export function magicDamage(total: number, ruleSet: RuleSet): number {
  if (ruleSet.magic !== 'simplified') {
    throw new Error(`spellcasting is not implemented (ruleSet.magic === '${ruleSet.magic}')`)
  }
  return Math.floor(total / MAGIC_RESULTS_PER_DAMAGE)
}

export interface AttackOutcome {
  readonly attackTotal: number
  /** null when no save roll was made -- magic allows none, and a zero attack earns none. */
  readonly saveTotal: number | null
  readonly damage: number
  /** The dice themselves, so the UI can show what landed rather than only the sum. */
  readonly attackRoll: RollResult
  readonly saveRoll: RollResult | null
  readonly rng: RngState
}

export interface AttackSpec {
  readonly action: ActionKind
  readonly attacker: PlayerId
  readonly attackerSlot: TerrainSlot
  readonly defender: PlayerId
  readonly defenderSlot: TerrainSlot
}

/**
 * One attack: the attacker rolls, the defender saves if there is anything to save
 * against, and the difference is the damage.
 *
 * Two details worth not losing:
 *
 *  - A save roll only happens if the attack generated at least one result. A zero
 *    attack does not merely deal no damage, it produces no save roll at all -- and
 *    so does not consume any randomness.
 *  - Magic in v0 allows no save whatsoever, so `saveTotal` stays null however large
 *    the roll.
 */
export function resolveAttack(state: GameState, spec: AttackSpec): AttackOutcome {
  const attackers = armyAt(state, spec.attacker, spec.attackerSlot)
  const defenders = armyAt(state, spec.defender, spec.defenderSlot)

  const [attackRoll, afterAttack] = rollArmy(attackers, spec.action, state.rng, state.ruleSet)

  if (spec.action === 'magic') {
    return {
      attackTotal: attackRoll.total,
      saveTotal: null,
      damage: magicDamage(attackRoll.total, state.ruleSet),
      attackRoll,
      saveRoll: null,
      rng: afterAttack,
    }
  }

  if (attackRoll.total === 0) {
    return { attackTotal: 0, saveTotal: null, damage: 0, attackRoll, saveRoll: null, rng: afterAttack }
  }

  const [saveRoll, afterSave] = rollArmy(defenders, 'save', afterAttack, state.ruleSet)
  return {
    attackTotal: attackRoll.total,
    saveTotal: saveRoll.total,
    damage: Math.max(0, attackRoll.total - saveRoll.total),
    attackRoll,
    saveRoll,
    rng: afterSave,
  }
}
