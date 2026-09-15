/**
 * Loads and validates the generated die data in `data/starter/`.
 *
 * Parsing is eager, at module load: a malformed data file should crash the app
 * immediately and loudly rather than produce a subtly wrong game. The Python
 * validator (`tools/validate_data.py`) is the first line of defence; this is the
 * second, and it is the one that runs in the browser.
 */
import rawUnits from '../../data/starter/units.json'
import rawTerrains from '../../data/starter/terrains.json'

import {
  DataError,
  type ActionIcon,
  type EighthFaceIcon,
  type Element,
  type Face,
  type NormalIcon,
  type Species,
  type TerrainDie,
  type TerrainFaceNumber,
  type TerrainType,
  type UnitClass,
  type UnitSize,
  type UnitType,
} from './types'

const NORMAL_ICONS: readonly string[] = ['ID', 'MELEE', 'MISSILE', 'MAGIC', 'SAVE', 'MANEUVER']
const ACTION_ICONS: readonly string[] = ['MELEE', 'MISSILE', 'MAGIC']
const ELEMENTS: readonly string[] = ['air', 'water', 'earth', 'fire', 'death', 'ivory']
const UNIT_CLASSES: readonly string[] = ['heavy_melee', 'light_melee', 'cavalry', 'missile', 'magic']
const UNIT_SIZES: readonly string[] = ['small', 'medium', 'large', 'monster']
const EIGHTH_FACES: readonly string[] = ['city', 'standing_stones', 'temple', 'tower']

const FACES_PER_DIE = { d6: 6, d10: 10 } as const

const FACE_PATTERN = /^(\d+) (.+)$/

/**
 * Parses one face string, e.g. `"2 MELEE"` or `"4 SAI:Create Fireminions"`.
 *
 * Exported because it is the single most fiddly piece of the data layer and
 * deserves direct tests.
 */
export function parseFace(raw: string, context: string): Face {
  const match = FACE_PATTERN.exec(raw)
  if (!match) {
    throw new DataError(`${context}: unparseable face ${JSON.stringify(raw)}`)
  }
  const count = Number(match[1])
  const icon = match[2] as string

  if (!Number.isInteger(count) || count < 1) {
    throw new DataError(`${context}: face ${JSON.stringify(raw)} has a non-positive count`)
  }

  if (icon.startsWith('SAI:')) {
    const sai = icon.slice(4).trim()
    if (sai === '') {
      throw new DataError(`${context}: face ${JSON.stringify(raw)} has an empty SAI name`)
    }
    return { count, icon: 'SAI', sai }
  }

  if (!NORMAL_ICONS.includes(icon)) {
    throw new DataError(`${context}: face ${JSON.stringify(raw)} has unknown icon ${JSON.stringify(icon)}`)
  }
  return { count, icon: icon as NormalIcon }
}

function parseElements(values: readonly string[], context: string): readonly Element[] {
  for (const value of values) {
    if (!ELEMENTS.includes(value)) {
      throw new DataError(`${context}: unknown element ${JSON.stringify(value)}`)
    }
  }
  return values as readonly Element[]
}

function oneOf<T extends string>(
  value: string,
  allowed: readonly string[],
  label: string,
  context: string,
): T {
  if (!allowed.includes(value)) {
    throw new DataError(`${context}: unknown ${label} ${JSON.stringify(value)}`)
  }
  return value as T
}

function loadUnits(): { species: readonly Species[]; units: readonly UnitType[] } {
  const species: Species[] = Object.entries(rawUnits.species).map(([id, s]) => ({
    id,
    name: s.name,
    elements: parseElements(s.elements, `species ${id}`),
  }))
  const speciesIds = new Set(species.map((s) => s.id))

  const units = rawUnits.units.map((u): UnitType => {
    const context = `unit ${u.id}`

    if (!speciesIds.has(u.species)) {
      throw new DataError(`${context}: unknown species ${JSON.stringify(u.species)}`)
    }
    if (u.dieType !== 'd6' && u.dieType !== 'd10') {
      throw new DataError(`${context}: unknown die type ${JSON.stringify(u.dieType)}`)
    }

    const faces = u.faces.map((f) => parseFace(f, context))
    const expected = FACES_PER_DIE[u.dieType]
    if (faces.length !== expected) {
      throw new DataError(`${context}: ${u.dieType} needs ${expected} faces, has ${faces.length}`)
    }

    // Invariant the whole roller depends on: exactly one ID face, whose count is
    // the unit's health. If this ever breaks, every damage number breaks with it.
    const idFaces = faces.filter((f) => f.icon === 'ID')
    if (idFaces.length !== 1) {
      throw new DataError(`${context}: expected exactly 1 ID face, found ${idFaces.length}`)
    }
    const idFace = idFaces[0] as Face
    if (idFace.count !== u.health) {
      throw new DataError(
        `${context}: ID face count ${idFace.count} does not equal health ${u.health}`,
      )
    }

    return {
      id: u.id,
      name: u.name,
      species: u.species,
      unitClass: oneOf<UnitClass>(u.class, UNIT_CLASSES, 'unit class', context),
      size: oneOf<UnitSize>(u.size, UNIT_SIZES, 'unit size', context),
      health: u.health,
      dieType: u.dieType,
      faces,
    }
  })

  return { species, units }
}

function loadTerrains(): { types: readonly TerrainType[]; dice: readonly TerrainDie[] } {
  const types = Object.entries(rawTerrains.terrainTypes).map(([id, t]): TerrainType => {
    const context = `terrain type ${id}`
    const faces = {} as Record<TerrainFaceNumber, ActionIcon>

    for (let n = 1; n <= 7; n++) {
      const value = (t.faces as Record<string, string | undefined>)[String(n)]
      if (value === undefined) {
        throw new DataError(`${context}: missing face ${n}`)
      }
      if (!ACTION_ICONS.includes(value)) {
        throw new DataError(`${context}: face ${n} is ${JSON.stringify(value)}, not an action icon`)
      }
      faces[n as TerrainFaceNumber] = value as ActionIcon
    }

    return {
      id,
      name: t.name,
      elements: parseElements(t.elements, context),
      faces,
    }
  })

  const typeIds = new Set(types.map((t) => t.id))
  const dice = rawTerrains.terrains.map((d): TerrainDie => {
    const context = `terrain die ${d.id}`
    if (!typeIds.has(d.type)) {
      throw new DataError(`${context}: unknown terrain type ${JSON.stringify(d.type)}`)
    }
    return {
      id: d.id,
      type: d.type,
      eighthFace: oneOf<EighthFaceIcon>(d.eighthFace, EIGHTH_FACES, 'eighth face', context),
    }
  })

  return { types, dice }
}

const loadedUnits = loadUnits()
const loadedTerrains = loadTerrains()

export const SPECIES: readonly Species[] = loadedUnits.species
export const UNIT_TYPES: readonly UnitType[] = loadedUnits.units
export const TERRAIN_TYPES: readonly TerrainType[] = loadedTerrains.types
export const TERRAIN_DICE: readonly TerrainDie[] = loadedTerrains.dice

const unitsById = new Map(UNIT_TYPES.map((u) => [u.id, u]))
const terrainTypesById = new Map(TERRAIN_TYPES.map((t) => [t.id, t]))

export function unitType(id: string): UnitType {
  const found = unitsById.get(id)
  if (!found) throw new DataError(`no such unit type: ${id}`)
  return found
}

export function terrainType(id: string): TerrainType {
  const found = terrainTypesById.get(id)
  if (!found) throw new DataError(`no such terrain type: ${id}`)
  return found
}

/** Units of one species, in the data's order (by class, then size). */
export function unitsOfSpecies(speciesId: string): readonly UnitType[] {
  return UNIT_TYPES.filter((u) => u.species === speciesId)
}
