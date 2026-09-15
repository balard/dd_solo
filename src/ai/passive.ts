/**
 * The alpha opponent: takes no initiative.
 *
 * Skips every march, never contests a maneuver, never reinforces or retreats. But
 * it is **not inert** -- it answers every decision forced on it, and it *does*
 * counter-attack, which costs it nothing and exercises a path a truly do-nothing
 * opponent would leave entirely untested.
 *
 * "Passive" here means "starts nothing", not "never acts".
 */
import { damageOptions } from '../engine/damage'
import type { RngState } from '../engine/rng'
import type { GameAction, GameState, Pending } from '../engine/types'
import { armyAt } from '../engine/types'

import type { AiPlayer } from './types'

export const passiveAi: AiPlayer = {
  name: 'passive',

  decide(state: GameState, pending: Pending, rng: RngState) {
    return [decideAction(state, pending), rng] as const
  },
}

function decideAction(state: GameState, pending: Pending): GameAction {
  switch (pending.kind) {
    case 'choose_march_army':
      return { kind: 'choose_march_army', army: null }

    case 'choose_maneuver':
      return { kind: 'choose_maneuver', maneuver: false }

    case 'contest_maneuver':
      return { kind: 'contest_maneuver', contest: false }

    case 'choose_action':
      return { kind: 'choose_action', action: null }

    // It counters: free, and it keeps the counter-attack path live under test.
    case 'choose_counter_attack':
      return { kind: 'choose_counter_attack', counter: true }

    case 'assign_damage':
      return {
        kind: 'assign_damage',
        unitIds: damageOptions(armyAt(state, pending.player, pending.slot), pending.damage)
          .suggestion,
      }

    case 'reinforce':
      return { kind: 'reinforce', moves: [] }

    case 'retreat':
      return { kind: 'retreat', unitIds: [] }

    // Unreachable while it never maneuvers or attacks, but a legal answer costs
    // nothing and beats throwing if a future rule routes it here.
    case 'choose_direction':
      return { kind: 'choose_direction', direction: pending.options[0] ?? 'up' }
    case 'choose_missile_target':
      return { kind: 'choose_missile_target', slot: pending.options[0] ?? 'frontier' }
  }
}
