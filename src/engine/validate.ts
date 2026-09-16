/**
 * Invariant checker for `GameState`.
 *
 * Returns a list of problems rather than throwing, so tests can assert on the exact
 * complaint and the self-play fuzz harness in Phase 6 can report every violation at
 * once instead of only the first.
 *
 * Note what is *not* checked: "every unit is in exactly one place" is structurally
 * guaranteed, because a unit's location is a field on the unit and there is no
 * parallel list of armies or dead units to drift out of sync. That was the point of
 * deriving armies by query, and adding the BUA did not weaken it -- `PLAN-V1.md`
 * asked Phase 2 for that check, and it would still be a check that cannot fail.
 *
 * What Phase 2 *did* make reachable is a unit changing sides: `exchangeWithDua` is
 * the only operation in the game that moves a die between two players' areas, and a
 * promotion that picked the wrong partner would be silent -- `speciesOf` reads the
 * species off whichever unit it finds first. Hence the species check below.
 */
import { UNIT_TYPES, terrainDie, unitType } from '../data/load'

import { pruneEffects } from './effects'
import {
  TERRAIN_SLOTS,
  capturedCount,
  livingUnits,
  unitsOf,
  type GameState,
  type PlayerId,
} from './types'

const LOCATION_KINDS: readonly string[] = ['terrain', 'reserve', 'dua', 'bua']


const PLAYERS: readonly PlayerId[] = ['p1', 'p2']

export function validateState(state: GameState): string[] {
  const problems: string[] = []
  const knownTypes = new Set(UNIT_TYPES.map((u) => u.id))

  for (const [key, unit] of Object.entries(state.units)) {
    if (unit.id !== key) {
      problems.push(`unit ${key}: keyed as ${key} but its id is ${unit.id}`)
    }
    if (!knownTypes.has(unit.typeId)) {
      problems.push(`unit ${unit.id}: unknown unit type ${unit.typeId}`)
    }
    if (unit.owner !== 'p1' && unit.owner !== 'p2') {
      problems.push(`unit ${unit.id}: unknown owner ${String(unit.owner)}`)
    }
    if (!LOCATION_KINDS.includes(unit.location.kind)) {
      problems.push(`unit ${unit.id}: unknown location ${String(unit.location.kind)}`)
    }
    if (unit.location.kind === 'terrain' && !TERRAIN_SLOTS.includes(unit.location.slot)) {
      problems.push(`unit ${unit.id}: unknown terrain slot ${String(unit.location.slot)}`)
    }
  }

  // A force is one species, dead and buried dice included. Only an exchange with the
  // DUA can break this, and only by pairing across owners or across species.
  for (const player of PLAYERS) {
    const species = new Set(
      unitsOf(state, player)
        .filter((u) => knownTypes.has(u.typeId))
        .map((u) => unitType(u.typeId).species),
    )
    if (species.size > 1) {
      problems.push(`${player}: fields more than one species (${[...species].sort().join(', ')})`)
    }
  }


  for (const slot of TERRAIN_SLOTS) {
    const terrain = state.terrains[slot] as GameState['terrains'][typeof slot] | undefined
    if (terrain === undefined) {
      problems.push(`terrain ${slot}: missing`)
      continue
    }
    if (terrain.slot !== slot) {
      problems.push(`terrain ${slot}: keyed as ${slot} but its slot is ${terrain.slot}`)
    }
    if (!Number.isInteger(terrain.face) || terrain.face < 1 || terrain.face > 8) {
      problems.push(`terrain ${slot}: face ${terrain.face} is outside 1-8`)
    }
    try {
      terrainDie(terrain.dieId)
    } catch {
      problems.push(`terrain ${slot}: unknown terrain die ${terrain.dieId}`)
    }

    // A terrain is captured exactly when it is on its eighth face. Letting these
    // drift apart would silently break both the win check and the revert-to-7 rule.
    if (terrain.face === 8 && terrain.capturedBy === null) {
      problems.push(`terrain ${slot}: on face 8 but nobody has captured it`)
    }
    if (terrain.face !== 8 && terrain.capturedBy !== null) {
      problems.push(`terrain ${slot}: captured by ${terrain.capturedBy} but on face ${terrain.face}`)
    }
  }

  for (const player of PLAYERS) {
    const captured = capturedCount(state, player)
    if (captured >= 2 && state.winner !== player) {
      problems.push(`${player}: holds ${captured} terrains but is not recorded as the winner`)
    }
    if (livingUnits(state, player).length === 0 && state.winner === player) {
      problems.push(`${player}: recorded as the winner with no units in play`)
    }
  }

  if (state.winner !== null && state.turn.phase !== 'game_over') {
    problems.push(`winner is ${state.winner} but the phase is ${state.turn.phase}`)
  }

  if (state.rng.counter < 0 || !Number.isInteger(state.rng.counter)) {
    problems.push(`rng counter ${state.rng.counter} is not a non-negative integer`)
  }

  // An effect whose army has emptied or whose unit has left play should have been
  // dropped at the end of the last action. Asking `pruneEffects` rather than repeating
  // its conditions means the check cannot drift away from the rule it is checking.
  if (pruneEffects(state) !== state) {
    problems.push(
      `effects: ${state.effects.length - pruneEffects(state).effects.length} outlived their ` +
        `target and were not pruned`,
    )
  }
  for (const effect of state.effects) {
    if (effect.target.kind === 'unit' && state.units[effect.target.unitId] === undefined) {
      problems.push(`effect ${effect.source}: names unit ${effect.target.unitId}, which does not exist`)
    }
    if (effect.expiresAtStartOfTurnOf !== 'p1' && effect.expiresAtStartOfTurnOf !== 'p2') {
      problems.push(
        `effect ${effect.source}: expires at the start of ` +
          `${String(effect.expiresAtStartOfTurnOf)}'s turn, who is not a player`,
      )
    }
  }

  const marched = state.turn.armiesMarched
  if (new Set(marched).size !== marched.length) {
    problems.push(`armiesMarched has a repeat: ${marched.join(', ')} -- each march needs a different army`)
  }

  return problems
}

/** Throws if the state is invalid. For use at the top of tests and in the fuzzer. */
export function assertValidState(state: GameState, context = 'state'): void {
  const problems = validateState(state)
  if (problems.length > 0) {
    throw new Error(`${context} is invalid:\n  ${problems.join('\n  ')}`)
  }
}
