/**
 * A unit taking damage on its own, and rolling saves against it (v2 Phase 6b).
 *
 * Two rules in the Dwarves' box make exactly this roll, and nothing before them did:
 * Firebolt's "inflict one point of damage on the target" (cumulative, so N castings on
 * one die are N damage) and Bash's "the targeted unit takes damage equal to the melee
 * results it generated. The targeted unit must make a save roll against this damage".
 * One function, so the two cannot come to disagree about what surviving means.
 *
 * It is **not** Lightning Strike's roll. That one asks for any save result at all and
 * kills on none; this one is damage arithmetic -- "when a unit takes damage it is
 * permitted to make a save roll" (p. 29), and damage kills whole units (`RULES-V0.md`
 * section 6): the unit dies when what its saves leave of the damage reaches its health.
 * One point on a 2-health die kills nothing, whatever the dice say, and still rolls,
 * since the rules give the save roll before anyone does the sum.
 *
 * A *unit* roll, gathered through `unitRoll` and never `armyRoll` (p. 28). A die that
 * cannot be rolled saves nothing. A glaring die that rolls ends its glare, as every
 * unit roll does (Hypnotic Glare, v2 Phase 5b).
 */
import { unitType } from '../data/load'

import { deathEntries, killUnits } from './death'
import { endGlaresOf, unitRoll } from './effects'
import { expectNoEffects, rollUnits, type DieRoll } from './roll'
import type { RollContext } from './sai'
import { armyRefOf, type GameState, type LogEntry, type UnitId } from './types'

/** "Any other save roll": a Counter on the die saves and sends nothing back, the sub-roll
 *  rule of `RULES-V0.md` section 11. */
const DAMAGE_SAVE_ROLL: RollContext = {
  purpose: { kind: 'save', against: null },
  isCounter: false,
  isSubRoll: true,
}

export interface DamageSubRoll {
  readonly state: GameState
  /** What the save roll threw; empty for a die that could not be rolled. */
  readonly dice: readonly DieRoll[]
  readonly saves: number
  /** Whether the unit went to its death -- which `killUnits` may still have turned
   *  into a Replanting, a Rise or an exchange; the log says which. */
  readonly killed: boolean
}

/**
 * `damage` points on one unit, its save roll, and the death if the saves fall short.
 *
 * Logs the roll as a `sai_sub_roll` carrying the damage, then whatever the death wrote.
 * A unit no longer in play takes nothing and rolls nothing: the state comes back as it
 * went in.
 */
export function damageSubRoll(
  state: GameState,
  unitId: UnitId,
  damage: number,
  source: string,
): DamageSubRoll {
  const unit = state.units[unitId]
  const where = armyRefOf(state, unitId)
  if (unit === undefined || where === null || damage <= 0) {
    return { state, dice: [], saves: 0, killed: false }
  }

  const [[sub], rng] = rollUnits([unitRoll(state, unitId)], 'save', DAMAGE_SAVE_ROLL, state.rng, state.ruleSet)
  const roll = sub?.roll ?? null
  if (roll !== null) expectNoEffects(roll, `${source}'s save roll`)
  const saves = roll?.total ?? 0
  const dice = roll?.dice ?? []
  const killed = damage - saves >= unitType(unit.typeId).health

  const entry: LogEntry = {
    kind: 'sai_sub_roll',
    player: unit.owner,
    source,
    slot: where,
    test: 'save',
    dice,
    escaped: killed ? [] : [unitId],
    damage,
  }
  const rolled = endGlaresOf({ ...state, rng, log: [...state.log, entry] }, dice.length > 0 ? [unitId] : [])
  if (!killed) return { state: rolled, dice, saves, killed }

  const outcome = killUnits(rolled, [unitId])
  return {
    state: { ...outcome.state, log: [...outcome.state.log, ...deathEntries(outcome, unit.owner, where, [unitId])] },
    dice,
    saves,
    killed,
  }
}
