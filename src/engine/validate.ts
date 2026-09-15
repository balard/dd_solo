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
 * deriving armies by query.
 */
import { UNIT_TYPES, terrainDie } from '../data/load'

import {
  TERRAIN_SLOTS,
  capturedCount,
  livingUnits,
  type GameState,
  type PlayerId,
} from './types'

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
    if (unit.location.kind === 'terrain' && !TERRAIN_SLOTS.includes(unit.location.slot)) {
      problems.push(`unit ${unit.id}: unknown terrain slot ${String(unit.location.slot)}`)
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
