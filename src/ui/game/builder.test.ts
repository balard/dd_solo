/**
 * The army builder's rules, without a DOM (v2 Phase 4) -- `newGame.test.ts`'s
 * arrangement.
 */
import { describe, expect, it } from 'vitest'

import { FULL_COLLECTION, collectionNamed, type Collection } from '../../data/collections'
import { DRAGON_DICE, TERRAIN_DICE, UNIT_TYPES } from '../../data/load'
import { PRESET_ARMY_NAMES, preset } from '../../data/presets'
import { builtForceProblem, rollForce, type BuiltForce } from '../../engine/force'
import { nextInt, rngFrom, type RngState } from '../../engine/rng'
import { setupGame } from '../../engine/setup'
import { V1_RULES } from '../../engine/types'

import { copiesLeft, forceHealth, forceProblems, used, type ProblemPlace } from './builder'

const sorry: Collection = (() => {
  const found = collectionNamed('sorry-12')
  if (found === null) throw new Error('sorry-12 is not loaded')
  return found
})()

const starter: BuiltForce = { armies: preset('treefolk_starter').armies }

/** A legal mixed 12 out of sorry-12: the force the exit criterion builds. */
const mixed12: BuiltForce = {
  armies: {
    home: ['treefolk.oak', 'firewalkers.guardian', 'treefolk.hamadryad'], // 4
    campaign: ['firewalkers.adventurer', 'treefolk.oakling', 'treefolk.nymph'], // 4
    horde: ['treefolk.oakling', 'firewalkers.explorer', 'firewalkers.sunburst', 'treefolk.pineling'], // 4
  },
  homeTerrain: 'swampland_city',
  frontierProposal: 'feyland_temple',
  dragons: ['earth_drake'],
}

const places = (problems: readonly { where: ProblemPlace }[]) => problems.map((p) => p.where)

describe('forceProblems', () => {
  it('finds nothing wrong with a preset over the full collection', () => {
    expect(forceProblems(FULL_COLLECTION, Infinity, starter)).toEqual([])
    expect(forceProblems(FULL_COLLECTION, 30, starter)).toEqual([])
  })

  it('finds nothing wrong with a mixed 12 built from sorry-12', () => {
    expect(forceHealth(mixed12)).toBe(12)
    expect(forceProblems(sorry, 12, mixed12)).toEqual([])
    // And setup agrees, which is the point of the builder.
    expect(() => setupGame({ seed: 1, forces: { kind: 'built', forces: { p1: mixed12, p2: mixed12 } }, ruleSet: V1_RULES })).not.toThrow()
  })

  it('holds a force to the cap', () => {
    const problems = forceProblems(FULL_COLLECTION, 24, starter)
    expect(problems).toEqual([{ where: 'force', text: 'it is 30 health, over the cap of 24' }])
  })

  /** The reason this is a list: a draft is wrong in several places at once, and a screen
   *  naming one of them hides the rest until it is fixed. */
  it('names every problem at once, each where it belongs', () => {
    const draft: BuiltForce = {
      armies: { home: ['firewalkers.gorgon', 'firewalkers.genie'], campaign: ['firewalkers.guardian'], horde: [] },
    }
    const problems = forceProblems(sorry, 8, draft)
    expect(places(problems)).toEqual(['force', 'force', 'force', 'home', 'horde', 'terrains', 'terrains', 'dragons'])
    // Guardian is held once and used once, so it is not among them.
    expect(problems.filter((p) => p.where === 'force').map((p) => p.text)).toEqual([
      'it is 9 health, over the cap of 8',
      'it uses Gorgon, which the collection does not hold',
      'it uses Genie, which the collection does not hold',
    ])
    expect(problems.find((p) => p.where === 'home')?.text).toBe(
      'the home army is 8 health, over half the force (4 of 9)',
    )
    expect(problems.find((p) => p.where === 'horde')?.text).toMatch(/empty/)
  })

  it('counts copies against what the collection holds', () => {
    const three: BuiltForce = { ...mixed12, armies: { ...mixed12.armies, home: ['treefolk.oakling', 'firewalkers.guardian', 'treefolk.hamadryad', 'treefolk.willowling'] } }
    // Two Oaklings owned; this uses three.
    expect(used(three, 'units', 'treefolk.oakling')).toBe(3)
    expect(copiesLeft(sorry, three, 'units', 'treefolk.oakling')).toBe(-1)
    expect(forceProblems(sorry, 12, three).map((p) => p.text)).toContain(
      'it uses 3 of Oakling; the collection holds 2',
    )
    expect(copiesLeft(FULL_COLLECTION, three, 'units', 'treefolk.oakling')).toBe(Infinity)
  })

  /** Home and proposal are two physical dice, even when they are the same die. */
  it('needs two copies of a terrain used as both Home and proposal', () => {
    const same: BuiltForce = { ...mixed12, frontierProposal: 'swampland_city' }
    expect(used(same, 'terrains', 'swampland_city')).toBe(2)
    expect(forceProblems(sorry, 12, same)).toEqual([
      { where: 'terrains', text: 'it uses 2 of Swampland · city; the collection holds 1' },
    ])
    expect(forceProblems(FULL_COLLECTION, 12, same)).toEqual([])
  })

  it('leaves the terrains and dragons to the draw only from a collection that holds them all', () => {
    const armiesOnly: BuiltForce = { armies: mixed12.armies }
    expect(forceProblems(FULL_COLLECTION, 12, armiesOnly)).toEqual([])
    expect(forceProblems(sorry, 12, armiesOnly)).toEqual([
      { where: 'terrains', text: 'choose a Home Terrain; setup can only draw one from every terrain die' },
      { where: 'terrains', text: 'choose a Frontier proposal; setup can only draw one from every terrain die' },
      { where: 'dragons', text: 'choose 1 dragon; setup can only draw them from every dragon die' },
    ])
  })

  it('holds the dragons to one per 24 health or part of it', () => {
    expect(forceProblems(FULL_COLLECTION, Infinity, { ...starter, dragons: ['fire_drake'] })).toEqual([
      {
        where: 'dragons',
        text: 'it brings 1 dragon; a 30-health force brings exactly 2, one per 24 health or part of it',
      },
    ])
    expect(forceProblems(FULL_COLLECTION, Infinity, { ...starter, dragons: ['fire_drake', 'fire_drake'] })).toEqual([])
    // sorry-12 holds one Earth Drake, and no Fire Drake at all.
    expect(forceProblems(sorry, 12, { ...mixed12, dragons: ['fire_drake'] }).map((p) => p.text)).toEqual([
      'it uses Fire Drake, which the collection does not hold',
    ])
  })

  it('reports a die that does not exist rather than throwing', () => {
    const typo: BuiltForce = { ...starter, armies: { ...starter.armies, horde: ['treefolk.ent'] }, homeTerrain: 'moon', dragons: ['ivory_drake', 'fire_drake'] }
    const texts = forceProblems(FULL_COLLECTION, Infinity, typo).map((p) => p.text)
    expect(texts).toContain('the horde army names treefolk.ent, which is not a unit die')
    expect(texts).toContain('the Home Terrain moon is not a terrain die')
    expect(texts).toContain('ivory_drake is not a dragon die')
  })

  /**
   * One statement of p. 8, written twice: here and `builtForceProblem`. Over the full
   * collection with no cap the two must agree on every force -- random drafts, most of
   * them illegal in some way, some of them legal.
   */
  it('agrees with the engine on what a legal force is', () => {
    const pick = <T,>(list: readonly T[], rng: RngState): readonly [T, RngState] => {
      const [i, next] = nextInt(rng, list.length)
      const item = list[i]
      if (item === undefined) throw new Error('empty list')
      return [item, next] as const
    }
    let rng = rngFrom(4)
    let legal = 0
    for (let n = 0; n < 2000; n++) {
      const armies = { home: [] as string[], campaign: [] as string[], horde: [] as string[] }
      let count: number
      ;[count, rng] = nextInt(rng, 12)
      for (let i = 0; i < count; i++) {
        let unit: (typeof UNIT_TYPES)[number]
        let army: (typeof PRESET_ARMY_NAMES)[number]
        ;[unit, rng] = pick(UNIT_TYPES, rng)
        ;[army, rng] = pick(PRESET_ARMY_NAMES, rng)
        armies[army].push(unit.id)
      }
      let dragonMode: number
      ;[dragonMode, rng] = nextInt(rng, 3)
      const dragons: string[] = []
      if (dragonMode > 0) {
        let length: number
        ;[length, rng] = nextInt(rng, 3)
        for (let i = 0; i < length; i++) {
          let die: (typeof DRAGON_DICE)[number]
          ;[die, rng] = pick(DRAGON_DICE, rng)
          dragons.push(die.id)
        }
      }
      let terrain: (typeof TERRAIN_DICE)[number]
      ;[terrain, rng] = pick(TERRAIN_DICE, rng)
      const force: BuiltForce = {
        armies,
        homeTerrain: terrain.id,
        ...(dragonMode > 0 ? { dragons } : {}),
      }
      const mine = forceProblems(FULL_COLLECTION, Infinity, force)
      const engine = builtForceProblem(force)
      expect(mine.length === 0, `${JSON.stringify(force)}: ${engine} / ${JSON.stringify(mine)}`).toBe(engine === null)
      if (engine === null) legal++
    }
    // Both halves of the equivalence were exercised.
    expect(legal).toBeGreaterThan(50)
    expect(legal).toBeLessThan(1950)
  })

  it('finds nothing wrong with a rolled force of the size asked for', () => {
    for (const budget of [12, 13, 24, 36]) {
      const [force] = rollForce(budget, { kind: 'mixed' }, rngFrom(budget))
      expect(forceProblems(FULL_COLLECTION, budget, force), `budget ${budget}`).toEqual([])
    }
  })
})
