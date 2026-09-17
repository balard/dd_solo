/**
 * A test tool, not an opponent.
 *
 * Picks a uniformly random legal decision. Self-play over thousands of seeded games
 * is the cheapest bug detector available here: it finds illegal states, unreachable
 * phases, infinite loops and crashes far faster than hand-written scenarios can.
 */
import { damageOptions, healthsOf } from '../engine/damage'
import { growthPartners } from '../engine/dua'
import { isAsleep } from '../engine/effects'
import { nextInt, type RngState } from '../engine/rng'
import {
  TERRAIN_SLOTS,
  armyAt,
  type GameAction,
  type GameState,
  type Pending,
  type TerrainSlot,
  type UnitId,
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

/** One unit's health, for the two budgets this file has to respect. */
function health(state: GameState, unitId: UnitId): number {
  const unit = state.units[unitId]
  return unit === undefined ? 0 : (healthsOf([unit])[0] ?? 0)
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

      // The same shuffle-then-solve, aimed at the *enemy* army. There is no "target
      // nothing" to explore -- an SAI against an opponent must take its maximum -- so
      // the whole space of this decision is which maximal set, and that is what the
      // shuffle walks.
      case 'sai_target': {
        // Choke may take only the dice that rolled an ID icon, and the maximum it is
        // held to is the maximum *within that set* -- so a fuzz that picks from the
        // whole army produces an illegal answer and fails the game rather than the
        // rule. A decision that gains a dimension has to reach the fuzz opponent too.
        const army = armyAt(state, pending.target, pending.slot).filter(
          (unit) => pending.eligible === undefined || pending.eligible.includes(unit.id),
        )
        const [shuffled, next] = shuffle(rng, army)

        // Sleep picks one die uniformly; the shuffle is the pick. A sleeping die is
        // deliberately *not* filtered out -- it is a legal target, and a fuzz that
        // never produces one never exercises the double-Sleep path.
        if (pending.limit.kind === 'one') {
          const unit = shuffled[0]
          const unitIds = unit === undefined ? [] : [unit.id]
          return [{ kind: 'sai_target', unitIds } as GameAction, next] as const
        }

        const { suggestion } = damageOptions(
          shuffled as readonly UnitInstance[],
          pending.limit.budget,
        )
        return [{ kind: 'sai_target', unitIds: suggestion } as GameAction, next] as const
      }

      /**
       * Uniform over every terrain the opponent holds, not just the one being
       * attacked. Galeforce is the first SAI that can reach off the board it was
       * rolled on, and picking `options[0]` here would mean a thousand fuzz games
       * never once produced a cross-terrain cast -- the reinforce bug again.
       */
      /**
       * Wild Growth. Builds a legal set of pairs by walking the army in a random
       * order and spending what is left of the budget on the first affordable partner
       * -- which is not a strategy, but it does reach the promotion path, including
       * the multi-step jumps that `promotionMatching` cannot express.
       */
      case 'sai_promote': {
        const [units, afterShuffle] = shuffle(rng, armyAt(state, pending.player, pending.slot))
        let next = afterShuffle
        let budget = pending.budget
        const taken = new Set<UnitId>()
        const pairs: { unitId: UnitId; partnerId: UnitId }[] = []

        for (const unit of units) {
          if (budget <= 0) break
          const options = growthPartners(state, unit.id, budget).filter((p) => !taken.has(p.id))
          if (options.length === 0) continue
          const [take, afterCoin] = coin(next)
          next = afterCoin
          if (!take) continue

          const [partner, afterPick] = pick(next, options)
          next = afterPick
          taken.add(partner.id)
          pairs.push({ unitId: unit.id, partnerId: partner.id })
          budget -= health(state, partner.id) - health(state, unit.id)
        }

        return [{ kind: 'sai_promote', pairs } as GameAction, next] as const
      }

      /** A free move: decline half the time, and otherwise take a random destination
       *  and a random affordable handful along. */
      case 'sai_move': {
        const [go, afterCoin] = coin(rng)
        if (!go || pending.options.length === 0) {
          return [{ kind: 'sai_move', slot: null, unitIds: [] } as GameAction, afterCoin] as const
        }

        const [slot, afterSlot] = pick(afterCoin, pending.options)
        const [others, afterShuffle] = shuffle(
          afterSlot,
          armyAt(state, pending.player, pending.slot).filter(
            (unit) => unit.id !== pending.unitId && !isAsleep(state, unit.id),
          ),
        )

        let carried = 0
        const unitIds: UnitId[] = []
        for (const unit of others) {
          const cost = health(state, unit.id)
          if (carried + cost > pending.health) continue
          carried += cost
          unitIds.push(unit.id)
        }

        return [{ kind: 'sai_move', slot, unitIds } as GameAction, afterShuffle] as const
      }

      case 'sai_target_army': {
        const [slot, next] = pick(rng, pending.options)
        return [
          { kind: 'sai_target_army', slot: slot ?? 'frontier' } as GameAction,
          next,
        ] as const
      }

      case 'reinforce': {
        // A destination *per unit*, not one for the batch: "you may split the reserve
        // units up, sending some to one terrain and some to another". One slot for
        // everybody left the split half of the Reinforce Step unreachable, so the
        // fuzz never once produced a reserve arriving at two terrains.
        const reserves = Object.values(state.units).filter(
          (u) => u.owner === pending.player && u.location.kind === 'reserve',
        )
        const [count, afterCount] = nextInt(rng, reserves.length + 1)

        const moves: { unitId: UnitId; slot: TerrainSlot }[] = []
        let next = afterCount
        for (const unit of reserves.slice(0, count)) {
          const [slot, afterSlot] = pick(next, TERRAIN_SLOTS)
          moves.push({ unitId: unit.id, slot })
          next = afterSlot
        }

        return [{ kind: 'reinforce', moves } as GameAction, next] as const
      }


      case 'retreat': {
        // A sleeping unit cannot leave its terrain, and the engine throws on one --
        // so the fuzz opponent has to know the rule too, or a decision that gained a
        // dimension quietly narrows the games it can produce.
        const deployed = Object.values(state.units).filter(
          (u) =>
            u.owner === pending.player &&
            u.location.kind === 'terrain' &&
            !isAsleep(state, u.id),
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
