/**
 * Conceding (v2 Phase 3e): an action, so the record says how the game ended.
 *
 * `concede` is the one action that matches no `Pending.kind`. It answers whatever is
 * open, for whoever it is addressed to, and ends the game in the other player's
 * favour. No AI ever sends it, so the fuzz names this file for both the action and
 * the `victory:concession` entry it leaves.
 */
import { describe, expect, it } from 'vitest'

import { greedyAi } from '../ai/greedy'
import { begin, reduce } from './reduce'
import { replay } from './replay'
import { FORCE_SETS, namedForces, setupGame, STARTER_FORCES } from './setup'
import {
  IllegalActionError,
  V1_RULES,
  forceSize,
  type GameAction,
  type GameState,
  type Pending,
} from './types'
import { validateState } from './validate'
import { rngFrom } from './rng'

const CONCEDE: GameAction = { kind: 'concede' }

const opening = (seed = 7) => begin(setupGame({ seed, forces: STARTER_FORCES, ruleSet: V1_RULES }))

/** Greedy plays both sides until `stop` holds for the open pending. */
function playUntil(state: GameState, stop: (kind: Pending['kind']) => boolean): [GameState, GameAction[]] {
  let current = state
  let rng = rngFrom(1)
  const actions: GameAction[] = []
  for (let i = 0; i < 2000 && current.pending !== null && current.winner === null; i++) {
    if (stop(current.pending.kind)) return [current, actions]
    const [action, next] = greedyAi.decide(current, current.pending, rng)
    rng = next
    actions.push(action)
    current = reduce(current, action)
  }
  throw new Error('never reached the decision asked for')
}

describe('concede', () => {
  it('ends the game for whoever the open decision is addressed to', () => {
    const state = opening()
    const asked = state.pending?.player
    expect(asked).toBeDefined()

    const ended = reduce(state, CONCEDE)
    const winner = asked === 'p1' ? 'p2' : 'p1'
    expect(ended.winner).toBe(winner)
    expect(ended.pending).toBeNull()
    expect(ended.turn.phase).toBe('game_over')
    expect(ended.log.at(-1)).toEqual({ kind: 'victory', player: winner, reason: 'concession' })
    expect(validateState(ended)).toEqual([])
  })

  /** The roll-off choice is the first decision of a live-rules game; a player may give
   *  up before a single face is rolled. */
  it('is legal at the roll-off, before the first turn', () => {
    const state = opening()
    expect(state.turn.phase).toBe('setup')
    expect(reduce(state, CONCEDE).winner).not.toBeNull()
  })

  it('draws no randomness: a concession is not a roll', () => {
    const state = opening()
    expect(reduce(state, CONCEDE).rng).toEqual(state.rng)
  })

  /** Mid-exchange is the hard case for `validateState`: a combat left open. Four golden
   *  games already end standing on a combat step, so an open exchange is a legal end. */
  it('ends a game mid-combat and leaves a valid state', () => {
    const [atDamage] = playUntil(opening(3), (kind) => kind === 'assign_damage')
    const ended = reduce(atDamage, CONCEDE)
    expect(ended.winner).not.toBeNull()
    expect(validateState(ended)).toEqual([])
  })

  it('is refused once the game is over', () => {
    const ended = reduce(opening(), CONCEDE)
    expect(() => reduce(ended, CONCEDE)).toThrow(IllegalActionError)
  })

  it('replays: the record says how the game ended', () => {
    const setup = { seed: 11, forces: STARTER_FORCES, ruleSet: V1_RULES }
    const [played, actions] = playUntil(begin(setupGame(setup)), (kind) => kind === 'choose_action')
    const record = { setup, actions: [...actions, CONCEDE] }
    const ended = reduce(played, CONCEDE)
    expect(replay(record)).toEqual(ended)
  })
})

describe('the built examples', () => {
  /** 3e's exit criterion is a 12-health game in the app, and these are the only ones. */
  it('are reachable by name, at 12 health a side', () => {
    const forces = namedForces('mixed-12')
    expect(forces?.kind).toBe('built')
    const state = begin(setupGame({ seed: 5, forces: forces!, ruleSet: V1_RULES }))
    expect(forceSize(state, 'p1')).toBe(12)
    expect(forceSize(state, 'p2')).toBe(12)
    expect(validateState(state)).toEqual([])
  })

  it('set up, every one', () => {
    for (const [name, forces] of Object.entries(FORCE_SETS)) {
      if (forces.kind !== 'built') continue
      expect(() => setupGame({ seed: 1, forces, ruleSet: V1_RULES }), name).not.toThrow()
    }
  })
})
