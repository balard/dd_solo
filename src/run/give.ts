/**
 * Every die a run gives, and the rule it is drawn by (v3 Phase 6). A reward template or
 * a boon decides **what kind** of die comes -- a small, medium, large or monster unit, a
 * dragon or a terrain -- and only then is it drawn, **similar** or **general**:
 *
 * |         | similar                                              | general                                  |
 * |---------|------------------------------------------------------|------------------------------------------|
 * | unit    | a unit copy of the pool -> a die of its species      | 7 in 10 sharing an element with the pool, else any |
 * | dragon  | a unit or dragon copy -> a dragon of its elements    | a dragon of an element a pool dragon has |
 * | terrain | a unit copy -> one of its elements -> a terrain of it | any terrain                              |
 *
 * "A copy" is per copy: two Oaks in the pool weigh twice one Pine. A unit's death element
 * gives no terrain, since none carries it. Which flavour a die is goes by the pool's
 * health (`SIMILAR_IN_100`), unless the caller forces one -- a boon's first and third.
 *
 * **Nothing already offered is offered again.** A die in `taken` is filtered out of every
 * list before the pick, and when that leaves a list empty the die is drawn from every die
 * of its kind not taken. Redrawing instead could loop forever: a pool whose only dragon
 * is fire has two general dragons, and a boon may already offer both.
 *
 * Every list is sorted by id before a pick, so reordering a data file cannot reseat a run.
 */
import type { Collection } from '../data/collections'
import { DRAGON_DICE, TERRAIN_DICE, dragonDie, speciesElements, unitType } from '../data/load'
import type { Element, UnitSize, UnitType } from '../data/types'
import { PLAYABLE_UNITS } from '../engine/playable'
import { nextInt, type RngState } from '../engine/rng'
import { terrainDiceSharing } from '../engine/setup'

import { GENERAL_SHARED_IN_10, SIMILAR_IN_100, type Flavour, type GiftKind, type Grant, type Offer } from './types'

export const byId = <T extends { readonly id: string }>(list: readonly T[]): readonly T[] =>
  [...list].sort((a, b) => a.id.localeCompare(b.id))

/** One item, uniformly. Throws on an empty list, naming what was being drawn. */
export function pick<T>(list: readonly T[], rng: RngState, what: string): readonly [T, RngState] {
  if (list.length === 0) throw new Error(`nothing to draw ${what} from`)
  const [index, next] = nextInt(rng, list.length)
  const item = list[index]
  if (item === undefined) throw new Error(`drew ${what} ${index} of ${list.length}`)
  return [item, next] as const
}

/** Every playable die, sorted by id. */
export const ALL_UNITS: readonly UnitType[] = byId(PLAYABLE_UNITS)

const ALL_DRAGONS: readonly string[] = byId(DRAGON_DICE).map((d) => d.id)
const ALL_TERRAINS: readonly string[] = byId(TERRAIN_DICE).map((d) => d.id)

/** Every unit the pool owns, by health. */
export function poolHealth(collection: Collection): number {
  return Object.entries(collection.units).reduce((sum, [id, n]) => sum + unitType(id).health * n, 0)
}

/** The chance in 100 that a die given to a pool of this health is similar. */
export function similarChance(health: number): number {
  const band = SIMILAR_IN_100.find((b) => health <= b.upTo)
  if (band === undefined) throw new Error(`no similar band holds ${health} health`)
  return band.chance
}

/** Similar or general, by the pool's health: one draw. */
export function drawFlavour(collection: Collection, rng: RngState): readonly [Flavour, RngState] {
  const [roll, next] = nextInt(rng, 100)
  return [roll < similarChance(poolHealth(collection)) ? 'similar' : 'general', next] as const
}

/** One id per copy the pool owns, sorted by id. */
const copies = (counts: Readonly<Record<string, number>>): string[] =>
  Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([id, n]) => Array<string>(n).fill(id))

/** Every element of every species the pool's units are, sorted. */
function poolElements(collection: Collection): readonly Element[] {
  const species = new Set(copies(collection.units).map((id) => unitType(id).species))
  return [...new Set([...species].flatMap((s) => speciesElements(s)))].sort()
}

const sharesElement = (unit: UnitType, elements: readonly Element[]): boolean =>
  speciesElements(unit.species).some((e) => elements.includes(e))

/** `list` without what is taken, or every die of the kind not taken when that is nothing. */
function untaken(list: readonly string[], everything: readonly string[], taken: readonly string[]): readonly string[] {
  const left = list.filter((id) => !taken.includes(id))
  return left.length > 0 ? left : everything.filter((id) => !taken.includes(id))
}

function drawUnit(
  size: UnitSize,
  flavour: Flavour,
  collection: Collection,
  taken: readonly string[],
  rng: RngState,
): readonly [string, RngState] {
  const ofSize = ALL_UNITS.filter((u) => u.size === size)
  const everything = ofSize.map((u) => u.id)
  if (flavour === 'similar') {
    const [copy, afterCopy] = pick(copies(collection.units), rng, 'a unit of the pool')
    const species = unitType(copy).species
    const list = ofSize.filter((u) => u.species === species).map((u) => u.id)
    return pick(untaken(list, everything, taken), afterCopy, `a similar ${size} die`)
  }
  const [roll, afterRoll] = nextInt(rng, 10)
  const elements = poolElements(collection)
  const list = roll < GENERAL_SHARED_IN_10 ? ofSize.filter((u) => sharesElement(u, elements)).map((u) => u.id) : everything
  return pick(untaken(list, everything, taken), afterRoll, `a general ${size} die`)
}

function drawDragon(
  flavour: Flavour,
  collection: Collection,
  taken: readonly string[],
  rng: RngState,
): readonly [string, RngState] {
  const ofElements = (elements: readonly string[]) => ALL_DRAGONS.filter((id) => elements.includes(dragonDie(id).element))
  if (flavour === 'similar') {
    const units = copies(collection.units)
    const sources = [...units.map((id) => ({ unit: id })), ...copies(collection.dragons).map((id) => ({ dragon: id }))]
    const [source, afterSource] = pick(sources, rng, 'a unit or dragon of the pool')
    const elements = 'unit' in source ? speciesElements(unitType(source.unit).species) : [dragonDie(source.dragon).element]
    return pick(untaken(ofElements(elements), ALL_DRAGONS, taken), afterSource, 'a similar dragon')
  }
  const elements = copies(collection.dragons).map((id) => dragonDie(id).element)
  return pick(untaken(ofElements(elements), ALL_DRAGONS, taken), rng, 'a general dragon')
}

function drawTerrain(
  flavour: Flavour,
  collection: Collection,
  taken: readonly string[],
  rng: RngState,
): readonly [string, RngState] {
  if (flavour === 'general') return pick(untaken(ALL_TERRAINS, ALL_TERRAINS, taken), rng, 'a general terrain')
  const [copy, afterCopy] = pick(copies(collection.units), rng, 'a unit of the pool')
  // No terrain carries death, so a Death species' terrain is always its other element.
  const elements = speciesElements(unitType(copy).species).filter((e) => e !== 'death')
  const [element, afterElement] = pick([...elements].sort(), afterCopy, `an element of ${copy}`)
  return pick(untaken(terrainDiceSharing([element]), ALL_TERRAINS, taken), afterElement, 'a similar terrain')
}

/**
 * One die of `kind`, `count` copies: its flavour by the pool's health unless `forced`,
 * then the die by that flavour's rule, never one in `taken`.
 */
export function giveDie(
  kind: GiftKind,
  count: number,
  collection: Collection,
  rng: RngState,
  options: { readonly forced?: Flavour; readonly taken?: readonly string[] } = {},
): readonly [Grant, RngState] {
  const [flavour, afterFlavour] = options.forced !== undefined ? [options.forced, rng] : drawFlavour(collection, rng)
  const taken = options.taken ?? []
  switch (kind) {
    case 'dragon': {
      const [id, next] = drawDragon(flavour, collection, taken, afterFlavour)
      return [{ kind: 'dragon', id, count, flavour }, next] as const
    }
    case 'terrain': {
      const [id, next] = drawTerrain(flavour, collection, taken, afterFlavour)
      return [{ kind: 'terrain', id, count, flavour }, next] as const
    }
    case 'small':
    case 'medium':
    case 'large':
    case 'monster': {
      const [id, next] = drawUnit(kind, flavour, collection, taken, afterFlavour)
      return [{ kind: 'unit', id, count, flavour }, next] as const
    }
  }
}

/** The health a grant adds to the pool. */
export const grantHealth = (grant: Grant): number => (grant.kind === 'unit' ? unitType(grant.id).health * grant.count : 0)

/** The health an offer adds to the pool. */
export const offerHealth = (offer: Offer): number => offer.grants.reduce((sum, g) => sum + grantHealth(g), 0)
