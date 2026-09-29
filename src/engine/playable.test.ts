/**
 * Which species the engine hands out (v2 Phase 5a): a species in the data is not
 * playable until every SAI on its dice has a handler and the ability table names it.
 *
 * The Coral Elves assertions are about the phase in progress, and move as it lands: the
 * slice that builds their last SAI and abilities flips them, and edits this file.
 */
import { describe, expect, it } from 'vitest'

import { UNIT_TYPES } from '../data/load'
import { builtForceProblem, generateForces, rollForce } from './force'
import { PLAYABLE_SPECIES, PLAYABLE_UNITS, speciesProblem, unitPlayable } from './playable'
import { rngFrom } from './rng'

describe('playable species', () => {
  it('are the two the engine has rules for; the Coral Elves are in the data but not yet', () => {
    expect(PLAYABLE_SPECIES.map((s) => s.id).sort()).toEqual(['firewalkers', 'treefolk'])
    expect(speciesProblem('treefolk')).toBeNull()
    expect(speciesProblem('coral_elves')).toBe(
      'Coral Elves are not playable yet: the SAIs Entangle, Ferry, Hypnotic Glare, Swallow, Tail, Wave ' +
        'and its species abilities are not implemented',
    )
    expect(unitPlayable('coral_elves.tako')).toBe(false)
    expect(PLAYABLE_UNITS.length).toBe(UNIT_TYPES.length - 20)
  })

  it('never reach a rolled force, from either pool', () => {
    for (let seed = 0; seed < 200; seed++) {
      const [mixed] = rollForce(24, { kind: 'mixed' }, rngFrom(seed))
      const [pair] = generateForces(rngFrom(seed), { mixed: seed % 2 === 0 })
      for (const force of [mixed, pair.p1, pair.p2]) {
        for (const id of Object.values(force.armies).flat()) expect(unitPlayable(id), id).toBe(true)
      }
    }
    expect(() => rollForce(24, { kind: 'species', species: 'coral_elves' }, rngFrom(1))).toThrow(
      /not playable yet/,
    )
  })

  it('are what a built force is held to', () => {
    const force = {
      armies: {
        home: ['treefolk.oak', 'treefolk.oak'],
        campaign: ['treefolk.oak', 'treefolk.oak'],
        horde: ['coral_elves.knight'],
      },
    }
    expect(builtForceProblem(force)).toMatch(/horde army names coral_elves\.knight, and Coral Elves are not playable yet/)
  })
})
