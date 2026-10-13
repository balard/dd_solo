/**
 * The giving layer (v3 Phase 6): which die a reward or a boon gives, similar or general.
 */
import { describe, expect, it } from 'vitest'

import type { Collection } from '../data/collections'
import { DRAGON_DICE, dragonDie, speciesElements, terrainDie, terrainType, unitType } from '../data/load'
import { PLAYABLE_SPECIES, PLAYABLE_UNITS } from '../engine/playable'
import { nextInt, rngFrom, type RngState } from '../engine/rng'

import { drawFlavour, giveDie, poolHealth, similarChance } from './give'
import { newRun, reduceRun } from './reduce'
import type { Flavour, GiftKind } from './types'

const pool = (units: Readonly<Record<string, number>>, dragons: Readonly<Record<string, number>> = { fire_drake: 1 }): Collection => ({
  id: 'test',
  name: 'Test',
  units,
  dragons,
  terrains: {},
})

/** `n` dice of `kind` from `collection`, one per seed. */
function many(kind: GiftKind, flavour: Flavour, collection: Collection, n = 300, taken: readonly string[] = []): string[] {
  return Array.from({ length: n }, (_, seed) => giveDie(kind, 1, collection, rngFrom(seed + 1), { forced: flavour, taken })[0].id)
}

const elementsOf = (unitId: string) => speciesElements(unitType(unitId).species)

describe('similar or general', () => {
  it('goes by the pool\'s health, in three bands', () => {
    expect([12, 24, 25, 36, 37, 90].map(similarChance)).toEqual([99, 99, 90, 90, 70, 70])
  })

  it('is one draw out of a hundred', () => {
    const treefolk = pool({ 'treefolk.oak_lord': 4 }) // 12 health: 99 in 100
    const [roll, after] = nextInt(rngFrom(3), 100)
    expect(drawFlavour(treefolk, rngFrom(3))).toEqual([roll < 99 ? 'similar' : 'general', after])
  })

  it('counts every unit the pool owns, fielded or not', () => {
    expect(poolHealth(pool({ 'treefolk.oak_lord': 2, 'treefolk.oakling': 3 }))).toBe(2 * 3 + 3 * 1)
  })

  it('draws a flavour unless one is forced, and a forced one draws nothing for it', () => {
    const treefolk = pool({ 'treefolk.oak': 1 })
    const [forced, afterForced] = giveDie('medium', 1, treefolk, rngFrom(5), { forced: 'general' })
    expect(forced.flavour).toBe('general')
    // A general unit is two draws, its 7-in-10 and the die; unforced, the flavour is a third.
    expect(afterForced.counter).toBe(rngFrom(5).counter + 2)
    expect(giveDie('medium', 1, treefolk, rngFrom(5))[1].counter).toBe(rngFrom(5).counter + 3)
  })
})

describe('a unit', () => {
  it('similar: picks a copy of the pool, then a die of its species and the size asked for', () => {
    const mixed = pool({ 'treefolk.oak': 3, 'goblins.thug': 1 })
    const dice = many('large', 'similar', mixed)
    for (const id of dice) {
      expect(unitType(id).size).toBe('large')
      expect(['treefolk', 'goblins']).toContain(unitType(id).species)
    }
    // Per copy: three Oaks weigh three times one Thug.
    const treefolk = dice.filter((id) => unitType(id).species === 'treefolk').length / dice.length
    expect(treefolk).toBeGreaterThan(0.65)
    expect(treefolk).toBeLessThan(0.85)
  })

  it('pins its order: flavour, the copy, then the die', () => {
    const treefolk = pool({ 'treefolk.oak': 1, 'treefolk.pine': 1 })
    let rng: RngState = rngFrom(11)
    let i: number
    ;[i, rng] = nextInt(rng, 100)
    expect(i).toBeLessThan(99) // this seed is similar
    ;[i, rng] = nextInt(rng, 2) // the copy: oak or pine, both Treefolk
    const monsters = PLAYABLE_UNITS.filter((u) => u.species === 'treefolk' && u.size === 'monster')
      .map((u) => u.id)
      .sort()
    ;[i, rng] = nextInt(rng, monsters.length)
    expect(giveDie('monster', 1, treefolk, rngFrom(11))).toEqual([
      { kind: 'unit', id: monsters[i], count: 1, flavour: 'similar' },
      rng,
    ])
  })

  it('general: shares an element with the pool seven times in ten, else any die of the size', () => {
    const treefolk = pool({ 'treefolk.oak': 1 }) // water and earth
    const dice = many('small', 'general', treefolk, 1000)
    for (const id of dice) expect(unitType(id).size).toBe('small')
    const sharing = dice.filter((id) => elementsOf(id).some((e) => e === 'water' || e === 'earth')).length / dice.length
    // 70% sharing outright, and some of the 30% "any" share by chance.
    expect(sharing).toBeGreaterThan(0.75)
    expect(dice.some((id) => !elementsOf(id).some((e) => e === 'water' || e === 'earth'))).toBe(true)
  })
})

describe('a dragon', () => {
  it('similar: of an element of a unit or dragon the pool holds', () => {
    const collection = pool({ 'treefolk.oak': 1 }, { fire_drake: 1 })
    for (const id of many('dragon', 'similar', collection)) {
      expect(['water', 'earth', 'fire']).toContain(dragonDie(id).element)
    }
  })

  it('general: of an element a pool dragon has, whatever the units are', () => {
    const collection = pool({ 'treefolk.oak': 1 }, { death_wyrm: 1 })
    for (const id of many('dragon', 'general', collection)) expect(dragonDie(id).element).toBe('death')
  })
})

describe('a terrain', () => {
  it('similar: carries an element of a unit the pool holds, and never draws on death', () => {
    const goblins = pool({ 'goblins.thug': 2 }) // death and earth: earth, always
    for (const id of many('terrain', 'similar', goblins)) {
      expect(terrainType(terrainDie(id).type).elements).toContain('earth')
    }
  })

  it('general: any terrain', () => {
    const goblins = pool({ 'goblins.thug': 2 })
    const dice = new Set(many('terrain', 'general', goblins, 1000))
    expect([...dice].some((id) => !terrainType(terrainDie(id).type).elements.includes('earth'))).toBe(true)
  })
})

describe('what is already offered', () => {
  it('is never offered again', () => {
    const collection = pool({ 'treefolk.oak': 1 }, { fire_drake: 1 })
    const taken = ['fire_wyrm', 'water_drake']
    for (const id of many('dragon', 'similar', collection, 300, taken)) expect(taken).not.toContain(id)
  })

  it('falls back to any die of the kind when the flavour has nothing left', () => {
    // One fire dragon: a general dragon is a fire drake or wyrm, and both are offered.
    const collection = pool({ 'treefolk.oak': 1 }, { fire_drake: 1 })
    const dice = many('dragon', 'general', collection, 100, ['fire_drake', 'fire_wyrm'])
    for (const id of dice) expect(['fire_drake', 'fire_wyrm']).not.toContain(id)
    expect(new Set(dice).size).toBe(DRAGON_DICE.length - 2)
  })

  it.each(PLAYABLE_SPECIES.map((s) => s.id))('gives a %s run three different dice of every kind a boon asks for', (race) => {
    const run = reduceRun(newRun(1), { kind: 'pick_race', race })
    for (const kind of ['dragon', 'terrain', 'monster'] as const) {
      const taken: string[] = []
      let rng = rngFrom(9)
      for (const flavour of ['similar', 'general', 'general'] as const) {
        const [grant, next] = giveDie(kind, 1, run.collection, rng, { forced: flavour, taken })
        rng = next
        taken.push(grant.id)
      }
      expect(new Set(taken).size).toBe(3)
    }
  })
})
