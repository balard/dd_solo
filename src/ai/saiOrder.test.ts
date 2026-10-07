import { describe, expect, it } from 'vitest'

import { FORCE_SETS, type ForceSpec } from '../engine/setup'

import { greedyAi } from './greedy'
import { describeTally, emptyTally, tallyGame } from './saiOrder'

/**
 * The measurement behind v2 Phase 9e's decision (`npm run sai-order`), kept from
 * rotting. A Genie mirror is where the order matters most often -- a Firecloud and a
 * Cantrip on one roll -- so a few games of it must find at least one.
 */
describe('the SAI-order measurement', () => {
  it('finds the Firecloud-and-Cantrip queue in a Genie mirror', () => {
    const tally = emptyTally()
    for (let seed = 1; seed <= 16; seed++) {
      tallyGame(seed, FORCE_SETS['firewalkers_genie'] as ForceSpec, { p1: greedyAi, p2: greedyAi }, tally)
    }
    expect(tally.queued).toBeGreaterThan(0)
    expect(tally.withCantrip).toBeGreaterThan(0)
    expect(tally.matters).toBeLessThanOrEqual(tally.twoOrMore)
    expect(describeTally('Genie mirror', 16, tally)).toMatch(/^Genie mirror, 16 games: \d+ exchanges/)
  })
})
