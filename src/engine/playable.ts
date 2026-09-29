/**
 * Which species the engine can play (v2 Phase 5a).
 *
 * **Being in the data is not being playable.** A species phase transcribes its dice
 * first (slice a) and builds the rules on them over the slices after, so for most of a
 * phase `units.json` holds dice whose SAIs `sai: 'full'` refuses. Every place that
 * *hands out* dice -- a rolled force, the army builder's palette, the random opponent's
 * pools, and `builtForceProblem`, which every force passes through -- asks this module,
 * so a half-built species is invisible rather than a throw in the middle of a game.
 *
 * **Derived, never flagged.** A species is playable when every SAI its dice carry has a
 * handler and the ability table names it. Nobody flips a switch at the end of a phase:
 * the slice that builds the last missing piece makes the species playable in the same
 * edit, and a test that counted on it not being so fails there. Spells are not part of
 * the question -- a spell nobody can cast is one fewer option, not a wrong game.
 */

import { SPECIES, UNIT_TYPES, unitType } from '../data/load'
import type { Species, UnitType } from '../data/types'
import { saiBuilt } from './sai'
import { SPECIES_ABILITIES } from './species'

/**
 * The rule itself, over whatever it is handed: why this species is not playable, or null.
 *
 * Pure, so it can be tested when every species in the data *is* playable -- which is
 * the normal state between species phases, and the one in which a test against the real
 * tables would have nothing to say.
 */
export function problemFor(
  species: Species,
  types: readonly UnitType[],
  built: (sai: string) => boolean,
  hasAbilities: boolean,
): string | null {
  const unbuilt = new Set<string>()
  for (const type of types) {
    if (type.species !== species.id) continue
    for (const face of type.faces) if (face.icon === 'SAI' && !built(face.sai)) unbuilt.add(face.sai)
  }

  const missing: string[] = []
  if (unbuilt.size > 0) missing.push(`the SAI${unbuilt.size > 1 ? 's' : ''} ${[...unbuilt].sort().join(', ')}`)
  if (!hasAbilities) missing.push('its species abilities')
  if (missing.length === 0) return null
  return `${species.name} are not playable yet: ${missing.join(' and ')} are not implemented`
}

/** Why a species in the data is not playable yet, or null when it is. */
export function speciesProblem(speciesId: string): string | null {
  const species = SPECIES.find((s) => s.id === speciesId)
  if (species === undefined) return `there is no species ${speciesId}`
  return problemFor(species, UNIT_TYPES, saiBuilt, SPECIES_ABILITIES[speciesId] !== undefined)
}

/** Every species the engine can play, in the data's order. */
export const PLAYABLE_SPECIES: readonly Species[] = SPECIES.filter((s) => speciesProblem(s.id) === null)

const PLAYABLE_IDS: ReadonlySet<string> = new Set(PLAYABLE_SPECIES.map((s) => s.id))

/** Every unit die of a playable species, in the data's order. */
export const PLAYABLE_UNITS: readonly UnitType[] = UNIT_TYPES.filter((u) => PLAYABLE_IDS.has(u.species))

/** Whether this unit die (which must exist) belongs to a playable species. */
export function unitPlayable(typeId: string): boolean {
  return PLAYABLE_IDS.has(unitType(typeId).species)
}

/** Whether the engine can play this species. */
export function speciesPlayable(speciesId: string): boolean {
  return PLAYABLE_IDS.has(speciesId)
}
