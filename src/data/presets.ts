/**
 * Hand-authored setup content from `data/presets.json`.
 *
 * Two things, deliberately separate. A **species profile** is the pair of terrain
 * dice a species brings -- its Home Terrain and the second one it proposes as the
 * Frontier -- and every game needs one per side. A **preset** is a named force: a
 * species and three army lists. Ordinary games roll their force from the seed
 * instead (`engine/force.ts`), so presets exist for the things randomness is no use
 * to: a test that needs a particular die on the board, and a golden corpus that has
 * to mean the same thing next year.
 *
 * They were one type, which worked only while every force implied its own terrains.
 *
 * Unlike `data/starter/`, this file is not generated -- it is content someone chose.
 * Validated eagerly here for the same reason as the die data: a broken preset should
 * fail loudly at load rather than produce an illegal board.
 */
import rawPresets from '../../data/presets.json'

import { unitType } from './load'
import { DataError } from './types'

/** The three armies a force is split into at setup. Setup vocabulary only -- the
 *  engine tracks unit locations, not army identities. */
export type PresetArmyName = 'home' | 'campaign' | 'horde'

export const PRESET_ARMY_NAMES: readonly PresetArmyName[] = ['home', 'campaign', 'horde']

/** The two terrain dice a species brings to a game. */
export interface SpeciesProfile {
  readonly id: string
  /** Placed at that player's own terrain slot. */
  readonly homeTerrain: string
  /** Proposed as the Frontier, and placed there if this side loses the roll-off. */
  readonly secondTerrain: string
}

/** A named force: who they are and how they are split at setup. */
export interface Preset {
  readonly id: string
  readonly name: string
  readonly species: string
  readonly armies: Readonly<Record<PresetArmyName, readonly string[]>>
}

/**
 * Total health of a force. Setup requires both sides to bring the same.
 */
export function presetHealth(preset: Preset): number {
  return PRESET_ARMY_NAMES.reduce((sum, name) => sum + armyHealth(preset, name), 0)
}

/**
 * RULES-V0.md section 7: every army starts with at least one die and at most half
 * the force's health.
 *
 * The cap used to be the literal 15 of a 30-health game. A rolled force is 24 or 36
 * health, so the rule it was standing in for -- half, rounded down -- is what is
 * checked now, and `engine/force.ts` checks the same one.
 */
export function maxArmyHealth(totalHealth: number): number {
  return Math.floor(totalHealth / 2)
}

function validate(preset: Preset): void {
  const context = `preset ${preset.id}`
  let total = 0
  const healths: number[] = []

  for (const armyName of PRESET_ARMY_NAMES) {
    const ids = preset.armies[armyName]
    if (ids.length === 0) {
      throw new DataError(`${context}: army ${armyName} is empty; each needs at least one die`)
    }

    let health = 0
    for (const id of ids) {
      // Throws a DataError if the unit type does not exist.
      const type = unitType(id)
      if (type.species !== preset.species) {
        throw new DataError(
          `${context}: ${id} is ${type.species}, but the preset is ${preset.species}`,
        )
      }
      health += type.health
    }

    healths.push(health)
    total += health
  }

  const cap = maxArmyHealth(total)
  PRESET_ARMY_NAMES.forEach((armyName, i) => {
    const health = healths[i] ?? 0
    if (health > cap) {
      throw new DataError(
        `${context}: army ${armyName} is ${health} health, over the setup cap of ${cap} ` +
          `(half of ${total})`,
      )
    }
  })
}

function load(): readonly Preset[] {
  const presets = Object.entries(rawPresets.presets).map(([id, p]): Preset => {
    const armies = {} as Record<PresetArmyName, readonly string[]>
    for (const armyName of PRESET_ARMY_NAMES) {
      const ids = (p.armies as Record<string, readonly string[] | undefined>)[armyName]
      if (ids === undefined) {
        throw new DataError(`preset ${id}: missing army ${armyName}`)
      }
      armies[armyName] = ids
    }

    const preset: Preset = { id, name: p.name, species: p.species, armies }
    validate(preset)
    return preset
  })

  return presets
}

function loadProfiles(): readonly SpeciesProfile[] {
  return Object.entries(rawPresets.species).map(([id, p]): SpeciesProfile => {
    const profile: SpeciesProfile = {
      id,
      homeTerrain: p.homeTerrain,
      secondTerrain: p.secondTerrain,
    }
    // A species cannot bring the same physical die twice, and setup would put both
    // on the board at once.
    if (profile.homeTerrain === profile.secondTerrain) {
      throw new DataError(
        `species ${id}: home and second terrain are both ${profile.homeTerrain}; ` +
          `they are two dice, so they have to be two dice`,
      )
    }
    return profile
  })
}

export const PRESETS: readonly Preset[] = load()
export const SPECIES_PROFILES: readonly SpeciesProfile[] = loadProfiles()

const byId = new Map(PRESETS.map((p) => [p.id, p]))
const profilesById = new Map(SPECIES_PROFILES.map((p) => [p.id, p]))

export function preset(id: string): Preset {
  const found = byId.get(id)
  if (!found) throw new DataError(`no such preset: ${id}`)
  return found
}

export function speciesProfile(id: string): SpeciesProfile {
  const found = profilesById.get(id)
  if (!found) throw new DataError(`no terrain profile for species: ${id}`)
  return found
}

/** Total health of a preset army, used by setup and by tests. */
export function armyHealth(p: Preset, armyName: PresetArmyName): number {
  return p.armies[armyName].reduce((sum, id) => sum + unitType(id).health, 0)
}
