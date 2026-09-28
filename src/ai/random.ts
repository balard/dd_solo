/**
 * A test tool, not an opponent.
 *
 * Picks a uniformly random legal decision. Self-play over thousands of seeded games
 * is the cheapest bug detector available here: it finds illegal states, unreachable
 * phases, infinite loops and crashes far faster than hand-written scenarios can.
 */
import type { ResultType } from '../data/types'
import { damageOptions, healthsOf } from '../engine/damage'
import { growthPartners } from '../engine/dua'
import { isAsleep } from '../engine/effects'
import { announcementProblem, elementsFor } from '../engine/magic'
import { nextInt, type RngState } from '../engine/rng'
import { DRAGON_ROLL_KINDS } from '../engine/sai'
import {
  TERRAIN_SLOTS,
  army as armyRef,
  type AnnouncedSpell,
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
      // All three answers, uniformly: the first turn, or either proposal. A fuzz that
      // always took the first turn would never reach `choose_frontier` at all.
      case 'roll_off_choice': {
        const [pick, next] = nextInt(rng, 3)
        const action: GameAction =
          pick === 0
            ? { kind: 'roll_off_choice', take: 'first_turn' }
            : { kind: 'roll_off_choice', take: 'frontier', proposer: pick === 1 ? 'p1' : 'p2' }
        return [action, next] as const
      }

      case 'choose_frontier': {
        const [proposer, next] = pick(rng, ['p1', 'p2'] as const)
        return [{ kind: 'choose_frontier', proposer } as GameAction, next] as const
      }

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

      /**
       * Announces a random affordable subset.
       *
       * It has to gain every dimension the decision has, or the fuzz quietly narrows
       * the way `reinforce`'s did -- an opponent that always announced nothing would
       * never execute a spell across a thousand games. So it spends a random slice of
       * the pool, picks the element and the target at random, and **combines castings
       * at random** rather than always casting one at a time, which is the only way
       * the cumulative arithmetic is ever exercised.
       *
       * Announcing nothing stays in the pool of answers: it is legal, it is what a
       * pool too small for anything does, and a fuzz that always spent would never
       * reach the empty-announcement path.
       */
      case 'announce_spells': {
        const casts: AnnouncedSpell[] = []
        let budget = pending.pool.points
        let state = rng

        const [order, afterShuffle] = shuffle(state, pending.castable)
        state = afterShuffle

        for (const offer of order) {
          const affordable = Math.min(offer.maxCount, Math.floor(budget / offer.spell.cost))
          if (affordable === 0) continue

          // The target first, because it sets the floor: Resurrect Dead's cost is a
          // property of what it is aimed at, and a count chosen before the target can
          // be too small for it.
          const reachable = offer.targets.filter((t) => t.minCount <= affordable)
          if (reachable.length === 0) continue
          const [aim, afterTarget] = pick(state, reachable)
          state = afterTarget

          // 0 is in the pool deliberately: "skip this one" has to be reachable, or
          // every castable spell is always cast and the partial-spend path is dead.
          const [extra, afterCount] = nextInt(state, affordable - aim.minCount + 2)
          state = afterCount
          if (extra === 0) continue
          const count = aim.minCount + extra - 1

          // Only an element this target takes and some split of the pool can pay. A
          // one-species game narrows neither, so this filters nothing there and draws
          // what it always drew; a mixed one (v2 Phase 2) has a pool per species -- six
          // points of Treefolk magic buy no Firewalker spell -- and a DUA of two colours.
          const payable = elementsFor(offer, aim.target).filter(
            (e) => announcementProblem(pending.pool, [...casts, { spell: offer.spell.id, element: e, count, target: aim.target }]) === null,
          )
          if (payable.length === 0) continue
          const [element, afterElement] = pick(state, payable)
          state = afterElement

          casts.push({ spell: offer.spell.id, element, count, target: aim.target })
          budget -= offer.spell.cost * count
        }

        return [{ kind: 'announce_spells', casts } as GameAction, state] as const
      }

      // Declining stays in the pool: it is legal, it is what a sensible player does
      // with a good roll, and a fuzz that always re-rolled would never reach the
      // path where the faces are left alone.
      case 'flashfire': {
        const [howMany, afterCount] = nextInt(rng, pending.budget + 1)
        const [shuffled, next] = shuffle(afterCount, pending.options)
        return [
          { kind: 'flashfire', unitIds: shuffled.slice(0, howMany) } as GameAction,
          next,
        ] as const
      }

      // Any subset, none included: Flashfire's reasoning, with no budget to cap it.
      case 'rapid_growth': {
        const [howMany, afterCount] = nextInt(rng, pending.options.length + 1)
        const [shuffled, next] = shuffle(afterCount, pending.options)
        return [
          { kind: 'rapid_growth', unitIds: shuffled.slice(0, howMany) } as GameAction,
          next,
        ] as const
      }

      // Any number of exchanges, none included, each with a random partner -- so the
      // fuzz sees both a declined kill line and a Flame burying what was declined.
      case 'accelerated_growth': {
        const most = Math.min(pending.dying.length, pending.partners.length)
        const [howMany, afterCount] = nextInt(rng, most + 1)
        const [dying, afterDying] = shuffle(afterCount, pending.dying)
        const [partners, next] = shuffle(afterDying, pending.partners)
        return [
          {
            kind: 'accelerated_growth',
            pairs: dying
              .slice(0, howMany)
              .map((unitId, i) => ({ unitId, partnerId: partners[i] as string })),
          } as GameAction,
          next,
        ] as const
      }

      // Declining is legal and free, so both answers stay in the pool -- a fuzz that
      // always rolled would never exercise a spell landing unopposed.
      case 'dispel_magic': {
        const [roll, next] = coin(rng)
        return [{ kind: 'dispel_magic', roll } as GameAction, next] as const
      }

      case 'dragon_order': {
        const [slot, next] = pick(rng, pending.options)
        return [{ kind: 'dragon_order', slot } as GameAction, next] as const
      }

      // One roll per dragon rather than one for the lot: each declaration is its own
      // choice, and a fuzz that gave every dragon the same index would never produce
      // two of yours splitting across two enemies.
      case 'dragon_target': {
        const targets: Record<string, string> = {}
        let state = rng
        for (const choice of pending.choices) {
          const [against, next] = pick(state, choice.options)
          state = next
          targets[choice.dragonId] = against
        }
        return [{ kind: 'dragon_target', targets } as GameAction, state] as const
      }

      case 'spell_move': {
        const [slot, next] = pick(rng, pending.options)
        return [{ kind: 'spell_move', slot } as GameAction, next] as const
      }

      case 'spell_summon': {
        const [dragonId, next] = pick(rng, pending.options)
        return [{ kind: 'spell_summon', dragonId } as GameAction, next] as const
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
        const army = armyRef(state, pending.player, pending.slot)
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
        const army = armyRef(state, pending.target, pending.slot).filter(
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
        const [units, afterShuffle] = shuffle(rng, armyRef(state, pending.player, pending.slot))
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
          armyRef(state, pending.player, pending.slot).filter(
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
        const [count, afterCount] = nextInt(rng, Math.min(deployed.length, 4) + 1)
        const unitIds = deployed.slice(0, count).map((u) => u.id)

        // Air Flight (Phase 8): some of the dice that stayed fly, each to a random
        // legal terrain. A second dimension of the same decision, so the fuzz learns
        // it or never produces a flight at all -- the reinforce lesson. Drawn only when
        // flights are offered, so a game without them plays exactly as before.
        const offers = (pending.flights ?? []).filter((o) => !unitIds.includes(o.unitId))
        if (offers.length === 0) {
          return [{ kind: 'retreat', unitIds } as GameAction, afterCount] as const
        }
        let draw = afterCount
        const flights: { unitId: string; slot: TerrainSlot }[] = []
        for (const offer of offers) {
          const [flies, afterCoin] = coin(draw)
          draw = afterCoin
          if (!flies) continue
          const [slot, afterPick] = pick(draw, offer.options)
          draw = afterPick
          flights.push({ unitId: offer.unitId, slot })
        }
        return [
          { kind: 'retreat', unitIds, ...(flights.length > 0 ? { flights } : {}) } as GameAction,
          draw,
        ] as const
      }

      // City: uniform over recruit / promote / nothing, so the fuzz reaches every
      // branch rather than always taking the first legal one.
      case 'eighth_face_city': {
        const options: (() => GameAction)[] = [() => ({ kind: 'eighth_face_city', choice: null })]
        for (const unitId of pending.recruits) {
          options.push(() => ({ kind: 'eighth_face_city', choice: { kind: 'recruit', unitId } }))
        }
        for (const pair of pending.promotions) {
          options.push(() => ({ kind: 'eighth_face_city', choice: { kind: 'promote', pair } }))
        }
        const [make, next] = pick(rng, options)
        return [make(), next] as const
      }

      case 'eighth_face_temple': {
        const [force, next] = coin(rng)
        return [{ kind: 'eighth_face_temple', force } as GameAction, next] as const
      }

      case 'temple_bury': {
        const [unitId, next] = pick(rng, pending.options)
        return [{ kind: 'temple_bury', unitId } as GameAction, next] as const
      }

      // A breath is forced to its maximum like any damage assignment, so the only
      // freedom is which maximal set -- the engine's suggestion is one of them.
      case 'dragon_breath': {
        const army = armyRef(state, pending.player, pending.slot)
        return [
          {
            kind: 'dragon_breath',
            unitIds: damageOptions(army, pending.health).suggestion,
          } as GameAction,
          rng,
        ] as const
      }

      case 'dragon_treasure': {
        const [pair, next] = pick(rng, [...pending.promotions, null])
        return [{ kind: 'dragon_treasure', pair } as GameAction, next] as const
      }

      /*
       * Spread both pools across the three kinds at random, one result at a time.
       *
       * Not "all into save": the split is the whole point of a combination roll, and
       * a fuzz opponent that always answered the same way would never produce a roll
       * that both kills a dragon and saves the army -- which is exactly the state
       * worth finding bugs in. The same lesson as `reinforce`'s one destination.
       */
      case 'dragon_allocate': {
        const [ids, afterIds] = spread(rng, pending.ids)
        const [flexible, afterFlexible] = spread(afterIds, pending.flexible)
        // Flaming Shields (Phase 8): any number from none to all. Drawn only when the
        // question is asked, so a fuzz run without Firewalkers at a fire terrain answers
        // exactly as it did before.
        const shields = pending.shields ?? 0
        if (shields === 0) {
          return [{ kind: 'dragon_allocate', ids, flexible } as GameAction, afterFlexible] as const
        }
        const [savesAsMelee, next] = nextInt(afterFlexible, shields + 1)
        return [
          {
            kind: 'dragon_allocate',
            ids,
            flexible,
            ...(savesAsMelee > 0 ? { savesAsMelee } : {}),
          } as GameAction,
          next,
        ] as const
      }

      /*
       * Each dragon gets a random slice of each pool, which may or may not kill it.
       * Deliberately not the greedy "spend exactly the threshold" that `PassiveAI`
       * plays: a fuzz that always killed what it could would never exercise a dragon
       * surviving an attack, or a pool spent on a dragon it cannot reach.
       */
      case 'dragon_damage_split': {
        let state_ = rng
        const melee: Record<string, number> = {}
        const missile: Record<string, number> = {}
        let meleeLeft = pending.melee
        let missileLeft = pending.missile
        for (const target of pending.targets) {
          const [m, afterM] = nextInt(state_, meleeLeft + 1)
          const [n, afterN] = nextInt(afterM, missileLeft + 1)
          state_ = afterN
          melee[target.dragonId] = m
          missile[target.dragonId] = n
          meleeLeft -= m
          missileLeft -= n
        }
        return [{ kind: 'dragon_damage_split', melee, missile } as GameAction, state_] as const
      }
    }
  },
}

/** Scatters `total` results at random across the three kinds a dragon roll counts. */
function spread(
  rng: RngState,
  total: number,
): readonly [Readonly<Partial<Record<ResultType, number>>>, RngState] {
  const out: Partial<Record<ResultType, number>> = {}
  let state = rng
  for (let n = 0; n < total; n++) {
    const [kind, next] = pick(state, DRAGON_ROLL_KINDS)
    state = next
    out[kind] = (out[kind] ?? 0) + 1
  }
  return [out, state] as const
}
