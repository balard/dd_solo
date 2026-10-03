/**
 * Which species the engine hands out (v2 Phase 5a): a species in the data is not
 * playable until every SAI on its dice has a handler and the ability table names it.
 *
 * Every species in the data is playable between species phases, so the rule is tested
 * through `problemFor` with made-up inputs, and the tables through `speciesProblem`.
 * The gate on rolled forces and built forces is only observable while a species is
 * half-built; the Coral Elves were that from 5a to 5d, the Dwarves from 6a to 6f, and the
 * Goblins from 7a to 7d.
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
   * v2 Phase 7d: the Goblins' abilities flipped them, so every species in the data is
   * playable again -- the gate is visible only while a species is half-built, and the
   * rule itself is tested above on made-up species.
   */
  it('are all playable once the Goblins have their SAIs and abilities (v2 Phase 7d)', () => {
    expect(PLAYABLE_SPECIES.map((s) => s.id).sort()).toEqual([
      'coral_elves',
      'dwarves',
      'firewalkers',
      'goblins',
      'treefolk',
    ])
    for (const species of SPECIES) expect(speciesProblem(species.id), species.id).toBeNull()
    expect(PLAYABLE_UNITS).toHaveLength(UNIT_TYPES.length)
    expect(unitPlayable('goblins.troll')).toBe(true)
  })

  it('accept a Goblins force from anywhere a force comes from', () => {
    const [force] = rollForce(24, { kind: 'species', species: 'goblins' }, rngFrom(1))
    expect(Object.values(force.armies).flat().every((id) => id.startsWith('goblins.'))).toBe(true)
    expect(builtForceProblem(force)).toBeNull()
  })

  it('accept a Dwarves force from anywhere a force comes from', () => {
    const [force] = rollForce(24, { kind: 'species', species: 'dwarves' }, rngFrom(1))
    expect(Object.values(force.armies).flat().every((id) => id.startsWith('dwarves.'))).toBe(true)
    expect(builtForceProblem(force)).toBeNull()
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
    expect([...seen].sort()).toEqual(['coral_elves', 'dwarves', 'firewalkers', 'goblins', 'treefolk'])
  })
})
