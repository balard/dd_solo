/**
 * Which species the engine hands out (v2 Phase 5a): a species in the data is not
 * playable until every SAI on its dice has a handler and the ability table names it.
 *
 * Every species in the data is playable between species phases, so the rule is tested
 * through `problemFor` with made-up inputs, and the tables through `speciesProblem`.
 * The gate on rolled forces and built forces is only observable while a species is
 * half-built; the Coral Elves were that from 5a to 5d, the Dwarves from 6a to 6f, and the
 * Goblins are from 7a to 7d.
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
   * v2 Phase 7a: the Goblins are in the data and not playable until 7d, which builds
   * their abilities after 7c has built four of the five SAIs and 7d the fifth. Each of
   * those shortens the sentence below, and 7d turns this back into "all playable".
   */
  it('are the four the engine has rules for; the Goblins are in the data but not yet', () => {
    expect(PLAYABLE_SPECIES.map((s) => s.id).sort()).toEqual(['coral_elves', 'dwarves', 'firewalkers', 'treefolk'])
    for (const species of SPECIES) {
      if (species.id === 'goblins') continue
      expect(speciesProblem(species.id), species.id).toBeNull()
    }
    expect(speciesProblem('goblins')).toBe(
      'Goblins are not playable yet: the SAI Regenerate and its species abilities are not implemented',
    )
    expect(PLAYABLE_UNITS).toHaveLength(UNIT_TYPES.length - 20)
    expect(unitPlayable('dwarves.behemoth')).toBe(true)
    expect(unitPlayable('goblins.cannibal')).toBe(false)
  })

  it('refuse a half-built species everywhere a force comes from', () => {
    expect(() => rollForce(24, { kind: 'species', species: 'goblins' }, rngFrom(1))).toThrow(
      /not playable yet/,
    )
    const force = {
      armies: {
        home: ['treefolk.oak', 'treefolk.oak'],
        campaign: ['treefolk.oak', 'treefolk.oak'],
        horde: ['goblins.cutthroat'],
      },
    }
    expect(builtForceProblem(force)).toMatch(/horde army names goblins\.cutthroat, and Goblins are not playable yet/)
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
    expect([...seen].sort()).toEqual(['coral_elves', 'dwarves', 'firewalkers', 'treefolk'])
  })
})
