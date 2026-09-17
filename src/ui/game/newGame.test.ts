/**
 * The start screen's rules, without a DOM -- the same arrangement as
 * `prompts.test.ts`: the component is a form, and everything it could get wrong is
 * a pure function.
 */
import { describe, expect, it } from 'vitest'

import { FULL_RULES } from '../../engine/types'

import { choiceGroups, newGameSetup, presetChoices, randomGameSetup, readSeed } from './newGame'

describe('presetChoices', () => {
  it('offers every hand-authored force, lightest first', () => {
    const choices = presetChoices()
    expect(choices).toHaveLength(14)

    const healths = choices.map((c) => c.health)
    expect([...healths].sort((a, b) => a - b)).toEqual(healths)
    // The monster fixtures are the lightest, so they are what the screen opens on.
    expect(healths[0]).toBe(24)
  })

  it('says how a force is split, in dice', () => {
    const satyr = presetChoices().find((c) => c.id === 'treefolk_satyr')
    expect(satyr?.split).toBe('3 / 2 / 1')
    expect(satyr?.health).toBe(24)
    expect(satyr?.species).toBe('treefolk')
  })

  /** Health is the only thing that decides whether two forces may meet, so it is
   *  what the groups are -- the legal pairings are visible before anything is
   *  clicked, rather than only after Start refuses. */
  it('groups by health, since that is what pairs', () => {
    const groups = choiceGroups()
    expect(groups.map((g) => g.health)).toEqual([24, 30, 35])
    expect(groups.map((g) => g.choices.length)).toEqual([10, 2, 2])
  })
})

describe('readSeed', () => {
  it('reads an empty box as "roll one"', () => {
    expect(readSeed('')).toEqual({ kind: 'random' })
    expect(readSeed('   ')).toEqual({ kind: 'random' })
  })

  it('takes a whole number, zero included', () => {
    expect(readSeed('7')).toEqual({ kind: 'fixed', seed: 7 })
    expect(readSeed(' 1234 ')).toEqual({ kind: 'fixed', seed: 1234 })
    expect(readSeed('0')).toEqual({ kind: 'fixed', seed: 0 })
  })

  /** Reported, never silently randomised: rolling a fresh game because the seed was
   *  mistyped loses the exact run you were trying to repeat. */
  it('refuses anything else rather than rolling', () => {
    for (const text of ['-1', 'x', '1.5', '1e3x', 'NaN']) {
      expect(readSeed(text).kind, text).toBe('bad')
    }
  })
})

describe('newGameSetup', () => {
  it('names both sides and states the ruleset', () => {
    const result = newGameSetup('treefolk_satyr', 'firewalkers_gorgon', '7', 999)
    expect(result).toEqual({
      kind: 'ok',
      setup: {
        seed: 7,
        forces: { kind: 'named', forces: { p1: 'treefolk_satyr', p2: 'firewalkers_gorgon' } },
        ruleSet: FULL_RULES,
      },
    })
  })

  it('spends the rolled seed when the box is empty', () => {
    const result = newGameSetup('treefolk_satyr', 'firewalkers_gorgon', '', 999)
    expect(result.kind === 'ok' && result.setup.seed).toBe(999)
  })

  it('pairs a fixture with itself', () => {
    expect(newGameSetup('treefolk_unicorn', 'treefolk_unicorn', '1', 0).kind).toBe('ok')
  })

  /** `setupGame` throws on this, and a throw out of a click handler is a blank page.
   *  Caught here so the screen can say it instead. */
  it('refuses two forces of different health', () => {
    const result = newGameSetup('treefolk_satyr', 'firewalkers_starter', '1', 0)
    expect(result.kind).toBe('problem')
    expect(result.kind === 'problem' && result.problem).toContain('24 and 30 health')
  })

  it('refuses a bad seed before it looks at the forces', () => {
    const result = newGameSetup('treefolk_satyr', 'firewalkers_starter', 'nope', 0)
    expect(result.kind === 'problem' && result.problem).toContain('whole number')
  })
})

describe('randomGameSetup', () => {
  it('rolls both sides from the seed', () => {
    expect(randomGameSetup('42', 0)).toEqual({
      kind: 'ok',
      setup: { seed: 42, forces: { kind: 'random' }, ruleSet: FULL_RULES },
    })
  })

  it('carries the same seed rule', () => {
    expect(randomGameSetup('', 55).kind === 'ok').toBe(true)
    expect(randomGameSetup('-3', 55).kind).toBe('problem')
  })
})
