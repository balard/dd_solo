/**
 * What an army is expected to roll, in closed form (v1 Phase 10a).
 *
 * **The one place the AI turns faces into numbers.** Every scorer in `GreedyAI` reads
 * the board through this file, so two decisions cannot disagree about what the same
 * army is worth. It is `OVERVIEW.md` section 4's observation made into code: every die's
 * face distribution is fully known and tiny, so an expectation is a sum over faces
 * rather than a sample.
 *
 * It is built out of the engine's own doors rather than beside them, and that is the
 * whole design:
 *
 * - a face's worth comes from `faceResults` and `saiEffects`, so an SAI counts only in
 *   the rolls its `Applies` column names -- a Fly on a monster is worth nothing to a
 *   melee attack here, exactly as it is in play;
 * - an army's dice and modifiers come from `armyRoll`, so a sleeping die drops out and
 *   a Galeforce, a Stone Skin, the eighth face's doubled IDs and Flaming Shields reach
 *   the estimate without this file naming any of them. An estimator that gathered its
 *   own modifiers would be the second door `armyRoll` exists to prevent;
 * - the arithmetic is `applyModifiers`, which takes fractional shares without
 *   complaint. Step 6's floor and step 7's round-down then act on an expectation
 *   rather than on a roll, which is an approximation -- E[max(0, X - 4)] is not
 *   max(0, E[X] - 4) -- and a conservative one, which is all a greedy player needs.
 *
 * Read-only queries into the engine, never a state change: the AI still answers only
 * through `GameAction`.
 */
import { unitType } from '../data/load'
import type { Face, ResultType } from '../data/types'
import { healthsOf, maxAbsorbable } from '../engine/damage'
import { armyRoll, spellSaves } from '../engine/effects'
import { applyModifiers, type ConvertibleType, type Share } from '../engine/pipeline'
import { conversionsIn, defaultContextFor, faceResults } from '../engine/roll'
import { saiEffects, type RollContext } from '../engine/sai'
import {
  opponentOf,
  type ArmyRef,
  type GameState,
  type PlayerId,
  type RuleSet,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from '../engine/types'

/**
 * One die's expected contribution to one roll.
 *
 * `share` keeps the pipeline's split because steps 6 and 9 need it: a subtraction eats
 * the normal share first and the eighth face doubles the ID share alone, so a single
 * number would get both wrong.
 */
export interface ExpectedDie {
  readonly share: Share
  /** Smite: damage the defender's saves never see. */
  readonly unsavable: number
  /** Counter and Volley on a save roll: damage straight back at the attacker. */
  readonly riposte: number
  /**
   * Health-worth a targeting SAI is expected to take out of the defending army --
   * Flame, Bullseye, Smother and the rest. Counted whole when the target has no way
   * out, and at half when it rolls for its life: a rough figure, and deliberately so,
   * since the chance depends on a die the roller does not own.
   */
  readonly targeted: number
  /**
   * The results of each convertible type this die rolled, for a "counts as" to move --
   * Flaming Shields' saves, Coastal Dodge's maneuver (v2 Phase 6b: one record for
   * every row of the table, rather than a field per ability).
   */
  readonly rolled: Rolled
  /** Wave (v2 Phase 5c): results taken off the *other* army's roll -- its saves when
   *  this is a melee attack. */
  readonly wave: number
}

export interface FaceWorth extends ExpectedDie {
  /** Step 3: "roll this unit again and apply the new result as well". */
  readonly reroll: boolean
}

/** What one face is worth in one roll -- the unit every other estimate is summed from. */
export function expectedFace(face: Face, resultType: ResultType, context: RollContext, ruleSet: RuleSet): FaceWorth {
  if (face.icon !== 'SAI') {
    const results = faceResults(face, resultType, ruleSet)
    return {
      share: face.icon === 'ID' ? { id: results, normal: 0, sai: 0 } : { id: 0, normal: results, sai: 0 },
      unsavable: 0,
      riposte: 0,
      targeted: 0,
      rolled: {
        melee: face.icon === 'MELEE' ? face.count : 0,
        save: face.icon === 'SAVE' ? face.count : 0,
        maneuver: face.icon === 'MANEUVER' ? face.count : 0,
      },
      wave: 0,
      reroll: false,
    }
  }

  const outcome = saiEffects(face, context, ruleSet)
  let sai = outcome.results[resultType] ?? 0
  let unsavable = 0
  let riposte = 0
  let targeted = 0
  let wave = 0
  for (const effect of outcome.effects) {
    switch (effect.kind) {
      case 'unsavable':
        unsavable += effect.damage
        break
      case 'riposte':
        riposte += effect.damage
        break
      case 'target_enemy':
        // Swallow's one die has no health budget; the die it takes rolls its ID one
        // time in six or ten, so it is counted as a likely kill of a middling die.
        if (effect.one === true) targeted += SWALLOW_WORTH
        else targeted += effect.escape === 'none' ? effect.health : effect.health / 2
        break
      case 'wave':
        wave += effect.amount
        break
      case 'choke':
        targeted += effect.health / 2
        break
      // Wild Growth's budget becomes save results wherever the roll counts them, and
      // "keep them all as saves" is always a legal split -- so on a save roll it is
      // worth its whole budget. Anywhere else it buys promotions, which are not results.
      case 'wild_growth':
        if (resultType === 'save' && context.purpose.kind === 'save') sai += effect.budget
        break
      // Not results in this roll: a pause, a move, or a pool spent elsewhere.
      case 'suppress_counter':
      case 'cantrip':
      case 'sleep':
      case 'galeforce':
      case 'confuse':
      case 'free_move':
      // Hypnotic Glare: dice taken out of the other army's save roll, which depends on
      // which of them come up ID -- too rough to price, and never counted as results.
      case 'glare':
        break
    }
  }

  return {
    share: { id: 0, normal: 0, sai },
    unsavable,
    riposte,
    targeted,
    rolled: {
      melee: outcome.results.melee ?? 0,
      save: outcome.results.save ?? 0,
      maneuver: outcome.results.maneuver ?? 0,
    },
    wave,
    reroll: outcome.reroll,
  }
}

/** Results of each type a "counts as" may move. */
export type Rolled = Readonly<Record<ConvertibleType, number>>

const CONVERTIBLE: readonly ConvertibleType[] = ['melee', 'save', 'maneuver']

/** What a Swallow is expected to take: one die, which rarely shows its ID. */
const SWALLOW_WORTH = 2

/**
 * One die type's expected contribution to one roll: the mean over its faces.
 *
 * A face that rerolls adds the die's whole expectation again, so with `k` of `n` faces
 * rerolling, `E = (sum of face values + k * E) / n`, which is `sum / (n - k)`. Closed
 * form, and it is what makes a Rend face worth more than the results printed on it.
 */
export function expectedDie(
  typeId: string,
  resultType: ResultType,
  context: RollContext,
  ruleSet: RuleSet,
): ExpectedDie {
  const faces = unitType(typeId).faces
  let rerolls = 0
  let id = 0
  let normal = 0
  let sai = 0
  let unsavable = 0
  let riposte = 0
  let targeted = 0
  const rolled = { melee: 0, save: 0, maneuver: 0 }
  let wave = 0

  for (const face of faces) {
    const worth = expectedFace(face, resultType, context, ruleSet)
    if (worth.reroll) rerolls += 1
    id += worth.share.id
    normal += worth.share.normal
    sai += worth.share.sai
    unsavable += worth.unsavable
    riposte += worth.riposte
    targeted += worth.targeted
    for (const type of CONVERTIBLE) rolled[type] += worth.rolled[type]
    wave += worth.wave
  }

  // A die whose every face rerolls would never stop; none in the data does, and a
  // die that did would be a data error rather than something to estimate.
  const divisor = faces.length - rerolls
  if (divisor <= 0) throw new Error(`${typeId} rerolls on every face`)

  return {
    share: { id: id / divisor, normal: normal / divisor, sai: sai / divisor },
    unsavable: unsavable / divisor,
    riposte: riposte / divisor,
    targeted: targeted / divisor,
    rolled: {
      melee: rolled.melee / divisor,
      save: rolled.save / divisor,
      maneuver: rolled.maneuver / divisor,
    },
    wave: wave / divisor,
  }
}

/** An army's expected roll, before and after the board has had its say. */
export interface ExpectedRoll {
  /** The dice alone: steps 1 to 5 and the SAIs' step-8 results. */
  readonly share: Share
  /** After every modifier `armyRoll` gathered -- the number the roll is expected to
   *  come to. */
  readonly total: number
  readonly unsavable: number
  readonly riposte: number
  readonly targeted: number
  /** Wave: what this roll takes off the other army's. */
  readonly wave: number
}

export interface ExpectedArmyOptions {
  /** What the roll is for. Defaults to `defaultContextFor`, as a roll does. */
  readonly context?: RollContext
  /** The army an attack is aimed at, for Wall of Fog -- `armyRoll`'s own argument. */
  readonly against?: ArmyRef
  /** Tower's missile at a Reserve Army counts no ID results. */
  readonly countIds?: false
}

/**
 * What this army is expected to roll for `resultType`.
 *
 * Through `armyRoll` and nothing else, for the reason the file comment gives. The
 * Flaming Shields permission rides the modifier list as a `counts_as`, which
 * `applyModifiers` ignores because only the dice can say how many saves there were --
 * so it is added here from the expected rolled saves, at step 10 where the roll adds it,
 * and never on a counter-attack, where the roll refuses it. Coastal Dodge (v2 Phase 5d)
 * is the same shape the other way. Both are asked of `conversionsIn`, the roll's own
 * resolver (v2 Phase 6b), so the estimate cannot apply one the roll would not.
 */
export function expectedArmy(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  resultType: ResultType,
  options: ExpectedArmyOptions = {},
): ExpectedRoll {
  const context = options.context ?? defaultContextFor(resultType)
  const { units, modifiers } = armyRoll(state, player, ref, resultType, options.against)

  let id = 0
  let normal = 0
  let sai = 0
  let unsavable = 0
  let riposte = 0
  let targeted = 0
  let converted = 0
  let wave = 0
  // Every "counts as" this roll makes on its own, through the roll's own resolver -- a
  // trade is the owner's choice and only a combination roll has one, which this never
  // estimates. `applyModifiers` ignores `counts_as`, so the results are added by hand.
  const conversions = conversionsIn([resultType], context, modifiers).filter((c) => !c.chosen)
  for (const unit of units) {
    const die = expectedDie(unit.typeId, resultType, context, state.ruleSet)
    id += die.share.id
    normal += die.share.normal
    sai += die.share.sai
    unsavable += die.unsavable
    riposte += die.riposte
    targeted += die.targeted
    wave += die.wave
    const species = unitType(unit.typeId).species
    for (const conversion of conversions) {
      if (conversion.species.has(species)) converted += die.rolled[conversion.from]
    }
  }

  const share: Share = { id: options.countIds === false ? 0 : id, normal, sai }

  return {
    share,
    total: applyModifiers(share, resultType, modifiers) + converted,
    unsavable,
    riposte,
    targeted,
    wave,
  }
}

/**
 * An expected magic total split by the species whose dice would roll it (v2 Phase 1),
 * so a mixed army's expected pool has suppliers the way a rolled one does.
 *
 * Proportional to each species' expected results in a magic roll, rounded down, with
 * what rounding leaves going to the largest remainders -- so the parts sum to `points`
 * exactly. Species in id order and ties in that order, so it never depends on the
 * order the board happens to list the dice in. A single-species force's pool ignores
 * the split, which is why nothing a one-species game does can move for it.
 */
export function expectedMagicBySpecies(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  points: number,
): Readonly<Record<string, number>> {
  const context = defaultContextFor('magic')
  const raw = new Map<string, number>()
  for (const unit of armyRoll(state, player, ref, 'magic').units) {
    const die = expectedDie(unit.typeId, 'magic', context, state.ruleSet)
    const species = unitType(unit.typeId).species
    raw.set(species, (raw.get(species) ?? 0) + die.share.id + die.share.normal + die.share.sai)
  }
  const species = [...raw.keys()].sort()
  const total = species.reduce((sum, s) => sum + (raw.get(s) ?? 0), 0)
  if (total <= 0 || points <= 0) return {}

  const exact = species.map((s) => ((raw.get(s) ?? 0) / total) * points)
  const parts = exact.map(Math.floor)
  let left = points - parts.reduce((sum, n) => sum + n, 0)
  const byRemainder = species
    .map((_, i) => i)
    .sort((a, b) => (exact[b] ?? 0) - (parts[b] ?? 0) - ((exact[a] ?? 0) - (parts[a] ?? 0)) || a - b)
  for (const i of byRemainder) {
    if (left <= 0) break
    parts[i] = (parts[i] ?? 0) + 1
    left -= 1
  }
  return Object.fromEntries(species.map((s, i) => [s, parts[i] ?? 0]))
}

/** An attack's expected outcome, both rolls and what they come to. */
export interface ExpectedAttack {
  readonly attack: ExpectedRoll
  readonly save: ExpectedRoll
  /** E[attack] − E[saves], floored at 0, plus what no save touches. */
  readonly damage: number
  /** What the defender's Counters and Volleys send back. */
  readonly riposte: number
}

/**
 * A melee or missile attack from `fromRef` at `target`, in expectation.
 *
 * The two specs are `combat.ts`'s `attackRollSpec` and `saveRollSpec` restated: the
 * attack names the army it is aimed at (Wall of Fog), a Tower's missile at a Reserve
 * Army counts no IDs, and the save roll knows what it is saving against, which is what
 * lets a Counter riposte. Magic is not here: what a magic action is worth is which
 * spells it buys, and that is the spell scorer's question.
 */
export function expectedAttack(
  state: GameState,
  attacker: PlayerId,
  fromRef: ArmyRef,
  action: 'melee' | 'missile',
  target: ArmyRef,
  isCounter = false,
): ExpectedAttack {
  const defender = opponentOf(attacker)
  const attack = expectedArmy(state, attacker, fromRef, action, {
    context: { purpose: { kind: 'attack', action }, isCounter },
    against: target,
    ...(action === 'missile' && target === 'reserve' ? { countIds: false as const } : {}),
  })
  const save = expectedArmy(state, defender, target, 'save', {
    context: { purpose: { kind: 'save', against: action }, isCounter },
  })

  return {
    attack,
    save,
    // A Wave comes off the saves, and never takes them below zero.
    damage:
      Math.max(0, attack.total - Math.max(0, save.total - attack.wave)) + attack.unsavable + attack.targeted,
    // Only the attacker's spell saves reduce what comes back (v2 Phase 6c), exactly as
    // `finishSaves` subtracts them.
    riposte: Math.max(0, save.riposte - spellSaves(state, attacker, fromRef)),
  }
}

/**
 * Health that `damage` would actually kill in this army: damage kills whole units, so
 * 3 damage against a lone monster kills nothing (invariant 4).
 *
 * The expectation is rounded rather than floored, so 0.9 expected damage reads as a
 * kill against a 1-health die. A greedy player told to be active should not see an
 * attack as worthless because its average falls a hair short.
 */
export function killValue(units: readonly UnitInstance[], damage: number): number {
  return maxAbsorbable(healthsOf(units), Math.max(0, Math.round(damage)))
}

/**
 * What one die is worth to its owner: its health, its best attack, and half its saves.
 *
 * A property of the die type alone -- deliberately not of where it stands, so the
 * same die is worth the same in the DUA, in Reserves and on a terrain, and a choice
 * between two of them is never decided by which terrain face happens to be up.
 */
export function unitValue(typeId: string, ruleSet: RuleSet): number {
  const results = (type: ResultType): number => {
    const { share } = expectedDie(typeId, type, defaultContextFor(type), ruleSet)
    return share.id + share.normal + share.sai
  }
  return (
    unitType(typeId).health +
    Math.max(results('melee'), results('missile'), results('magic')) +
    results('save') / 2
  )
}

/**
 * The maximal set of units `damage` must take that scores lowest (or highest).
 *
 * Maximal is `damage.ts`'s rule and nothing else: the set's health equals
 * `maxAbsorbable`, which is exactly what `assignmentProblem` checks. Within that, it
 * is a 0/1 knapsack over health with an exact target -- **never a largest-first loop**,
 * which kills the 3 of 3, 2, 2 for 4 damage when {2, 2} absorbs all of it.
 *
 * Ties go to the earlier units, so the answer is a function of the army's order and
 * nothing else.
 */
function maximalSubsetBy(
  units: readonly UnitInstance[],
  damage: number,
  score: (unit: UnitInstance) => number,
  prefer: 'min' | 'max',
): readonly UnitId[] {
  const healths = healthsOf(units)
  const target = maxAbsorbable(healths, damage)
  if (target === 0) return []

  const better = (a: number, b: number): boolean => (prefer === 'min' ? a < b : a > b)
  // best[i][s]: the best score of a subset of the first i units whose health is
  // exactly s, or undefined when no subset reaches s.
  const best: (number | undefined)[][] = [[0, ...new Array<undefined>(target).fill(undefined)]]
  for (let i = 1; i <= units.length; i++) {
    const health = healths[i - 1] as number
    const value = score(units[i - 1] as UnitInstance)
    const previous = best[i - 1] as (number | undefined)[]
    const row = [...previous]
    for (let s = health; s <= target; s++) {
      const without = previous[s]
      const from = previous[s - health]
      if (from === undefined) continue
      const withIt = from + value
      if (without === undefined || better(withIt, without)) row[s] = withIt
    }
    best.push(row)
  }

  // Walk back: unit i was taken exactly when leaving it out could not give this score.
  const chosen: UnitId[] = []
  let s = target
  for (let i = units.length; i >= 1 && s > 0; i--) {
    if ((best[i] as (number | undefined)[])[s] === (best[i - 1] as (number | undefined)[])[s]) continue
    const unit = units[i - 1] as UnitInstance
    chosen.push(unit.id)
    s -= healths[i - 1] as number
  }
  if (s !== 0) throw new Error(`could not rebuild a maximal set for ${damage} damage`)
  return chosen.reverse()
}

/**
 * Which of your own units to lose: the cheapest maximal set.
 *
 * Health lost is the same whichever maximal set dies -- that is what maximal means --
 * so the choice is about what the survivors can still do.
 */
export function leastValuableMaximal(
  units: readonly UnitInstance[],
  damage: number,
  ruleSet: RuleSet,
  score: (unit: UnitInstance) => number = (unit) => unitValue(unit.typeId, ruleSet),
): readonly UnitId[] {
  return maximalSubsetBy(units, damage, score, 'min')
}

/** Which of an opponent's units to take: the dearest maximal set. */
export function mostValuableMaximal(
  units: readonly UnitInstance[],
  damage: number,
  ruleSet: RuleSet,
  score: (unit: UnitInstance) => number = (unit) => unitValue(unit.typeId, ruleSet),
): readonly UnitId[] {
  return maximalSubsetBy(units, damage, score, 'max')
}

/** Both sides of a maneuver contest at one terrain, in expectation. */
export interface ContestOdds {
  readonly mine: number
  readonly theirs: number
  /** Positive when `player` is expected to win. A tie goes to the maneuvering army. */
  readonly margin: number
}

/**
 * Whether `player`'s army at `slot` is expected to win a maneuver there.
 *
 * An expectation, not a probability. That is enough for a player told to maneuver
 * even when the odds are slightly against it; a probability is what a search player
 * would want, and it is one convolution of these same face tables away.
 */
export function contestOdds(state: GameState, player: PlayerId, slot: TerrainSlot): ContestOdds {
  const mine = expectedArmy(state, player, slot, 'maneuver').total
  const theirs = expectedArmy(state, opponentOf(player), slot, 'maneuver').total
  return { mine, theirs, margin: mine - theirs }
}
