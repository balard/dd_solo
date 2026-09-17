import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'

import type { RollEffect } from './pipeline'
import { advance } from './reduce'
import { rollDice, type RngState } from './rng'
import { targetTasks } from './targeting'
import { applyAction } from './turn'
import {
  IllegalActionError,
  V0_RULES,
  type GameState,
  type RuleSet,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from './types'
import { validateState } from './validate'

const FULL_RULES: RuleSet = { ...V0_RULES, sai: 'full' }

/** Gorgon faces 1 and 7 are both `2 SAI:Flame`; the die is 4 health. */
const FLAME_FACES = [1, 7]

const flame = (unitId: string, health = 2): RollEffect => ({
  kind: 'target_enemy',
  health,
  escape: 'none',
  fate: 'bury',
  unitId,
  sai: 'Flame',
})

const smother = (unitId: string, health = 2): RollEffect => ({
  kind: 'target_enemy',
  health,
  escape: 'maneuver',
  fate: 'kill',
  unitId,
  sai: 'Smother',
})

/** The RNG counter at which these dice show these faces. */
function rngShowing(typeIds: readonly string[], faces: readonly number[]): RngState {
  const counts = typeIds.map((id) => unitType(id).faces.length)
  for (let counter = 0; counter < 2_000_000; counter += 1) {
    const [indices] = rollDice({ seed: 1, counter }, counts)
    if (faces.every((face, i) => indices[i] === face)) return { seed: 1, counter }
  }
  throw new Error(`no counter shows ${typeIds.join(', ')} on faces ${faces.join(', ')}`)
}

/** A board with the named dice standing where they are put, mid-melee at the Frontier. */
function stage(options: {
  readonly attackers: readonly string[]
  readonly defenders: readonly string[]
  readonly rng: RngState
}): GameState {
  const units: Record<UnitId, UnitInstance> = {}
  const place = (owner: 'p1' | 'p2', typeIds: readonly string[]) =>
    typeIds.forEach((typeId, i) => {
      const id = `${owner}:${i}`
      units[id] = { id, typeId, owner, location: { kind: 'terrain', slot: 'frontier' } }
    })
  place('p1', options.attackers)
  place('p2', options.defenders)

  const terrain = (slot: TerrainSlot) =>
    ({ slot, dieId: 'highland_tower', face: 6 as const, capturedBy: null })

  return {
    ruleSet: { ...FULL_RULES, dua: 'active' },
    rng: options.rng,
    units,
    effects: [],
    terrains: {
      p1_home: terrain('p1_home'),
      frontier: terrain('frontier'),
      p2_home: terrain('p2_home'),
    },
    turn: {
      marching: 'p1',
      phase: 'march',
      marchIndex: 0,
      marchStep: 'resolve_attack',
      marchingArmy: 'frontier',
      armiesMarched: ['frontier'],
      combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
    },
    pending: null,
    log: [],
    winner: null,
  }
}

// --- the order and combination rules -----------------------------------------

describe('targetTasks', () => {
  it('ignores every effect that is not a targeting one', () => {
    const effects: readonly RollEffect[] = [
      { kind: 'unsavable', damage: 4, unitId: 'a', sai: 'Smite' },
      { kind: 'riposte', damage: 4, unitId: 'b', sai: 'Counter' },
      { kind: 'suppress_counter', unitId: 'c', sai: 'Surprise' },
    ]
    expect(targetTasks(effects)).toEqual([])
  })

  /**
   * "Multiples of the same SAI may be combined to create a single larger effect"
   * (p. 27), and v1 always does -- see the house rule in `targeting.ts`. This is the
   * case that shows why it matters rather than being tidier: two Flames of two
   * health-worth can take nothing from a 3-health die, and one Flame of four takes it.
   */
  it('sums two dice of the same SAI into one larger effect', () => {
    expect(targetTasks([flame('a'), flame('b')])).toEqual([
      { kind: 'enemy', sai: 'Flame', health: 4, escape: 'none', fate: 'bury' },
    ])
  })

  it('keeps different SAIs apart, in roll order', () => {
    const other = smother('b')
    expect(targetTasks([flame('a'), other, flame('c')]).map((t) => [t.sai, t.health])).toEqual([
      ['Flame', 4],
      ['Smother', 2],
    ])
  })

  it('orders by first appearance, which is the order the dice were rolled', () => {
    const other = smother('a')
    expect(targetTasks([other, flame('b')]).map((t) => t.sai)).toEqual(['Smother', 'Flame'])
  })
})

// --- Flame, end to end --------------------------------------------------------

describe('Flame', () => {
  /**
   * `2 SAI:Flame` is a *budget*, not a result count, and against an army of monsters
   * two health-worth can take nothing at all -- no die is small enough. So no decision
   * is raised, the same way damage too small to kill is dropped rather than asked
   * about (`RULES-V0.md` section 6).
   *
   * This is the test that fails if the face count is ever read as "four results,
   * because it is a monster face": a budget of 4 would take a Gorgon.
   */
  it('raises no decision when nothing is small enough to take', () => {
    const state = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['firewalkers.gorgon', 'firewalkers.gorgon'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )

    expect(state.pending?.kind).not.toBe('sai_target')
    expect(state.log.some((e) => e.kind === 'sai_resolved')).toBe(false)
    // Every defender is still standing: nothing was taken, and nothing was buried.
    expect(Object.values(state.units).filter((u) => u.location.kind === 'bua')).toEqual([])
  })

  it('asks the attacker, about the defending army', () => {
    const state = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['treefolk.oak', 'treefolk.oakling'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )

    expect(state.pending).toEqual({
      kind: 'sai_target',
      // The roller chooses -- the first pending in the game addressed to someone
      // other than the owner of the dice at stake.
      player: 'p1',
      sai: 'Flame',
      target: 'p2',
      slot: 'frontier',
      budget: 2,
    })
  })

  it('kills and buries what it takes, and says so in that order', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['treefolk.oak', 'treefolk.oakling'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )
    // Two health-worth, maximally: the Oak exactly, never the 1-health Oakling.
    const oak = Object.values(start.units).find((u) => u.typeId === 'treefolk.oak')!
    const done = applyAction(start, { kind: 'sai_target', unitIds: [oak.id] })

    expect(done.units[oak.id]?.location).toEqual({ kind: 'bua' })
    expect(done.log.map((e) => e.kind).filter((k) => k.startsWith('sai_') || k.startsWith('units_')))
      .toEqual(['sai_resolved', 'units_killed', 'units_buried'])
    expect(validateState(done)).toEqual([])
  })

  it('refuses a selection that is not maximal', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['treefolk.oak', 'treefolk.oakling'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )
    const oakling = Object.values(start.units).find((u) => u.typeId === 'treefolk.oakling')!

    // One health-worth when two is available: p. 32 forces the maximum.
    expect(() => applyAction(start, { kind: 'sai_target', unitIds: [oakling.id] })).toThrow(
      IllegalActionError,
    )
  })

  /**
   * Two Flame dice make one budget of four, which is the only way a Flame reaches a
   * monster -- and the monster it reaches here is the one die in the game that can
   * answer back.
   *
   * **This is the `killAndBury` test.** "The targets are killed and buried" is two
   * steps because a live unit passes through the DUA on its way to the BUA, and a
   * Phoenix "may roll once when killed and again when buried". So the draw count is
   * the evidence: two draws and it is buried, one draw and it rose before the burial
   * could happen. A short-cut straight to the BUA would take one draw and always
   * bury, and nothing but this would notice.
   */
  it('gives a Flamed Phoenix both of its rolls', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.gorgon', 'firewalkers.gorgon'],
        defenders: ['firewalkers.phoenix'],
        rng: rngShowing(['firewalkers.gorgon', 'firewalkers.gorgon'], FLAME_FACES),
      }),
    )

    expect(start.pending).toMatchObject({ kind: 'sai_target', sai: 'Flame', budget: 4 })

    const phoenix = Object.values(start.units).find((u) => u.typeId === 'firewalkers.phoenix')!
    const before = start.rng.counter
    const done = applyAction(start, { kind: 'sai_target', unitIds: [phoenix.id] })
    const draws = done.rng.counter - before

    if (done.units[phoenix.id]?.location.kind === 'bua') {
      expect(draws, 'buried: it failed to rise on death and again on burial').toBe(2)
      expect(done.log.some((e) => e.kind === 'units_buried')).toBe(true)
    } else {
      expect(done.units[phoenix.id]?.location).toEqual({ kind: 'reserve' })
      expect(draws, 'risen: the first roll saved it, so there was no burial').toBe(1)
      expect(done.log.some((e) => e.kind === 'units_buried')).toBe(false)
    }
  })

  it('wins the game outright when it takes the last defender', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['treefolk.oak'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )
    const oak = Object.values(start.units).find((u) => u.typeId === 'treefolk.oak')!
    const done = advance(applyAction(start, { kind: 'sai_target', unitIds: [oak.id] }))

    expect(done.winner).toBe('p1')
    // The save roll never happened: there was nobody left to make it.
    expect(done.log.some((e) => e.kind === 'combat_resolved')).toBe(false)
  })

  /** Under the rung Phase 1 shipped, Flame is still just an inert face. */
  it('does nothing at all under sai: results', () => {
    const base = stage({
      attackers: ['firewalkers.gorgon'],
      defenders: ['treefolk.oak', 'treefolk.oakling'],
      rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
    })
    const state = advance({ ...base, ruleSet: { ...base.ruleSet, sai: 'results' } })

    expect(state.pending?.kind).not.toBe('sai_target')
    expect(Object.values(state.units).filter((u) => u.location.kind === 'bua')).toEqual([])
  })
})
