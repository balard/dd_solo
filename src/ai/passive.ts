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
import type { GameAction, GameState, Pending, TerrainSlot } from '../engine/types'
import { army as armyRef } from '../engine/types'

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

    // It casts nothing, which is honest while it also attacks nothing -- and stops
    // being honest the moment it is declining eighteen spells. `GreedyAI` (Phase 9)
    // is where that is answered; see OVERVIEW.md section 4.
    case 'announce_spells':
      return { kind: 'announce_spells', casts: [] }

    // It casts nothing, so these only ever reach it as a spell of the *human's* that
    // put a decision in its hands. Each takes the first legal answer: there is no
    // passive option -- a declared target and a summoned dragon are forced once the
    // spell resolves -- and picking is not the same as wanting.
    // It declines the reroll, which is the one genuinely passive answer among these:
    // "may re-roll", and keeping what you rolled is a real choice rather than a
    // forfeit.
    case 'flashfire':
      return { kind: 'flashfire', unitIds: [] }

    case 'dragon_order':
      return { kind: 'dragon_order', slot: pending.options[0] as TerrainSlot }

    case 'dragon_target':
      return {
        kind: 'dragon_target',
        targets: Object.fromEntries(
          pending.choices.map((choice) => [choice.dragonId, choice.options[0] as string]),
        ),
      }

    case 'spell_move':
      return { kind: 'spell_move', slot: pending.options[0] as TerrainSlot }

    case 'spell_summon':
      return { kind: 'spell_summon', dragonId: pending.options[0] as string }

    // It counters: free, and it keeps the counter-attack path live under test.
    case 'choose_counter_attack':
      return { kind: 'choose_counter_attack', counter: true }

    case 'assign_damage':
      return {
        kind: 'assign_damage',
        unitIds: damageOptions(armyRef(state, pending.player, pending.slot), pending.damage)
          .suggestion,
      }

    // There is no passive answer here: an SAI aimed at an opponent must take the
    // maximum it can (full rules p. 32), so the only choice is *which* maximal set,
    // and declining is not on offer. Taking the engine's own suggestion is the same
    // move `assign_damage` makes, pointed at the other army.
    case 'sai_target': {
      // Choke may pick only from the dice that rolled an ID, so the maximum it is held
      // to is the maximum within that set.
      const army = armyRef(state, pending.target, pending.slot).filter(
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

    // City: free, so it takes what it can get -- a promotion first (it never
    // costs anything a passive player would rather keep), else a recruit, else
    // there is nothing on offer and "do nothing" is the only legal answer anyway.
    case 'eighth_face_city': {
      const [promotion] = pending.promotions
      if (promotion !== undefined) {
        return { kind: 'eighth_face_city', choice: { kind: 'promote', pair: promotion } }
      }
      const [recruitId] = pending.recruits
      if (recruitId !== undefined) {
        return { kind: 'eighth_face_city', choice: { kind: 'recruit', unitId: recruitId } }
      }
      return { kind: 'eighth_face_city', choice: null }
    }

    // Temple: forces every time. A crude opinion, but a real one -- `GreedyAI`
    // (Phase 9) is what should notice a Phoenix in the opponent's DUA and decline.
    case 'eighth_face_temple':
      return { kind: 'eighth_face_temple', force: true }

    // No opinion about which of its own dice to lose, so the first offered.
    case 'temple_bury':
      return { kind: 'temple_bury', unitId: pending.options[0] ?? '' }

    // A breath kills five health-worth and the owner only picks which: the same
    // maximal rule as any damage assignment, and declining is not on offer.
    case 'dragon_breath':
      return {
        kind: 'dragon_breath',
        unitIds: damageOptions(armyRef(state, pending.player, pending.slot), pending.health)
          .suggestion,
      }

    // Free, like City's: a treasure promotion costs nothing a passive player would
    // rather keep, so declining it would be surrender rather than passivity.
    case 'dragon_treasure':
      return { kind: 'dragon_treasure', pair: pending.promotions[0] ?? null }

    // Everything into saves. Passive has one thing it wants from a dragon attack --
    // to still have an army afterwards -- and melee and missile only kill dragons.
    // `GreedyAI` is what should weigh a slaying against the casualties.
    case 'dragon_allocate':
      return {
        kind: 'dragon_allocate',
        ids: { save: pending.ids },
        flexible: { save: pending.flexible },
      }

    // It spends what it has where it can kill, which is free: melee and missile
    // results have no other use in a dragon attack, and holding them back would
    // leave a dragon alive for no gain.
    case 'dragon_damage_split': {
      const melee: Record<string, number> = {}
      const missile: Record<string, number> = {}
      let meleeLeft = pending.melee
      let missileLeft = pending.missile
      for (const target of pending.targets) {
        if (meleeLeft >= target.threshold) {
          melee[target.dragonId] = target.threshold
          meleeLeft -= target.threshold
        } else if (missileLeft >= target.threshold) {
          missile[target.dragonId] = target.threshold
          missileLeft -= target.threshold
        }
      }
      return { kind: 'dragon_damage_split', melee, missile }
    }
  }
}
