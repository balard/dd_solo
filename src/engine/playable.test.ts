/**
 * Which species the engine hands out (v2 Phase 5a): a species in the data is not
 * playable until every SAI on its dice has a handler and the ability table names it.
 *
 * Every species in the data is playable between species phases, so the rule is tested
 * through `problemFor` with made-up inputs, and the tables through `speciesProblem`.
 * The gate on rolled forces and built forces is only observable while a species is
 * half-built; the Coral Elves were that from 5a to 5d, and the Dwarves are from 6a to 6f.
 */
import { describe, expect, it } from 'vitest'

import { SPECIES, UNIT_TYPES } from '../data/load'
import type { Species, UnitType } from '../data/types'
import { builtForceProblem, generateForces, rollForce } from './force'
import { PLAYABLE_SPECIES, PLAYABLE_UNITS, problemFor, speciesProblem, unitPlayable } from './playable'
import { rngFrom } from './rng'

const merfolk: Species = { id: 'merfolk', name: 'Merfolk', elements: ['water', 'air'] }
const die = (sais: readonly string[]): UnitType =>
  ({
    id: 'merfolk.x',
    species: 'merfolk',
    faces: sais.map((sai) => ({ count: 4, icon: 'SAI', sai })),
  }) as unknown as UnitType

describe('the playable rule', () => {
  it('names every unbuilt SAI on the species\' dice, and missing abilities', () => {
    const types = [die(['Tail', 'Wave']), die(['Wave', 'Smite'])]
    expect(problemFor(merfolk, types, (sai) => sai === 'Smite', false)).toBe(
      'Merfolk are not playable yet: the SAIs Tail, Wave and its species abilities are not implemented',
    )
    expect(problemFor(merfolk, types, (sai) => sai !== 'Wave', true)).toBe(
      'Merfolk are not playable yet: the SAI Wave are not implemented',
    )
    expect(problemFor(merfolk, types, () => true, true)).toBeNull()
  })

  it('reads only the species it is asked about', () => {
    const other = { ...die(['Backflip']), species: 'someone_else' } as UnitType
    expect(problemFor(merfolk, [other], () => false, true)).toBeNull()
  })
})

describe('the species in the data', () => {
  /**
   * v2 Phase 6a: the Dwarves are in the data and not playable until 6f, which builds
   * their abilities after 6d and 6e have built the four SAIs. Each of those slices
   * shortens the sentence below, and 6f turns this back into "all playable".
   */
  it('are the three the engine has rules for; the Dwarves are in the data but not yet', () => {
    expect(PLAYABLE_SPECIES.map((s) => s.id).sort()).toEqual(['coral_elves', 'firewalkers', 'treefolk'])
    for (const species of SPECIES) {
      if (species.id === 'dwarves') continue
      expect(speciesProblem(species.id), species.id).toBeNull()
    }
    expect(speciesProblem('dwarves')).toBe(
      'Dwarves are not playable yet: the SAI Charge and its species abilities are not implemented',
    )
    expect(PLAYABLE_UNITS).toHaveLength(UNIT_TYPES.length - 20)
    expect(unitPlayable('coral_elves.tako')).toBe(true)
    expect(unitPlayable('dwarves.behemoth')).toBe(false)
  })

  it('refuse a half-built species everywhere a force comes from', () => {
    expect(() => rollForce(24, { kind: 'species', species: 'dwarves' }, rngFrom(1))).toThrow(
      /not playable yet/,
    )
    const force = {
      armies: {
        home: ['treefolk.oak', 'treefolk.oak'],
        campaign: ['treefolk.oak', 'treefolk.oak'],
        horde: ['dwarves.sergeant'],
      },
    }
    expect(builtForceProblem(force)).toMatch(/horde army names dwarves\.sergeant, and Dwarves are not playable yet/)
  })

  it('all reach a rolled force: the race draw and the mixed pool', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 200; seed++) {
      const [mixed] = rollForce(24, { kind: 'mixed' }, rngFrom(seed))
      const [pair] = generateForces(rngFrom(seed), { mixed: seed % 2 === 0 })
      for (const force of [mixed, pair.p1, pair.p2]) {
        for (const id of Object.values(force.armies).flat()) seen.add(id.split('.')[0] ?? '')
      }
    }
    expect([...seen].sort()).toEqual(['coral_elves', 'firewalkers', 'treefolk'])
  })
})
