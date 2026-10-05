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

import type { UnitRollInput } from './effects'
import {
  allocateIds,
  type ConvertibleType,
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

/**
 * One named modifier's share of a roll's arithmetic: "− 4 **Galeforce**".
 *
 * `delta` is what it changed the total by, given the ones before it -- not its printed
 * amount. A Galeforce on a roll of two takes two, and a halving takes whatever half was.
 * So the steps always add up: `base + Σ delta = total`, whatever the pipeline did.
 */
export interface RollStep {
  readonly source: string
  readonly delta: number
}

/**
 * Why a roll's total is what it is (v1 Phase 9c): the number on the dice, each named
 * modifier in pipeline order, and the notes that are not arithmetic.
 *
 * **Display only.** Every number here is derived from modifiers already reflected in
 * the totals, and `digestState` leaves the `...Math` log fields out -- which is also
 * what keeps the goldens byte-identical, since `V0_RULES` has eighth-face doubling.
 */
export interface RollMath {
  /** What the dice show: step 5, plus the two things drawn on the dice themselves --
   *  an eighth face's doubled IDs and Flaming Shields' converted saves. */
  readonly base: number
  readonly steps: readonly RollStep[]
  /** Facts about the roll that change what the dice show rather than the total:
   *  "IDs doubled (Eighth face)", "Tower: ID results do not count". */
  readonly notes: readonly string[]
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
  /** `RollOutcome.countedAs`, carried through for the log. Omitted when none. */
  readonly countedAs?: number
  /** `RollOutcome.math` for this roll's type. Omitted when there is nothing to say. */
  readonly math?: RollMath
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
  /**
   * Names `saiResults` when they are **not on the dice** -- Wild Growth's unpromoted
   * save share, which the player chose rather than a face showed -- so the roll's
   * arithmetic can say "+ 2 Wild Growth". Absent means they are on the dice: a dragon
   * roll's flexible results are, and are only being given a type.
   */
  readonly saiResultsSource?: string
  /**
   * Tower's "only count non-ID missile results" against a Reserve Army (Phase 5d):
   * a counting rule at step 5, not a modifier. It cannot be a `subtract` -- the
   * amount is not known until the dice land, and step 6 removes ID results last --
   * and it cannot ride on step 9's one-multiplier-per-type cap, since the same roll
   * may also be doubling IDs for the eighth face. So it is its own spec field, the
   * third after `saiResults` and `context`: a fact about what the roll is *for*,
   * which the pipeline has to know before step 6 ever runs. Optional-and-omitted,
   * like every new field near the digest -- `false` is the only value written.
   */
  readonly countIds?: false
  /**
   * Flaming Shields in a roll that counts saves as well as melee -- the dragon
   * combination roll, and nothing else in scope: how many of the rolled save results
   * the owner moves to melee (v1 Phase 8).
   *
   * In a roll that counts melee and not saves there is nothing to choose -- converting
   * only adds -- so every rolled save converts and this stays omitted. Here it is a
   * real trade, saves against the dragon's damage for melee against its hide, which is
   * why it is the owner's number rather than a rule. Omitted means none.
   */
  readonly savesAsMelee?: number
}

export interface RollOutcome {
  readonly dice: readonly DieRoll[]
  readonly totals: Readonly<Partial<Record<ResultType, number>>>
  readonly effects: readonly RollEffect[]
  /**
   * Results a "counts as" moved into this roll's melee at step 10 -- Flaming Shields.
   * Omitted when none, so the log can say where a number came from without every roll
   * in every golden carrying a zero.
   */
  readonly countedAs?: number
  /** Per counted type, why its total is what it is. Omitted when no type has a named
   *  modifier or a note -- which is most rolls. */
  readonly math?: Readonly<Partial<Record<ResultType, RollMath>>>
}

/** One face, sorted into the pipeline steps it feeds. */
interface Contribution {
  /** Step 5, held apart because step 6 removes ID results last. */
  readonly idPool: number
  readonly normals: Readonly<Partial<Record<ResultType, number>>>
  /** Step 8. */
  readonly saiResults: Readonly<Partial<Record<ResultType, number>>>
  /** Step 8, but the roller picks the type. Only a combination roll produces any. */
  readonly flexible: number
  readonly effects: readonly RollEffectBody[]
  /** Which SAI produced those effects, for the log. Null on a normal face. */
  readonly saiName: string | null
  /** Step 3. */
  readonly reroll: boolean
}

const NO_SAI = { saiResults: {}, flexible: 0, effects: [], saiName: null, reroll: false } as const

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
      flexible: outcome.flexible ?? 0,
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
 * **everything this roll counts**, doubled if the eighth face is doubling IDs.
 *
 * The authoritative total is `RollOutcome.totals`, which the pipeline computes in
 * the aggregate. This is the same arithmetic on one die, kept because a roll strip
 * showing five dice that do not add up to the total is worse than useless -- and
 * because ID doubling is the one modifier that is per-die by nature. SAI results are
 * added *undoubled*: step 8 runs after step 7 and the only multiplier in play
 * multiplies the ID share alone.
 *
 * **Summed across the kinds, not just the first one.** With one counted type those
 * are the same number, which is every roll before Phase 6. A dragon roll counts
 * melee, missile and save at once, and reading only the first meant a die that
 * rolled four saves reported zero -- so the strip greyed it out as a blank while its
 * saves were being counted in the total right beside it.
 */
function perDieResults(
  face: Face,
  contribution: Contribution,
  spec: RollSpec,
  /** Flaming Shields: this die's save results, counted as melee in a roll that does not
   *  count saves. Without it a save face in a Firewalker's melee attack would draw as a
   *  blank beside a total that was counting it -- the Phase 6 bug, a third way. */
  converted = 0,
): number {
  // `flexible` is counted too: a Create Fireminions in a dragon roll really did
  // generate X results and the player is only choosing their *type*, so leaving it
  // out greys the die out as a blank next to the pool it just contributed to.
  const sai =
    spec.kinds.reduce((sum, kind) => sum + (contribution.saiResults[kind] ?? 0), 0) +
    contribution.flexible

  if (face.icon !== 'ID') {
    return (
      spec.kinds.reduce((sum, kind) => sum + (contribution.normals[kind] ?? 0), 0) + sai + converted
    )
  }
  if (spec.countIds === false) return sai

  // The ID pool is one number however many types it can be spent on, so it is
  // counted once -- doubled if any counted type is doubling it.
  const doubles = spec.modifiers.find(
    (m) => m.kind === 'multiply' && m.share === 'id' && spec.kinds.includes(m.resultType),
  )
  const by = doubles !== undefined && doubles.kind === 'multiply' ? doubles.by : 1
  return contribution.idPool * by + sai
}

/**
 * A "counts as" that applies to this roll (v2 Phase 6b): whose dice, from what, to what.
 *
 * `chosen` is a **trade**: the roll counts the `from` type as well, so converting takes
 * results away from one total to give them to another, and the owner says how many --
 * Flaming Shields in the dragon's combination roll, `RollSpec.savesAsMelee`. Everywhere
 * else converting only adds, so every rolled result of those dice converts.
 */
export interface Conversion {
  readonly from: ConvertibleType
  readonly to: ConvertibleType
  /** A set of species rather than a yes (v2 Phase 1): the permission is one species',
   *  so in a mixed army another species' dice keep what they rolled. */
  readonly species: ReadonlySet<string>
  readonly source: string
  readonly chosen: boolean
}

/**
 * Every "counts as" this roll applies, from the permissions `armyRoll` gathered.
 *
 * **The one resolver**, which replaced one function per ability. A permission applies
 * when the roll counts its `to` type and the counter-attack rule holds -- Flaming
 * Shields "does not apply when making a counter-attack" -- and it is decided here
 * rather than in `armyRoll` because this is the one place that knows what the roll is
 * for. Coastal Dodge is gathered at every water terrain and lands only where it can.
 *
 * A trade is asked about only for saves as melee, the one the rules put in front of a
 * player (the dragon roll's Flaming Shields). Any other pair in a roll that counts both
 * of its types is left off: no roll in scope counts maneuver and saves together, and
 * Coastal Dodge was "a roll that counts saves and not maneuver" before this table.
 */
export function conversionsIn(
  kinds: readonly ResultType[],
  context: RollContext,
  modifiers: readonly Modifier[],
): readonly Conversion[] {
  const out: Conversion[] = []
  for (const m of modifiers) {
    if (m.kind !== 'counts_as') continue
    if (!kinds.includes(m.resultType)) continue
    if (m.counter === 'never' && context.isCounter) continue
    if (m.counter === 'only' && !context.isCounter) continue
    const trade = kinds.includes(m.from)
    if (trade && !(m.from === 'save' && m.resultType === 'melee')) continue
    const source = m.source ?? `${m.from} as ${m.resultType}`
    const same = out.findIndex((c) => c.from === m.from && c.to === m.resultType && c.source === source)
    const species = new Set([...(same >= 0 ? out[same]!.species : []), ...m.species])
    const conversion: Conversion = { from: m.from, to: m.resultType, species, source, chosen: trade }
    if (same >= 0) out[same] = conversion
    else out.push(conversion)
  }
  return out
}

/** Whether this die's results are among those a conversion moves. */
function convertsDie(conversion: Conversion, die: RawDie): boolean {
  return conversion.species.has(unitType(die.typeId).species)
}

/**
 * The results of one type a die *rolled*: a normal icon's count, or an SAI's results.
 *
 * Never an ID -- in a roll counting the type an ID is already that type, and in a
 * combination roll the owner allocates it directly -- and never a `flexible` result,
 * for the same reason. Nothing a spell or an effect adds is here either, because none
 * of that is on a die: "results generated by spells may never be counted as another
 * type". A Trample in a save roll generates maneuver too, and those are rolled results.
 */
function rolledResults(face: Face, contribution: Contribution, type: ConvertibleType, ruleSet: RuleSet): number {
  if (face.icon === 'ID') return 0
  if (face.icon === 'SAI') return contribution.saiResults[type] ?? 0
  return faceResults(face, type, ruleSet)
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
  /**
   * Leave a die whose reroll comes *with a target* where it is (post-Phase 9 fix):
   * Bullseye and Double Strike are applied at step 3, "one at a time", and "roll this
   * unit again" comes after the kill. So their die is not thrown again here; the
   * exchange applies the SAI -- targets, sub-roll, deaths and whatever those trigger
   * -- and only then rerolls it (`rerollHeld` in `combat.ts`). Rend, which targets
   * nobody, still rerolls here, and a Rend chain that lands on a Double Strike stops
   * on it.
   */
  hold = false,
): readonly [readonly RawDie[], RngState] {
  const out: RawDie[] = [...dice]
  const rerolls = (die: RawDie) =>
    classify(faceOf(die), spec, ruleSet).reroll && !(hold && holdsTargetedReroll(die, spec, ruleSet))
  const queue: RawDie[] = dice.filter(rerolls)

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
    if (rerolls(again)) queue.push(again)
  }

  return [out, state] as const
}

/**
 * Whether this die's face rerolls *after* targeting somebody -- Bullseye and Double
 * Strike, "the targets make a save roll ... roll this unit again". Step 3 applies them
 * one at a time, so the reroll waits for the SAI to resolve.
 */
export function holdsTargetedReroll(die: RawDie, spec: RollSpec, ruleSet: RuleSet): boolean {
  const contribution = classify(faceOf(die), spec, ruleSet)
  return contribution.reroll && contribution.effects.some((effect) => effect.kind === 'target_enemy')
}

/**
 * What a combination roll leaves for its roller to allocate: the ID pool, and any
 * step-8 results whose type the roller chooses (Create Fireminions).
 *
 * Pure, and deliberately separate from `resolveFaces` -- which cannot run at all on
 * a multi-kind roll until the allocation exists, since `allocateIds` refuses a
 * combination roll without one. So the dragon attack resolves in three moves:
 * ask this what is on the table, put the question to the roller, then resolve the
 * same faces with the answer. The middle step draws no randomness, which is the
 * whole point of `resolveFaces` being pure.
 */
export function rollPools(
  dice: readonly RawDie[],
  spec: RollSpec,
  ruleSet: RuleSet,
): { readonly ids: number; readonly flexible: number; readonly shields: number } {
  let ids = 0
  let flexible = 0
  let shields = 0
  // Only a trade has anything to choose. In a roll that does not count saves, every
  // rolled save converts and nobody is asked.
  const traded = conversionsIn(spec.kinds, spec.context, spec.modifiers).filter((c) => c.chosen)
  for (const die of dice) {
    const face = faceOf(die)
    const contribution = classify(face, spec, ruleSet)
    ids += contribution.idPool
    flexible += contribution.flexible
    for (const conversion of traded) {
      if (convertsDie(conversion, die)) shields += rolledResults(face, contribution, conversion.from, ruleSet)
    }
  }
  return { ids, flexible, shields }
}

/**
 * Charge (v2 Phase 6e): when a Charge face is on a melee attack, "the attacking army
 * counts all Maneuver results as if they were Melee results".
 *
 * A fact about the faces, not about the board, so it is decided here, where the faces
 * are -- and so every reader of an attack roll agrees on it, the parked roll on screen,
 * the targeting queue and the totals alike. Two things change: the purpose says
 * `charging`, so an SAI offering maneuver among its choices (Fly) gives it; and a
 * "counts as" maneuver-to-melee joins the modifiers for every die in the roll, whatever
 * its species -- the attacking *army* counts them, not its Dwarves -- which 6b's
 * conversion table then applies like any other, and names on the arithmetic line.
 */
function charging(dice: readonly RawDie[], spec: RollSpec, ruleSet: RuleSet): RollSpec {
  const purpose = spec.context.purpose
  if (purpose.kind !== 'attack' || purpose.charging === true) return spec
  const charged = dice.some((die) => {
    const face = faceOf(die)
    return face.icon === 'SAI' && classify(face, spec, ruleSet).effects.some((effect) => effect.kind === 'charge')
  })
  if (!charged) return spec
  const species = [...new Set(dice.map((die) => unitType(die.typeId).species))]
  return {
    ...spec,
    context: { ...spec.context, purpose: { ...purpose, charging: true } },
    modifiers: [
      ...spec.modifiers,
      { kind: 'counts_as', from: 'maneuver', resultType: 'melee', counter: 'never', species, source: 'Charge' },
    ],
  }
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
  given: RollSpec,
  ruleSet: RuleSet,
): RollOutcome {
  const spec = charging(dice, given, ruleSet)
  const shown: DieRoll[] = []
  const normals = new Map<ResultType, number>(spec.kinds.map((kind) => [kind, 0]))
  // Seeded with the player's own step-8 results, which join exactly where a face's do.
  const saiResults = new Map<ResultType, number>(
    spec.kinds.map((kind) => [kind, spec.saiResults?.[kind] ?? 0]),
  )
  const effects: RollEffect[] = []
  let idPool = 0
  const conversions = conversionsIn(spec.kinds, spec.context, spec.modifiers)
  // What each conversion found on the dice, in the order `conversionsIn` listed them.
  const found = conversions.map(() => 0)

  for (const die of dice) {
    const face = faceOf(die)
    const contribution = classify(face, spec, ruleSet)
    // A conversion the roll makes on its own is drawn on the die that rolled it; a
    // trade is the owner's number, and is not any one die's.
    let shownConverted = 0
    conversions.forEach((conversion, i) => {
      if (!convertsDie(conversion, die)) return
      const amount = rolledResults(face, contribution, conversion.from, ruleSet)
      found[i] = (found[i] ?? 0) + amount
      if (!conversion.chosen) shownConverted += amount
    })

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
      results: perDieResults(face, contribution, spec, shownConverted),
      ...(die.reroll === true ? { reroll: true as const } : {}),
      ...(contribution.effects.length > 0 ? { effects: contribution.effects } : {}),
    })
  }

  // Step 5's other half: Tower's "only count non-ID missile results" gives every
  // counted type an ID share of zero, ahead of the ordinary allocation -- step 9's
  // doubling then doubles zero, which is the right answer either way.
  const allocation = spec.countIds === false ? new Map() : allocateIds(idPool, spec.kinds, spec.idAllocation)
  const totals: Partial<Record<ResultType, number>> = {}

  // A trade's number is the owner's (`savesAsMelee`); every other conversion moves all
  // it found. Each becomes the step-10 `add` it is.
  const chosen = spec.savesAsMelee ?? 0
  const trade = conversions.findIndex((c) => c.chosen)
  if (chosen > 0 && trade < 0) {
    throw new Error(
      `${chosen} saves counted as melee, but this roll ` +
        (conversions.some((c) => c.from === 'save' && c.to === 'melee')
          ? 'converts every save it rolled'
          : 'has no Flaming Shields to convert with'),
    )
  }
  if (!Number.isInteger(chosen) || chosen < 0 || chosen > (trade < 0 ? 0 : (found[trade] ?? 0))) {
    throw new Error(`${chosen} saves counted as melee, from ${trade < 0 ? 0 : (found[trade] ?? 0)} rolled`)
  }
  const moved = conversions.map((c, i) => (c.chosen ? chosen : (found[i] ?? 0)))
  // Flaming Shields' number, which the log carries as `flamingShields` and the golden
  // digest records -- so it stays that and nothing else: saves as melee, in a roll that
  // is not a counter-attack (the only one Flaming Shields makes).
  const countedAs = spec.context.isCounter
    ? 0
    : conversions.reduce((sum, c, i) => sum + (c.from === 'save' && c.to === 'melee' ? (moved[i] ?? 0) : 0), 0)
  const onDice: Modifier[] = []
  conversions.forEach((c, i) => {
    const amount = moved[i] ?? 0
    if (amount > 0) onDice.push({ kind: 'add', resultType: c.to, amount, source: c.source })
  })
  const modifiers: readonly Modifier[] = [...spec.modifiers, ...onDice]
  const math: Partial<Record<ResultType, RollMath>> = {}

  for (const kind of spec.kinds) {
    let normal = normals.get(kind) ?? 0
    let sai = saiResults.get(kind) ?? 0
    // Traded results stop being their old type: they leave its share before step 6,
    // so a Galeforce's minus four is not charged against results that are melee now.
    const tradedAway = trade >= 0 && conversions[trade]?.from === kind ? chosen : 0
    if (tradedAway > 0) {
      const fromNormal = Math.min(normal, tradedAway)
      normal -= fromNormal
      sai -= tradedAway - fromNormal
    }
    const share = { id: allocation.get(kind) ?? 0, normal, sai }
    totals[kind] = applyModifiers(share, kind, modifiers)

    // Every conversion but Flaming Shields' is a note on the type it lands in. Flaming
    // Shields' is the log's own `flamingShields` field, which both clients already draw.
    const noted = conversions.flatMap((c, i) => {
      const amount = moved[i] ?? 0
      if (c.to !== kind || amount === 0) return []
      if (c.from === 'save' && c.to === 'melee' && !spec.context.isCounter) return []
      return [`${amount} ${c.from} counted as ${PLURAL[c.to]} (${c.source})`]
    })
    const explained = explainRoll(share, kind, modifiers, onDice, spec, noted)
    if (explained !== null) math[kind] = explained
  }

  return {
    dice: shown,
    totals,
    effects,
    ...(countedAs > 0 ? { countedAs } : {}),
    ...(Object.keys(math).length > 0 ? { math } : {}),
  }
}

/** How a note names the type a conversion lands in: "3 maneuver counted as saves". */
const PLURAL: Readonly<Record<ConvertibleType, string>> = {
  melee: 'melee',
  save: 'saves',
  maneuver: 'maneuver',
  magic: 'magic',
  missile: 'missile',
}

/** Where each named modifier falls in steps 6 to 10, so the arithmetic reads in the
 *  order the rulebook applies it. The off-dice step-8 results sit between divide and
 *  multiply, exactly where `applyModifiers` joins them. */
const STEP_ORDER: Readonly<Record<Modifier['kind'], number>> = {
  ignore_ids: 0,
  subtract: 1,
  divide: 2,
  multiply: 4,
  add: 5,
  counts_as: 6,
}

/**
 * One counted type's `RollMath`, or null when there is nothing to explain.
 *
 * **Recomputed through `applyModifiers`, never re-derived.** The base is the pipeline
 * run with only the modifiers the dice already show -- the eighth face's doubling,
 * Flaming Shields' conversion -- and then each named modifier is added one at a time in
 * step order, its `delta` the change in the total. The sum telescopes to the real total
 * by construction, so the line can never disagree with the number beside it: a second
 * implementation of the pipeline is exactly how it would have.
 */
function explainRoll(
  share: { readonly id: number; readonly normal: number; readonly sai: number },
  kind: ResultType,
  modifiers: readonly Modifier[],
  /** The conversions the dice already show: Flaming Shields', Coastal Dodge's. */
  converted: readonly Modifier[],
  spec: RollSpec,
  /** What those conversions say about this type, already worded by `resolveFaces`. */
  conversionNotes: readonly string[],
): RollMath | null {
  const own = modifiers.filter((m) => m.resultType === kind)
  const onDice = own.filter(
    (m) => converted.includes(m) || (m.kind === 'multiply' && m.share === 'id'),
  )
  const named = own
    .filter((m) => !onDice.includes(m) && m.kind !== 'counts_as')
    .sort((a, b) => STEP_ORDER[a.kind] - STEP_ORDER[b.kind])

  const offDice = spec.saiResultsSource !== undefined ? (spec.saiResults?.[kind] ?? 0) : 0
  const without = { ...share, sai: share.sai - offDice }

  const notes: string[] = []
  const doubling = onDice.find((m) => m.kind === 'multiply')
  if (doubling !== undefined && share.id > 0) {
    notes.push(`IDs doubled (${doubling.source ?? 'eighth face'})`)
  }
  if (spec.countIds === false) notes.push('Tower: ID results do not count')
  // A conversion is on the dice, like the eighth face's doubling -- so it is a note,
  // and the dice strip already shows each die's share of it.
  notes.push(...conversionNotes)

  if (named.length === 0 && offDice === 0 && notes.length === 0) return null

  const base = applyModifiers(without, kind, onDice)
  const steps: RollStep[] = []
  let applied: Modifier[] = [...onDice]
  let current = without
  let running = base
  let offDiceDone = offDice === 0

  // Two castings of one effect are one step, not two: "− 8 Galeforce" reads as what
  // happened, "− 4 Galeforce − 4 Galeforce" as a stutter. Adjacent only, so a name that
  // turns up at two different pipeline steps still shows at both.
  const add = (source: string) => {
    const next = applyModifiers(current, kind, applied)
    const last = steps.at(-1)
    if (last !== undefined && last.source === source) {
      steps[steps.length - 1] = { source, delta: last.delta + (next - running) }
    } else {
      steps.push({ source, delta: next - running })
    }
    running = next
  }

  for (const modifier of named) {
    if (!offDiceDone && STEP_ORDER[modifier.kind] > 3) {
      current = share
      offDiceDone = true
      add(spec.saiResultsSource ?? 'SAI')
    }
    applied = [...applied, modifier]
    add(modifier.source ?? modifier.kind)
  }
  if (!offDiceDone) {
    current = share
    add(spec.saiResultsSource ?? 'SAI')
  }

  return { base, steps, notes }
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
 * One unit's own roll, and what became of it.
 *
 * `roll` is null when the unit could not be rolled at all -- a sleeping die -- which
 * is not the same answer as a roll that came to zero and must not be flattened into
 * one: the first consumed no randomness.
 */
export interface SubRoll {
  readonly unitId: UnitId
  readonly roll: RollResult | null
}

/**
 * Rolls each unit on its own: Phase 4d's sub-rolls, where a Smother's targets "make a
 * maneuver roll" one die at a time.
 *
 * `rollArmy`'s sibling, one rung down the p. 28 rule -- an army roll and a unit roll
 * gather different modifiers, so the two doors share no gatherer. Take the inputs from
 * `unitRoll` in `effects.ts`, in the order you want them rolled; a unit that cannot be
 * rolled is skipped and **draws nothing**, the same discipline `death.ts` keeps for a
 * unit with no Rise face.
 *
 * Seize does not come through here. "If they roll an ID icon" is a question about a
 * face rather than a total, so it is `rollFaces` and a look at `faceOf(die).icon` --
 * which also keeps it from tripping the `'full'` refusal on some unbuilt SAI a target
 * happens to show.
 */
export function rollUnits(
  inputs: readonly UnitRollInput[],
  resultType: ResultType,
  context: RollContext,
  rng: RngState,
  ruleSet: RuleSet,
): readonly [readonly SubRoll[], RngState] {
  const out: SubRoll[] = []
  let state = rng

  for (const input of inputs) {
    if (!input.rollable) {
      out.push({ unitId: input.unit.id, roll: null })
      continue
    }

    const [outcome, next] = resolveRoll(
      [input.unit],
      { kinds: [resultType], modifiers: input.modifiers, context },
      state,
      ruleSet,
    )
    state = next
    out.push({ unitId: input.unit.id, roll: asResult(outcome, resultType) })
  }

  return [out, state] as const
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
 * What a sub-roll is for: one die rolling `resultType` on its own (Phase 4d), with the
 * purpose an unaimed roll of that type would have and `isSubRoll` set.
 *
 * A melee one (v2 Phase 8b) is a melee *attack* to the SAI reference, so its results
 * apply as written; `saiEffects` drops every effect it would make (`resultsOnly`). No
 * melee caller until Web and Charm.
 */
export function subRollContext(resultType: ResultType): RollContext {
  return { ...defaultContextFor(resultType), isSubRoll: true }
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
    ...(outcome.countedAs !== undefined ? { countedAs: outcome.countedAs } : {}),
    ...(outcome.math?.[resultType] !== undefined ? { math: outcome.math[resultType] } : {}),
  }
}

/**
 * "14 on the dice − 4 Galeforce + 2 Stone Skin = 12" -- a roll's arithmetic as one
 * sentence, for both clients.
 *
 * Beside `saiPhrase`, for its reason: the first draft of a shared sentence gets written
 * twice, and that is how the browser and the terminal start describing one roll
 * differently. A step that changed nothing still prints, as "± 0": a Galeforce on a
 * roll with nothing left to take is still a Galeforce, and leaving it out is the silence
 * this whole field exists to end.
 */
export function mathPhrase(math: RollMath, total: number): string {
  const steps = math.steps.map((step) =>
    step.delta < 0
      ? ` − ${-step.delta} ${step.source}`
      : step.delta > 0
        ? ` + ${step.delta} ${step.source}`
        : ` ± 0 ${step.source}`,
  )
  return math.steps.length === 0 ? '' : `${math.base} on the dice${steps.join('')} = ${total}`
}

/**
 * Damage that only spells' saves reduce, as a clause: " − 2 Stone Skin = 2", or "" when
 * no spell took anything off (v2 Phase 6c). A riposte's and, from 6e, a Charge's. Both
 * clients print this, so the browser and the terminal cannot word one number two ways.
 */
export function spellSavedPhrase(math: RollMath | undefined, net: number): string {
  if (math === undefined || math.steps.length === 0) return ''
  return `${math.steps.map((step) => ` − ${-step.delta} ${step.source}`).join('')} = ${net}`
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
