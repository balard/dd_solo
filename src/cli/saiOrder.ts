/**
 * `npm run sai-order`: how often the order a roll's SAIs resolve in could matter, over
 * self-play (v2 Phase 9e). See `src/ai/saiOrder.ts` for what is counted, and
 * `RULES-V0.md` section 11 for the decision these numbers settled.
 *
 * About twenty seconds. Re-run it when a species phase adds a targeting SAI or a
 * Cantrip-like window: a new pairing is what could make the house rule cost more.
 */
import { greedyAi } from '../ai/greedy'
import { randomAi } from '../ai/random'
import { describeTally, emptyTally, tallyGame } from '../ai/saiOrder'
import type { AiPlayer } from '../ai/types'
import { BESTIARY_FORCES, FORCE_SETS, type ForceSpec } from '../engine/setup'
import type { PlayerId } from '../engine/types'

const RUNS: readonly (readonly [string, ForceSpec, Readonly<Record<PlayerId, AiPlayer>>, number])[] = [
  ['Greedy self-play, rolled forces', { kind: 'random' }, { p1: greedyAi, p2: greedyAi }, 200],
  ['Greedy self-play, bestiary', BESTIARY_FORCES, { p1: greedyAi, p2: greedyAi }, 100],
  ['Greedy self-play, Genie mirror', FORCE_SETS['firewalkers_genie'] as ForceSpec, { p1: greedyAi, p2: greedyAi }, 50],
  ['Random self-play, rolled forces', { kind: 'random' }, { p1: randomAi, p2: randomAi }, 200],
  ['Random self-play, mixed forces', { kind: 'random', mixed: true }, { p1: randomAi, p2: randomAi }, 100],
]

for (const [name, forces, players, games] of RUNS) {
  const tally = emptyTally()
  for (let seed = 1; seed <= games; seed++) tallyGame(seed, forces, players, tally)
  console.log(describeTally(name, games, tally))
}
