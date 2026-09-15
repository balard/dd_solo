/**
 * Hand-authored starting forces from `data/presets.json`.
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

export interface Preset {
  readonly id: string
  readonly name: string
  readonly species: string
  readonly homeTerrain: string
  readonly proposedFrontier: string
  readonly armies: Readonly<Record<PresetArmyName, readonly string[]>>
}

/** Rules constraints from RULES-V0.md section 7. */
const TOTAL_HEALTH = 30
const MAX_ARMY_HEALTH = 15

function validate(preset: Preset): void {
  const context = `preset ${preset.id}`
  let total = 0

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

    if (health > MAX_ARMY_HEALTH) {
      throw new DataError(
        `${context}: army ${armyName} is ${health} health, over the setup cap of ${MAX_ARMY_HEALTH}`,
      )
    }
    total += health
  }

  if (total !== TOTAL_HEALTH) {
    throw new DataError(`${context}: force is ${total} health, expected ${TOTAL_HEALTH}`)
  }
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

    const preset: Preset = {
      id,
      name: p.name,
      species: p.species,
      homeTerrain: p.homeTerrain,
      proposedFrontier: p.proposedFrontier,
      armies,
    }
    validate(preset)
    return preset
  })

  return presets
}

export const PRESETS: readonly Preset[] = load()

const byId = new Map(PRESETS.map((p) => [p.id, p]))

export function preset(id: string): Preset {
  const found = byId.get(id)
  if (!found) throw new DataError(`no such preset: ${id}`)
  return found
}

/** Total health of a preset army, used by setup and by tests. */
export function armyHealth(p: Preset, armyName: PresetArmyName): number {
  return p.armies[armyName].reduce((sum, id) => sum + unitType(id).health, 0)
}
