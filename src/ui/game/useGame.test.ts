import { describe, expect, it } from 'vitest'

import { BESTIARY_FORCES, STARTER_FORCES } from '../../engine/setup'
import { SAI_RULES } from '../../engine/types'

import { parseGameRequest } from './useGame'

/**
 * `?forces=` and `?seed=` are the only way the hand-authored pairings are reachable
 * from the browser, so the parsing gets a test even though the hook around it does
 * not -- it is a pure function over a query string, which is the shape `prompts.ts`
 * established for exactly this reason.
 */
describe('parseGameRequest', () => {
  const FALLBACK = 99

  it('is nothing at all for an ordinary visit', () => {
    expect(parseGameRequest('', FALLBACK)).toBeNull()
    expect(parseGameRequest('?utm_source=somewhere', FALLBACK)).toBeNull()
  })

  it('names a force and a seed', () => {
    const request = parseGameRequest('?forces=bestiary&seed=7', FALLBACK)
    expect(request?.setup).toEqual({ seed: 7, forces: BESTIARY_FORCES, ruleSet: SAI_RULES })
    expect(request?.origin).toEqual({ kind: 'requested', forces: 'bestiary', seed: 7 })
  })

  it('takes a force on its own, and rolls the seed', () => {
    const request = parseGameRequest('?forces=starter', FALLBACK)
    expect(request?.setup.forces).toEqual(STARTER_FORCES)
    expect(request?.setup.seed).toBe(FALLBACK)
  })

  it('takes a seed on its own, and still rolls the forces', () => {
    const request = parseGameRequest('?seed=1234', FALLBACK)
    expect(request?.setup).toEqual({ seed: 1234, forces: { kind: 'random' }, ruleSet: SAI_RULES })
    expect(request?.origin).toEqual({ kind: 'requested', forces: null, seed: 1234 })
  })

  /**
   * Reported rather than ignored. Quietly rolling a random force would look exactly
   * like a preset that does not work, which is the one outcome worth ruling out.
   */
  it('says so when the force does not exist, and plays on', () => {
    const request = parseGameRequest('?forces=nope', FALLBACK)
    expect(request?.setup.forces).toEqual({ kind: 'random' })
    expect(request?.origin.kind).toBe('recovered')
    expect(request?.origin).toMatchObject({ reason: expect.stringContaining('starter or bestiary') })
  })

  it('falls back on a seed that is not a seed', () => {
    for (const bad of ['?seed=abc', '?seed=-1', '?seed=1.5']) {
      expect(parseGameRequest(bad, FALLBACK)?.setup.seed, bad).toBe(FALLBACK)
    }
  })

  /**
   * `Number('')` is 0, which is a legal seed and a completely different game from
   * the one an empty parameter was asking for -- which is none at all.
   */
  it('treats an empty parameter as no parameter', () => {
    expect(parseGameRequest('?seed=', FALLBACK)).toBeNull()
    expect(parseGameRequest('?forces=', FALLBACK)).toBeNull()
    expect(parseGameRequest('?forces=&seed=', FALLBACK)).toBeNull()
    expect(parseGameRequest('?forces=bestiary&seed=', FALLBACK)?.setup.seed).toBe(FALLBACK)
  })

  /** Every game the app starts is played under `SAI_RULES`, link or no link. */
  it('never starts a game on a different ruleset', () => {
    expect(parseGameRequest('?forces=bestiary', FALLBACK)?.setup.ruleSet).toBe(SAI_RULES)
    expect(parseGameRequest('?forces=nope', FALLBACK)?.setup.ruleSet).toBe(SAI_RULES)
  })
})
