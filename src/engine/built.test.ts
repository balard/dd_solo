/**
 * Built forces (v2 Phase 2): a force handed to `setupGame` whole -- exact armies, and
 * optionally the Home Terrain, the Frontier proposal and the dragons it would otherwise
 * draw -- at any size, the two sides no longer required to match.
 *
 * The load-bearing claim is the one named forces have always made: **a pinned value
 * draws nothing**, not "the same draw". So most of these tests compare a whole state,
 * RNG counter included, against the game that pins the same thing another way.
 */
import { describe, expect, it } from 'vitest'

import mixed12Json from '../../data/forces/mixed-12.json'
import mixed12vs24Json from '../../data/forces/mixed-12-vs-24.json'
import { greedyAi } from '../ai/greedy'
import { randomAi } from '../ai/random'
import { runGame } from '../ai/run'
import { terrainDie, unitType } from '../data/load'
import { preset } from '../data/presets'

import { builtForceProblem, readBuiltForces, type BuiltForce } from './force'
import { setupGame, STARTER_FORCES, type ForceSpec, type SetupOptions } from './setup'
import {
  SPECIES_RULES,
  V0_RULES,
  V1_RULES,
  forceSize,
  forceSpecies,
  opponentOf,
  type GameState,
  type PlayerId,
} from './types'
import { validateState } from './validate'

function pairFrom(json: unknown): Readonly<Record<PlayerId, BuiltForce>> {
  const read = readBuiltForces(json)
  if ('problem' in read) throw new Error(read.problem)
  return read.forces
}

const MIXED_12 = pairFrom(mixed12Json)
const MIXED_12_VS_24 = pairFrom(mixed12vs24Json)

const built = (forces: Readonly<Record<PlayerId, BuiltForce>>): ForceSpec => ({ kind: 'built', forces })

/** The starter lists as built forces with only their armies -- what `named` resolves to. */
const STARTERS_BUILT: Readonly<Record<PlayerId, BuiltForce>> = {
  p1: { armies: preset('treefolk_starter').armies },
  p2: { armies: preset('firewalkers_starter').armies },
}

const dragonDiceOf = (state: GameState, player: PlayerId): readonly string[] =>
  Object.values(state.dragons)
    .filter((d) => d.owner === player)
    .map((d) => d.dieId)

describe('a preset is a built force with only its armies', () => {
  it.each([
    ['V0_RULES', V0_RULES],
    ['SPECIES_RULES', SPECIES_RULES],
    ['V1_RULES', V1_RULES],
  ])('opens on the same board, die for die, under %s', (_name, ruleSet) => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(setupGame({ seed, forces: built(STARTERS_BUILT), ruleSet })).toEqual(
        setupGame({ seed, forces: STARTER_FORCES, ruleSet }),
      )
    }
  })
})

describe('what a built force pins draws nothing', () => {
  const armiesOnly = STARTERS_BUILT

  it('a Home Terrain pinned by the force is the board `SetupOptions.terrains` pins', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const byForce = setupGame({
        seed,
        ruleSet: V1_RULES,
        forces: built({
          p1: { ...armiesOnly.p1, homeTerrain: 'feyland_city' },
          p2: { ...armiesOnly.p2, homeTerrain: 'coastland_temple' },
        }),
      })
      const byOptions = setupGame({
        seed,
        ruleSet: V1_RULES,
        forces: built(armiesOnly),
        terrains: { p1_home: 'feyland_city', p2_home: 'coastland_temple' },
      })
      expect(byForce).toEqual(byOptions)
      expect(byForce.terrains.p1_home.dieId).toBe('feyland_city')
    }
  })

  it('`SetupOptions.terrains` wins over the force, being applied last', () => {
    const state = setupGame({
      seed: 3,
      ruleSet: V1_RULES,
      forces: built({ p1: { ...armiesOnly.p1, homeTerrain: 'feyland_city' }, p2: armiesOnly.p2 }),
      terrains: { p1_home: 'flatland_tower' },
    })
    expect(state.terrains.p1_home.dieId).toBe('flatland_tower')
  })

  it("is each player's proposal under the roll-off choice, and the other side still draws", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = setupGame({
        seed,
        ruleSet: V1_RULES,
        forces: built({ p1: { ...armiesOnly.p1, frontierProposal: 'flatland_city' }, p2: armiesOnly.p2 }),
      })
      expect(state.rollOff?.proposals.p1).toBe('flatland_city')
      // p2's is drawn from a terrain sharing an element with Firewalkers, as always.
      const p2 = state.rollOff?.proposals.p2
      expect(p2).toBeDefined()
      expect(terrainDie(p2 ?? '').id).toBe(p2)
    }
  })

  it('under the split rung, the roll-off loser places their own proposal', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = setupGame({
        seed,
        ruleSet: SPECIES_RULES,
        forces: built({
          p1: { ...armiesOnly.p1, frontierProposal: 'flatland_city' },
          p2: { ...armiesOnly.p2, frontierProposal: 'feyland_tower' },
        }),
      })
      const loser = opponentOf(state.turn.marching)
      expect(state.terrains.frontier.dieId).toBe(loser === 'p1' ? 'flatland_city' : 'feyland_tower')
    }
  })

  it('named dragons are the pool, and draw what a game with no dragons at all draws', () => {
    const dragons = { p1: ['earth_wyrm', 'water_drake'], p2: ['death_drake', 'fire_wyrm'] }
    for (let seed = 1; seed <= 20; seed++) {
      const state = setupGame({
        seed,
        ruleSet: V1_RULES,
        forces: built({
          p1: { ...armiesOnly.p1, dragons: dragons.p1 },
          p2: { ...armiesOnly.p2, dragons: dragons.p2 },
        }),
      })
      expect(dragonDiceOf(state, 'p1')).toEqual(dragons.p1)
      expect(dragonDiceOf(state, 'p2')).toEqual(dragons.p2)
      // The dragon step is the last draw setup makes, so skipping it entirely is the
      // same stream as a ruleset with no dragons.
      const without = setupGame({ seed, ruleSet: { ...V1_RULES, dragons: false }, forces: built(armiesOnly) })
      expect(state.rng).toEqual(without.rng)
      expect(state.terrains).toEqual(without.terrains)
    }
  })

  it('a force pinning everything leaves the terrain stream to the other side alone', () => {
    const state = setupGame({ seed: 11, ruleSet: V1_RULES, forces: built(MIXED_12_VS_24) })
    expect(state.terrains.p1_home.dieId).toBe('swampland_temple')
    expect(state.rollOff?.proposals.p1).toBe('highland_tower')
    expect(dragonDiceOf(state, 'p1')).toEqual(['water_drake'])
  })
})

describe('builtForceProblem', () => {
  const ok = MIXED_12.p1

  it('accepts both example files', () => {
    for (const pair of [MIXED_12, MIXED_12_VS_24]) {
      expect(builtForceProblem(pair.p1)).toBeNull()
      expect(builtForceProblem(pair.p2)).toBeNull()
    }
  })

  it('refuses an empty army', () => {
    expect(builtForceProblem({ armies: { ...ok.armies, horde: [] } })).toMatch(/horde army is empty/)
  })

  it('refuses an army over half the force, rounded down', () => {
    // 4 + 3 at home is 7 of a 9-health force, whose cap is 4.
    const force: BuiltForce = {
      armies: {
        home: ['treefolk.darktree', 'treefolk.oak_lord'],
        campaign: ['treefolk.oakling'],
        horde: ['treefolk.nymph'],
      },
    }
    expect(builtForceProblem(force)).toMatch(/home army is 7 health, over the setup cap of 4/)
  })

  it('refuses a die that is not in the data', () => {
    expect(builtForceProblem({ armies: { ...ok.armies, campaign: ['treefolk.ent'] } })).toMatch(/treefolk\.ent/)
    expect(builtForceProblem({ ...ok, homeTerrain: 'swampland_castle' })).toMatch(/home terrain swampland_castle/)
    expect(builtForceProblem({ ...ok, frontierProposal: 'moon' })).toMatch(/frontier proposal moon/)
    expect(builtForceProblem({ ...ok, dragons: ['ivory_drake'] })).toMatch(/ivory_drake/)
  })

  it('holds named dragons to exactly one per 24 health, or part of it -- so one at 12, not none', () => {
    expect(builtForceProblem({ ...ok, dragons: [] })).toMatch(/brings 0 dragons; a 12-health force brings exactly 1/)
    expect(builtForceProblem({ ...ok, dragons: ['fire_drake', 'air_wyrm'] })).toMatch(/exactly 1/)
    expect(builtForceProblem({ ...ok, dragons: ['death_wyrm'] })).toBeNull()
  })

  it('is asked of every force by setupGame, which names the player', () => {
    expect(() =>
      setupGame({ seed: 1, forces: built({ p1: MIXED_12.p1, p2: { armies: { ...ok.armies, horde: [] } } }) }),
    ).toThrow(/p2's force cannot start a game: its horde army is empty/)
  })
})

describe('readBuiltForces', () => {
  it('ignores a comment and reads the optional fields', () => {
    expect(MIXED_12_VS_24.p1.dragons).toEqual(['water_drake'])
    expect(MIXED_12.p1.homeTerrain).toBeUndefined()
    expect('homeTerrain' in MIXED_12.p1).toBe(false)
  })

  it('says what is wrong with a malformed file rather than throwing', () => {
    expect(readBuiltForces([])).toEqual({ problem: 'expected an object with a p1 and a p2 force' })
    expect(readBuiltForces({ p1: MIXED_12.p1 })).toEqual({ problem: 'p2: missing, or not an object' })
    expect(readBuiltForces({ ...MIXED_12, p2: { armies: { home: [], campaign: [] } } })).toEqual({
      problem: 'p2: its horde army is not a list of unit ids',
    })
    expect(readBuiltForces({ ...MIXED_12, p1: { ...MIXED_12.p1, dragons: 'fire_drake' } })).toEqual({
      problem: 'p1: dragons is not a list of dragon die ids',
    })
  })
})

describe('forces of unequal size', () => {
  it('sets up 12 against 24 without throwing, each force reading its own size', () => {
    const state = setupGame({ seed: 5, ruleSet: V1_RULES, forces: built(MIXED_12_VS_24) })
    expect(validateState(state)).toEqual([])
    expect(forceSize(state, 'p1')).toBe(12)
    expect(forceSize(state, 'p2')).toBe(24)
    expect(dragonDiceOf(state, 'p1')).toHaveLength(1)
    expect(dragonDiceOf(state, 'p2')).toHaveLength(1)
  })

  it('gives a 36-health side two dragons against a 12-health side\'s one', () => {
    const big: BuiltForce = { armies: preset('treefolk_bestiary').armies }
    const small: BuiltForce = MIXED_12.p1
    const state = setupGame({ seed: 5, ruleSet: V1_RULES, forces: built({ p1: small, p2: big }) })
    expect(forceSize(state, 'p2')).toBe(35)
    expect(dragonDiceOf(state, 'p1')).toHaveLength(1)
    expect(dragonDiceOf(state, 'p2')).toHaveLength(2)
  })
})

describe('the drawn Home of a force that does not name one', () => {
  const homeType = (force: BuiltForce, seed: number): string =>
    terrainDie(
      setupGame({ seed, ruleSet: V1_RULES, forces: built({ p1: force, p2: STARTERS_BUILT.p2 }) }).terrains.p1_home.dieId,
    ).type

  it("is the largest species' own type in a mixed force", () => {
    // 7 health of Treefolk against 5 of Firewalkers.
    for (let seed = 1; seed <= 20; seed++) expect(homeType(MIXED_12.p1, seed)).toBe('swampland')
  })

  it('breaks a tie by species id, which puts Firewalkers first', () => {
    const tied: BuiltForce = {
      armies: {
        home: ['treefolk.oak', 'firewalkers.watcher'],
        campaign: ['treefolk.oakling', 'firewalkers.guardian'],
        horde: ['treefolk.nymph', 'firewalkers.explorer'],
      },
    }
    for (let seed = 1; seed <= 20; seed++) expect(homeType(tied, seed)).toBe('wasteland')
  })
})

describe('a rolled mixed force', () => {
  const options = (seed: number): SetupOptions => ({ seed, ruleSet: V1_RULES, forces: { kind: 'random', mixed: true } })

  it('sets up valid boards, the same size a side, and mixes species', () => {
    let mixedSides = 0
    for (let seed = 1; seed <= 40; seed++) {
      const state = setupGame(options(seed))
      expect(validateState(state)).toEqual([])
      expect(forceSize(state, 'p1')).toBe(forceSize(state, 'p2'))
      for (const player of ['p1', 'p2'] as const) if (forceSpecies(state, player).length > 1) mixedSides += 1
      const drawn = state.log.find((e) => e.kind === 'forces_drawn')
      expect(drawn?.kind === 'forces_drawn' && drawn.health).toBe(forceSize(state, 'p1'))
    }
    expect(mixedSides).toBeGreaterThan(60)
  })

  it('is reproducible from the seed', () => {
    expect(setupGame(options(9))).toEqual(setupGame(options(9)))
  })

  it('draws from every die, not only one species', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      for (const unit of Object.values(setupGame(options(seed)).units)) seen.add(unitType(unit.typeId).species)
    }
    expect([...seen].sort()).toEqual(['coral_elves', 'dwarves', 'firewalkers', 'goblins', 'lava_elves', 'treefolk'])
  })
})

describe('the exit criterion: a 12-health mixed force plays to the end', () => {
  it.each([1, 2, 3, 4, 5])('against a 12-health force, greedy against greedy, seed %i', (seed) => {
    const result = runGame({
      setup: { seed, ruleSet: V1_RULES, forces: built(MIXED_12) },
      players: { p1: greedyAi, p2: greedyAi },
      aiSeed: seed,
      maxDecisions: 5000,
      validate: true,
    })
    expect(result.stoppedBecause).toBe('winner')
  })

  it.each([1, 2, 3])('against a 24-health force, greedy against random, seed %i', (seed) => {
    const result = runGame({
      setup: { seed, ruleSet: V1_RULES, forces: built(MIXED_12_VS_24) },
      players: { p1: greedyAi, p2: randomAi },
      aiSeed: seed,
      maxDecisions: 20_000,
      validate: true,
    })
    expect(result.stoppedBecause).toBe('winner')
    expect(forceSize(result.state, 'p1')).toBe(12)
    expect(forceSize(result.state, 'p2')).toBe(24)
  })
})
