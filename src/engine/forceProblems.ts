/**
 * Everything wrong with a force drawn from a collection (v2 Phase 4), as a list.
 *
 * **Moved out of `src/ui/game/builder.ts` in v3 Phase 0**, unchanged in what it says:
 * v3's run must refuse an illegal force with the same statement the builder shows, and
 * `src/run/` may not import `src/ui/`. The builder's draft functions (`addUnit`,
 * `setTerrain`, ...) stayed in the UI; only the judgement moved.
 *
 * **A list, not the first problem.** `builtForceProblem` returns the first thing wrong,
 * which is right for setup -- it throws -- and wrong for a builder, whose draft is
 * incomplete for most of its life: an empty Horde and a missing dragon are both true at
 * once, and a screen that names only one of them hides the other until the first is
 * fixed. Each problem says where it belongs, so the screen can put it beside the
 * section it is about.
 *
 * The p. 8 rules here and in `builtForceProblem` are one statement written twice, and
 * `forceProblems.test.ts` holds them together: over the full collection with no cap and
 * `dragons: 'at_most'`, a force has no problems here exactly when the engine finds none.
 */
import { owned, ownsEveryDie, type Collection, type CollectionKind } from '../data/collections'
import { DRAGON_DICE, TERRAIN_DICE, UNIT_TYPES, dragonName, terrainDieName, unitType } from '../data/load'
import { PRESET_ARMY_NAMES, maxArmyHealth, type PresetArmyName } from '../data/presets'

import { dragonCount, type BuiltForce } from './force'
import { speciesProblem, unitPlayable } from './playable'

export type TerrainField = 'homeTerrain' | 'frontierProposal'

/** Where a problem belongs on the builder: the whole force, one army, one terrain field,
 *  the terrains together (one die used by both fields), or the dragons. */
export type ProblemPlace = 'force' | PresetArmyName | TerrainField | 'terrains' | 'dragons'

export interface ForceProblem {
  readonly where: ProblemPlace
  readonly text: string
}

/**
 * How many dragons a force must name:
 * - `'exactly'` one per 24 health or part of it -- the builder outside a run, which
 *   asks for what a normal game brings;
 * - `'at_most'` that many, and at least one -- a run (v3), where a force fields the
 *   dragons it owns and plays short at a disadvantage. This is what setup accepts.
 */
export type DragonRule = 'exactly' | 'at_most'

const UNIT_IDS: ReadonlySet<string> = new Set(UNIT_TYPES.map((u) => u.id))
const TERRAIN_IDS: ReadonlySet<string> = new Set(TERRAIN_DICE.map((d) => d.id))
const DRAGON_IDS: ReadonlySet<string> = new Set(DRAGON_DICE.map((d) => d.id))

/** Health of the dice in a list that exist; an unknown id is reported, not counted. */
export const healthOf = (ids: readonly string[]): number =>
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
 * - **the dragons** (p. 8): when named, one per 24 health or part of it -- exactly, or
 *   at most and at least one, by `dragons` (`DragonRule`);
 * - **the collection**: no more copies of any die than it holds;
 * - **absent is a draw**: setup draws an unnamed terrain or dragon from the whole data,
 *   so a force may leave one unnamed only when the collection holds every die of that
 *   kind without limit. Stated as that rather than as "limited mode", so a collection
 *   needs no mode flag.
 */
export function forceProblems(
  collection: Collection,
  cap: number,
  force: BuiltForce,
  dragons: DragonRule = 'exactly',
): readonly ForceProblem[] {
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
      add(
        'dragons',
        dragons === 'exactly'
          ? `choose ${plural(wanted, 'dragon')}; setup can only draw them from every dragon die`
          : `choose ${wanted === 1 ? 'a dragon' : `1 to ${wanted} dragons`}; setup can only draw them from every dragon die`,
      )
    }
  } else {
    for (const id of force.dragons.filter((d) => !DRAGON_IDS.has(d))) add('dragons', `${id} is not a dragon die`)
    const count = force.dragons.length
    if (dragons === 'exactly' && count !== wanted) {
      add(
        'dragons',
        `it brings ${plural(count, 'dragon')}; a ${total}-health force brings exactly ${wanted}, ` +
          'one per 24 health or part of it',
      )
    } else if (dragons === 'at_most' && count === 0) {
      add('dragons', 'it brings no dragons; a force brings at least one')
    } else if (dragons === 'at_most' && count > wanted) {
      add(
        'dragons',
        `it brings ${plural(count, 'dragon')}; a ${total}-health force brings at most ${wanted}, ` +
          'one per 24 health or part of it',
      )
    }
    for (const text of overOwned(collection, force, 'dragons', DRAGON_IDS)) add('dragons', text)
  }

  return problems
}
