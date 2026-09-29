/**
 * What the army builder has to decide, without a DOM (v2 Phase 4) -- `newGame.ts`'s
 * arrangement: the screen shows a problem and never decides one.
 *
 * **A list, not the first problem.** `builtForceProblem` in the engine returns the first
 * thing wrong, which is right for setup -- it throws -- and wrong for a builder, whose
 * draft is incomplete for most of its life: an empty Horde and a missing dragon are both
 * true at once, and a screen that names only one of them hides the other until the first
 * is fixed. Each problem says where it belongs, so the screen can put it beside the
 * section it is about.
 *
 * The p. 8 rules here and in `builtForceProblem` are one statement written twice, and
 * `builder.test.ts` holds them together: over the full collection with no cap, a force
 * has no problems here exactly when the engine finds none.
 */
import {
  diceOfKind,
  owned,
  ownsEveryDie,
  type Collection,
  type CollectionKind,
} from '../../data/collections'
import {
  DRAGON_DICE,
  SPECIES,
  TERRAIN_DICE,
  UNIT_TYPES,
  dragonName,
  terrainDieName,
  unitType,
} from '../../data/load'
import { PRESET_ARMY_NAMES, maxArmyHealth, type PresetArmyName } from '../../data/presets'
import { dragonCount, type BuiltForce } from '../../engine/force'
import { PLAYABLE_SPECIES, speciesProblem, unitPlayable } from '../../engine/playable'

import { compareForDisplay } from './prompts'

/** Where a problem belongs on the builder: the whole force, one army, one terrain field,
 *  the terrains together (one die used by both fields), or the dragons. */
export type ProblemPlace = 'force' | PresetArmyName | TerrainField | 'terrains' | 'dragons'

export interface ForceProblem {
  readonly where: ProblemPlace
  readonly text: string
}

const UNIT_IDS: ReadonlySet<string> = new Set(UNIT_TYPES.map((u) => u.id))
const TERRAIN_IDS: ReadonlySet<string> = new Set(TERRAIN_DICE.map((d) => d.id))
const DRAGON_IDS: ReadonlySet<string> = new Set(DRAGON_DICE.map((d) => d.id))

/** Health of the dice in a list that exist; an unknown id is reported, not counted. */
const healthOf = (ids: readonly string[]): number =>
  ids.reduce((sum, id) => sum + (UNIT_IDS.has(id) ? unitType(id).health : 0), 0)

/** The force's size: every die in its three armies. */
export function forceHealth(force: BuiltForce): number {
  return PRESET_ARMY_NAMES.reduce((sum, name) => sum + healthOf(force.armies[name]), 0)
}

/** The ids a force uses of one kind of die, a copy per use: the three armies' dice, the
 *  Home Terrain and the Frontier proposal (two physical dice, even when alike), or the
 *  dragons. */
function uses(force: BuiltForce, kind: CollectionKind): readonly string[] {
  switch (kind) {
    case 'units':
      return PRESET_ARMY_NAMES.flatMap((name) => force.armies[name])
    case 'terrains':
      return [force.homeTerrain, force.frontierProposal].filter((id): id is string => id !== undefined)
    case 'dragons':
      return force.dragons ?? []
  }
}

/** How many copies of one die the force uses. */
export function used(force: BuiltForce, kind: CollectionKind, id: string): number {
  return uses(force, kind).filter((u) => u === id).length
}

/** Copies of a die the collection still has to give: `Infinity` in the full collection,
 *  and below zero when the force already uses more than it owns. */
export function copiesLeft(collection: Collection, force: BuiltForce, kind: CollectionKind, id: string): number {
  return owned(collection, kind, id) - used(force, kind, id)
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const NAME_OF: Readonly<Record<CollectionKind, (id: string) => string>> = {
  units: (id) => unitType(id).name,
  terrains: terrainDieName,
  dragons: dragonName,
}

/** Every die of one kind the force uses more copies of than the collection holds. */
function overOwned(collection: Collection, force: BuiltForce, kind: CollectionKind, known: ReadonlySet<string>): string[] {
  const texts: string[] = []
  for (const id of new Set(uses(force, kind))) {
    if (!known.has(id)) continue // reported as unknown where it is named
    const have = owned(collection, kind, id)
    const want = used(force, kind, id)
    if (want > have) {
      texts.push(
        have === 0
          ? `it uses ${NAME_OF[kind](id)}, which the collection does not hold`
          : `it uses ${want} of ${NAME_OF[kind](id)}; the collection holds ${have}`,
      )
    }
  }
  return texts
}

/**
 * Everything that stops this force starting a game from this collection, under this
 * force-size cap, in the builder's order: the force, each army, the terrains, the
 * dragons. Empty when it may start.
 *
 * - **the cap**: the force's total health is at most `cap` (`Infinity` for none);
 * - **each army** (p. 8): at least one die, and at most half the force, rounded down;
 * - **the dragons** (p. 8): exactly one per 24 health or part of it, when named;
 * - **the collection**: no more copies of any die than it holds;
 * - **absent is a draw**: setup draws an unnamed terrain or dragon from the whole data,
 *   so a force may leave one unnamed only when the collection holds every die of that
 *   kind without limit. Stated as that rather than as "limited mode", so a collection
 *   needs no mode flag.
 */
export function forceProblems(collection: Collection, cap: number, force: BuiltForce): readonly ForceProblem[] {
  const problems: ForceProblem[] = []
  const add = (where: ProblemPlace, text: string) => problems.push({ where, text })

  const total = forceHealth(force)
  if (total > cap) add('force', `it is ${total} health, over the cap of ${cap}`)
  for (const text of overOwned(collection, force, 'units', UNIT_IDS)) add('force', text)

  const half = maxArmyHealth(total)
  for (const name of PRESET_ARMY_NAMES) {
    const ids = force.armies[name]
    if (ids.length === 0) {
      add(name, `the ${name} army is empty; each army needs at least one die`)
      continue
    }
    for (const id of ids.filter((i) => !UNIT_IDS.has(i))) add(name, `the ${name} army names ${id}, which is not a unit die`)
    for (const id of ids.filter((i) => UNIT_IDS.has(i) && !unitPlayable(i))) {
      add(name, `the ${name} army names ${id}, and ${speciesProblem(unitType(id).species)}`)
    }
    const health = healthOf(ids)
    if (health > half) {
      add(name, `the ${name} army is ${health} health, over half the force (${half} of ${total})`)
    }
  }

  const terrains = ownsEveryDie(collection, 'terrains')
  for (const [field, words] of [
    ['homeTerrain', 'Home Terrain'],
    ['frontierProposal', 'Frontier proposal'],
  ] as const) {
    const id = force[field]
    if (id === undefined) {
      if (!terrains) add(field, `choose a ${words}; setup can only draw one from every terrain die`)
    } else if (!TERRAIN_IDS.has(id)) {
      add(field, `the ${words} ${id} is not a terrain die`)
    }
  }
  for (const text of overOwned(collection, force, 'terrains', TERRAIN_IDS)) add('terrains', text)

  const wanted = dragonCount(total)
  if (force.dragons === undefined) {
    if (!ownsEveryDie(collection, 'dragons')) {
      add('dragons', `choose ${plural(wanted, 'dragon')}; setup can only draw them from every dragon die`)
    }
  } else {
    for (const id of force.dragons.filter((d) => !DRAGON_IDS.has(d))) add('dragons', `${id} is not a dragon die`)
    if (force.dragons.length !== wanted) {
      add(
        'dragons',
        `it brings ${plural(force.dragons.length, 'dragon')}; a ${total}-health force brings exactly ${wanted}, ` +
          'one per 24 health or part of it',
      )
    }
    for (const text of overOwned(collection, force, 'dragons', DRAGON_IDS)) add('dragons', text)
  }

  return problems
}

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

export type TerrainField = 'homeTerrain' | 'frontierProposal'

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
