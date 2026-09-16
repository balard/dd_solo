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
import { bury } from './dua'
import { rollDie } from './rng'
import type { GameState, UnitId, UnitInstance } from './types'

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
  if (candidates.length === 0) return { state, risen: [] }

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

  return { state: { ...state, units, rng }, risen }
}

/**
 * Kills units: to the DUA, then the death trigger.
 *
 * Under `dua: 'inert'` this is exactly `applyDamage` and nothing else -- same state,
 * same `rng.counter`. Like `applyDamage`, it does not check for victory: the caller
 * does, because the win check runs after every state change.
 */
export function killUnits(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  const killed = applyDamage(state, unitIds)
  if (state.ruleSet.dua !== 'active') return { state: killed, risen: [] }
  return riseFromTheAshes(killed, unitIds)
}

/**
 * Buries units -- from the DUA or straight off the board -- then the death trigger.
 *
 * Kill-and-bury is `killUnits` followed by `buryUnits` over whatever the first call
 * did not rescue: two rolls, and a success on the first means the unit is never
 * passed to the second. Its only caller is Phase 4's Flame; it ships now so that
 * Flame is one line then, and so that the two-roll rule is written down while the
 * paragraph it comes from is in front of us.
 */
export function buryUnits(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  const buried = bury(state, unitIds)
  if (state.ruleSet.dua !== 'active') return { state: buried, risen: [] }
  return riseFromTheAshes(buried, unitIds)
}
