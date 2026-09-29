/**
 * The builder's kept forces (v2 Phase 4b): parsing what `localStorage` held, in node.
 * The two functions that touch `localStorage` are wrapped and not tested here, by the
 * project's no-DOM rule.
 */
import { describe, expect, it } from 'vitest'

import {
  newForceId,
  parseSavedForces,
  removeForce,
  serializeSavedForces,
  upsertForce,
  type SavedForce,
} from './forceStore'

const entry = (id: string, name = id): SavedForce => ({
  id,
  name,
  collection: 'full',
  cap: 24,
  force: { armies: { home: ['treefolk.oak'], campaign: ['treefolk.pine'], horde: ['treefolk.nymph'] } },
})

describe('parseSavedForces', () => {
  it('reads back what it wrote, pins and all', () => {
    const pinned: SavedForce = {
      ...entry('a'),
      force: { ...entry('a').force, homeTerrain: 'swampland_city', dragons: ['earth_drake'] },
    }
    expect(parseSavedForces(serializeSavedForces([pinned, entry('b')]))).toEqual([pinned, entry('b')])
  })

  it('reads a missing or unreadable store as empty', () => {
    expect(parseSavedForces(null)).toEqual([])
    expect(parseSavedForces('{not json')).toEqual([])
    expect(parseSavedForces('[]')).toEqual([])
    expect(parseSavedForces('null')).toEqual([])
    expect(parseSavedForces('{"forces": 3}')).toEqual([])
  })

  it('drops an entry that is not a force, and keeps the rest', () => {
    const raw = JSON.stringify({
      forces: [
        entry('good'),
        { ...entry('no-cap'), cap: 'big' },
        { ...entry('bad-army'), force: { armies: { home: 'oak' } } },
        null,
        entry('also-good'),
      ],
    })
    expect(parseSavedForces(raw).map((f) => f.id)).toEqual(['good', 'also-good'])
  })

  /** Legality is not the store's question: the data may move under a kept force, and
   *  the builder asks `forceProblems` every time it shows one. */
  it('keeps a force naming a die the data does not have', () => {
    const odd = { ...entry('odd'), force: { armies: { home: ['treefolk.ent'], campaign: [], horde: [] } } }
    expect(parseSavedForces(serializeSavedForces([odd]))).toEqual([odd])
  })
})

describe('editing the list', () => {
  it('replaces by id, or appends', () => {
    const list = [entry('a'), entry('b')]
    expect(upsertForce(list, entry('b', 'renamed')).map((f) => f.name)).toEqual(['a', 'renamed'])
    expect(upsertForce(list, entry('c')).map((f) => f.id)).toEqual(['a', 'b', 'c'])
    expect(removeForce(list, 'a').map((f) => f.id)).toEqual(['b'])
  })

  it('makes an id nobody has', () => {
    const list = [entry('force-5'), entry('force-6')]
    expect(newForceId(list, 5)).toBe('force-7')
    expect(newForceId(list, 9)).toBe('force-9')
  })
})
