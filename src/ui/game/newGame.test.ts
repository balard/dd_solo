/**
 * The start screen's rules, without a DOM -- the same arrangement as
 * `prompts.test.ts`: the component is a form, and everything it could get wrong is
 * a pure function.
 */
import { describe, expect, it } from 'vitest'

import { V1_RULES } from '../../engine/types'

import { DEFAULT_OPPONENT, OPPONENTS } from '../../ai/opponents'
import { greedyAi } from '../../ai/greedy'
import { runGame } from '../../ai/run'
import { FULL_COLLECTION } from '../../data/collections'
import { preset } from '../../data/presets'
import {
  builtForceHealth,
  builtForceProblem,
  rollForce,
  type BuiltForce,
  type ForcePool,
} from '../../engine/force'
import { rngFrom } from '../../engine/rng'
import { setupGame } from '../../engine/setup'

import { forceProblems } from './builder'
import type { SavedForce } from './forceStore'
import {
  choiceGroups,
  newGameSetup,
  opponentChoices,
  parseSideValue,
  poolChoices,
  presetChoices,
  randomGameSetup,
  readSeed,
  rollOpponent,
  sideOptionGroups,
  sideValue,
  type NewGameRequest,
  type SetupChoice,
} from './newGame'

/** The mixed 12 of `builder.test.ts`, kept from sorry-12: ready to play. */
const mixed12: BuiltForce = {
  armies: {
    home: ['treefolk.oak', 'firewalkers.guardian', 'treefolk.hamadryad'],
    campaign: ['firewalkers.adventurer', 'treefolk.oakling', 'treefolk.nymph'],
    horde: ['treefolk.oakling', 'firewalkers.explorer', 'firewalkers.sunburst', 'treefolk.pineling'],
  },
  homeTerrain: 'swampland_city',
  frontierProposal: 'feyland_temple',
  dragons: ['earth_drake'],
}

const keptMixed12: SavedForce = { id: 'mine', name: 'Mixed 12', collection: 'sorry-12', cap: 12, force: mixed12 }

describe('presetChoices', () => {
  it('offers every hand-authored force, lightest first', () => {
    const choices = presetChoices()
    expect(choices).toHaveLength(35)

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
    expect(groups.map((g) => g.choices.length)).toEqual([25, 5, 5])
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
  const presets = (p1: string, p2: string, seedText = '7', unequal = false): NewGameRequest => ({
    p1: { kind: 'preset', id: p1 },
    p2: { kind: 'preset', id: p2 },
    unequal,
    seedText,
  })

  /** Two presets are still the `named` spec, so a preset game's record reads exactly as
   *  it did before the builder existed. */
  it('names both sides and states the ruleset', () => {
    const result = newGameSetup(presets('treefolk_satyr', 'firewalkers_gorgon'), [], 999)
    expect(result).toEqual({
      kind: 'ok',
      setup: {
        seed: 7,
        forces: { kind: 'named', forces: { p1: 'treefolk_satyr', p2: 'firewalkers_gorgon' } },
        ruleSet: V1_RULES,
      },
      health: { p1: 24, p2: 24 },
    })
  })

  it('spends the rolled seed when the box is empty', () => {
    const result = newGameSetup(presets('treefolk_satyr', 'firewalkers_gorgon', ''), [], 999)
    expect(result.kind === 'ok' && result.setup.seed).toBe(999)
  })

  it('pairs a fixture with itself', () => {
    expect(newGameSetup(presets('treefolk_unicorn', 'treefolk_unicorn', '1'), [], 0).kind).toBe('ok')
  })

  /** Unequal can be on purpose since v2 Phase 2, and since 4c the screen can say so. */
  it('refuses two forces of different health until told it is on purpose', () => {
    const slip = newGameSetup(presets('treefolk_satyr', 'firewalkers_starter', '1'), [], 0)
    expect(slip.kind).toBe('problem')
    expect(slip.kind === 'problem' && slip.problem).toContain('24 and 30 health')
    // The healths travel with the problem, which is how the screen knows to ask.
    expect(slip.health).toEqual({ p1: 24, p2: 30 })

    const meant = newGameSetup(presets('treefolk_satyr', 'firewalkers_starter', '1', true), [], 0)
    expect(meant.kind).toBe('ok')
  })

  it('refuses a bad seed before it looks at the forces', () => {
    const result = newGameSetup(presets('treefolk_satyr', 'firewalkers_starter', 'nope'), [], 0)
    expect(result.kind === 'problem' && result.problem).toContain('whole number')
  })

  it('plays a kept force as it was built, pins and all', () => {
    const result = newGameSetup(
      { p1: { kind: 'kept', id: 'mine' }, p2: { kind: 'kept', id: 'mine' }, unequal: false, seedText: '3' },
      [keptMixed12],
      0,
    )
    if (result.kind !== 'ok') throw new Error(result.problem)
    expect(result.setup.forces).toEqual({ kind: 'built', forces: { p1: mixed12, p2: mixed12 } })
    expect(() => setupGame(result.setup)).not.toThrow()
  })

  /** A preset against a kept force cannot be `named`, so the preset goes in whole. */
  it('turns a preset into its armies beside a kept force', () => {
    const result = newGameSetup(
      { p1: { kind: 'kept', id: 'mine' }, p2: { kind: 'preset', id: 'treefolk_satyr' }, unequal: true, seedText: '3' },
      [keptMixed12],
      0,
    )
    if (result.kind !== 'ok') throw new Error(result.problem)
    const forces = result.setup.forces
    expect(forces.kind === 'built' && forces.forces.p2).toEqual({ armies: preset('treefolk_satyr').armies })
  })

  it('refuses a kept force that is gone, or has something to fix', () => {
    const request = (id: string): NewGameRequest => ({
      p1: { kind: 'kept', id },
      p2: { kind: 'preset', id: 'treefolk_satyr' },
      unequal: true,
      seedText: '1',
    })
    const gone = newGameSetup(request('nope'), [keptMixed12], 0)
    expect(gone.kind === 'problem' && gone.problem).toBe('your kept force is no longer kept')

    // sorry-12 holds one dragon; a force that names none may not leave it to the draw.
    const unfinished: SavedForce = { ...keptMixed12, id: 'half', force: { armies: mixed12.armies } }
    const broken = newGameSetup(request('half'), [unfinished], 0)
    expect(broken.kind === 'problem' && broken.problem).toMatch(/has 3 things to fix in the army builder/)
  })
})

describe('a random opponent', () => {
  const against = (size: 'same' | number, pool: ForcePool = { kind: 'mixed' }, seedText = '11'): NewGameRequest => ({
    p1: { kind: 'kept', id: 'mine' },
    p2: { kind: 'random', size, pool },
    unequal: false,
    seedText,
  })
  const opponentOf = (result: SetupChoice): BuiltForce => {
    if (result.kind !== 'ok' || result.setup.forces.kind !== 'built') throw new Error('expected a built game')
    return result.setup.forces.forces.p2
  }

  it('is rolled at your size, and is legal', () => {
    const result = newGameSetup(against('same'), [keptMixed12], 0)
    expect(result.health).toEqual({ p1: 12, p2: 12 })
    expect(builtForceProblem(opponentOf(result))).toBeNull()
  })

  /** "The same seed and the same forces replay the same game" -- a rolled opponent
   *  included -- and a different seed rolls a different one. */
  it('is the same force for the same seed, and another for another', () => {
    const once = opponentOf(newGameSetup(against('same'), [keptMixed12], 0))
    const again = opponentOf(newGameSetup(against('same'), [keptMixed12], 0))
    expect(again).toEqual(once)
    expect(opponentOf(newGameSetup(against('same', { kind: 'mixed' }, '12'), [keptMixed12], 0))).not.toEqual(once)
    expect(rollOpponent(11, 12, { kind: 'mixed' })).toEqual({ force: once })
  })

  /** Its own stream, not setup's: the roll-off would otherwise read the numbers the
   *  force was drawn from. */
  it('draws from a stream of its own, not the one setup uses', () => {
    const [unsalted] = rollForce(12, { kind: 'mixed' }, rngFrom(11))
    expect(opponentOf(newGameSetup(against('same'), [keptMixed12], 0))).not.toEqual(unsalted)
  })

  it('draws from one species when asked', () => {
    const force = opponentOf(newGameSetup(against('same', { kind: 'species', species: 'firewalkers' }), [keptMixed12], 0))
    const ids = [...force.armies.home, ...force.armies.campaign, ...force.armies.horde]
    expect(ids.every((id) => id.startsWith('firewalkers.'))).toBe(true)
  })

  it('may be a chosen size, which is unequal and so has to be meant', () => {
    const slip = newGameSetup(against(24), [keptMixed12], 0)
    expect(slip.kind).toBe('problem')
    expect(slip.health).toEqual({ p1: 12, p2: 24 })
    const meant = newGameSetup({ ...against(24), unequal: true }, [keptMixed12], 0)
    expect(meant.kind).toBe('ok')
    expect(builtForceHealth(opponentOf(meant))).toBe(24)
  })

  it('offers every species and a mixed draw', () => {
    expect(poolChoices().map((p) => p.value)).toEqual([
      'mixed',
      'treefolk',
      'firewalkers',
      'coral_elves',
      'dwarves',
      'goblins',
    ])
  })
})

describe('the side pickers', () => {
  it('reads and writes a side as a select value', () => {
    for (const side of [{ kind: 'random' }, { kind: 'preset', id: 'treefolk_satyr' }, { kind: 'kept', id: 'force-1' }] as const) {
      expect(parseSideValue(sideValue(side))).toEqual(side)
    }
    expect(parseSideValue('nonsense')).toBeNull()
    expect(parseSideValue('kept:')).toBeNull()
    expect(parseSideValue('other:x')).toBeNull()
  })

  it('offers a random force to the opponent only, then kept forces, then presets by health', () => {
    const unfinished: SavedForce = { ...keptMixed12, id: 'half', name: 'Half', force: { armies: mixed12.armies } }
    const mine = sideOptionGroups([keptMixed12, unfinished], false)
    expect(mine.map((g) => g.label)).toEqual(['Kept in the army builder', '24 health', '30 health', '35 health'])
    expect(mine[0]?.options).toEqual([
      { value: 'kept:mine', label: 'Mixed 12', disabled: false },
      { value: 'kept:half', label: 'Half (3 to fix in the builder)', disabled: true },
    ])
    expect(sideOptionGroups([], true).map((g) => g.label)).toEqual(['Rolled', '24 health', '30 health', '35 health'])
  })
})

/**
 * Phase 4's exit criterion, headless: a mixed 12 built from sorry-12 and a 36 built from
 * the full collection, each against a random force of its own size, set up exactly as
 * the start screen sets them up and played to the end. Greedy plays both seats, since
 * the browser's human cannot be scripted here; the browser run is the other half.
 */
describe('the exit criterion, played headless', () => {
  it('plays a limited mixed 12 and a full 36 to the end against random forces', () => {
    const [rolled36] = rollForce(36, { kind: 'mixed' }, rngFrom(36))
    const full36: SavedForce = {
      id: 'big',
      name: 'Big',
      collection: 'full',
      cap: 36,
      force: { ...rolled36, homeTerrain: 'highland_temple', frontierProposal: 'coastland_city', dragons: ['fire_wyrm', 'water_drake'] },
    }
    expect(forceProblems(FULL_COLLECTION, 36, full36.force)).toEqual([])

    for (const [entry, seed] of [[keptMixed12, 4], [full36, 5]] as const) {
      const result = newGameSetup(
        { p1: { kind: 'kept', id: entry.id }, p2: { kind: 'random', size: 'same', pool: { kind: 'mixed' } }, unequal: false, seedText: String(seed) },
        [keptMixed12, full36],
        0,
      )
      if (result.kind !== 'ok') throw new Error(result.problem)
      const run = runGame({ setup: result.setup, players: { p1: greedyAi, p2: greedyAi }, maxDecisions: 20_000 })
      expect(run.stoppedBecause, entry.name).toBe('winner')
      // A real game, not a setup that ends before it starts: these run 125-150
      // decisions and a score of combats.
      expect(run.decisions, entry.name).toBeGreaterThan(50)
    }
  })
})

describe('randomGameSetup', () => {
  it('rolls both sides from the seed', () => {
    expect(randomGameSetup('42', 0)).toEqual({
      kind: 'ok',
      setup: { seed: 42, forces: { kind: 'random' }, ruleSet: V1_RULES },
    })
  })

  it('carries the same seed rule', () => {
    expect(randomGameSetup('', 55).kind === 'ok').toBe(true)
    expect(randomGameSetup('-3', 55).kind).toBe('problem')
  })
})

describe('opponentChoices', () => {
  it('opens on GreedyAI, the opponent that plays', () => {
    expect(DEFAULT_OPPONENT).toBe('greedy')
    expect(opponentChoices()[0]?.id).toBe('greedy')
  })

  it('offers every registered opponent, each with words, and never the fuzz opponent', () => {
    const ids = opponentChoices().map((o) => o.id)
    expect([...ids].sort()).toEqual(Object.keys(OPPONENTS).sort())
    expect(ids as readonly string[]).not.toContain('random')
    for (const choice of opponentChoices()) {
      expect(choice.name.length, choice.id).toBeGreaterThan(0)
      expect(choice.note.length, choice.id).toBeGreaterThan(0)
    }
  })
})
