import { describe, expect, it } from 'vitest'

import { unitType, unitsOfSpecies } from '../data/load'
import { PRESET_ARMY_NAMES, maxArmyHealth } from '../data/presets'

import { FORCE_SIZES, drawForce, generateForces, repairSplit, splitForce } from './force'
import { rngFrom } from './rng'
import { setupGame, STARTER_FORCES } from './setup'
import { TERRAIN_SLOTS, armyAt, unitsOf, type PlayerId } from './types'
import { validateState } from './validate'

const PLAYERS: readonly PlayerId[] = ['p1', 'p2']

const healthOf = (ids: readonly string[]) => ids.reduce((sum, id) => sum + unitType(id).health, 0)
const unitHealth = (units: readonly { typeId: string }[]) =>
  units.reduce((sum, u) => sum + unitType(u.typeId).health, 0)

describe('drawForce', () => {
  it('lands exactly on the budget, never over and never short', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const budget of FORCE_SIZES) {
        const [ids] = drawForce('treefolk', budget, rngFrom(seed))
        expect(healthOf(ids), `seed ${seed} budget ${budget}`).toBe(budget)
      }
    }
  })

  it('draws only from its own species', () => {
    const own = new Set(unitsOfSpecies('firewalkers').map((u) => u.id))
    const [ids] = drawForce('firewalkers', 36, rngFrom(9))
    expect(ids.every((id) => own.has(id))).toBe(true)
  })

  /**
   * The point of rolling a force at all. The two hand-authored lists field one
   * monster each, which is what capped SAI coverage at 10 of 25; a drawn force
   * reaches all 20 dice of its species, so the rest turn up on their own.
   */
  it('reaches dice the starter lists never field, monsters included', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 100; seed++) {
      for (const id of drawForce('treefolk', 36, rngFrom(seed))[0]) seen.add(id)
    }
    expect(seen.size).toBe(unitsOfSpecies('treefolk').length)
    const monsters = unitsOfSpecies('treefolk').filter((u) => u.size === 'monster')
    expect(monsters.every((m) => seen.has(m.id))).toBe(true)
  })

  it('is reproducible from its seed', () => {
    expect(drawForce('treefolk', 24, rngFrom(77))).toEqual(drawForce('treefolk', 24, rngFrom(77)))
  })
})

describe('splitForce', () => {
  it('never leaves an army empty or over half the force', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const [ids] = drawForce(seed % 2 === 0 ? 'treefolk' : 'firewalkers', 24, rngFrom(seed))
      const [armies] = splitForce(ids, rngFrom(seed * 3))
      const cap = maxArmyHealth(healthOf(ids))

      for (const name of PRESET_ARMY_NAMES) {
        expect(armies[name].length, `seed ${seed} ${name}`).toBeGreaterThan(0)
        expect(healthOf(armies[name]), `seed ${seed} ${name}`).toBeLessThanOrEqual(cap)
      }
      expect(healthOf(PRESET_ARMY_NAMES.flatMap((n) => [...armies[n]]))).toBe(healthOf(ids))
    }
  })

  it('deals every die exactly once', () => {
    const [ids] = drawForce('treefolk', 36, rngFrom(5))
    const [armies] = splitForce(ids, rngFrom(5))
    const dealt = PRESET_ARMY_NAMES.flatMap((n) => [...armies[n]])
    expect([...dealt].sort()).toEqual([...ids].sort())
  })

  /**
   * The fallback is what makes `splitForce` terminate rather than spin, so it is
   * worth knowing it always produces a legal split -- for every force the draw can
   * produce, not just the ones the retry happens to hand it.
   */
  it('always repairs to a legal split, whatever it is given', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const budget of FORCE_SIZES) {
        const [ids] = drawForce('firewalkers', budget, rngFrom(seed))
        const armies = repairSplit(ids)
        const cap = maxArmyHealth(budget)
        for (const name of PRESET_ARMY_NAMES) {
          expect(armies[name].length, `seed ${seed} ${name}`).toBeGreaterThan(0)
          expect(healthOf(armies[name]), `seed ${seed} ${name}`).toBeLessThanOrEqual(cap)
        }
      }
    }
  })

  it('repairs the hardest case there is: nothing but monsters', () => {
    const armies = repairSplit(Array<string>(6).fill('treefolk.darktree'))
    for (const name of PRESET_ARMY_NAMES) {
      expect(armies[name].length).toBe(2)
      expect(healthOf(armies[name])).toBe(8)
    }
  })
})

describe('generateForces', () => {
  it('gives the two players different species', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const [forces] = generateForces(rngFrom(seed))
      expect(forces.p1.species, `seed ${seed}`).not.toBe(forces.p2.species)
    }
  })

  it('reaches both race assignments', () => {
    const firsts = new Set<string>()
    for (let seed = 1; seed <= 50; seed++) firsts.add(generateForces(rngFrom(seed))[0].p1.species)
    expect(firsts.size).toBe(2)
  })

  it('gives both players the same size, and only ever a legal one', () => {
    const sizes = new Set<number>()
    for (let seed = 1; seed <= 200; seed++) {
      const [forces] = generateForces(rngFrom(seed))
      const p1 = healthOf(PRESET_ARMY_NAMES.flatMap((n) => [...forces.p1.armies[n]]))
      const p2 = healthOf(PRESET_ARMY_NAMES.flatMap((n) => [...forces.p2.armies[n]]))
      expect(p1, `seed ${seed}`).toBe(p2)
      expect(FORCE_SIZES, `seed ${seed}`).toContain(p1)
      sizes.add(p1)
    }
    // Both sizes turn up, or the draw is not really drawing.
    expect([...sizes].sort((a, b) => a - b)).toEqual([...FORCE_SIZES])
  })
})

describe('a game set up from nothing but a seed', () => {
  it('is legal, every time, across 1000 seeds', () => {
    const frontiers = new Set<string>()
    const sizes = new Set<number>()

    for (let seed = 1; seed <= 1000; seed++) {
      const state = setupGame({ seed, forces: { kind: 'random' } })
      const problems = validateState(state)
      expect(problems, `seed ${seed}`).toEqual([])

      for (const player of PLAYERS) {
        const total = unitHealth(unitsOf(state, player))
        expect(FORCE_SIZES, `seed ${seed} ${player}`).toContain(total)
        sizes.add(total)

        const cap = maxArmyHealth(total)
        for (const slot of TERRAIN_SLOTS) {
          const army = armyAt(state, player, slot)
          expect(army.length, `seed ${seed} ${player} ${slot}`).toBeGreaterThan(0)
          expect(unitHealth(army), `seed ${seed} ${player} ${slot}`).toBeLessThanOrEqual(cap)
        }
      }

      expect(unitHealth(unitsOf(state, 'p1')), `seed ${seed}`).toBe(
        unitHealth(unitsOf(state, 'p2')),
      )
      frontiers.add(state.terrains.frontier.dieId)
    }

    expect([...sizes].sort((a, b) => a - b)).toEqual([...FORCE_SIZES])
    // The Frontier is no longer a constant: both species' second terrains turn up,
    // depending on who lost the roll-off.
    expect(frontiers.size).toBe(2)
  })

  it('reproduces itself exactly from the same seed', () => {
    for (const seed of [3, 44, 512]) {
      expect(setupGame({ seed, forces: { kind: 'random' } })).toEqual(
        setupGame({ seed, forces: { kind: 'random' } }),
      )
    }
  })

  it('gives different seeds different games', () => {
    const a = setupGame({ seed: 1, forces: { kind: 'random' } })
    const b = setupGame({ seed: 2, forces: { kind: 'random' } })
    expect(Object.keys(a.units).sort()).not.toEqual(Object.keys(b.units).sort())
  })

  /**
   * The rule that keeps the golden corpus meaningful: a named force must not
   * advance the RNG before the roll-off, or every recorded game lands on a
   * different board than it was recorded on.
   */
  it('consumes no generation draws when the forces are named', () => {
    const named = setupGame({ seed: 8, forces: STARTER_FORCES })
    const pinned = setupGame({
      seed: 8,
      forces: STARTER_FORCES,
      terrains: { frontier: 'highland_tower' },
    })
    // The roll-off is the first thing to draw, so both of these agree with a state
    // whose only randomness is the roll-off and three terrain faces.
    expect(named.rng.counter).toBe(pinned.rng.counter)
    expect(named.log.some((e) => e.kind === 'forces_drawn')).toBe(false)
    expect(Object.keys(named.units)).toHaveLength(28)
  })

  it('says in the log what it rolled', () => {
    const state = setupGame({ seed: 12, forces: { kind: 'random' } })
    const entry = state.log.find((e) => e.kind === 'forces_drawn')
    expect(entry).toBeDefined()
    if (entry?.kind !== 'forces_drawn') throw new Error('unreachable')

    expect(FORCE_SIZES).toContain(entry.health)
    expect(entry.species.p1).not.toBe(entry.species.p2)
    for (const player of PLAYERS) {
      expect(entry.dice[player]).toBe(unitsOf(state, player).length)
    }
  })
})
