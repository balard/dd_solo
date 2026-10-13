/**
 * How much a run's pool grows, act by act (v3 Phase 6a): the measurement the run's reward
 * mix is tuned against. `npm run run-economy` prints it.
 *
 * Every battle is won, so the numbers are what a run *can* reach, not what one does: a
 * loss ends a run and grows nothing. Everything else is answered by a policy, so the
 * spread between a player who always takes the heaviest offer and one who takes the
 * lightest is the range a reward mix leaves to choice.
 *
 * Pure, like the rest of `src/run/`: the same seed and policy give the same numbers.
 */
import { nextInt, rngFrom, type RngState } from '../engine/rng'

import { autopilot } from './autopilot'
import { offerHealth, poolHealth as healthOfPool } from './give'
import { newRun, reduceRun } from './reduce'
import { ACTS, RUN_PLAYER, type Act, type Offer, type RunAction, type RunState } from './types'

export type Policy = 'autopilot' | 'heaviest' | 'lightest' | 'random'

export const POLICIES: readonly Policy[] = ['autopilot', 'heaviest', 'lightest', 'random']

/** Every unit the pool owns, by health: the number the curve is about. */
export const poolHealth = (run: RunState): number => healthOfPool(run.collection)

const dragonsOwned = (run: RunState): number => Object.values(run.collection.dragons).reduce((sum, n) => sum + n, 0)

/** The index of the offer a policy takes; ties go to the first. */
function pickOffer(offers: readonly Offer[], policy: 'heaviest' | 'lightest'): number {
  let best = 0
  offers.forEach((offer, index) => {
    const health = offerHealth(offer)
    const current = offerHealth(offers[best] as Offer)
    if (policy === 'heaviest' ? health > current : health < current) best = index
  })
  return best
}

/** A uniform pick among everything that may answer this pending, battles and forces aside. */
function randomAnswer(run: RunState, rng: RngState): readonly [RunAction, RngState] {
  const pending = run.pending
  switch (pending.kind) {
    case 'reward': {
      const [index, next] = nextInt(rng, pending.offers.length)
      return [{ kind: 'take_offer', index }, next]
    }
    case 'event': {
      const answers: RunAction[] = [
        { kind: 'skip' },
        ...pending.upgradable.map((unit): RunAction => ({ kind: 'upgrade', unit })),
        ...pending.transformable.map((unit): RunAction => ({ kind: 'transform', unit })),
      ]
      const [index, next] = nextInt(rng, answers.length)
      return [answers[index] as RunAction, next]
    }
    case 'choose_race':
    case 'arrange_force':
    case 'battle':
    case 'over':
      return [autopilot(run), rng]
  }
}

function answer(run: RunState, policy: Policy, rng: RngState): readonly [RunAction, RngState] {
  if (run.pending.kind === 'battle') return [{ kind: 'battle_ended', winner: RUN_PLAYER }, rng]
  if (policy === 'random') return randomAnswer(run, rng)
  if (policy !== 'autopilot' && run.pending.kind === 'reward') {
    return [{ kind: 'take_offer', index: pickOffer(run.pending.offers, policy) }, rng]
  }
  return [autopilot(run), rng]
}

/** The pool at the end of one act. */
export interface ActEnd {
  readonly health: number
  readonly dragons: number
}

/** One run, every battle won, to its end: the pool after each act. */
export function playEconomyRun(seed: number, race: string, policy: Policy): Readonly<Record<Act, ActEnd>> {
  let run = reduceRun(newRun(seed), { kind: 'pick_race', race })
  let rng = rngFrom(seed ^ 0x0ec0_0e1c)
  const ends: Partial<Record<Act, ActEnd>> = {}
  for (let step = 0; run.pending.kind !== 'over'; step++) {
    if (step > 10_000) throw new Error(`run ${seed} (${race}, ${policy}) did not end`)
    const act = run.act
    const [action, next] = answer(run, policy, rng)
    rng = next
    run = reduceRun(run, action)
    if (run.act !== act || run.pending.kind === 'over') ends[act] = { health: poolHealth(run), dragons: dragonsOwned(run) }
  }
  for (const act of ACTS) if (ends[act] === undefined) throw new Error(`run ${seed} never finished act ${act}`)
  return ends as Record<Act, ActEnd>
}

/** Order statistics over one act's ends. */
export interface Spread {
  readonly min: number
  readonly p10: number
  readonly mean: number
  readonly p90: number
  /** The share of runs that end the act under `target` health. */
  readonly under: number
  /** The share of runs that end the act owning fewer than two dragons. */
  readonly oneDragon: number
}

export function spread(ends: readonly ActEnd[], target: number): Spread {
  const sorted = ends.map((e) => e.health).sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return {
    min: sorted[0] ?? 0,
    p10: at(0.1),
    mean: sorted.reduce((s, h) => s + h, 0) / Math.max(1, sorted.length),
    p90: at(0.9),
    under: sorted.filter((h) => h < target).length / Math.max(1, sorted.length),
    oneDragon: ends.filter((e) => e.dragons < 2).length / Math.max(1, ends.length),
  }
}
