/**
 * The app's run save, over a fake `localStorage` (v3 Phase 3).
 */
import { describe, expect, it } from 'vitest'

import { autopilot } from '../../run/autopilot'
import { battleSetup } from '../../run/battle'
import { newRun, reduceRun } from '../../run/reduce'
import type { RunState } from '../../run/types'

import { clearRun, readRun, runInProgress, saveRun, type RunStorage } from './runStore'

function memory(): RunStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }
}

const broken: RunStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('quota')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
}

/** Plays a run on autopilot, saving after every step as the app will, up to a battle. */
function toFirstBattle(storage: RunStorage): RunState {
  let run = reduceRun(newRun(12), { kind: 'pick_race', race: 'firewalkers' })
  saveRun(run, storage)
  while (run.pending.kind !== 'battle') {
    run = reduceRun(run, autopilot(run))
    saveRun(run, storage)
  }
  return run
}

describe('runStore', () => {
  it('reads nothing before anything is saved', () => {
    expect(readRun(memory())).toEqual({ kind: 'none' })
  })

  // The exit criterion's second half, in node: a reload mid-battle returns to that
  // encounter's start, and the battle it sets up is the same game.
  it('comes back from a battle to its encounter, with the same board', () => {
    const storage = memory()
    const battle = toFirstBattle(storage)
    const load = readRun(storage)
    if (load.kind !== 'ok') throw new Error(load.kind)
    expect(load.run.pending.kind).toBe('arrange_force')
    expect(load.run.current).toEqual(battle.current)
    expect(load.run.force).toEqual(battle.force)
    const again = reduceRun(load.run, { kind: 'ready' })
    expect(again).toEqual(battle)
    expect(battleSetup(again)).toEqual(battleSetup(battle))
    expect(runInProgress(load)).toBe(true)
  })

  it('keeps a finished run until it has been shown, then clears it', () => {
    const storage = memory()
    const battle = toFirstBattle(storage)
    const lost = reduceRun(battle, { kind: 'battle_ended', winner: 'p2' })
    expect(saveRun(lost, storage)).toBe(true)
    const load = readRun(storage)
    expect(load).toMatchObject({ kind: 'ok', run: { status: 'lost' } })
    expect(runInProgress(load)).toBe(false)
    clearRun(storage)
    expect(readRun(storage)).toEqual({ kind: 'none' })
  })

  it('reports a save it cannot carry on, every time it is read, until it is cleared', () => {
    const storage = memory()
    storage.setItem('dd_solo.run', JSON.stringify({ version: 0, run: {} }))
    // Twice, as StrictMode reads: the second read must still say why.
    expect(readRun(storage)).toEqual({ kind: 'outdated', found: 0 })
    expect(readRun(storage)).toEqual({ kind: 'outdated', found: 0 })
    clearRun(storage)
    expect(readRun(storage)).toEqual({ kind: 'none' })
  })

  it('never throws when storage does', () => {
    const run = newRun(1)
    expect(saveRun(run, broken)).toBe(false)
    expect(readRun(broken)).toMatchObject({ kind: 'unreadable', reason: /storage is unavailable/ })
    expect(() => clearRun(broken)).not.toThrow()
    expect(saveRun(run, null)).toBe(false)
    expect(readRun(null)).toEqual({ kind: 'none' })
  })
})
