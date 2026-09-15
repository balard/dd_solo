/**
 * Rolling an army for a result type.
 *
 * Much smaller than the rulebook makes it sound. The rules give two exceptions --
 * an ID icon generates the unit's health-worth of results, and monster icons count
 * for four -- but the *data already encodes both*: every ID face's count equals its
 * unit's health, and every normal monster face's count is 4. So there is no
 * multiplier, no size lookup, and no branch on `monster` anywhere below.
 *
 * If you find yourself reaching for `unit.size === 'monster'` here, stop: the data
 * is already doing it.
 */
import { unitType } from '../data/load'
import type { Face, NormalIcon, ResultType, UnitType } from '../data/types'

import { rollDie, type RngState } from './rng'
import type { RuleSet, UnitId, UnitInstance } from './types'

/** The face icon that produces each result type. ID matches all of them. */
const ICON_FOR: Readonly<Record<ResultType, NormalIcon>> = {
  melee: 'MELEE',
  missile: 'MISSILE',
  magic: 'MAGIC',
  save: 'SAVE',
  maneuver: 'MANEUVER',
}

export const RESULT_TYPES: readonly ResultType[] = [
  'melee',
  'missile',
  'magic',
  'save',
  'maneuver',
]

/**
 * How many results one face generates when rolling for `resultType`.
 *
 * The whole rule, in three lines.
 */
export function faceResults(face: Face, resultType: ResultType, ruleSet: RuleSet): number {
  // An ID icon generates whatever you are rolling for, health-worth of it -- and
  // `count` is already that health.
  if (face.icon === 'ID') return face.count

  if (face.icon === 'SAI') {
    if (ruleSet.sai === 'inert') return 0
    // Deliberately loud rather than silently zero: turning SAIs on is a v1
    // milestone, and a half-on ruleset should not quietly play a wrong game.
    throw new Error(
      `SAI resolution is not implemented (ruleSet.sai === 'full', face ${face.count} ${face.sai})`,
    )
  }

  return face.icon === ICON_FOR[resultType] ? face.count : 0
}

/** One die's contribution to a roll. Kept per-die so the UI can show the dice and
 *  the log can reconstruct what happened. */
export interface DieRoll {
  readonly unitId: UnitId
  readonly typeId: string
  /** Index into the unit type's `faces`. */
  readonly faceIndex: number
  readonly face: Face
  /** Results this die contributed to the roll's total. */
  readonly results: number
}

export interface RollResult {
  readonly resultType: ResultType
  readonly dice: readonly DieRoll[]
  readonly total: number
}

/**
 * Rolls every die in an army for one result type.
 *
 * The eighth-face ID-doubling bonus is the one modifier it applies, via `doubleIds`.
 * Everything else about a face is already in the data.
 */
export function rollArmy(
  units: readonly UnitInstance[],
  resultType: ResultType,
  rng: RngState,
  ruleSet: RuleSet,
  /**
   * The eighth-face bonus: "When rolling the army, all ID results are doubled"
   * (starter rules, Terrain - Eighth Face). True when this army holds the terrain
   * it is rolling at. It applies to *every* roll that army makes there -- attacks,
   * saves and maneuvers alike -- not just attacks.
   *
   * It lives here rather than in `faceResults` because it is a fact about the
   * board, not about the face: the same die doubles or not depending on where it
   * is standing. `faceResults` stays a pure face-to-results function.
   */
  doubleIds = false,
): readonly [RollResult, RngState] {
  const dice: DieRoll[] = []
  let state = rng
  let total = 0

  for (const unit of units) {
    const type = unitType(unit.typeId)
    const [faceIndex, next] = rollDie(state, type.faces.length)
    state = next

    const face = type.faces[faceIndex]
    if (face === undefined) {
      throw new Error(`${unit.typeId}: rolled face ${faceIndex} but the die has ${type.faces.length}`)
    }

    const rolled = faceResults(face, resultType, ruleSet)
    const results = doubleIds && face.icon === 'ID' ? rolled * 2 : rolled
    total += results
    dice.push({ unitId: unit.id, typeId: unit.typeId, faceIndex, face, results })
  }

  return [{ resultType, dice, total }, state] as const
}

/** The most one die can generate for a result type. Used by the property tests and,
 *  later, by AI evaluation. */
export function maxResults(type: UnitType, resultType: ResultType, ruleSet: RuleSet): number {
  return type.faces.reduce((best, face) => Math.max(best, faceResults(face, resultType, ruleSet)), 0)
}

/** The most an army could generate for a result type, if every die rolled its best face. */
export function maxArmyResults(
  units: readonly UnitInstance[],
  resultType: ResultType,
  ruleSet: RuleSet,
): number {
  return units.reduce((sum, u) => sum + maxResults(unitType(u.typeId), resultType, ruleSet), 0)
}
