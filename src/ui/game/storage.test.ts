import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { randomAi } from '../../ai/random'
import { runGame } from '../../ai/run'
import { replay } from '../../engine/replay'

import { SAVE_VERSION, clearSave, readSave, writeSave } from './storage'

/** A minimal localStorage, since these tests run in node. */
function installStorage(impl?: Partial<Storage>): Map<string, string> {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
    ...impl,
  }
  globalThis.window = { localStorage: storage } as unknown as Window & typeof globalThis
  return map
}

const played = () =>
  runGame({
    setup: { seed: 7, forces: { p1: 'treefolk_starter', p2: 'firewalkers_starter' } },
    players: { p1: randomAi, p2: randomAi },
    aiSeed: 7,
    maxDecisions: 120,
  })

describe('storage', () => {
  let map: Map<string, string>

  beforeEach(() => {
    map = installStorage()
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('reports nothing when there is no save', () => {
    expect(readSave()).toEqual({ kind: 'none' })
  })

  /** The point of storing the record rather than a snapshot. */
  it('round-trips a game through a save and replays to the same state', () => {
    const { state, record } = played()
    expect(writeSave(record)).toBe(true)

    const result = readSave()
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('unreachable')

    expect(replay(result.save.record)).toEqual(state)
  })

  it('stays small enough to be a save file', () => {
    const { record } = played()
    writeSave(record)
    expect([...map.values()][0]!.length).toBeLessThan(40_000)
  })

  it('rejects a save from a different rules version', () => {
    map.set('dd_solo.save', JSON.stringify({ version: SAVE_VERSION + 1, record: {}, savedAt: '' }))
    expect(readSave()).toEqual({ kind: 'outdated', found: SAVE_VERSION + 1 })
  })

  it.each([
    ['not json at all', 'not valid JSON'],
    ['null', 'not an object'],
    ['{}', 'no version'],
    [JSON.stringify({ version: SAVE_VERSION }), 'missing its moves'],
    [JSON.stringify({ version: SAVE_VERSION, record: { setup: {} } }), 'missing its moves'],
  ])('reports %j as unreadable', (raw, expected) => {
    map.set('dd_solo.save', raw)
    const result = readSave()
    expect(result.kind).toBe('unreadable')
    if (result.kind === 'unreadable') expect(result.reason).toContain(expected)
  })

  it('clears a save', () => {
    writeSave(played().record)
    clearSave()
    expect(readSave()).toEqual({ kind: 'none' })
  })

  /**
   * A private window, blocked site data or a full quota all throw here. A game that
   * cannot be saved must still be playable, so every access is wrapped.
   */
  it('survives storage that throws on write', () => {
    installStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(writeSave(played().record)).toBe(false)
  })

  it('survives storage that throws on read', () => {
    installStorage({
      getItem: () => {
        throw new Error('SecurityError')
      },
    })
    const result = readSave()
    expect(result.kind).toBe('unreadable')
  })

  it('survives storage that throws on clear', () => {
    installStorage({
      removeItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(() => clearSave()).not.toThrow()
  })
})
