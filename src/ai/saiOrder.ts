/**
 * How often the order a roll's SAIs resolve in could matter (v2 Phase 9e).
 *
 * The rules let the roller choose that order (p. 27, step 4); the engine fixes it to
 * roll order, a house rule from v1 Phase 4b (`targeting.ts`). Phase 9e was to give the
 * choice back only if it came up often enough to earn a question, and this is the
 * measurement it was decided on. `npm run sai-order` prints it; `RULES-V0.md` section 11
 * records the numbers and the decision.
 *
 * **What counts as "can matter"** -- the step-4 queue of one attack roll, as it is parked
 * for its first decision, holding:
 * - **two different SAIs that both reach the defending army** -- a targeting SAI with
 *   something to take (`enemy`, `sleep`), or a Cantrip, whose spells can change what a
 *   later SAI may pick from. A Galeforce, a free move, a Wild Growth or an Illusion
 *   touches no die the others pick from, so it never makes the order matter;
 * - **or one unit-targeting SAI twice** (two Sleeps, two Swallows): p. 32 resolves them
 *   one by one, so each may name the same die -- the "insurance" case. Counted apart
 *   when the defending army is down to one die, where it matters most.
 *
 * A Bullseye or Double Strike is left out: it is a step-3 SAI, and step 3 keeps its
 * order by rule. An over-count rather than an under-count otherwise -- two SAIs that
 * reach one army do not always interfere -- so a small number here is a ceiling.
 *
 * Read from outside the engine, off `combat.attack.targets` at each action boundary, so
 * it needs no engine counter and no `GameState` field. The cost is that a queue drained
 * inside a single action is not seen, which only happens when no task in it asked
 * anything -- and then there was no order to choose.
 */
import { damageOptions } from '../engine/damage'
import { begin, reduce } from '../engine/reduce'
import { rngFrom } from '../engine/rng'
import { setupGame, type ForceSpec } from '../engine/setup'
import type { TargetTask } from '../engine/targeting'
import { V1_RULES, army as armyRef, type GameState, type PlayerId } from '../engine/types'

import type { AiPlayer } from './types'

export interface OrderTally {
  /** Every exchange in the games (`combat_resolved` entries). */
  exchanges: number
  /** Attack rolls parked with a step-4 queue. */
  queued: number
  /** ... of which held two tasks or more. */
  twoOrMore: number
  /** ... of which the order could matter, by the definition above. */
  matters: number
  /** Two different SAIs that reach the defending army. */
  different: number
  /** ... one of them a Cantrip. */
  withCantrip: number
  /** One unit-targeting SAI twice. */
  repeated: number
  /** ... against an army of one die. */
  lastDie: number
  /** A few of the queues that counted, for reading. */
  readonly examples: string[]
}

export const emptyTally = (): OrderTally => ({
  exchanges: 0,
  queued: 0,
  twoOrMore: 0,
  matters: 0,
  different: 0,
  withCantrip: 0,
  repeated: 0,
  lastDie: 0,
  examples: [],
})

const opponent = (player: PlayerId): PlayerId => (player === 'p1' ? 'p2' : 'p1')

/** Plays one game and adds what its attack rolls queued to `tally`. */
export function tallyGame(
  seed: number,
  forces: ForceSpec,
  players: Readonly<Record<PlayerId, AiPlayer>>,
  tally: OrderTally,
  maxDecisions = 20_000,
): GameState {
  let state = begin(setupGame({ seed, forces, ruleSet: V1_RULES }))
  let rng = rngFrom(seed * 7 + 1)
  const seen = new Set<unknown>()
  for (let n = 0; state.winner === null && state.pending !== null && n < maxDecisions; n++) {
    const [action, next] = players[state.pending.player].decide(state, state.pending, rng)
    rng = next
    state = reduce(state, action)

    const combat = state.turn.combat
    const attack = combat?.attack
    // One count per attack roll: the raw dice array is the roll's identity.
    if (combat === undefined || combat === null || attack?.targets === undefined || seen.has(attack.dice)) continue
    seen.add(attack.dice)

    const isCounter = state.turn.marchStep.includes('counter')
    const defender = isCounter ? state.turn.marching : opponent(state.turn.marching)
    const slot = isCounter ? (state.turn.marchingArmy ?? 'reserve') : combat.targetSlot
    const army = armyRef(state, defender, slot)
    const reaches = (task: TargetTask): boolean => {
      switch (task.kind) {
        case 'enemy':
          return task.one === true ? army.length > 0 : damageOptions(army, task.health).required > 0
        case 'sleep':
          return army.length > 0
        case 'cantrip':
          return true
        default:
          return false
      }
    }

    const step4 = attack.targets.filter((task) => !(task.kind === 'enemy' && task.rerollAfter !== undefined))
    const reaching = step4.filter(reaches)
    const oneUnit = reaching.filter((task) => task.kind === 'sleep' || (task.kind === 'enemy' && task.one === true))
    const different = new Set(reaching.map((task) => task.sai)).size > 1
    const repeated = oneUnit.length > new Set(oneUnit.map((task) => task.sai)).size

    tally.queued++
    if (step4.length > 1) tally.twoOrMore++
    if (!different && !repeated) continue
    tally.matters++
    if (different) tally.different++
    if (different && reaching.some((task) => task.kind === 'cantrip')) tally.withCantrip++
    if (repeated) tally.repeated++
    if (repeated && army.length === 1) tally.lastDie++
    if (tally.examples.length < 6) {
      tally.examples.push(`seed ${seed}: ${reaching.map((task) => task.sai).join(' + ')} against ${army.length} dice`)
    }
  }
  tally.exchanges += state.log.filter((entry) => entry.kind === 'combat_resolved').length
  return state
}

/** One line of the report. */
export function describeTally(name: string, games: number, tally: OrderTally): string {
  const rate = tally.matters === 0 ? 'never' : `1 exchange in ${Math.round(tally.exchanges / tally.matters)}`
  return (
    `${name}, ${games} games: ${tally.exchanges} exchanges, ${tally.queued} attack rolls queued SAIs, ` +
    `${tally.twoOrMore} queued two or more. The order could matter ${tally.matters} times (${rate}): ` +
    `${tally.different} with two different SAIs (${tally.withCantrip} with a Cantrip), ` +
    `${tally.repeated} with one unit-targeting SAI twice (${tally.lastDie} against a last die).` +
    tally.examples.map((example) => `\n    ${example}`).join('')
  )
}
