import { describe, expect, it } from 'vitest'

import { begin, reduce } from '../../engine/reduce'
import { setupGame, STARTER_FORCES } from '../../engine/setup'
import { V1_RULES, type GameState } from '../../engine/types'

import { formatClock, gameSummary, turnNumber } from './summary'

const opening = () => begin(setupGame({ seed: 7, forces: STARTER_FORCES, ruleSet: V1_RULES }))

describe('gameSummary', () => {
  it('is nothing while the game is on', () => {
    expect(gameSummary(opening(), 'p1', 1000)).toBeNull()
  })

  it('says who conceded, from either seat', () => {
    const state = opening()
    const asked = state.pending?.player ?? 'p1'
    const ended = reduce(state, { kind: 'concede' })
    const other = asked === 'p1' ? 'p2' : 'p1'

    expect(gameSummary(ended, asked, 0)).toMatchObject({
      won: false,
      endedBy: 'concession',
      headline: 'You conceded',
    })
    expect(gameSummary(ended, other, 0)).toMatchObject({ won: true, headline: 'The enemy conceded' })
  })

  /** Given up before anyone chose at the roll-off: no turn was played. */
  it('counts no turns for a game conceded at the roll-off', () => {
    const ended = reduce(opening(), { kind: 'concede' })
    expect(gameSummary(ended, 'p1', 0)?.turn).toBe(0)
  })

  it('reports health left against what each side brought', () => {
    const ended = reduce(opening(), { kind: 'concede' })
    const summary = gameSummary(ended, 'p1', 65_000)
    expect(summary?.mine).toEqual({ left: 30, of: 30 })
    expect(summary?.theirs).toEqual({ left: 30, of: 30 })
    expect(summary?.elapsedMs).toBe(65_000)
  })

  it('names captures and elimination by the victory entry', () => {
    const ended = reduce(opening(), { kind: 'concede' })
    const as = (reason: 'captures' | 'elimination'): GameState => ({
      ...ended,
      log: [...ended.log.slice(0, -1), { kind: 'victory', player: ended.winner ?? 'p1', reason }],
    })
    const winner = ended.winner ?? 'p1'
    expect(gameSummary(as('captures'), winner, 0)?.headline).toBe('You captured two terrains')
    expect(gameSummary(as('elimination'), winner, 0)?.headline).toBe('The enemy has no units left')
  })
})

describe('turnNumber', () => {
  it('is the turn in progress: one before any turn has ended', () => {
    expect(turnNumber(opening())).toBe(1)
  })
})

describe('formatClock', () => {
  it('reads as a clock', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(7_900)).toBe('0:07')
    expect(formatClock(12 * 60_000 + 40_000)).toBe('12:40')
    expect(formatClock(3_600_000 + 2 * 60_000 + 9_000)).toBe('1:02:09')
    expect(formatClock(-5)).toBe('0:00')
  })
})
