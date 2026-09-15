/**
 * A test tool, not an opponent.
 *
 * Picks a uniformly random legal decision. Self-play over thousands of seeded games
 * is the cheapest bug detector available here: it finds illegal states, unreachable
 * phases, infinite loops and crashes far faster than hand-written scenarios can.
 */
import { damageOptions } from '../engine/damage'
import { nextInt, type RngState } from '../engine/rng'
import {
  TERRAIN_SLOTS,
  armyAt,
  type GameAction,
  type GameState,
  type Pending,
  type UnitInstance,
} from '../engine/types'

import type { AiPlayer } from './types'

function pick<T>(rng: RngState, options: readonly T[]): readonly [T, RngState] {
  if (options.length === 0) throw new Error('nothing to pick from')
  const [index, next] = nextInt(rng, options.length)
  return [options[index] as T, next] as const
}

function coin(rng: RngState): readonly [boolean, RngState] {
  const [value, next] = nextInt(rng, 2)
  return [value === 1, next] as const
}

/** Fisher-Yates over the injected rng, so shuffles are reproducible too. */
function shuffle<T>(rng: RngState, items: readonly T[]): readonly [T[], RngState] {
  const out = [...items]
  let state = rng
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(state, i + 1)
    state = next
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return [out, state] as const
}

export const randomAi: AiPlayer = {
  name: 'random',

  decide(state: GameState, pending: Pending, rng: RngState) {
    switch (pending.kind) {
      case 'choose_march_army': {
        // `null` is always legal, so it belongs in the pool alongside the armies.
        const [army, next] = pick(rng, [...pending.options, null])
        return [{ kind: 'choose_march_army', army } as GameAction, next] as const
      }

      case 'choose_maneuver': {
        const [maneuver, next] = coin(rng)
        return [{ kind: 'choose_maneuver', maneuver } as GameAction, next] as const
      }

      case 'contest_maneuver': {
        const [contest, next] = coin(rng)
        return [{ kind: 'contest_maneuver', contest } as GameAction, next] as const
      }

      case 'choose_direction': {
        const [direction, next] = pick(rng, pending.options)
        return [{ kind: 'choose_direction', direction } as GameAction, next] as const
      }

      case 'choose_action': {
        const [action, next] = pick(rng, [...pending.legal, null])
        return [{ kind: 'choose_action', action } as GameAction, next] as const
      }

      case 'choose_missile_target': {
        const [slot, next] = pick(rng, pending.options)
        return [{ kind: 'choose_missile_target', slot } as GameAction, next] as const
      }

      case 'choose_counter_attack': {
        const [counter, next] = coin(rng)
        return [{ kind: 'choose_counter_attack', counter } as GameAction, next] as const
      }

      case 'assign_damage': {
        // Every maximal set is legal and they are not interchangeable -- which units
        // die changes the game. Shuffling before solving explores that space without
        // enumerating it.
        const army = armyAt(state, pending.player, pending.slot)
        const [shuffled, next] = shuffle(rng, army)
        const { suggestion } = damageOptions(shuffled as readonly UnitInstance[], pending.damage)
        return [{ kind: 'assign_damage', unitIds: suggestion } as GameAction, next] as const
      }

      case 'reinforce': {
        const reserves = Object.values(state.units).filter(
          (u) => u.owner === pending.player && u.location.kind === 'reserve',
        )
        const [slot, afterSlot] = pick(rng, TERRAIN_SLOTS)
        const [count, next] = nextInt(afterSlot, reserves.length + 1)
        return [
          {
            kind: 'reinforce',
            moves: reserves.slice(0, count).map((u) => ({ unitId: u.id, slot })),
          } as GameAction,
          next,
        ] as const
      }

      case 'retreat': {
        const deployed = Object.values(state.units).filter(
          (u) => u.owner === pending.player && u.location.kind === 'terrain',
        )
        const [count, next] = nextInt(rng, Math.min(deployed.length, 4) + 1)
        return [
          { kind: 'retreat', unitIds: deployed.slice(0, count).map((u) => u.id) } as GameAction,
          next,
        ] as const
      }
    }
  },
}
