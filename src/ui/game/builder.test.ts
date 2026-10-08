/**
 * The army builder's rules, without a DOM (v2 Phase 4) -- `newGame.test.ts`'s
 * arrangement.
 */
import { describe, expect, it } from 'vitest'

import { FULL_COLLECTION, collectionNamed, type Collection } from '../../data/collections'
import { preset } from '../../data/presets'
import type { BuiltForce } from '../../engine/force'

import {
  EMPTY_FORCE,
  addDragon,
  addUnit,
  armyLines,
  defaultCap,
  defaultForceName,
  ownedHealth,
  palette,
  removeDragon,
  removeUnit,
  setTerrain,
  terrainChoices,
  unitPalette,
} from './builder'

const sorry: Collection = (() => {
  const found = collectionNamed('sorry-12')
  if (found === null) throw new Error('sorry-12 is not loaded')
  return found
})()

const starter: BuiltForce = { armies: preset('treefolk_starter').armies }

/** A legal mixed 12 out of sorry-12: the force the exit criterion builds. */
const mixed12: BuiltForce = {
  armies: {
    home: ['treefolk.oak', 'firewalkers.guardian', 'treefolk.hamadryad'], // 4
    campaign: ['firewalkers.adventurer', 'treefolk.oakling', 'treefolk.nymph'], // 4
    horde: ['treefolk.oakling', 'firewalkers.explorer', 'firewalkers.sunburst', 'treefolk.pineling'], // 4
  },
  homeTerrain: 'swampland_city',
  frontierProposal: 'feyland_temple',
  dragons: ['earth_drake'],
}

describe('the draft', () => {
  it('adds and takes back dice by army, and leaves the others alone', () => {
    let force = addUnit(EMPTY_FORCE, 'home', 'treefolk.oak')
    force = addUnit(force, 'home', 'treefolk.pine')
    force = addUnit(force, 'horde', 'treefolk.oak')
    expect(force.armies).toEqual({ home: ['treefolk.oak', 'treefolk.pine'], campaign: [], horde: ['treefolk.oak'] })
    force = removeUnit(force, 'home', 0)
    expect(force.armies).toEqual({ home: ['treefolk.pine'], campaign: [], horde: ['treefolk.oak'] })
    // Pure: the empty force is still empty.
    expect(EMPTY_FORCE.armies.home).toEqual([])
  })

  /** Absent means drawn, as for setup: an emptied field is removed, not left blank. */
  it('removes a terrain or the dragons rather than leaving them empty', () => {
    const named = setTerrain(EMPTY_FORCE, 'homeTerrain', 'swampland_city')
    expect(named.homeTerrain).toBe('swampland_city')
    expect('homeTerrain' in setTerrain(named, 'homeTerrain', null)).toBe(false)

    const one = addDragon(EMPTY_FORCE, 'fire_drake')
    expect(one.dragons).toEqual(['fire_drake'])
    expect('dragons' in removeDragon(one, 0)).toBe(false)
    expect(removeDragon(addDragon(one, 'air_wyrm'), 0).dragons).toEqual(['air_wyrm'])
  })

  it('reads each army against half the force', () => {
    expect(armyLines(mixed12)).toEqual([
      { army: 'home', dice: 3, health: 4, half: 6 },
      { army: 'campaign', dice: 3, health: 4, half: 6 },
      { army: 'horde', dice: 4, health: 4, half: 6 },
    ])
  })

  it('opens a collection on the largest cap it can fill, and the full one on 24', () => {
    expect(ownedHealth(sorry)).toBe(14)
    expect(defaultCap(sorry)).toBe(12)
    expect(ownedHealth(FULL_COLLECTION)).toBe(Infinity)
    expect(defaultCap(FULL_COLLECTION)).toBe(24)
  })

  it('names a force by its species and size until somebody names it', () => {
    expect(defaultForceName(EMPTY_FORCE)).toBe('An empty force')
    expect(defaultForceName(starter)).toBe('Treefolk, 30 health')
    expect(defaultForceName(mixed12)).toBe('Treefolk and Firewalkers, 12 health')
  })
})

describe('the palette', () => {
  it('lists what the collection owns, with the copies left', () => {
    const groups = unitPalette(sorry, mixed12)
    expect(groups.map((g) => g.species)).toEqual(['treefolk', 'firewalkers'])
    const treefolk = groups[0]?.dice ?? []
    // Both Oaklings are in the force; the die stays listed, at none left.
    expect(treefolk.find((d) => d.id === 'treefolk.oakling')?.left).toBe(0)
    expect(treefolk.find((d) => d.id === 'treefolk.willowling')?.left).toBe(1)
    // Heavy melee first, heaviest first -- the board's order.
    expect(treefolk.map((d) => d.id).slice(0, 2)).toEqual(['treefolk.oak', 'treefolk.oakling'])
  })

  it('lists every die in the full collection, endlessly, monsters first', () => {
    const groups = unitPalette(FULL_COLLECTION, EMPTY_FORCE)
    expect(groups.flatMap((g) => g.dice)).toHaveLength(120)
    expect(groups.every((g) => g.dice.every((d) => d.left === Infinity))).toBe(true)
    expect(groups[0]?.dice.slice(0, 5).map((d) => d.id)).toEqual([
      'treefolk.darktree',
      'treefolk.redwood',
      'treefolk.satyr',
      'treefolk.strangle_vine',
      'treefolk.unicorn',
    ])
  })

  it('lists dragons and terrains in the data order', () => {
    expect(palette(sorry, mixed12, 'dragons')).toEqual([{ id: 'earth_drake', left: 0 }])
    expect(palette(sorry, mixed12, 'terrains').map((d) => [d.id, d.left])).toEqual([
      ['swampland_city', 0],
      ['wasteland_tower', 1],
      ['feyland_temple', 0],
    ])
  })

  /** Swapping a Home Terrain must not be refused because the old one is in use -- by
   *  the very field being changed. */
  it('counts the die a terrain field names as free for that field', () => {
    const home = terrainChoices(sorry, mixed12, 'homeTerrain')
    expect(home.find((d) => d.id === 'swampland_city')?.left).toBe(1)
    // The proposal's die is still taken.
    expect(home.find((d) => d.id === 'feyland_temple')?.left).toBe(0)
  })
})
