/**
 * The alpha opponent: takes no initiative.
 *
 * Skips every march, never reinforces or retreats. But it is **not inert** -- it
 * answers every decision forced on it, and it *does* contest maneuvers and
 * counter-attack.
 *
 * Both of those are free. Contesting costs nothing but a roll it was never going to
 * use elsewhere, and declining would hand the marcher every terrain turn unopposed,
 * which is not passivity so much as surrender. They also keep the contest and
 * counter-attack paths under test, which a truly do-nothing opponent would leave
 * entirely unexercised.
 *
 * "Passive" here means "starts nothing", not "never acts". The engine only asks at
 * all when this player actually has an army at the contested terrain.
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

    // It contests: free, and letting every maneuver through unopposed is surrender.
    case 'contest_maneuver':
      return { kind: 'contest_maneuver', contest: true }

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

    // There is no passive answer here: an SAI aimed at an opponent must take the
    // maximum it can (full rules p. 32), so the only choice is *which* maximal set,
    // and declining is not on offer. Taking the engine's own suggestion is the same
    // move `assign_damage` makes, pointed at the other army.
    case 'sai_target': {
      // Choke may pick only from the dice that rolled an ID, so the maximum it is held
      // to is the maximum within that set.
      const army = armyAt(state, pending.target, pending.slot).filter(
        (unit) => pending.eligible === undefined || pending.eligible.includes(unit.id),
      )
      // Sleep takes one die and there is nothing to maximise; everything else takes
      // the maximum it can, because p. 32 leaves no other legal answer.
      const unitIds =
        pending.limit.kind === 'one'
          ? army.slice(0, 1).map((unit) => unit.id)
          : damageOptions(army, pending.limit.budget).suggestion
      return { kind: 'sai_target', unitIds }
    }

    // **The first decisions passive can honestly decline**, and it declines both.
    // Every SAI before Phase 4e was aimed at an opponent and forced to its maximum;
    // these two are friendly and "up to", so doing nothing is a legal answer rather
    // than a surrender -- and `PassiveAI` starting nothing is the whole point of it.
    case 'sai_promote':
      return { kind: 'sai_promote', pairs: [] }

    case 'sai_move':
      return { kind: 'sai_move', slot: null, unitIds: [] }

    // Likewise forced: the SAI fires, so an army must be named. The first is as good
    // an answer as passive can give -- wanting a *particular* terrain is GreedyAI's.
    case 'sai_target_army':
      return { kind: 'sai_target_army', slot: pending.options[0] ?? 'frontier' }

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
