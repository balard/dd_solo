import { describe, expect, it } from 'vitest'

import {
  DRAGON_DICE,
  DRAGON_FORM_TYPES,
  SPECIES,
  TERRAIN_DICE,
  TERRAIN_TYPES,
  UNIT_TYPES,
  dragonDie,
  dragonFaceIcon,
  dragonForm,
  parseFace,
  terrainType,
  unitType,
  unitsOfSpecies,
} from './load'
import { DataError, type DragonFaceNumber, type DragonIcon, type Face } from './types'

const FACE_NUMBERS: readonly DragonFaceNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

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
  it('loads all 60 unit dice: the starter set and the Coral Elves', () => {
    expect(UNIT_TYPES).toHaveLength(60)
    expect(SPECIES.map((s) => s.id).sort()).toEqual(['coral_elves', 'firewalkers', 'treefolk'])
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
  it('loads 6 types and 24 dice', () => {
    expect(TERRAIN_TYPES).toHaveLength(6)
    expect(TERRAIN_DICE).toHaveLength(24)
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
    const counts = (id: string) => {
      const faces = terrainType(id).faces
      const list = ([1, 2, 3, 4, 5, 6, 7] as const).map((n) => faces[n])
      return {
        melee: list.filter((f) => f === 'MELEE').length,
        missile: list.filter((f) => f === 'MISSILE').length,
        magic: list.filter((f) => f === 'MAGIC').length,
      }
    }
    expect(counts('swampland')).toEqual({ melee: 3, missile: 2, magic: 2 })
    expect(counts('highland')).toEqual({ melee: 2, missile: 2, magic: 3 })
    expect(counts('wasteland')).toEqual({ melee: 4, missile: 2, magic: 1 })
    expect(counts('coastland')).toEqual({ melee: 2, missile: 4, magic: 1 })
    expect(counts('feyland')).toEqual({ melee: 3, missile: 1, magic: 3 })
    expect(counts('flatland')).toEqual({ melee: 3, missile: 3, magic: 1 })
  })
})

describe('dragon data', () => {
  const profile = (form: 'drake' | 'wyrm') => {
    const faces = dragonForm(form).faces
    const list = FACE_NUMBERS.map((n) => faces[n])
    const count = (icon: DragonIcon) => list.filter((f) => f === icon).length
    return {
      jaws: count('JAWS'),
      breath: count('BREATH'),
      claw: count('CLAW'),
      belly: count('BELLY'),
      wing: count('WING'),
      tail: count('TAIL'),
      treasure: count('TREASURE'),
    }
  }

  it('loads 2 forms and 10 dice -- 5 elements x drake/wyrm', () => {
    expect(DRAGON_FORM_TYPES.map((f) => f.id).sort()).toEqual(['drake', 'wyrm'])
    expect(DRAGON_DICE).toHaveLength(10)
    expect([...new Set(DRAGON_DICE.map((d) => d.element))].sort()).toEqual([
      'air',
      'death',
      'earth',
      'fire',
      'water',
    ])
  })

  it('gives every form all twelve faces', () => {
    for (const form of DRAGON_FORM_TYPES) {
      for (const n of FACE_NUMBERS) {
        expect(form.faces[n], `${form.id} face ${n}`).toBeDefined()
      }
    }
  })

  // The layout neither rulebook prints. A wyrm is not a drake with one face
  // swapped: it spends both wings on a third tail and a treasure chest.
  it('reads back the transcribed face profile of each form', () => {
    expect(profile('drake')).toEqual({
      jaws: 1,
      breath: 1,
      claw: 4,
      belly: 2,
      wing: 2,
      tail: 2,
      treasure: 0,
    })
    expect(profile('wyrm')).toEqual({
      jaws: 1,
      breath: 1,
      claw: 4,
      belly: 2,
      wing: 0,
      tail: 3,
      treasure: 1,
    })
  })

  it('gives wings to drakes and the treasure chest to wyrms', () => {
    expect(profile('drake').treasure).toBe(0)
    expect(profile('wyrm').wing).toBe(0)
  })

  it('shares one layout across all five elements of a form', () => {
    for (const form of ['drake', 'wyrm'] as const) {
      const dice = DRAGON_DICE.filter((d) => d.form === form)
      expect(dice).toHaveLength(5)
      for (const die of dice) {
        for (const n of FACE_NUMBERS) {
          expect(dragonFaceIcon(die.id, n), `${die.id} face ${n}`).toBe(dragonForm(form).faces[n])
        }
      }
    }
  })

  it('names every die after its element and form', () => {
    for (const die of DRAGON_DICE) {
      expect(die.id).toBe(`${die.element}_${die.form}`)
      expect(dragonDie(die.id)).toBe(die)
    }
  })

  it('throws a DataError for an unknown dragon die', () => {
    expect(() => dragonDie('ivory_drake')).toThrow(DataError)
  })
})
