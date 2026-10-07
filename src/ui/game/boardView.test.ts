import { describe, expect, it } from 'vitest'

import { greedyAi } from '../../ai/greedy'
import { randomAi } from '../../ai/random'
import type { AiPlayer } from '../../ai/types'
import { begin, reduce } from '../../engine/reduce'
import { rngFrom } from '../../engine/rng'
import { FORCE_SETS, setupGame, type ForceSpec } from '../../engine/setup'
import { V1_RULES, type GameState } from '../../engine/types'

import { boardAt, marksIn, rebuild } from './boardView'

/** What the board draws, and nothing it does not. */
const board = (state: GameState) => ({
  units: state.units,
  terrains: state.terrains,
  dragons: state.dragons,
  effects: [...state.effects].map((e) => JSON.stringify(e)).sort(),
  winner: state.winner,
  rollOff: state.rollOff,
})

/** Every state a game passes through at an action boundary. */
function play(seed: number, forces: ForceSpec, players: Record<'p1' | 'p2', AiPlayer>, cap = 3000): GameState[] {
  let state = begin(setupGame({ seed, forces, ruleSet: V1_RULES }))
  let rng = rngFrom(seed + 17)
  const states = [state]
  while (state.winner === null && state.pending !== null && states.length < cap) {
    const [action, next] = players[state.pending.player].decide(state, state.pending, rng)
    rng = next
    state = reduce(state, action)
    states.push(state)
  }
  return states
}

describe('rebuilding the board from the log', () => {
  /**
   * The rule the whole view rests on: every change to the board the log names, it names
   * with where the die went. Rebuilding one whole action from the state before it lands
   * exactly on the state after, so a seen entry is never drawn wrong -- only a change no
   * entry names could be, and this is where one would show.
   */
  it('replays every action of real games back to the state after it', () => {
    const games: [number, ForceSpec, Record<'p1' | 'p2', AiPlayer>][] = [
      ...[1, 2, 3, 4, 5, 6].map((seed): [number, ForceSpec, Record<'p1' | 'p2', AiPlayer>] => [
        seed,
        { kind: 'random' },
        { p1: greedyAi, p2: greedyAi },
      ]),
      ...Object.keys(FORCE_SETS).map((name, i): [number, ForceSpec, Record<'p1' | 'p2', AiPlayer>] => [
        100 + i,
        FORCE_SETS[name] as ForceSpec,
        { p1: greedyAi, p2: randomAi },
      ]),
      // Random self-play reaches what greedy never chooses. Measured when this landed:
      // these games write every kind of entry that moves a die, a dragon, a terrain or
      // an effect -- breaths, a dragon sent home and a Flash Flood among them.
      ...Array.from({ length: 20 }, (_, i) => i + 7).map((seed): [number, ForceSpec, Record<'p1' | 'p2', AiPlayer>] => [
        seed,
        seed % 2 === 0 ? { kind: 'random', mixed: true } : { kind: 'random' },
        { p1: randomAi, p2: randomAi },
      ]),
    ]
    const misses: string[] = []
    for (const [seed, forces, players] of games) {
      const states = play(seed, forces, players)
      for (let i = 1; i < states.length; i++) {
        const before = states[i - 1] as GameState
        const after = states[i] as GameState
        const got = board(rebuild(after, before, after.log.length))
        const want = board(after)
        // The one change no line names: Accelerated Growth's dying dice go to the DUA
        // when the offer is raised and are named when it is answered. Until then the
        // board keeps them, which is the safe way to be wrong.
        const dying = new Set((after.turn.growthOffers ?? []).flatMap((offer) => offer.dying.map((d) => d.unitId)))
        const unexplained = Object.keys(want.units).filter(
          (id) => !dying.has(id) && JSON.stringify(got.units[id]) !== JSON.stringify(want.units[id]),
        )
        for (const key of Object.keys(want) as (keyof typeof want)[]) {
          if (key === 'units' ? unexplained.length > 0 : JSON.stringify(got[key]) !== JSON.stringify(want[key])) {
            const kinds = after.log.slice(before.log.length).map((e) => e.kind)
            misses.push(`seed ${seed} action ${i}: ${key} after [${kinds.join(', ')}]`)
          }
        }
      }
    }
    expect(misses.slice(0, 20)).toEqual([])
  }, 120_000)

  it('is the state itself when nothing is held back', () => {
    const [before, after] = play(3, { kind: 'random' }, { p1: greedyAi, p2: greedyAi }).slice(5, 7) as [GameState, GameState]
    expect(boardAt(after, before, after.log.length)).toBe(after)
  })

  it('marks a die by the worst that happens to it', () => {
    const marks = marksIn([
      { kind: 'sai_resolved', player: 'p2', sai: 'Flame', slot: 'frontier', unitIds: ['a', 'b'] },
      { kind: 'units_killed', player: 'p1', slot: 'frontier', unitIds: ['a'] },
      { kind: 'units_buried', player: 'p1', unitIds: ['a'] },
    ])
    expect(marks.get('a')).toBe('buried')
    expect(marks.get('b')).toBe('Flame')
  })
})
