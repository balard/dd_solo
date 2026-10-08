/**
 * The autopilot (v3 Phase 2): what `--p1-ai` answers a run with outside its battles, and
 * the terminal's `auto` force.
 */
import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'
import { PRESET_ARMY_NAMES } from '../data/presets'
import { builtForceProblem } from '../engine/force'
import { forceHealth, forceProblems } from '../engine/forceProblems'
import { PLAYABLE_SPECIES } from '../engine/playable'

import { autopilot, suggestForce, unfieldedHealth } from './autopilot'
import { newRun, reduceRun } from './reduce'
import { ACT_SIZE, type RunState } from './types'

/** Plays a run on autopilot, every battle won (or lost on `loseAt`). */
function autoRun(seed: number, race: string, loseAt = Infinity): { run: RunState; readies: number } {
  let run = reduceRun(newRun(seed), { kind: 'pick_race', race })
  let battles = 0
  let readies = 0
  for (let n = 0; n < 1000 && run.pending.kind !== 'over'; n++) {
    if (run.pending.kind === 'battle') {
      battles++
      run = reduceRun(run, { kind: 'battle_ended', winner: battles >= loseAt ? 'p2' : 'p1' })
      continue
    }
    const action = autopilot(run)
    const before = run
    run = reduceRun(run, action)
    if (action.kind === 'ready') {
      readies++
      expect(forceProblems(run.collection, ACT_SIZE[before.act], run.force, 'at_most')).toEqual([])
      expect(builtForceProblem(run.force)).toBeNull()
    }
  }
  return { run, readies }
}

describe('autopilot', () => {
  it.each(PLAYABLE_SPECIES.map((s) => s.id))('wins a run of %s when every battle is won', (race) => {
    for (const seed of [1, 2, 3]) {
      const { run, readies } = autoRun(seed, race)
      expect(run.status).toBe('won')
      expect(readies).toBeGreaterThan(15)
      // By Act III it fields close to the cap: the rewards went into the force.
      expect(forceHealth(run.force)).toBeGreaterThan(ACT_SIZE[2])
    }
  })

  it('stops at the battle it loses', () => {
    const { run } = autoRun(4, 'dwarves', 3)
    expect(run.status).toBe('lost')
  })

  it('picks a race by the seed, and refuses a battle', () => {
    expect(autopilot(newRun(0))).toEqual({ kind: 'pick_race', race: PLAYABLE_SPECIES[0]?.id })
    expect(autopilot(newRun(1))).toEqual({ kind: 'pick_race', race: PLAYABLE_SPECIES[1]?.id })
    let run = reduceRun(newRun(5), { kind: 'pick_race', race: 'treefolk' })
    while (run.pending.kind !== 'battle') run = reduceRun(run, autopilot(run))
    expect(() => autopilot(run)).toThrow(/a battle is played/)
  })

  it('takes a dragon while short of two, then the heaviest unit', () => {
    const run = reduceRun(newRun(5), { kind: 'pick_race', race: 'treefolk' })
    const offers = [
      { kind: 'unit', id: 'treefolk.oak' },
      { kind: 'unit', id: 'treefolk.darktree' },
      { kind: 'unit', id: 'treefolk.oakling' },
      { kind: 'dragon', id: 'water_wyrm' },
      { kind: 'terrain', id: 'swampland_city' },
    ] as const
    const reward: RunState = { ...run, pending: { kind: 'reward', offers } }
    expect(autopilot(reward)).toEqual({ kind: 'take_offer', index: 3 })
    const twoDragons = { ...reward, collection: { ...run.collection, dragons: { water_wyrm: 1, earth_drake: 1 } } }
    expect(autopilot(twoDragons)).toEqual({ kind: 'take_offer', index: 1 })
  })

  it('upgrades a medium before a small, and skips when nothing can be', () => {
    const run = reduceRun(newRun(5), { kind: 'pick_race', race: 'treefolk' })
    const encounter = { id: 'x', act: 1 as const, kind: 'event' as const, name: 'X' }
    const event = (upgradable: string[]): RunState => ({
      ...run,
      pending: { kind: 'event', encounter, upgradable, transformable: upgradable },
    })
    expect(autopilot(event(['treefolk.oakling', 'treefolk.oak']))).toEqual({ kind: 'upgrade', unit: 'treefolk.oak' })
    expect(autopilot(event(['treefolk.oakling']))).toEqual({ kind: 'upgrade', unit: 'treefolk.oakling' })
    expect(autopilot(event([]))).toEqual({ kind: 'skip' })
  })
})

describe('suggestForce', () => {
  const base = reduceRun(newRun(8), { kind: 'pick_race', race: 'treefolk' })

  it('fields the opening whole, keeping its terrains and dragon', () => {
    const force = suggestForce(base, 12)
    expect(force).not.toBeNull()
    expect(forceHealth(force!)).toBe(12)
    expect(force?.homeTerrain).toBe(base.force.homeTerrain)
    expect(force?.frontierProposal).toBe(base.force.frontierProposal)
    expect(force?.dragons).toEqual(base.force.dragons)
  })

  it('sits a monster out when it would be over half the force', () => {
    const run: RunState = {
      ...base,
      collection: {
        ...base.collection,
        units: { 'treefolk.darktree': 1, 'treefolk.oakling': 1, 'treefolk.pineling': 1, 'treefolk.nymph': 1 },
      },
    }
    // 4 + 1 + 1 + 1 = 7, half 3: the Darktree cannot stand in any army.
    const force = suggestForce(run, 12)
    expect(PRESET_ARMY_NAMES.flatMap((a) => force?.armies[a] ?? []).sort()).toEqual([
      'treefolk.nymph',
      'treefolk.oakling',
      'treefolk.pineling',
    ])
  })

  it('stays under the cap, and fills up to it from a bigger pool', () => {
    const run: RunState = { ...base, collection: { ...base.collection, units: { ...base.collection.units, 'treefolk.darktree': 2 } } }
    const force = suggestForce(run, 12)
    expect(forceHealth(force!)).toBe(12)
    expect(unfieldedHealth({ ...run, force: force! })).toBe(8)
    expect(PRESET_ARMY_NAMES.flatMap((a) => force!.armies[a]).some((id) => unitType(id).health === 4)).toBe(true)
  })

  it('cannot make a force of fewer than three dice', () => {
    const run: RunState = { ...base, collection: { ...base.collection, units: { 'treefolk.oak': 2 } } }
    expect(suggestForce(run, 12)).toBeNull()
  })
})
