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

import {
  allocateIds,
  applyModifiers,
  doubleIdsModifier,
  type IdAllocation,
  type Modifier,
  type RollEffect,
} from './pipeline'
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

export interface RollSpec {
  /**
   * Which result types this roll counts for. One for an ordinary roll; melee,
   * missile and save together for a dragon's combination roll (Phase 6).
   */
  readonly kinds: readonly ResultType[]
  readonly modifiers: readonly Modifier[]
  /**
   * How many ID results each kind receives. The rules let the owner choose this at
   * step 5, but only a combination roll has a choice to make -- with one kind every
   * ID goes to it. Required, and must spend the pool exactly, when `kinds` names
   * more than one.
   */
  readonly idAllocation?: IdAllocation
}

export interface RollOutcome {
  readonly dice: readonly DieRoll[]
  readonly totals: Readonly<Partial<Record<ResultType, number>>>
  readonly effects: readonly RollEffect[]
}

/**
 * The per-die number the log and the UI show: its step-5 contribution, doubled if
 * the eighth face is doubling ID results for this type.
 *
 * The authoritative total is `RollOutcome.totals`, which the pipeline computes in
 * the aggregate. This is the same arithmetic on one die, kept because a roll strip
 * showing five dice that do not add up to the total is worse than useless -- and
 * because this is the one modifier that is per-die by nature.
 */
function perDieResults(
  face: Face,
  primary: ResultType,
  ruleSet: RuleSet,
  modifiers: readonly Modifier[],
): number {
  const rolled = faceResults(face, primary, ruleSet)
  if (face.icon !== 'ID') return rolled

  for (const modifier of modifiers) {
    if (modifier.kind === 'multiply' && modifier.share === 'id' && modifier.resultType === primary) {
      return rolled * modifier.by
    }
  }
  return rolled
}

/**
 * Rolls a set of dice and resolves the result: step 1, and steps 5 to 10.
 *
 * Consumes exactly one draw per die, in order, which is what lets a game replay die
 * for die however the arithmetic in `pipeline.ts` grows.
 */
export function resolveRoll(
  units: readonly UnitInstance[],
  spec: RollSpec,
  rng: RngState,
  ruleSet: RuleSet,
): readonly [RollOutcome, RngState] {
  const primary = spec.kinds[0]
  if (primary === undefined) throw new Error('a roll needs at least one result type')

  const dice: DieRoll[] = []
  const normals = new Map<ResultType, number>(spec.kinds.map((kind) => [kind, 0]))
  let idPool = 0
  let state = rng

  for (const unit of units) {
    const type = unitType(unit.typeId)
    const [faceIndex, next] = rollDie(state, type.faces.length)
    state = next

    const face = type.faces[faceIndex]
    if (face === undefined) {
      throw new Error(
        `${unit.typeId}: rolled face ${faceIndex} but the die has ${type.faces.length}`,
      )
    }

    if (face.icon === 'ID') {
      // An ID face generates the unit's health-worth of whatever is being rolled
      // for, and `count` is already that health. Which *type* it counts as is
      // settled below, at step 5.
      idPool += face.count
    } else {
      for (const kind of spec.kinds) {
        // Still through `faceResults`, so a SAI face under `sai: 'full'` throws
        // here exactly as it did before the pipeline existed.
        normals.set(kind, (normals.get(kind) ?? 0) + faceResults(face, kind, ruleSet))
      }
    }

    dice.push({
      unitId: unit.id,
      typeId: unit.typeId,
      faceIndex,
      face,
      results: perDieResults(face, primary, ruleSet, spec.modifiers),
    })
  }

  const allocation = allocateIds(idPool, spec.kinds, spec.idAllocation)
  const totals: Partial<Record<ResultType, number>> = {}

  for (const kind of spec.kinds) {
    totals[kind] = applyModifiers(
      { id: allocation.get(kind) ?? 0, normal: normals.get(kind) ?? 0, sai: 0 },
      kind,
      spec.modifiers,
    )
  }

  return [{ dice, totals, effects: [] }, state] as const
}

/**
 * Rolls every die in an army for one result type.
 *
 * A thin door onto `resolveRoll`, which is where the rulebook's ten-step pipeline
 * lives. This shape -- one result type, one number -- is all that v0 ever needs, so
 * it stays: a combination roll and a modifier list are `resolveRoll`'s business.
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
   * It is a fact about the board rather than about the face -- the same die doubles
   * or not depending on where it is standing -- so `faceResults` stays a pure
   * face-to-results function and this rides in as a step-9 modifier.
   */
  doubleIds = false,
): readonly [RollResult, RngState] {
  const [outcome, next] = resolveRoll(
    units,
    {
      kinds: [resultType],
      modifiers: doubleIds ? [doubleIdsModifier(resultType)] : [],
    },
    rng,
    ruleSet,
  )

  return [{ resultType, dice: outcome.dice, total: outcome.totals[resultType] ?? 0 }, next] as const
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
