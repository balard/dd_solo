import { describe, expect, it } from 'vitest'

import {
  SPECIES,
  TERRAIN_DICE,
  TERRAIN_TYPES,
  UNIT_TYPES,
  parseFace,
  terrainType,
  unitType,
  unitsOfSpecies,
} from './load'
import { DataError, type Face } from './types'

describe('parseFace', () => {
  it('parses a normal icon with its count', () => {
    expect(parseFace('2 MELEE', 'test')).toEqual({ count: 2, icon: 'MELEE' })
  })

  it('parses an SAI, keeping its printed name', () => {
    expect(parseFace('4 SAI:Create Fireminions', 'test')).toEqual({
      count: 4,
      icon: 'SAI',
      sai: 'Create Fireminions',
    })
  })

  it.each([
    ['MELEE', 'no count'],
    ['2', 'no icon'],
    ['0 MELEE', 'zero count'],
    ['-1 MELEE', 'negative count'],
    ['2 SWORDS', 'unknown icon'],
    ['2 SAI:', 'empty SAI name'],
    ['TODO', 'untranscribed placeholder'],
    ['', 'empty string'],
  ])('rejects %j (%s)', (input) => {
    expect(() => parseFace(input, 'test')).toThrow(DataError)
  })
})

describe('unit data', () => {
  it('loads all 40 starter-set unit dice', () => {
    expect(UNIT_TYPES).toHaveLength(40)
    expect(SPECIES.map((s) => s.id).sort()).toEqual(['firewalkers', 'treefolk'])
  })

  it('gives each species 20 dice', () => {
    for (const species of SPECIES) {
      expect(unitsOfSpecies(species.id)).toHaveLength(20)
    }
  })

  it('gives every die the face count its die type implies', () => {
    for (const unit of UNIT_TYPES) {
      expect(unit.faces).toHaveLength(unit.dieType === 'd6' ? 6 : 10)
    }
  })

  it('gives every die exactly one ID face whose count is its health', () => {
    for (const unit of UNIT_TYPES) {
      const idFaces = unit.faces.filter((f) => f.icon === 'ID')
      expect(idFaces, unit.id).toHaveLength(1)
      expect((idFaces[0] as Face).count, unit.id).toBe(unit.health)
    }
  })

  it('makes every monster face count 4 results, except SAI X values', () => {
    for (const unit of UNIT_TYPES.filter((u) => u.size === 'monster')) {
      for (const face of unit.faces) {
        if (face.icon !== 'SAI') {
          expect(face.count, `${unit.id} ${face.icon}`).toBe(4)
        }
      }
    }
  })

  it('reads back a hand-checked die', () => {
    // The Firewalker Guardian -- the die that proved a face carries a count of
    // icons rather than one icon. Its fifth face is a double melee on a 1-health unit.
    expect(unitType('firewalkers.guardian').faces).toEqual([
      { count: 1, icon: 'ID' },
      { count: 1, icon: 'MELEE' },
      { count: 1, icon: 'SAVE' },
      { count: 1, icon: 'MISSILE' },
      { count: 2, icon: 'MELEE' },
      { count: 1, icon: 'MANEUVER' },
    ])
  })

  it('throws a DataError for an unknown unit id', () => {
    expect(() => unitType('treefolk.ent')).toThrow(DataError)
  })
})

describe('terrain data', () => {
  it('loads 3 types and 12 dice', () => {
    expect(TERRAIN_TYPES).toHaveLength(3)
    expect(TERRAIN_DICE).toHaveLength(12)
  })

  it('pairs every type with all four eighth-face icons', () => {
    for (const type of TERRAIN_TYPES) {
      const variants = TERRAIN_DICE.filter((d) => d.type === type.id).map((d) => d.eighthFace)
      expect(variants.sort(), type.id).toEqual(['city', 'standing_stones', 'temple', 'tower'])
    }
  })

  it('orders faces magic -> missile -> melee as the number rises', () => {
    const rank = { MAGIC: 0, MISSILE: 1, MELEE: 2 } as const
    for (const type of TERRAIN_TYPES) {
      const sequence = ([1, 2, 3, 4, 5, 6, 7] as const).map((n) => rank[type.faces[n]])
      expect(sequence, type.id).toEqual([...sequence].sort((a, b) => a - b))
    }
  })

  it('reads back the three split points, which differ per type', () => {
    const profile = (id: string) => {
      const faces = terrainType(id).faces
      return ([1, 2, 3, 4, 5, 6, 7] as const).map((n) => faces[n]).join(' ')
    }
    expect(profile('swampland')).toBe('MAGIC MAGIC MISSILE MISSILE MELEE MELEE MELEE')
    expect(profile('highland')).toBe('MAGIC MAGIC MAGIC MISSILE MISSILE MELEE MELEE')
    expect(profile('wasteland')).toBe('MAGIC MISSILE MISSILE MELEE MELEE MELEE MELEE')
  })
})
