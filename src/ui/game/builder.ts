/**
 * The army builder's draft, without a DOM (v2 Phase 4) -- `newGame.ts`'s arrangement:
 * the screen shows a problem and never decides one.
 *
 * What a draft has wrong with it is `forceProblems`, which moved to
 * `src/engine/forceProblems.ts` in v3 Phase 0 so the run can ask it too.
 */
import { diceOfKind, owned, type Collection } from '../../data/collections'
import { SPECIES, UNIT_TYPES, unitType } from '../../data/load'
import { PRESET_ARMY_NAMES, maxArmyHealth, type PresetArmyName } from '../../data/presets'
import type { BuiltForce } from '../../engine/force'
import { copiesLeft, forceHealth, healthOf, type TerrainField } from '../../engine/forceProblems'
import { PLAYABLE_SPECIES } from '../../engine/playable'

import { compareForDisplay } from './prompts'

const UNIT_IDS: ReadonlySet<string> = new Set(UNIT_TYPES.map((u) => u.id))

// --- the draft (v2 Phase 4b) ----------------------------------------------------------

/**
 * The builder edits a `BuiltForce` directly: there is no second shape for "a force being
 * built", so what the screen holds is exactly what setup will be handed, and every edit
 * below is a pure function from one to the next.
 *
 * **Absent means drawn**, as it does for setup: clearing a terrain or taking the last
 * dragon away removes the field rather than leaving an empty value, so a full-collection
 * draft that names nothing is a force setup draws everything for.
 */
export const EMPTY_FORCE: BuiltForce = { armies: { home: [], campaign: [], horde: [] } }

/** The sizes a force is built to. v3's run raises its cap through the same three. */
export const FORCE_CAPS: readonly number[] = [12, 24, 36]

/** Total health of everything a collection owns: `Infinity` for the full one. */
export function ownedHealth(collection: Collection): number {
  return Object.entries(collection.units).reduce((sum, [id, count]) => sum + unitType(id).health * count, 0)
}

/**
 * The cap a collection opens on: the standard 24 for the full collection, and for a
 * limited one the largest cap it can fill -- sorry-12 holds 14 health, so 12. Never
 * below the smallest cap, since a collection too small for any is still one to look at.
 */
export function defaultCap(collection: Collection): number {
  const health = ownedHealth(collection)
  if (health === Infinity) return 24
  const fits = FORCE_CAPS.filter((cap) => cap <= health)
  return fits[fits.length - 1] ?? (FORCE_CAPS[0] as number)
}

const withArmy = (force: BuiltForce, army: PresetArmyName, ids: readonly string[]): BuiltForce => ({
  ...force,
  armies: { ...force.armies, [army]: ids },
})

export function addUnit(force: BuiltForce, army: PresetArmyName, typeId: string): BuiltForce {
  return withArmy(force, army, [...force.armies[army], typeId])
}

/** Takes away the die at `index` in an army; the index is the army's own order. */
export function removeUnit(force: BuiltForce, army: PresetArmyName, index: number): BuiltForce {
  return withArmy(
    force,
    army,
    force.armies[army].filter((_, i) => i !== index),
  )
}

/** Names a terrain die for a field, or with null leaves it to setup's draw. */
export function setTerrain(force: BuiltForce, field: TerrainField, dieId: string | null): BuiltForce {
  const { [field]: _dropped, ...rest } = force
  return dieId === null ? rest : { ...rest, [field]: dieId }
}

const withDragons = (force: BuiltForce, dragons: readonly string[]): BuiltForce => {
  const { dragons: _dropped, ...rest } = force
  return dragons.length === 0 ? rest : { ...rest, dragons }
}

export function addDragon(force: BuiltForce, dieId: string): BuiltForce {
  return withDragons(force, [...(force.dragons ?? []), dieId])
}

export function removeDragon(force: BuiltForce, index: number): BuiltForce {
  return withDragons(
    force,
    (force.dragons ?? []).filter((_, i) => i !== index),
  )
}

/** One army's line on the builder: its dice and health against half the force. */
export interface ArmyLine {
  readonly army: PresetArmyName
  readonly dice: number
  readonly health: number
  /** Half the force, rounded down: the most this army may hold (p. 8). */
  readonly half: number
}

export function armyLines(force: BuiltForce): readonly ArmyLine[] {
  const half = maxArmyHealth(forceHealth(force))
  return PRESET_ARMY_NAMES.map((army) => ({
    army,
    dice: force.armies[army].length,
    health: healthOf(force.armies[army]),
    half,
  }))
}

/** A die the collection can give, and how many copies are left: `Infinity` in the full
 *  collection, 0 when every copy owned is already in the force. */
export interface PaletteDie {
  readonly id: string
  readonly left: number
}

export interface UnitPaletteGroup {
  readonly species: string
  readonly dice: readonly PaletteDie[]
}

/**
 * The unit dice a collection owns, by species and then in the board's display order --
 * monsters first, then class, heaviest first -- so a die sits where the player will look
 * for it on the board. A die whose copies are all fielded stays listed, at 0 left: it is
 * still owned, and taking it off the list would move every die after it under the thumb.
 */
export function unitPalette(collection: Collection, force: BuiltForce): readonly UnitPaletteGroup[] {
  // Playable species only: a species transcribed ahead of its rules is owned and in the
  // data, and still nothing the engine would let a game start with.
  return PLAYABLE_SPECIES.map((species) => ({
    species: species.id,
    dice: UNIT_TYPES.filter((u) => u.species === species.id && owned(collection, 'units', u.id) > 0)
      .sort(compareForDisplay)
      .map((u) => ({ id: u.id, left: copiesLeft(collection, force, 'units', u.id) })),
  })).filter((group) => group.dice.length > 0)
}

/** The dragons or terrains a collection owns, in the data's order. */
export function palette(
  collection: Collection,
  force: BuiltForce,
  kind: 'dragons' | 'terrains',
): readonly PaletteDie[] {
  return diceOfKind(kind)
    .filter((id) => owned(collection, kind, id) > 0)
    .map((id) => ({ id, left: copiesLeft(collection, force, kind, id) }))
}

/**
 * The terrain dice a field may name, counting the die the field names now as available:
 * swapping a Home Terrain for another should not be refused because the first is still
 * in use -- by this very field.
 */
export function terrainChoices(
  collection: Collection,
  force: BuiltForce,
  field: TerrainField,
): readonly PaletteDie[] {
  return palette(collection, setTerrain(force, field, null), 'terrains')
}

/** What a force is called when nobody has named it: its species and its size, "Treefolk
 *  and Firewalkers, 12 health". */
export function defaultForceName(force: BuiltForce): string {
  const ids = PRESET_ARMY_NAMES.flatMap((army) => force.armies[army]).filter((id) => UNIT_IDS.has(id))
  const species = SPECIES.filter((s) => ids.some((id) => unitType(id).species === s.id)).map((s) => s.name)
  if (species.length === 0) return 'An empty force'
  const names = species.length === 1 ? species[0] : `${species.slice(0, -1).join(', ')} and ${species[species.length - 1]}`
  return `${names}, ${forceHealth(force)} health`
}
