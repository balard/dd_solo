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
import rawDragons from '../../data/starter/dragons.json'

import {
  DataError,
  type ActionIcon,
  type DragonDie,
  type DragonElement,
  type DragonFaceNumber,
  type DragonForm,
  type DragonFormType,
  type DragonIcon,
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
const DRAGON_ELEMENTS: readonly string[] = ['air', 'water', 'earth', 'fire', 'death']
const DRAGON_FORMS: readonly string[] = ['drake', 'wyrm']
const DRAGON_ICONS: readonly string[] = [
  'JAWS',
  'BREATH',
  'CLAW',
  'BELLY',
  'WING',
  'TAIL',
  'TREASURE',
]

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

function loadDragons(): { forms: readonly DragonFormType[]; dice: readonly DragonDie[] } {
  const forms = Object.entries(rawDragons.dragonForms).map(([id, f]): DragonFormType => {
    const context = `dragon form ${id}`
    const faces = {} as Record<DragonFaceNumber, DragonIcon>

    for (let n = 1; n <= 12; n++) {
      const value = (f.faces as Record<string, string | undefined>)[String(n)]
      if (value === undefined) {
        throw new DataError(`${context}: missing face ${n}`)
      }
      if (!DRAGON_ICONS.includes(value)) {
        throw new DataError(`${context}: face ${n} is ${JSON.stringify(value)}, not a dragon icon`)
      }
      faces[n as DragonFaceNumber] = value as DragonIcon
    }

    return {
      id: oneOf<DragonForm>(id, DRAGON_FORMS, 'dragon form', context),
      name: f.name,
      faces,
    }
  })

  const formIds = new Set(forms.map((f) => f.id))
  const dice = rawDragons.dragons.map((d): DragonDie => {
    const context = `dragon die ${d.id}`
    if (!formIds.has(d.form as DragonForm)) {
      throw new DataError(`${context}: unknown dragon form ${JSON.stringify(d.form)}`)
    }
    return {
      id: d.id,
      element: oneOf<DragonElement>(d.element, DRAGON_ELEMENTS, 'dragon element', context),
      form: d.form as DragonForm,
    }
  })

  return { forms, dice }
}

const loadedUnits = loadUnits()
const loadedTerrains = loadTerrains()
const loadedDragons = loadDragons()

export const SPECIES: readonly Species[] = loadedUnits.species
export const UNIT_TYPES: readonly UnitType[] = loadedUnits.units
export const TERRAIN_TYPES: readonly TerrainType[] = loadedTerrains.types
export const TERRAIN_DICE: readonly TerrainDie[] = loadedTerrains.dice
export const DRAGON_FORM_TYPES: readonly DragonFormType[] = loadedDragons.forms
export const DRAGON_DICE: readonly DragonDie[] = loadedDragons.dice

const unitsById = new Map(UNIT_TYPES.map((u) => [u.id, u]))
const terrainTypesById = new Map(TERRAIN_TYPES.map((t) => [t.id, t]))
const terrainDiceById = new Map(TERRAIN_DICE.map((d) => [d.id, d]))
const dragonFormsById = new Map(DRAGON_FORM_TYPES.map((f) => [f.id, f]))
const dragonDiceById = new Map(DRAGON_DICE.map((d) => [d.id, d]))

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

export function terrainDie(id: string): TerrainDie {
  const found = terrainDiceById.get(id)
  if (!found) throw new DataError(`no such terrain die: ${id}`)
  return found
}

/** The action icon on a terrain die's numbered face. Face 8 is the eighth face and
 *  carries no action, so it is not addressable here. */
export function terrainFaceAction(dieId: string, face: TerrainFaceNumber): ActionIcon {
  return terrainType(terrainDie(dieId).type).faces[face]
}

export function dragonForm(id: DragonForm): DragonFormType {
  const found = dragonFormsById.get(id)
  if (!found) throw new DataError(`no such dragon form: ${id}`)
  return found
}

export function dragonDie(id: string): DragonDie {
  const found = dragonDiceById.get(id)
  if (!found) throw new DataError(`no such dragon die: ${id}`)
  return found
}

/** The icon on a dragon die's numbered face. The form fixes all twelve. */
export function dragonFaceIcon(dieId: string, face: DragonFaceNumber): DragonIcon {
  return dragonForm(dragonDie(dieId).form).faces[face]
}

/** "Fire Drake". Both clients need it, and it is a fact about the data. */
export function dragonName(dieId: string): string {
  const die = dragonDie(dieId)
  return `${die.element[0]?.toUpperCase() ?? ''}${die.element.slice(1)} ${dragonForm(die.form).name}`
}

/**
 * "Coastland · city": a terrain die's type and its eighth-face icon, which together
 * are what tells two dice apart -- two players can bring the same type. Both clients
 * name the roll-off's proposed Frontiers with it (v1 Phase 10e), which is where a die
 * is named before it has a slot to be called by.
 */
export function terrainDieName(dieId: string): string {
  const die = terrainDie(dieId)
  return `${terrainType(die.type).name} · ${die.eighthFace.replace(/_/g, ' ')}`
}

/**
 * A species' two elements -- the one copy of this fact.
 *
 * It lives here rather than in `setup.ts`, where it started, because it is a fact
 * about the data and setup is no longer its only reader: Phase 7's magic pool asks
 * which elements an army's magic may be spent as, and that is the same question.
 */
export function speciesElements(speciesId: string): readonly Element[] {
  const found = SPECIES.find((s) => s.id === speciesId)
  if (!found) throw new DataError(`no such species: ${speciesId}`)
  return found.elements
}

/**
 * A species' own terrain type: the one whose two elements are exactly the species' two.
 * Treefolk (water, earth) bring Swampland, Firewalkers (air, fire) bring Wasteland.
 *
 * Derived rather than tabled, so there is no second copy of "which terrain a species
 * brings" to drift. The six basic types carry the six pairs of four elements, one each,
 * so the match is always exactly one, and this throws if the data ever stops saying so.
 */
export function homeTerrainType(speciesId: string): TerrainType {
  const only = ownTerrainType(speciesId)
  if (only === null) throw new DataError(`${speciesId} matches no terrain type`)
  return only
}

/**
 * `homeTerrainType`, or null for a species whose elements make no terrain type -- which
 * is every species carrying Death, since no terrain does (v2 Phase 2). Still throws if
 * two types match, since that is the data contradicting itself rather than a species
 * the rule does not cover.
 */
export function ownTerrainType(speciesId: string): TerrainType | null {
  const own = speciesElements(speciesId)
  const found = TERRAIN_TYPES.filter(
    (t) => t.elements.length === own.length && own.every((e) => t.elements.includes(e)),
  )
  if (found.length > 1) {
    throw new DataError(`${speciesId} matches ${found.length} terrain types, not exactly one`)
  }
  return found[0] ?? null
}

/** Units of one species, in the data's order (by class, then size). */
export function unitsOfSpecies(speciesId: string): readonly UnitType[] {
  return UNIT_TYPES.filter((u) => u.species === speciesId)
}
