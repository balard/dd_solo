/**
 * Melee, missile and magic: what is legal, and what a single exchange produces.
 *
 * Pure helpers only -- the step machine that sequences attack, saves, damage and
 * counter-attack lives in `turn.ts`.
 */
import { terrainFaceAction } from '../data/load'
import type { TerrainFaceNumber } from '../data/types'

import type { RollEffect } from './pipeline'
import { rollArmy, type RollResult } from './roll'
import type { RngState } from './rng'
import type { RollContext } from './sai'
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

/**
 * Whether this player's rolls at this terrain double their ID results.
 *
 * The eighth-face holder's bonus. Gated on the ruleset so `captureOnly` still plays
 * the old alpha game, where a capture won and did nothing else.
 */
export function doublesIds(state: GameState, player: PlayerId, slot: TerrainSlot): boolean {
  return state.ruleSet.eighthFace !== 'captureOnly' && state.terrains[slot].capturedBy === player
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
  const defender = opponentOf(player)

  // What the terrain offers, before checking there is anything to hit.
  const offered = eighthFaceActions(state, player, slot) ?? faceActions(state, slot)

  return offered.filter((action) =>
    action === 'missile'
      ? missileTargets(state, player, slot).length > 0
      : armyAt(state, defender, slot).length > 0,
  )
}

/** The single action the terrain's numbered face dictates, or none. */
function faceActions(state: GameState, slot: TerrainSlot): readonly ActionKind[] {
  const action = terrainAction(state, slot)
  return action === null ? [] : [action]
}

/**
 * The eighth face overrides the face-number action entirely: "The army may take a
 * melee, missile, or magic action, but opposing armies at the terrain are restricted
 * to a melee action" (starter rules, Terrain - Eighth Face).
 *
 * Null means "not an eighth face, or the ruleset does not grant this" -- so the
 * caller falls back to the numbered face.
 */
function eighthFaceActions(
  state: GameState,
  player: PlayerId,
  slot: TerrainSlot,
): readonly ActionKind[] | null {
  const terrain = state.terrains[slot]
  if (terrain.face !== 8 || state.ruleSet.eighthFace === 'captureOnly') return null
  return terrain.capturedBy === player ? ['melee', 'missile', 'magic'] : ['melee']
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
  /** Everything the defending army is about to lose units to, saves already taken
   *  off: `max(0, attack - saves)` plus `unsavable`. */
  readonly damage: number
  /** Smite: the part of `damage` the save roll never had a chance at. Reported
   *  separately only so the log can explain itself. */
  readonly unsavable: number
  /** Counter and Volley: damage the *save* roll sent back at the attacking army,
   *  which gets no save roll of its own. Assigned in its own step. */
  readonly riposte: number
  /** Surprise: this attack denies the defender their counter-attack. */
  readonly counterSuppressed: boolean
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
  /**
   * Whether this exchange is the counter-attack rather than the opening attack.
   *
   * Required rather than defaulted: it is what tells Surprise not to fire ("Surprise
   * has no effect during a counter-attack"), while Counter on the same exchange
   * still does, and a default would silently pick one side of that.
   */
  readonly isCounter: boolean
}

/** Total damage of one effect kind. */
function damageFrom(effects: readonly RollEffect[], kind: 'riposte' | 'unsavable'): number {
  return effects.reduce((sum, e) => (e.kind === kind ? sum + e.damage : sum), 0)
}

/**
 * Refuses an effect this roll has nowhere to put.
 *
 * Every effect a roll produces must be consumed by someone. Phase 4's targeting and
 * free-move effects will arrive on rolls that predate them, and the failure mode --
 * an SAI that computes correctly and is then dropped on the floor, with every test
 * green -- is the one this phase came closest to shipping.
 */
function expectOnly(
  effects: readonly RollEffect[],
  allowed: readonly RollEffect['kind'][],
  what: string,
): void {
  for (const effect of effects) {
    if (!allowed.includes(effect.kind)) {
      throw new Error(`${what} produced a ${effect.kind} effect (${effect.sai}), which nothing reads`)
    }
  }
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

  const attackContext: RollContext = {
    purpose: { kind: 'attack', action: spec.action },
    isCounter: spec.isCounter,
  }
  const [attackRoll, afterAttack] = rollArmy(
    attackers,
    spec.action,
    state.rng,
    state.ruleSet,
    doublesIds(state, spec.attacker, spec.attackerSlot),
    attackContext,
  )

  expectOnly(attackRoll.effects, ['unsavable', 'suppress_counter'], `a ${spec.action} attack`)
  const unsavable = damageFrom(attackRoll.effects, 'unsavable')
  const counterSuppressed = attackRoll.effects.some((e) => e.kind === 'suppress_counter')

  if (spec.action === 'magic') {
    return {
      attackTotal: attackRoll.total,
      saveTotal: null,
      damage: magicDamage(attackRoll.total, state.ruleSet) + unsavable,
      unsavable,
      riposte: 0,
      counterSuppressed,
      attackRoll,
      saveRoll: null,
      rng: afterAttack,
    }
  }

  // No results, no save roll -- and so no randomness consumed. The condition is the
  // *attack total*, not the damage: a Smite-only attack rolls zero melee, earns the
  // defender no save roll, and still kills.
  if (attackRoll.total === 0) {
    return {
      attackTotal: 0,
      saveTotal: null,
      damage: unsavable,
      unsavable,
      riposte: 0,
      counterSuppressed,
      attackRoll,
      saveRoll: null,
      rng: afterAttack,
    }
  }

  // The save roll is "rolling the army" too, so the defender's own eighth face
  // doubles their ID saves. It is also where Counter and Volley hit back, which is
  // why it needs to know what it is saving against.
  const saveContext: RollContext = {
    purpose: { kind: 'save', against: spec.action },
    isCounter: spec.isCounter,
  }
  const [saveRoll, afterSave] = rollArmy(
    defenders,
    'save',
    afterAttack,
    state.ruleSet,
    doublesIds(state, spec.defender, spec.defenderSlot),
    saveContext,
  )

  expectOnly(saveRoll.effects, ['riposte'], `a save roll against ${spec.action}`)

  return {
    attackTotal: attackRoll.total,
    saveTotal: saveRoll.total,
    damage: Math.max(0, attackRoll.total - saveRoll.total) + unsavable,
    unsavable,
    riposte: damageFrom(saveRoll.effects, 'riposte'),
    counterSuppressed,
    attackRoll,
    saveRoll,
    rng: afterSave,
  }
}
