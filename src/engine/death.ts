/**
 * What happens to a unit at the moment it is killed or buried.
 *
 * v0 had no such moment: `applyDamage` moved units to the DUA and that was the end
 * of them. Under `dua: 'active'` a death is a place where a rule can intervene, and
 * Rise from the Ashes is the first one to (Phase 8's Treefolk Replanting is the
 * next, and it plugs in here).
 *
 * > "Whenever a unit with this SAI is killed or buried, roll the unit. If **Rise
 * > from the Ashes** is rolled, the unit is moved to your Reserve Area. If an effect
 * > both kills and buries this unit, it may roll once when killed and again when
 * > buried. If the first roll is successful, the unit is not buried."
 *
 * Three things in that paragraph are easy to get wrong, and each is a test:
 *
 *  - The success condition is **rolling a Rise from the Ashes face**, not rolling an
 *    ID. On the Phoenix -- the only die in the box carrying it -- that is 2 faces in
 *    10, not 1.
 *  - It fires on **burial as well as death**, which is why `buryUnits` exists here
 *    rather than `bury` in `dua.ts` being the whole story.
 *  - An effect that both kills and buries gives **two** rolls, and a success on the
 *    first means the second never happens.
 *
 * Under `dua: 'inert'` none of this runs and **no die is rolled at all**. That is
 * not a detail: the 25 golden games are recorded under `V0_RULES`, and a single
 * extra draw here would shift `rng.counter` and every die after it in all of them.
 */
import { unitType } from '../data/load'

import { applyDamage } from './damage'
import { bury, exchangeWithDua } from './dua'
import { regrows } from './effects'
import { rollDie } from './rng'
import {
  deadUnits,
  type ArmyRef,
  type GameState,
  type LogEntry,
  type PlayerId,
  type PromotionPair,
  type UnitId,
  type UnitInstance,
} from './types'

/**
 * The SAI whose whole point is this file.
 *
 * Spelled out here rather than imported because `sai.ts` holds its handlers in an
 * object literal keyed by name; `death.test.ts` asserts this string is one of those
 * keys, so the two cannot drift apart silently.
 */
export const RISE_FROM_THE_ASHES = 'Rise from the Ashes'

export interface DeathOutcome {
  readonly state: GameState
  /** Units that rolled their way into Reserves instead. Always a subset of what was
   *  passed in, and empty under `dua: 'inert'`. */
  readonly risen: readonly UnitId[]
  /**
   * Accelerated Growth: units that were exchanged rather than killed (Phase 7e).
   *
   * **They were never killed**, which is the difference between this and `risen`: a
   * risen unit really died and then moved, and the log says both. These did not die at
   * all, so the caller must leave them out of its `units_killed` entry -- which is what
   * `killedIds` is for.
   */
  readonly regrown: readonly PromotionPair[]
}

/** What a caller should actually report as killed, given what it asked for. */
export function killedIds(
  outcome: DeathOutcome,
  requested: readonly UnitId[],
): readonly UnitId[] {
  if (outcome.regrown.length === 0) return requested
  const swapped = new Set(outcome.regrown.map((pair) => pair.unitId))
  return requested.filter((id) => !swapped.has(id))
}

/**
 * The log one death produces: who really died, who rose, and who was exchanged.
 *
 * Entries are *built* here rather than written -- this file still logs nothing and
 * still knows nothing about phases. They are built here because the three-way split is
 * a fact about what `killUnits` just did, and eight call sites each deriving it from
 * `risen` and `regrown` is eight chances to report a unit as killed that never died.
 */
export function deathEntries(
  outcome: DeathOutcome,
  player: PlayerId,
  slot: ArmyRef,
  requested: readonly UnitId[],
): readonly LogEntry[] {
  const killed = killedIds(outcome, requested)
  return [
    ...(killed.length > 0
      ? [{ kind: 'units_killed', player, slot, unitIds: killed } as const]
      : []),
    // A subset of the line above: the unit really was killed, and then moved.
    ...(outcome.risen.length > 0
      ? [{ kind: 'units_risen', player, unitIds: outcome.risen } as const]
      : []),
    // Not a subset of anything: these never died at all.
    ...(outcome.regrown.length > 0
      ? [{ kind: 'units_regrown', player, pairs: outcome.regrown } as const]
      : []),
  ]
}

const hasRiseFace = (unit: UnitInstance): boolean =>
  unitType(unit.typeId).faces.some(
    (face) => face.icon === 'SAI' && face.sai === RISE_FROM_THE_ASHES,
  )

/**
 * Rolls every unit in `unitIds` that carries the SAI and moves the successes to
 * Reserves. Units without it consume no randomness whatsoever.
 *
 * The roll order is the order units sit in `state.units`, which is the order
 * `armyAt` returns them and therefore the order `rollArmy` deals dice -- *not* the
 * order the player happened to type into `assign_damage`. Both replay identically,
 * since the action is recorded either way; the canonical one is chosen so that two
 * players naming the same units in different orders get the same game.
 */
function riseFromTheAshes(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  const candidates = Object.values(state.units).filter(
    (unit) => unitIds.includes(unit.id) && hasRiseFace(unit),
  )
  if (candidates.length === 0) return { state, risen: [], regrown: [] }

  const units = { ...state.units }
  const risen: UnitId[] = []
  let rng = state.rng

  for (const unit of candidates) {
    const type = unitType(unit.typeId)
    const [faceIndex, next] = rollDie(rng, type.faces.length)
    rng = next

    const face = type.faces[faceIndex]
    if (face === undefined) {
      throw new Error(`${unit.typeId}: rolled face ${faceIndex} of ${type.faces.length}`)
    }
    if (face.icon !== 'SAI' || face.sai !== RISE_FROM_THE_ASHES) continue

    units[unit.id] = { ...unit, location: { kind: 'reserve' } }
    risen.push(unit.id)
  }

  return { state: { ...state, units, rng }, risen, regrown: [] }
}

/**
 * Kills units: to the DUA, then the death trigger.
 *
 * Under `dua: 'inert'` this is exactly `applyDamage` and nothing else -- same state,
 * same `rng.counter`. Like `applyDamage`, it does not check for victory: the caller
 * does, because the win check runs after every state change.
 */
export function killUnits(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  // Accelerated Growth intercepts first: a unit it saves never reaches `applyDamage`,
  // so it is never killed and no death trigger fires on it.
  const regrown = acceleratedGrowth(state, unitIds)
  const grown = regrown.length === 0 ? state : exchangeWithDua(state, regrown)
  const dying = killedIds({ state: grown, risen: [], regrown }, unitIds)

  const killed = applyDamage(grown, dying)
  if (state.ruleSet.dua !== 'active') return { state: killed, risen: [], regrown }
  return { ...riseFromTheAshes(killed, dying), regrown }
}

/**
 * Accelerated Growth: "when a two (or greater) health Treefolk unit is killed, you may
 * instead exchange it with a one health Treefolk unit from your DUA."
 *
 * **Taken automatically rather than offered**, which is a house rule and the only one
 * this spell needs (`RULES-V0.md` section 15). The "may" is exercised by choosing to
 * cast it: `killUnits` is a pure transform called from eight places -- damage
 * assignment, a breath, a Flame, a Temple -- and none of them can stop to ask.
 *
 * Board order, and one partner per dying unit, so two deaths in one assignment cannot
 * both claim the same small die.
 */
function acceleratedGrowth(
  state: GameState,
  unitIds: readonly UnitId[],
): readonly PromotionPair[] {
  if (state.ruleSet.dua !== 'active') return []

  const pairs: PromotionPair[] = []
  const taken = new Set<UnitId>()

  for (const unit of Object.values(state.units)) {
    if (!unitIds.includes(unit.id)) continue
    if (!regrows(state, unit.owner)) continue

    const type = unitType(unit.typeId)
    if (type.health < 2) continue

    const partner = deadUnits(state, unit.owner).find(
      (dead) =>
        !taken.has(dead.id) &&
        unitType(dead.typeId).species === type.species &&
        unitType(dead.typeId).health === 1,
    )
    if (partner === undefined) continue

    taken.add(partner.id)
    pairs.push({ unitId: unit.id, partnerId: partner.id })
  }

  return pairs
}

/**
 * Buries units that are already in the DUA, then the death trigger.
 *
 * `bury` refuses a unit that is still in play, so an effect that kills *and* buries
 * must go through `killAndBury` below rather than calling this directly.
 */
export function buryUnits(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  const buried = bury(state, unitIds)
  if (state.ruleSet.dua !== 'active') return { state: buried, risen: [], regrown: [] }
  return { ...riseFromTheAshes(buried, unitIds), regrown: [] }
}

/**
 * An effect that kills *and* buries -- Flame, Fire breath, the Temple.
 *
 * Two steps, because the rules are two steps: a live unit passes through the DUA on
 * its way to the BUA. That is bookkeeping for every other die in the game and it is
 * not bookkeeping for a Phoenix, which "may roll once when killed and again when
 * buried" -- so collapsing this into one move would silently halve its chances, and
 * the only evidence would be a probability nobody measures.
 *
 * "If the first roll is successful, the unit is not buried", which is why the second
 * step is passed only what the first did not rescue.
 *
 * Its first caller is Phase 4's Flame. It ships now so that Flame is one line then,
 * and so that the rule is written down while the paragraph it comes from is in front
 * of us rather than reconstructed later from a comment.
 */
export function killAndBury(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  const killed = killUnits(state, unitIds)
  const survivors = unitIds.filter((id) => !killed.risen.includes(id))
  const buried = buryUnits(killed.state, survivors)

  return {
    state: buried.state,
    risen: [...killed.risen, ...buried.risen],
    regrown: killed.regrown,
  }
}

