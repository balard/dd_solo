/**
 * What a player owns (v2 Phase 4): dice to build a force from, not a force.
 *
 * The army builder picks from a **collection**. v3's run hands dice, dragons and
 * terrains out as rewards and only ever changes which collection the builder is given,
 * so the builder has no mode flag: the full mode is a collection too -- every die in
 * the data, at unlimited count -- and a limited one is a file like `sorry-12.json`.
 *
 * **The full collection counts `Infinity`**, so `owned` needs no case for it and
 * "copies left" is plain subtraction. It is built here in code, never read from JSON,
 * which cannot hold the number.
 *
 * Like `presets.ts`, a hand-authored collection is checked at load: a collection that
 * names a die the data does not have should fail loudly rather than offer a button
 * that crashes setup.
 */
import sorry12Json from '../../data/collections/sorry-12.json'

import { DRAGON_DICE, TERRAIN_DICE, UNIT_TYPES } from './load'
import { DataError } from './types'

/** The three kinds of die a collection holds, named as its fields are. */
export type CollectionKind = 'units' | 'dragons' | 'terrains'

export const COLLECTION_KINDS: readonly CollectionKind[] = ['units', 'dragons', 'terrains']

export interface Collection {
  readonly id: string
  readonly name: string
  /** Copies owned, by unit type id. A die not listed is not owned. */
  readonly units: Readonly<Record<string, number>>
  /** Copies owned, by dragon die id. */
  readonly dragons: Readonly<Record<string, number>>
  /** Copies owned, by terrain die id. */
  readonly terrains: Readonly<Record<string, number>>
}

/** Every die id of one kind in the data, in the data's order. */
export function diceOfKind(kind: CollectionKind): readonly string[] {
  switch (kind) {
    case 'units':
      return UNIT_TYPES.map((u) => u.id)
    case 'dragons':
      return DRAGON_DICE.map((d) => d.id)
    case 'terrains':
      return TERRAIN_DICE.map((d) => d.id)
  }
}

/** How many copies of a die the collection holds: 0 when it holds none. */
export function owned(collection: Collection, kind: CollectionKind, id: string): number {
  return collection[kind][id] ?? 0
}

/**
 * Whether the collection holds every die of a kind without limit -- which is what lets
 * a force leave that kind to setup's draw, since setup draws from the whole data and
 * could otherwise hand a player a die they do not own. True of the full collection
 * and, by construction, of no file.
 */
export function ownsEveryDie(collection: Collection, kind: CollectionKind): boolean {
  return diceOfKind(kind).every((id) => owned(collection, kind, id) === Infinity)
}

const unlimited = (kind: CollectionKind): Readonly<Record<string, number>> =>
  Object.fromEntries(diceOfKind(kind).map((id) => [id, Infinity]))

/** Everything in the data, at unlimited count: the builder's full mode. */
export const FULL_COLLECTION: Collection = {
  id: 'full',
  name: 'Every die',
  units: unlimited('units'),
  dragons: unlimited('dragons'),
  terrains: unlimited('terrains'),
}

/**
 * A collection from parsed JSON -- a file a person wrote, so its shape is checked before
 * it is trusted with a type: a `name`, and a map of die id to copies owned for each of
 * `units`, `dragons` and `terrains` (an absent map owns none of that kind). Every id must
 * be a die in the data, and every count a whole number of at least one. Any other key
 * (a `_comment`) is ignored.
 */
export function readCollection(
  id: string,
  value: unknown,
): { readonly collection: Collection } | { readonly problem: string } {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isRecord(value)) return { problem: 'expected an object' }

  const name = value['name']
  if (typeof name !== 'string' || name.trim() === '') return { problem: 'it has no name' }

  const maps = {} as Record<CollectionKind, Readonly<Record<string, number>>>
  for (const kind of COLLECTION_KINDS) {
    const raw = value[kind] ?? {}
    if (!isRecord(raw)) return { problem: `its ${kind} is not a map of die id to count` }
    const known = new Set(diceOfKind(kind))
    for (const [dieId, count] of Object.entries(raw)) {
      if (!known.has(dieId)) return { problem: `its ${kind} names ${dieId}, which is not one of those dice` }
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
        return { problem: `it owns ${String(count)} of ${dieId}; a count is a whole number, 1 or more` }
      }
    }
    maps[kind] = raw as Readonly<Record<string, number>>
  }

  return { collection: { id, name, ...maps } }
}

function load(id: string, json: unknown): Collection {
  const read = readCollection(id, json)
  if ('problem' in read) throw new DataError(`data/collections/${id}.json: ${read.problem}`)
  return read.collection
}

/** Every collection the builder can be given, the full one first. */
export const COLLECTIONS: readonly Collection[] = [FULL_COLLECTION, load('sorry-12', sorry12Json)]

export function collectionNamed(id: string): Collection | null {
  return COLLECTIONS.find((c) => c.id === id) ?? null
}
