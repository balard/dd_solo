/**
 * Rolling an army: steps 1, 3, 4 and 5 of the pipeline, on top of `pipeline.ts`'s
 * 6 to 10.
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
  type RollEffectBody,
} from './pipeline'
import { rollDie, type RngState } from './rng'
import { saiEffects, saiMaxResults, type RollContext } from './sai'
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
 * A roll that rerolls forever is a bug in a handler, not a game. Rend chains
 * genuinely -- a reroll showing Rend rerolls again -- but on a d6 carrying one Rend
 * face the chance of reaching this is around 10^-78, so hitting it means something
 * is returning `reroll: true` unconditionally.
 */
const MAX_REROLLS_PER_ROLL = 100

/**
 * How many results one face generates when rolling for `resultType`.
 *
 * The whole rule, in three lines -- and it stays that way. An SAI face contributes
 * nothing *here* whatever the ruleset says, because SAI results are step 8 and this
 * is step 5; `saiEffects` in `sai.ts` is where they come from. The `'full'` throw
 * stays as the guard that a half-built ruleset cannot quietly play a wrong game.
 */
export function faceResults(face: Face, resultType: ResultType, ruleSet: RuleSet): number {
  // An ID icon generates whatever you are rolling for, health-worth of it -- and
  // `count` is already that health.
  if (face.icon === 'ID') return face.count

  if (face.icon === 'SAI') {
    if (ruleSet.sai === 'full') {
      throw new Error(
        `targeting SAIs are not implemented (ruleSet.sai === 'full', face ${face.count} ${face.sai})`,
      )
    }
    return 0
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
  /** Step 3: this die was rolled again by an SAI, and both faces count. Present only
   *  when true, and invisible to the golden digest, which renders a die as
   *  `unitId@faceIndex=results`. */
  readonly reroll?: true
}

export interface RollResult {
  readonly resultType: ResultType
  readonly dice: readonly DieRoll[]
  readonly total: number
  /**
   * Everything the roll produced that is not a number.
   *
   * Present on `RollResult` and not only on `RollOutcome` because `combat.ts` calls
   * `rollArmy`, never `resolveRoll`: without this field a riposte or a Smite would be
   * computed correctly and then dropped on the floor, with every test still green.
   */
  readonly effects: readonly RollEffect[]
}

export interface RollSpec {
  /**
   * Which result types this roll counts for. One for an ordinary roll; melee,
   * missile and save together for a dragon's combination roll (Phase 6).
   */
  readonly kinds: readonly ResultType[]
  readonly modifiers: readonly Modifier[]
  /**
   * What the roll is *for*, which is a different question from what it counts. SAIs
   * apply by roll type -- "during a melee attack", "during a save roll against a
   * missile action" -- so this is what decides whether a face does anything at all.
   */
  readonly context: RollContext
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

/** The type a roll's per-die display number is counted in: the first of its kinds. */
function primaryKind(spec: RollSpec): ResultType {
  const primary = spec.kinds[0]
  if (primary === undefined) throw new Error('a roll needs at least one result type')
  return primary
}

/** One face, sorted into the pipeline steps it feeds. */
interface Contribution {
  /** Step 5, held apart because step 6 removes ID results last. */
  readonly idPool: number
  readonly normals: Readonly<Partial<Record<ResultType, number>>>
  /** Step 8. */
  readonly saiResults: Readonly<Partial<Record<ResultType, number>>>
  readonly effects: readonly RollEffectBody[]
  /** Which SAI produced those effects, for the log. Null on a normal face. */
  readonly saiName: string | null
  /** Step 3. */
  readonly reroll: boolean
}

const NO_SAI = { saiResults: {}, effects: [], saiName: null, reroll: false } as const

/**
 * Sorts one rolled face into the steps it feeds.
 *
 * One function, used by both passes below. Two of these would drift, and the way
 * they would drift is a rerolled die counting differently from a first-rolled one.
 */
function classify(face: Face, spec: RollSpec, ruleSet: RuleSet): Contribution {
  if (face.icon === 'ID') {
    // An ID face generates the unit's health-worth of whatever is being rolled for,
    // and `count` is already that health. Which *type* it counts as is settled at
    // step 5 by `allocateIds`.
    return { idPool: face.count, normals: {}, ...NO_SAI }
  }

  if (face.icon === 'SAI') {
    // `saiEffects` carries the `'full'` throw, so a half-built ruleset still refuses
    // to play here exactly as `faceResults` used to make it.
    const outcome = saiEffects(face, spec.context, ruleSet)
    return {
      idPool: 0,
      normals: {},
      saiResults: outcome.results,
      effects: outcome.effects,
      saiName: face.sai,
      reroll: outcome.reroll,
    }
  }

  const normals: Partial<Record<ResultType, number>> = {}
  for (const kind of spec.kinds) normals[kind] = faceResults(face, kind, ruleSet)
  return { idPool: 0, normals, ...NO_SAI }
}

/**
 * The per-die number the log and the UI show: its step-5 and step-8 contribution to
 * the roll's primary type, doubled if the eighth face is doubling ID results.
 *
 * The authoritative total is `RollOutcome.totals`, which the pipeline computes in
 * the aggregate. This is the same arithmetic on one die, kept because a roll strip
 * showing five dice that do not add up to the total is worse than useless -- and
 * because ID doubling is the one modifier that is per-die by nature. SAI results are
 * added *undoubled*: step 8 runs after step 7 and the only multiplier in play
 * multiplies the ID share alone.
 */
function perDieResults(
  face: Face,
  contribution: Contribution,
  primary: ResultType,
  modifiers: readonly Modifier[],
): number {
  const sai = contribution.saiResults[primary] ?? 0

  if (face.icon !== 'ID') return (contribution.normals[primary] ?? 0) + sai

  for (const modifier of modifiers) {
    if (modifier.kind === 'multiply' && modifier.share === 'id' && modifier.resultType === primary) {
      return contribution.idPool * modifier.by + sai
    }
  }
  return contribution.idPool + sai
}

/**
 * Rolls a set of dice and resolves the result: steps 1 and 3 to 10.
 *
 * **Two passes, not one interleaved sweep.** Step 1 rolls *every* die; step 3 is a
 * separate sweep that rerolls the ones an SAI says to. So `dice` always begins with
 * one entry per unit, in unit order -- exactly the stream v0 consumed -- and every
 * entry after that is a step-3 reroll. Interleaving would collapse the two steps and
 * be wrong the moment Phase 4's Bullseye and Double Strike reroll at a different
 * point than Rend does.
 *
 * **The reroll queue is drained FIFO**, in the order the rerolls were generated.
 * With Rend on one face of one unit type FIFO and depth-first are indistinguishable
 * today, which is exactly why the choice would otherwise be made by accident -- and
 * once a game is recorded, the order is load-bearing forever.
 */
export function resolveRoll(
  units: readonly UnitInstance[],
  spec: RollSpec,
  rng: RngState,
  ruleSet: RuleSet,
): readonly [RollOutcome, RngState] {
  const primary = primaryKind(spec)

  const dice: DieRoll[] = []
  const normals = new Map<ResultType, number>(spec.kinds.map((kind) => [kind, 0]))
  const saiResults = new Map<ResultType, number>(spec.kinds.map((kind) => [kind, 0]))
  const effects: RollEffect[] = []
  let idPool = 0
  let state = rng

  /** Rolls one die, folds it into the running totals, and says whether step 3 owes
   *  it another roll. */
  function rollOne(unit: UnitInstance, isReroll: boolean): boolean {
    const type = unitType(unit.typeId)
    const [faceIndex, next] = rollDie(state, type.faces.length)
    state = next

    const face = type.faces[faceIndex]
    if (face === undefined) {
      throw new Error(`${unit.typeId}: rolled face ${faceIndex} but the die has ${type.faces.length}`)
    }

    const contribution = classify(face, spec, ruleSet)

    idPool += contribution.idPool
    for (const kind of spec.kinds) {
      normals.set(kind, (normals.get(kind) ?? 0) + (contribution.normals[kind] ?? 0))
      saiResults.set(kind, (saiResults.get(kind) ?? 0) + (contribution.saiResults[kind] ?? 0))
    }
    for (const effect of contribution.effects) {
      effects.push({ ...effect, unitId: unit.id, sai: contribution.saiName ?? '' })
    }

    dice.push({
      unitId: unit.id,
      typeId: unit.typeId,
      faceIndex,
      face,
      results: perDieResults(face, contribution, primary, spec.modifiers),
      ...(isReroll ? { reroll: true as const } : {}),
    })

    return contribution.reroll
  }

  // Step 1.
  const queue: UnitInstance[] = []
  for (const unit of units) {
    if (rollOne(unit, false)) queue.push(unit)
  }

  // Step 3.
  let rerolled = 0
  while (queue.length > 0) {
    const unit = queue.shift()
    if (unit === undefined) break
    if (++rerolled > MAX_REROLLS_PER_ROLL) {
      throw new Error(
        `${unit.typeId} (${unit.id}) rerolled ${MAX_REROLLS_PER_ROLL} times in one roll; ` +
          `an SAI handler is asking for a reroll unconditionally`,
      )
    }
    if (rollOne(unit, true)) queue.push(unit)
  }

  const allocation = allocateIds(idPool, spec.kinds, spec.idAllocation)
  const totals: Partial<Record<ResultType, number>> = {}

  for (const kind of spec.kinds) {
    totals[kind] = applyModifiers(
      {
        id: allocation.get(kind) ?? 0,
        normal: normals.get(kind) ?? 0,
        sai: saiResults.get(kind) ?? 0,
      },
      kind,
      spec.modifiers,
    )
  }

  return [{ dice, totals, effects }, state] as const
}

/**
 * Refuses a roll effect that the caller has nowhere to put.
 *
 * Every effect a roll produces has to be consumed by someone. A maneuver roll and
 * the order-of-play roll-off have no channel for one, and Phase 4 gives Firewalking
 * and Teleport an effect on exactly those rolls -- so this is what stops them being
 * computed correctly and then dropped on the floor with every test still green.
 */
export function expectNoEffects(roll: RollResult, what: string): void {
  const effect = roll.effects[0]
  if (effect !== undefined) {
    throw new Error(`${what} produced a ${effect.kind} effect (${effect.sai}), which nothing reads`)
  }
}

/**
 * What a roll is for, when the caller has not said.
 *
 * A save roll defaults to `against: null` -- "any other save roll" in the SAI
 * reference -- which is the *narrow* reading: Counter and Volley generate their
 * saves and no riposte. So forgetting to pass a context loses damage rather than
 * inventing it, and `combat.ts` has a test that it does not forget.
 */
export function defaultContextFor(resultType: ResultType): RollContext {
  if (resultType === 'save') return { purpose: { kind: 'save', against: null }, isCounter: false }
  if (resultType === 'maneuver') return { purpose: { kind: 'maneuver' }, isCounter: false }
  return { purpose: { kind: 'attack', action: resultType }, isCounter: false }
}

/**
 * Rolls every die in an army for one result type.
 *
 * A thin door onto `resolveRoll`, which is where the rulebook's ten-step pipeline
 * lives. This shape -- one result type, one number -- is all that most of the engine
 * needs, so it stays: a combination roll and a modifier list are `resolveRoll`'s
 * business.
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
  /** What the roll is for; see `defaultContextFor` for what leaving it out means. */
  context: RollContext = defaultContextFor(resultType),
): readonly [RollResult, RngState] {
  const [outcome, next] = resolveRoll(
    units,
    {
      kinds: [resultType],
      modifiers: doubleIds ? [doubleIdsModifier(resultType)] : [],
      context,
    },
    rng,
    ruleSet,
  )

  return [
    {
      resultType,
      dice: outcome.dice,
      total: outcome.totals[resultType] ?? 0,
      effects: outcome.effects,
    },
    next,
  ] as const
}

/** The most one die can generate for a result type. Used by the property tests and,
 *  later, by AI evaluation. */
export function maxResults(type: UnitType, resultType: ResultType, ruleSet: RuleSet): number {
  return type.faces.reduce(
    (best, face) =>
      Math.max(
        best,
        face.icon === 'SAI'
          ? saiMaxResults(face, resultType, ruleSet)
          : faceResults(face, resultType, ruleSet),
      ),
    0,
  )
}

/**
 * The most an army could generate for a result type, if every die rolled its best
 * face.
 *
 * **Not a bound on a roll's total once rerolls exist** -- a Rend adds a die to the
 * roll that this sum does not count. Bound a roll by its own `dice` instead:
 * `Σ maxResults(unitType(die.typeId), ...)`.
 */
export function maxArmyResults(
  units: readonly UnitInstance[],
  resultType: ResultType,
  ruleSet: RuleSet,
): number {
  return units.reduce((sum, u) => sum + maxResults(unitType(u.typeId), resultType, ruleSet), 0)
}
