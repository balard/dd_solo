import { describe, expect, it } from 'vitest'

import { POLICIES, playEconomyRun, spread } from './economy'

describe('the economy report', () => {
  it('plays a run to its end under every policy, and the pool never shrinks between acts', () => {
    for (const policy of POLICIES) {
      const ends = playEconomyRun(3, 'treefolk', policy)
      expect(ends[1].health).toBeGreaterThanOrEqual(12)
      expect(ends[2].health).toBeGreaterThanOrEqual(ends[1].health)
      expect(ends[3].health).toBeGreaterThanOrEqual(ends[2].health)
    }
  })

  it('is the same numbers for the same seed', () => {
    expect(playEconomyRun(5, 'goblins', 'random')).toEqual(playEconomyRun(5, 'goblins', 'random'))
  })

  it('spreads order statistics and the share under a target', () => {
    const s = spread([10, 20, 30, 40].map((health) => ({ health, dragons: 1 })), 25)
    expect(s).toMatchObject({ min: 10, mean: 25, under: 0.5, oneDragon: 1 })
  })
})
