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
 * is step 5; `saiEffects` in `sai.ts` is where they come from, and it is the one
 * place that refuses an SAI the ruleset cannot play.
 *
 * It used to carry a copy of that refusal, which was right while `'full'` threw for
 * every SAI alike and wrong the moment one of them was implemented: this function
 * cannot tell a Counter from a Choke, so its throw would have refused the ones that
 * work. `ruleSet` stays in the signature because the caller has it and a future rung
 * may yet change what a *normal* face is worth.
 */
export function faceResults(face: Face, resultType: ResultType, _ruleSet: RuleSet): number {
  // An ID icon generates whatever you are rolling for, health-worth of it -- and
  // `count` is already that health.
  if (face.icon === 'ID') return face.count

  // Step 8, not step 5. `saiEffects` owns both the results and the refusal.
  if (face.icon === 'SAI') return 0

  return face.icon === ICON_FOR[resultType] ? face.count : 0
}

/**
 * A die as it landed: everything randomness decided about it, and nothing else.
 *
 * The `Face` is not stored because it *follows* from `(typeId, faceIndex)` through
 * the same data the roll read it from -- the argument `digest.ts` already makes for
 * rendering a die as `unitId@faceIndex=results`. Keeping it out is what lets a raw
 * die be stashed in `CombatState` across a decision without putting a face object in
 * the golden digest.
 */
export interface RawDie {
  readonly unitId: UnitId
  readonly typeId: string
  /** Index into the unit type's `faces`. */
  readonly faceIndex: number
  /** Step 3: this die was rolled again by an SAI, and both faces count. */
  readonly reroll?: true
}

/** The face a raw die is showing. */
export function faceOf(die: RawDie): Face {
  const type = unitType(die.typeId)
  const face = type.faces[die.faceIndex]
  if (face === undefined) {
    throw new Error(`${die.typeId}: rolled face ${die.faceIndex} but the die has ${type.faces.length}`)
  }
  return face
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
  /**
   * What this die produced that was not a number -- Smite's unsavable damage,
   * Counter's riposte, Surprise's suppression.
   *
   * Display only: `RollOutcome.effects` is the authoritative copy and the one the
   * engine reads, stamped with the unit that made each one. This is here because the
   * roll strip had no way to tell a die that did nothing from a die whose whole
   * contribution was an effect -- a Fireshadow that Smote for 4 rendered greyed out
   * and blank, next to a log line reporting 4 damage from nowhere.
   *
   * Omitted when empty, and invisible to the golden digest either way, which renders
   * a die as `unitId@faceIndex=results`.
   */
  readonly effects?: readonly RollEffectBody[]
}


/**
 * Which SAIs produced an effect of this kind, by name, in roll order and without
 * repeats.
 *
 * `combat_resolved` carries the totals -- 4 riposte, 4 unsavable -- and the
 * attribution is on the dice, so this is what lets a log line say *Counter* sent 4
 * back rather than "4 straight back, which no save can stop". Both clients need it,
 * which is why it lives beside `DieRoll` rather than in either of them.
 *
 * Empty for a roll from before `DieRoll.effects` existed, or one under a ruleset
 * where no SAI fires -- so a caller has to have a wording that works without names.
 */
export function saisBehind(
  dice: readonly DieRoll[],
  kind: RollEffectBody['kind'],
): readonly string[] {
  const names: string[] = []
  for (const die of dice) {
    if (die.face.icon !== 'SAI') continue
    if (!(die.effects ?? []).some((effect) => effect.kind === kind)) continue
    if (!names.includes(die.face.sai)) names.push(die.face.sai)
  }
  return names
}

/**
 * The same names as one phrase -- "Counter", or "Counter and Volley" -- or null when
 * the roll named none.
 *
 * Null rather than an empty string because the two cases want different sentences,
 * not the same sentence with a hole in it. Shared so the browser and the terminal
 * cannot drift into wording the other does not have.
 */
export function saiPhrase(
  dice: readonly DieRoll[],
  kind: RollEffectBody['kind'],
): string | null {
  const names = saisBehind(dice, kind)
  if (names.length === 0) return null
  if (names.length === 1) return names[0] ?? null
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
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
  /**
   * Step 8 results a *player* supplied rather than a face: Wild Growth's save share,
   * from Phase 4e.
   *
   * It joins exactly where an SAI's own results join -- after step 7's divide, before
   * step 9's multiply -- which is the whole reason it is a spec field and not a number
   * added to the final total. The two agree only while no step-9 multiplier has
   * `share: 'all'`, and the eighth face's does not *yet*.
   *
   * Nothing writes it in Phase 4a. `resolveFaces` being pure is what lets a later
   * phase resolve the same faces twice -- once to discover the decision, once with
   * the answer -- without a second draw.
   */
  readonly saiResults?: Readonly<Partial<Record<ResultType, number>>>
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
 * Step 1: every die, once, in unit order.
 *
 * Deliberately says nothing about what the faces mean -- it takes no `RollSpec` and
 * no `RuleSet`, so "what randomness decided" and "what the rules make of it" are two
 * functions and a caller cannot accidentally do the second twice.
 */
export function rollFaces(
  units: readonly UnitInstance[],
  rng: RngState,
): readonly [readonly RawDie[], RngState] {
  const dice: RawDie[] = []
  let state = rng

  for (const unit of units) {
    const [faceIndex, next] = rollDie(state, unitType(unit.typeId).faces.length)
    state = next
    dice.push({ unitId: unit.id, typeId: unit.typeId, faceIndex })
  }

  return [dice, state] as const
}

/**
 * Step 3: reroll the dice an SAI says to, and append each new face to the list.
 *
 * **A separate sweep, not interleaved with step 1.** So `dice` always begins with one
 * entry per unit, in unit order -- exactly the stream v0 consumed -- and every entry
 * after that is a step-3 reroll. Interleaving would collapse the two steps and be
 * wrong the moment Bullseye and Double Strike reroll at a different point than Rend
 * does.
 *
 * **The queue is drained FIFO**, in the order the rerolls were generated. With Rend
 * on one face of one unit type FIFO and depth-first are indistinguishable today,
 * which is exactly why the choice would otherwise be made by accident -- and once a
 * game is recorded, the order is load-bearing forever.
 */
export function rerollSweep(
  dice: readonly RawDie[],
  spec: RollSpec,
  ruleSet: RuleSet,
  rng: RngState,
): readonly [readonly RawDie[], RngState] {
  const out: RawDie[] = [...dice]
  const queue: RawDie[] = dice.filter((die) => classify(faceOf(die), spec, ruleSet).reroll)

  let state = rng
  let rerolled = 0

  while (queue.length > 0) {
    const die = queue.shift()
    if (die === undefined) break
    if (++rerolled > MAX_REROLLS_PER_ROLL) {
      throw new Error(
        `${die.typeId} (${die.unitId}) rerolled ${MAX_REROLLS_PER_ROLL} times in one roll; ` +
          `an SAI handler is asking for a reroll unconditionally`,
      )
    }

    const [faceIndex, next] = rollDie(state, unitType(die.typeId).faces.length)
    state = next

    const again: RawDie = {
      unitId: die.unitId,
      typeId: die.typeId,
      faceIndex,
      reroll: true as const,
    }
    out.push(again)
    if (classify(faceOf(again), spec, ruleSet).reroll) queue.push(again)
  }

  return [out, state] as const
}

/**
 * Steps 4 to 10: what the rules make of faces already on the table.
 *
 * **Pure.** No RNG, no `GameState`, and no dependence on anything but the dice, the
 * spec and the ruleset -- which is what lets a phase with a mid-roll decision resolve
 * the same dice twice, once to discover the question and once with the answer, and
 * consume no extra randomness doing it.
 */
export function resolveFaces(
  dice: readonly RawDie[],
  spec: RollSpec,
  ruleSet: RuleSet,
): RollOutcome {
  const primary = primaryKind(spec)

  const shown: DieRoll[] = []
  const normals = new Map<ResultType, number>(spec.kinds.map((kind) => [kind, 0]))
  // Seeded with the player's own step-8 results, which join exactly where a face's do.
  const saiResults = new Map<ResultType, number>(
    spec.kinds.map((kind) => [kind, spec.saiResults?.[kind] ?? 0]),
  )
  const effects: RollEffect[] = []
  let idPool = 0

  for (const die of dice) {
    const face = faceOf(die)
    const contribution = classify(face, spec, ruleSet)

    idPool += contribution.idPool
    for (const kind of spec.kinds) {
      normals.set(kind, (normals.get(kind) ?? 0) + (contribution.normals[kind] ?? 0))
      saiResults.set(kind, (saiResults.get(kind) ?? 0) + (contribution.saiResults[kind] ?? 0))
    }
    for (const effect of contribution.effects) {
      effects.push({ ...effect, unitId: die.unitId, sai: contribution.saiName ?? '' })
    }

    shown.push({
      unitId: die.unitId,
      typeId: die.typeId,
      faceIndex: die.faceIndex,
      face,
      results: perDieResults(face, contribution, primary, spec.modifiers),
      ...(die.reroll === true ? { reroll: true as const } : {}),
      ...(contribution.effects.length > 0 ? { effects: contribution.effects } : {}),
    })
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

  return { dice: shown, totals, effects }
}

/**
 * Rolls a set of dice and resolves the result: steps 1 and 3 to 10.
 *
 * The composition of the three above, and the door every roll that needs no pause
 * goes through. A phase that *does* need one calls the three in turn and stops in
 * between; see `combat.ts`, which splits an exchange across two march steps.
 */
export function resolveRoll(
  units: readonly UnitInstance[],
  spec: RollSpec,
  rng: RngState,
  ruleSet: RuleSet,
): readonly [RollOutcome, RngState] {
  const [rolled, afterRoll] = rollFaces(units, rng)
  const [swept, afterSweep] = rerollSweep(rolled, spec, ruleSet, afterRoll)
  return [resolveFaces(swept, spec, ruleSet), afterSweep] as const
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
   * Everything the board says about this roll: the eighth-face holder's doubled ID
   * results, and every effect with a duration sitting on the army.
   *
   * All of it is a fact about the board rather than about any face -- the same die
   * doubles or not depending on where it is standing -- so `faceResults` stays a pure
   * face-to-results function and this rides in at steps 6 to 10. Gather it with
   * `armyRoll` in `effects.ts`, which returns the modifiers and the rollable units
   * together so that a call site cannot take one and forget the other.
   *
   * This was a `doubleIds: boolean` while the eighth face was the only thing in the
   * game with an opinion about a roll.
   */
  modifiers: readonly Modifier[] = [],
  /** What the roll is for; see `defaultContextFor` for what leaving it out means. */
  context: RollContext = defaultContextFor(resultType),
): readonly [RollResult, RngState] {
  const [outcome, next] = resolveRoll(
    units,
    {
      kinds: [resultType],
      modifiers,
      context,
    },
    rng,
    ruleSet,
  )

  return [asResult(outcome, resultType), next] as const
}

/**
 * A one-type outcome read as a `RollResult`.
 *
 * `RollOutcome.totals` is the authoritative shape -- a combination roll has no single
 * total -- but every roll in the game today counts exactly one type, and the rest of
 * the engine is written against `RollResult`. Shared so that a caller which resolves
 * the faces itself, because it had to stop in the middle, reads them the same way
 * `rollArmy` does.
 */
export function asResult(outcome: RollOutcome, resultType: ResultType): RollResult {
  return {
    resultType,
    dice: outcome.dice,
    total: outcome.totals[resultType] ?? 0,
    effects: outcome.effects,
  }
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
