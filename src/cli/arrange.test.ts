/**
 * The terminal's force-arranging commands (v3 Phase 2), without a terminal.
 */
import { describe, expect, it } from 'vitest'

import { forceHealth } from '../engine/forceProblems'
import { newRun, reduceRun } from '../run/reduce'
import type { RunState } from '../run/types'

import { arrangeCommand, owned, spareUnits } from './arrange'

const opening = reduceRun(newRun(8), { kind: 'pick_race', race: 'treefolk' })
/** The opening pool with two Oaks more, so there is something spare to field. */
const run: RunState = {
  ...opening,
  collection: { ...opening.collection, units: { ...opening.collection.units, 'treefolk.oak': (opening.collection.units['treefolk.oak'] ?? 0) + 2 } },
}

const forceOf = (line: string, from: RunState = run) => {
  const reply = arrangeCommand(from, 24, line)
  if (reply.kind !== 'force') throw new Error(`${line}: ${JSON.stringify(reply)}`)
  return reply.force
}

describe('arrangeCommand', () => {
  it('lists only the copies the force does not field', () => {
    expect(spareUnits(opening)).toEqual([])
    expect(spareUnits(run)).toEqual(['treefolk.oak', 'treefolk.oak'])
  })

  it('fields a spare die in the army named, and takes one back', () => {
    const force = forceOf('1 c')
    expect(force.armies.campaign).toEqual([...run.force.armies.campaign, 'treefolk.oak'])
    expect(forceHealth(force)).toBe(14)
    const back = forceOf(`x c ${force.armies.campaign.length}`, { ...run, force })
    expect(back).toEqual(run.force)
    expect(forceOf('2 horde').armies.horde).toContain('treefolk.oak')
  })

  it('names terrains and toggles dragons by their owned numbers', () => {
    const terrains = owned(run, 'terrains')
    expect(forceOf('home t2').homeTerrain).toBe(terrains[1])
    expect(forceOf('front 1').frontierProposal).toBe(terrains[0])
    const without = forceOf('dragon d1')
    expect(without.dragons).toBeUndefined()
    expect(forceOf('dragon d1', { ...run, force: without }).dragons).toEqual(run.force.dragons)
  })

  it('fills the force with auto, and fights on ready or an empty line', () => {
    expect(forceHealth(forceOf('auto'))).toBe(16)
    expect(arrangeCommand(run, 24, '')).toEqual({ kind: 'ready' })
    expect(arrangeCommand(run, 24, 'ready')).toEqual({ kind: 'ready' })
    expect(arrangeCommand(run, 24, 'q')).toEqual({ kind: 'quit' })
  })

  it('says what is wrong with a line rather than guessing', () => {
    expect(arrangeCommand(run, 24, '1')).toEqual({ kind: 'problem', text: 'which army? 1 h, 1 c or 1 d' })
    expect(arrangeCommand(run, 24, '9 h').kind).toBe('problem')
    expect(arrangeCommand(run, 24, 'x z 1').kind).toBe('problem')
    expect(arrangeCommand(run, 24, 'x h 9')).toEqual({ kind: 'problem', text: 'the home army has no die 9' })
    expect(arrangeCommand(run, 24, 'home t9').kind).toBe('problem')
    expect(arrangeCommand(run, 24, 'dance').kind).toBe('problem')
  })
})
