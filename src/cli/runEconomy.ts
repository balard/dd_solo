/**
 * `npm run run-economy`: how much a run's pool grows by the end of each act, every battle
 * won, under each answering policy (v3 Phase 6). See `src/run/economy.ts`.
 *
 * The targets are the curve agreed on 2026-10-13: the pool ends Act I at about 30 health
 * (12 + 18) and Act II at about 42 (+12). A few seconds.
 */
import { PLAYABLE_SPECIES } from '../engine/playable'
import { POLICIES, playEconomyRun, spread, type ActEnd } from '../run/economy'
import type { Act } from '../run/types'

const RUNS_PER_RACE = 200
const START = 12
const TARGET: Readonly<Record<Act, number>> = { 1: START + 18, 2: START + 18 + 12, 3: 0 }

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4)
const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1)).padStart(5)

console.log(`${RUNS_PER_RACE} runs per race, ${PLAYABLE_SPECIES.length} races, every battle won. Pool health at each act's end.`)
console.log(`Targets: Act I ${TARGET[1]}, Act II ${TARGET[2]}.\n`)
console.log('policy      act    min   p10  mean   p90  under  <2 dragons')
for (const policy of POLICIES) {
  const ends: Record<Act, ActEnd[]> = { 1: [], 2: [], 3: [] }
  for (const species of PLAYABLE_SPECIES) {
    for (let seed = 1; seed <= RUNS_PER_RACE; seed++) {
      const run = playEconomyRun(seed, species.id, policy)
      for (const act of [1, 2, 3] as const) ends[act].push(run[act])
    }
  }
  for (const act of [1, 2, 3] as const) {
    const s = spread(ends[act], TARGET[act])
    const under = act === 3 ? '   - ' : pct(s.under) + ' '
    console.log(
      `${(act === 1 ? policy : '').padEnd(10)}  ${['I', 'II', 'III'][act - 1]?.padEnd(4)} ${num(s.min)} ${num(s.p10)} ${num(s.mean)} ${num(s.p90)}  ${under}  ${pct(s.oneDragon)}`,
    )
  }
}
