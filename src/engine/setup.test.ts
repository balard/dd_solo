import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'
import { PRESETS, preset } from '../data/presets'

import { reduce } from './reduce'
import { rngFrom } from './rng'
import { rollStartingFace, setupGame, type SetupOptions } from './setup'
import {
  IllegalActionError,
  TERRAIN_SLOTS,
  armyAt,
  capturedCount,
  deadUnits,
  livingUnits,
  reserveArmy,
  unitsOf,
  type GameState,
  type PlayerId,
} from './types'
import { validateState } from './validate'

const OPTIONS: SetupOptions = {
  seed: 1234,
  forces: { p1: 'treefolk_starter', p2: 'firewalkers_starter' },
  firstPlayer: 'p1',
}

const healthOf = (units: readonly { typeId: string }[]) =>
  units.reduce((sum, u) => sum + unitType(u.typeId).health, 0)

describe('presets', () => {
  it('loads both starter forces', () => {
    expect(PRESETS.map((p) => p.id).sort()).toEqual([
      'firewalkers_starter',
      'treefolk_starter',
    ])
  })

  it('gives each force 30 health', () => {
    for (const p of PRESETS) {
      const total = Object.values(p.armies)
        .flat()
        .reduce((sum, id) => sum + unitType(id).health, 0)
      expect(total, p.id).toBe(30)
    }
  })

  it('keeps every starting army within the 15-health setup cap', () => {
    for (const p of PRESETS) {
      for (const [name, ids] of Object.entries(p.armies)) {
        const health = ids.reduce((sum, id) => sum + unitType(id).health, 0)
        expect(health, `${p.id} ${name}`).toBeLessThanOrEqual(15)
        expect(ids.length, `${p.id} ${name}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('rollStartingFace', () => {
  it('only ever produces 1-6', () => {
    let rng = rngFrom(99)
    for (let i = 0; i < 3000; i++) {
      const [face, next] = rollStartingFace(rng)
      expect(face).toBeGreaterThanOrEqual(1)
      expect(face).toBeLessThanOrEqual(6)
      rng = next
    }
  })

  it('reaches 6 more often than any other face, because 7 folds down onto it', () => {
    let rng = rngFrom(4242)
    const counts = new Map<number, number>()
    for (let i = 0; i < 12_000; i++) {
      const [face, next] = rollStartingFace(rng)
      counts.set(face, (counts.get(face) ?? 0) + 1)
      rng = next
    }
    const sixes = counts.get(6) ?? 0
    for (const face of [1, 2, 3, 4, 5]) {
      expect(sixes, `6 vs ${face}`).toBeGreaterThan(counts.get(face) ?? 0)
    }
  })
})

describe('setupGame', () => {
  const state = setupGame(OPTIONS)

  it('produces a valid state', () => {
    expect(validateState(state)).toEqual([])
  })

  it('places 60 health of units, 30 a side', () => {
    expect(Object.keys(state.units)).toHaveLength(28) // 14 dice a side
    for (const player of ['p1', 'p2'] as PlayerId[]) {
      expect(healthOf(unitsOf(state, player)), player).toBe(30)
    }
  })

  it('starts every unit on a terrain, none in reserve or dead', () => {
    for (const player of ['p1', 'p2'] as PlayerId[]) {
      expect(reserveArmy(state, player)).toEqual([])
      expect(deadUnits(state, player)).toEqual([])
      expect(livingUnits(state, player)).toHaveLength(unitsOf(state, player).length)
    }
  })

  it('deploys Home at your terrain, Campaign at the Frontier, Horde at the enemy terrain', () => {
    const p1 = preset('treefolk_starter')
    expect(healthOf(armyAt(state, 'p1', 'p1_home'))).toBe(
      p1.armies.home.reduce((s, id) => s + unitType(id).health, 0),
    )
    expect(healthOf(armyAt(state, 'p1', 'frontier'))).toBe(
      p1.armies.campaign.reduce((s, id) => s + unitType(id).health, 0),
    )
    expect(healthOf(armyAt(state, 'p1', 'p2_home'))).toBe(
      p1.armies.horde.reduce((s, id) => s + unitType(id).health, 0),
    )
  })

  it('puts both sides at every terrain, since Horde meets Home', () => {
    for (const slot of TERRAIN_SLOTS) {
      expect(armyAt(state, 'p1', slot).length, slot).toBeGreaterThan(0)
      expect(armyAt(state, 'p2', slot).length, slot).toBeGreaterThan(0)
    }
  })

  it('uses each home terrain from its own preset, plus the agreed Frontier', () => {
    expect(state.terrains.p1_home.dieId).toBe('swampland_tower')
    expect(state.terrains.p2_home.dieId).toBe('wasteland_tower')
    expect(state.terrains.frontier.dieId).toBe('highland_tower')
  })

  it('starts every terrain on a face between 1 and 6, uncaptured', () => {
    for (const slot of TERRAIN_SLOTS) {
      const terrain = state.terrains[slot]
      expect(terrain.face, slot).toBeGreaterThanOrEqual(1)
      expect(terrain.face, slot).toBeLessThanOrEqual(6)
      expect(terrain.capturedBy, slot).toBeNull()
    }
    expect(capturedCount(state, 'p1')).toBe(0)
    expect(capturedCount(state, 'p2')).toBe(0)
  })

  it('gives the first march to the chosen player', () => {
    expect(state.turn.marching).toBe('p1')
    expect(setupGame({ ...OPTIONS, firstPlayer: 'p2' }).turn.marching).toBe('p2')
    expect(state.turn.armiesMarched).toEqual([])
    expect(state.winner).toBeNull()
  })

  // The determinism guarantee everything downstream rests on: save/load, undo,
  // reproducible bug reports, and the Phase 6 fuzz harness.
  it('is reproducible from its seed', () => {
    expect(setupGame(OPTIONS)).toEqual(setupGame(OPTIONS))
  })

  it('gives different seeds different opening terrain faces', () => {
    const faces = (seed: number) =>
      TERRAIN_SLOTS.map((slot) => setupGame({ ...OPTIONS, seed }).terrains[slot].face).join(',')
    const distinct = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(faces))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('records the opening in the log', () => {
    expect(state.log[0]).toEqual({ kind: 'game_start', seed: 1234, firstPlayer: 'p1' })
    expect(state.log.filter((e) => e.kind === 'terrain_placed')).toHaveLength(3)
  })

  it('rejects an unknown preset', () => {
    expect(() => setupGame({ ...OPTIONS, forces: { p1: 'nope', p2: 'nope' } })).toThrow()
  })
})

describe('order of play', () => {
  const rolled = (seed: number) =>
    setupGame({ seed, forces: { p1: 'treefolk_starter', p2: 'firewalkers_starter' } })

  it('decides the first player by the Horde roll-off when none is given', () => {
    const state = rolled(7)
    const entry = state.log.find((e) => e.kind === 'order_of_play')
    expect(entry).toBeDefined()
    if (entry?.kind !== 'order_of_play') throw new Error('unreachable')
    expect(entry.firstPlayer).toBe(state.turn.marching)
    expect(entry.rolls.p1).not.toBe(entry.rolls.p2)
    expect(entry.firstPlayer).toBe(entry.rolls.p1 > entry.rolls.p2 ? 'p1' : 'p2')
  })

  it('still produces a valid state', () => {
    expect(validateState(rolled(7))).toEqual([])
  })

  it('lets either side win across seeds', () => {
    const winners = new Set(
      Array.from({ length: 40 }, (_, i) => rolled(i + 1).turn.marching),
    )
    expect(winners).toEqual(new Set(['p1', 'p2']))
  })

  it('skips the roll-off entirely when a first player is given', () => {
    const state = setupGame(OPTIONS)
    expect(state.log.some((e) => e.kind === 'order_of_play')).toBe(false)
  })

  it('stays reproducible with the roll-off in the stream', () => {
    expect(rolled(21)).toEqual(rolled(21))
  })
})

describe('validateState', () => {
  const state = setupGame(OPTIONS)

  it('accepts a freshly set up game', () => {
    expect(validateState(state)).toEqual([])
  })

  it('catches a terrain captured without being on face 8', () => {
    const broken: GameState = {
      ...state,
      terrains: { ...state.terrains, frontier: { ...state.terrains.frontier, capturedBy: 'p1' } },
    }
    expect(validateState(broken).join()).toMatch(/captured by p1 but on face/)
  })

  it('catches face 8 with nobody holding it', () => {
    const broken: GameState = {
      ...state,
      terrains: { ...state.terrains, frontier: { ...state.terrains.frontier, face: 8 } },
    }
    expect(validateState(broken).join()).toMatch(/on face 8 but nobody has captured it/)
  })

  it('catches two captures without a winner', () => {
    const broken: GameState = {
      ...state,
      terrains: {
        ...state.terrains,
        frontier: { ...state.terrains.frontier, face: 8, capturedBy: 'p1' },
        p2_home: { ...state.terrains.p2_home, face: 8, capturedBy: 'p1' },
      },
    }
    expect(validateState(broken).join()).toMatch(/holds 2 terrains but is not recorded as the winner/)
  })

  it('catches an unknown unit type', () => {
    const first = Object.values(state.units)[0]!
    const broken: GameState = {
      ...state,
      units: { ...state.units, [first.id]: { ...first, typeId: 'treefolk.ent' } },
    }
    expect(validateState(broken).join()).toMatch(/unknown unit type treefolk\.ent/)
  })

  it('catches the same army marching twice', () => {
    const broken: GameState = {
      ...state,
      turn: { ...state.turn, armiesMarched: ['frontier', 'frontier'] },
    }
    expect(validateState(broken).join()).toMatch(/each march needs a different army/)
  })
})

describe('reduce', () => {
  const state = setupGame(OPTIONS)

  it('rejects an action when nothing is pending', () => {
    expect(() => reduce(state, { kind: 'choose_maneuver', maneuver: true })).toThrow(
      IllegalActionError,
    )
  })

  it('rejects an action that answers a different decision', () => {
    const waiting: GameState = {
      ...state,
      pending: { kind: 'choose_maneuver', player: 'p1', slot: 'frontier' },
    }
    expect(() => reduce(waiting, { kind: 'contest_maneuver', contest: true })).toThrow(
      /waiting for choose_maneuver/,
    )
  })

  it('rejects any action once the game is over', () => {
    const finished: GameState = { ...state, winner: 'p1', turn: { ...state.turn, phase: 'game_over' } }
    expect(() => reduce(finished, { kind: 'choose_maneuver', maneuver: true })).toThrow(
      /the game is over/,
    )
  })

  it('does not mutate the state it is given', () => {
    const before = JSON.stringify(state)
    try {
      reduce(state, { kind: 'choose_maneuver', maneuver: true })
    } catch {
      /* expected */
    }
    expect(JSON.stringify(state)).toBe(before)
  })
})
