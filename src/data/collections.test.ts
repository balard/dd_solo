import { describe, expect, it } from 'vitest'

import {
  COLLECTIONS,
  COLLECTION_KINDS,
  FULL_COLLECTION,
  collectionNamed,
  diceOfKind,
  owned,
  ownsEveryDie,
  readCollection,
} from './collections'
import { unitType } from './load'

describe('the full collection', () => {
  it('holds every die in the data without limit', () => {
    for (const kind of COLLECTION_KINDS) {
      expect(diceOfKind(kind).length, kind).toBeGreaterThan(0)
      for (const id of diceOfKind(kind)) expect(owned(FULL_COLLECTION, kind, id), id).toBe(Infinity)
      expect(ownsEveryDie(FULL_COLLECTION, kind)).toBe(true)
    }
  })

  it('is the first the builder is offered', () => {
    expect(COLLECTIONS[0]).toBe(FULL_COLLECTION)
    expect(collectionNamed('full')).toBe(FULL_COLLECTION)
    expect(collectionNamed('nope')).toBeNull()
  })
})

describe('sorry-12', () => {
  const sorry = collectionNamed('sorry-12')

  /** The limited mode's smallest real test: enough to build a mixed 12 from, with a
   *  choice left over, and exactly the one dragon and two terrains a 12 needs. */
  it('is a little over 12 health of small and medium dice, of both species', () => {
    if (sorry === null) throw new Error('sorry-12 is not loaded')
    const entries = Object.entries(sorry.units)
    const health = entries.reduce((n, [id, count]) => n + unitType(id).health * count, 0)
    expect(health).toBe(14)
    expect(entries.every(([id]) => unitType(id).health <= 2)).toBe(true)
    expect(new Set(entries.map(([id]) => unitType(id).species))).toEqual(new Set(['treefolk', 'firewalkers']))
    expect(Object.values(sorry.dragons).reduce((a, b) => a + b, 0)).toBe(1)
    expect(Object.values(sorry.terrains).reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('does not own everything, so it cannot leave a terrain or a dragon to the draw', () => {
    if (sorry === null) throw new Error('sorry-12 is not loaded')
    expect(ownsEveryDie(sorry, 'terrains')).toBe(false)
    expect(ownsEveryDie(sorry, 'dragons')).toBe(false)
    expect(owned(sorry, 'units', 'treefolk.oakling')).toBe(2)
    expect(owned(sorry, 'units', 'treefolk.darktree')).toBe(0)
  })
})

describe('readCollection', () => {
  const read = (value: unknown) => readCollection('test', value)
  const problem = (value: unknown) => {
    const r = read(value)
    return 'problem' in r ? r.problem : null
  }

  it('reads a well-formed file, and an absent kind owns none', () => {
    const r = read({ _comment: 'ignored', name: 'Tiny', units: { 'treefolk.oak': 2 } })
    if ('problem' in r) throw new Error(r.problem)
    expect(r.collection).toEqual({ id: 'test', name: 'Tiny', units: { 'treefolk.oak': 2 }, dragons: {}, terrains: {} })
  })

  it('says what is wrong with one that is not', () => {
    expect(problem([])).toMatch(/object/)
    expect(problem({ units: {} })).toMatch(/no name/)
    expect(problem({ name: 'x', units: [] })).toMatch(/units is not a map/)
    expect(problem({ name: 'x', units: { 'treefolk.ent': 1 } })).toMatch(/treefolk\.ent/)
    // A die of the wrong kind is as unknown as a misspelt one.
    expect(problem({ name: 'x', dragons: { 'treefolk.oak': 1 } })).toMatch(/dragons names treefolk\.oak/)
    expect(problem({ name: 'x', units: { 'treefolk.oak': 0 } })).toMatch(/1 or more/)
    expect(problem({ name: 'x', units: { 'treefolk.oak': 1.5 } })).toMatch(/whole number/)
    expect(problem({ name: 'x', terrains: { swampland_city: '2' } })).toMatch(/whole number/)
  })
})
