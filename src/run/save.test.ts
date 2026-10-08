/**
 * The run save's format (v3 Phase 3): a snapshot, checked for its shape on the way in.
 */
import { describe, expect, it } from 'vitest'

import { autopilot } from './autopilot'
import { newRun, reduceRun } from './reduce'
import { RUN_VERSION, loadMessage, parseRunSave, serializeRun, shouldSave } from './save'
import type { RunState } from './types'

/** Every state of a run on autopilot, battles won, to its end. */
function everyState(seed: number, race: string): readonly RunState[] {
  const states: RunState[] = []
  let run = newRun(seed)
  states.push(run)
  run = reduceRun(run, { kind: 'pick_race', race })
  while (true) {
    states.push(run)
    if (run.pending.kind === 'over') return states
    run = reduceRun(run, run.pending.kind === 'battle' ? { kind: 'battle_ended', winner: 'p1' } : autopilot(run))
  }
}

const written = (run: RunState) => serializeRun(run, '2026-10-08T00:00:00.000Z')

describe('the run save', () => {
  it('reads back every state of a whole run exactly, and carries on from it the same', () => {
    const states = everyState(3, 'coral_elves')
    expect(states.length).toBeGreaterThan(60)
    for (const [i, run] of states.entries()) {
      const load = parseRunSave(written(run))
      if (load.kind !== 'ok') throw new Error(`state ${i}: ${JSON.stringify(load)}`)
      expect(load.run).toEqual(run)
      expect(load.savedAt).toBe('2026-10-08T00:00:00.000Z')
      // A snapshot is a run: the next answer from it is the next answer from the original.
      if (run.pending.kind === 'over' || run.pending.kind === 'battle' || run.pending.kind === 'choose_race') continue
      expect(reduceRun(load.run, autopilot(load.run))).toEqual(states[i + 1])
    }
  })

  it('is written at every resting point but a battle in progress', () => {
    const kinds = new Map<string, boolean>()
    for (const run of everyState(4, 'dwarves')) kinds.set(run.pending.kind, shouldSave(run))
    expect(Object.fromEntries(kinds)).toEqual({
      choose_race: true,
      arrange_force: true,
      battle: false,
      reward: true,
      event: true,
      over: true,
    })
  })

  it('has nothing to read when nothing was written', () => {
    expect(parseRunSave(null)).toEqual({ kind: 'none' })
    expect(loadMessage({ kind: 'none' })).toBeNull()
  })

  it('discards a version-1 save, which has no history', () => {
    const v1 = JSON.parse(written(newRun(1))) as { version: number; run: Record<string, unknown> }
    v1.version = 1
    delete v1.run['history']
    expect(parseRunSave(JSON.stringify(v1))).toEqual({ kind: 'outdated', found: 1 })
  })

  it('discards a save of another version, and says so', () => {
    const old = JSON.stringify({ ...JSON.parse(written(newRun(1))), version: RUN_VERSION + 1 })
    const load = parseRunSave(old)
    expect(load).toEqual({ kind: 'outdated', found: RUN_VERSION + 1 })
    expect(loadMessage(load)).toMatch(/older version .* discarded/)
  })

  it('refuses a damaged save with a sentence rather than a crash', () => {
    const run = everyState(5, 'treefolk')[5] as RunState
    const damage = (change: (run: Record<string, unknown>) => void) => {
      const save = JSON.parse(written(run)) as { run: Record<string, unknown> }
      change(save.run)
      return parseRunSave(JSON.stringify(save))
    }
    expect(parseRunSave('{nope')).toEqual({ kind: 'unreadable', reason: 'the saved run is not valid JSON' })
    expect(parseRunSave('{}')).toEqual({ kind: 'unreadable', reason: 'the saved run has no version' })
    expect(damage((r) => (r['act'] = 4))).toEqual({ kind: 'unreadable', reason: 'the saved run is damaged: its act is damaged' })
    expect(damage((r) => (r['pending'] = { kind: 'shop' }))).toMatchObject({ reason: /next question/ })
    expect(damage((r) => delete r['force'])).toMatchObject({ reason: /its force: missing/ })
    // The one thing that rots with no change of shape: a die the data no longer has.
    expect(
      damage((r) => ((r['collection'] as { units: Record<string, number> }).units['treefolk.ent'] = 1)),
    ).toEqual({
      kind: 'unreadable',
      reason: 'the saved run is damaged: its pool holds treefolk.ent, which the data no longer has',
    })
    expect(loadMessage({ kind: 'unreadable', reason: 'x' })).toBe('A saved run could not be read (x), and was discarded.')
  })
})
