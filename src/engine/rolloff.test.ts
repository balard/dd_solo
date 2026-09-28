/**
 * The roll-off choice (v1 Phase 10e): the Horde winner takes the first turn *or* the
 * pick of the two proposed Frontiers, and the loser gets the other prize (full rules
 * p. 10, step 4). The house rule it replaces -- winner marches, loser draws -- stays
 * what every rung below `V1_RULES` plays, and the goldens are what prove that.
 */
import { describe, expect, it } from 'vitest'

import { speciesElements, terrainDie, terrainType } from '../data/load'

import { advance, begin, reduce } from './reduce'
import { replay } from './replay'
import { setupGame, type SetupOptions } from './setup'
import {
  IllegalActionError,
  SPECIES_RULES,
  V1_RULES,
  opponentOf,
  forceSpecies,
  type GameState,
  type PlayerId,
} from './types'
import { validateState } from './validate'

const options = (seed: number): SetupOptions => ({ seed, forces: { kind: 'random' }, ruleSet: V1_RULES })

/** A game paused on the roll-off choice, checked valid. */
function opened(seed: number): GameState {
  const state = begin(setupGame(options(seed)))
  expect(validateState(state)).toEqual([])
  return state
}

const elementsOf = (dieId: string) => terrainType(terrainDie(dieId).type).elements

describe('the roll-off choice', () => {
  it('opens the game on the winner’s choice, before any face is rolled', () => {
    const state = opened(11)
    const rolled = state.log.find((e) => e.kind === 'roll_off')
    if (rolled?.kind !== 'roll_off') throw new Error('no roll_off entry')

    expect(state.turn.phase).toBe('setup')
    expect(state.pending).toEqual({
      kind: 'roll_off_choice',
      player: rolled.winner,
      proposals: rolled.proposals,
    })
    // Nothing is placed yet: no face, no order of play, and no first player to name.
    expect(state.log.some((e) => e.kind === 'terrain_placed')).toBe(false)
    expect(state.log.some((e) => e.kind === 'order_of_play')).toBe(false)
    expect(state.log[0]).toEqual({ kind: 'game_start', seed: 11 })
  })

  it('draws each proposal from a terrain sharing an element with its proposer', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const state = opened(seed)
      if (state.pending?.kind !== 'roll_off_choice') throw new Error(`seed ${seed}: no choice`)
      for (const player of ['p1', 'p2'] as const) {
        const mine = forceSpecies(state, player).flatMap((species) => speciesElements(species))
        const proposal = state.pending.proposals[player]
        expect(elementsOf(proposal).some((e) => mine.includes(e)), `seed ${seed} ${player}`).toBe(true)
      }
    }
  })

  it('taking the first turn hands the loser the Frontier pick', () => {
    const state = opened(11)
    const winner = state.pending?.player as PlayerId
    const loser = opponentOf(winner)

    const asked = advance(reduce(state, { kind: 'roll_off_choice', take: 'first_turn' }))
    expect(validateState(asked)).toEqual([])
    expect(asked.pending).toMatchObject({ kind: 'choose_frontier', player: loser })

    const proposals = state.rollOff?.proposals
    const played = advance(reduce(asked, { kind: 'choose_frontier', proposer: loser }))
    expect(validateState(played)).toEqual([])
    expect(played.rollOff).toBeUndefined()
    expect(played.terrains.frontier.dieId).toBe(proposals?.[loser])
    expect(played.turn.marching).toBe(winner)
    expect(played.pending).toMatchObject({ kind: 'choose_march_army', player: winner })
    expect(played.log.find((e) => e.kind === 'roll_off_decided')).toEqual({
      kind: 'roll_off_decided',
      winner,
      took: 'first_turn',
      proposer: loser,
      frontier: proposals?.[loser],
      firstPlayer: winner,
    })
  })

  it('picking the Frontier gives the loser the first turn', () => {
    const state = opened(11)
    const winner = state.pending?.player as PlayerId
    const loser = opponentOf(winner)

    const played = advance(reduce(state, { kind: 'roll_off_choice', take: 'frontier', proposer: loser }))
    expect(validateState(played)).toEqual([])
    expect(played.terrains.frontier.dieId).toBe(state.rollOff?.proposals[loser])
    expect(played.turn.marching).toBe(loser)
    expect(played.pending).toMatchObject({ kind: 'choose_march_army', player: loser })
  })

  it('rolls the three starting faces only once the choice is made, and all within 1-6', () => {
    const state = opened(11)
    const played = advance(reduce(state, { kind: 'roll_off_choice', take: 'frontier', proposer: 'p1' }))
    const placed = played.log.filter((e) => e.kind === 'terrain_placed')
    expect(placed.map((e) => e.kind === 'terrain_placed' && e.slot)).toEqual(['p1_home', 'frontier', 'p2_home'])
    for (const slot of ['p1_home', 'frontier', 'p2_home'] as const) {
      expect(played.terrains[slot].face).toBeGreaterThanOrEqual(1)
      expect(played.terrains[slot].face).toBeLessThanOrEqual(6)
    }
    expect(played.rng.counter).toBeGreaterThan(state.rng.counter)
  })

  it('refuses a second choice, and a proposal nobody made', () => {
    const state = opened(11)
    const asked = advance(reduce(state, { kind: 'roll_off_choice', take: 'first_turn' }))
    expect(() => reduce(asked, { kind: 'roll_off_choice', take: 'first_turn' })).toThrow(IllegalActionError)
    expect(() =>
      reduce(state, { kind: 'roll_off_choice', take: 'frontier', proposer: 'p3' as PlayerId }),
    ).toThrow(IllegalActionError)
  })

  it('replays die for die from its record', () => {
    const setup = options(11)
    const state = opened(11)
    const answer = { kind: 'roll_off_choice', take: 'frontier', proposer: 'p2' } as const
    const actions = [answer]
    const played = advance(reduce(state, answer))
    expect(replay({ setup, actions })).toEqual(played)
  })
})

describe('when there is nothing to choose', () => {
  it('skips the choice when the first player is named: no roll-off, nobody to choose', () => {
    const state = begin(setupGame({ ...options(11), firstPlayer: 'p2' }))
    expect(state.rollOff).toBeUndefined()
    expect(state.pending?.kind).toBe('choose_march_army')
  })

  it('skips the choice when the Frontier is pinned: the winner simply marches first', () => {
    const state = begin(setupGame({ ...options(11), terrains: { frontier: 'highland_tower' } }))
    expect(state.rollOff).toBeUndefined()
    expect(state.terrains.frontier.dieId).toBe('highland_tower')
    const order = state.log.find((e) => e.kind === 'order_of_play')
    expect(order?.kind === 'order_of_play' && order.firstPlayer).toBe(state.turn.marching)
  })

  it('never asks under SPECIES_RULES, which keeps the split', () => {
    const state = begin(setupGame({ ...options(11), ruleSet: SPECIES_RULES }))
    expect(state.rollOff).toBeUndefined()
    expect(state.log.some((e) => e.kind === 'roll_off')).toBe(false)
    expect(state.pending?.kind).toBe('choose_march_army')
  })
})

describe('validateState', () => {
  it('refuses a placeholder that shows a face', () => {
    const state = opened(11)
    const tampered: GameState = {
      ...state,
      terrains: { ...state.terrains, p1_home: { ...state.terrains.p1_home, face: 4 } },
    }
    expect(validateState(tampered).join(' ')).toContain('before the roll-off choice has rolled any')
  })

  it('refuses a setup phase with no choice open', () => {
    const { rollOff: _open, ...rest } = opened(11)
    expect(validateState(rest).join(' ')).toContain('no roll-off choice open')
  })
})
