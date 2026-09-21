/**
 * The magic pool: what a caster has to spend, and what they may spend it on.
 *
 * **One number, not a per-element tally**, and that is the load-bearing
 * simplification of the whole spell system. The rules say each unit's magic results
 * "may be divided between that unit's elements" (full rules p. 13), and
 * `validateState` enforces that every unit of a player shares one species -- so the
 * whole army's magic is a single total the caster splits freely between its species'
 * two elements. The starter book says it outright: "Each result rolled by the army
 * counts as one point of magic of EITHER of the species' elements."
 *
 * Two things follow. `resolveFaces` stays pure and `GameState`-free, because nothing
 * needs to know which die produced which element. And validating a whole announcement
 * is a sum rather than a knapsack: every point is interchangeable.
 *
 * It collapses the day two units in one army carry different elements -- a species
 * ability, or a mixed force. Nothing else in the spell system depends on it, and this
 * comment is where a future reader should start when it does.
 */
import { speciesElements, terrainDie, terrainType } from '../data/load'
import {
  spellAcceptsElement,
  spellAllowsSpecies,
  SPELLS,
  type Spell,
} from '../data/spells'
import type { Element } from '../data/types'

import { iconAt } from './effects'
import { resolvesSpell } from './spells'
import { speciesOf, type ArmyRef, type GameState, type PlayerId, type RuleSet } from './types'

/**
 * Magic results a caster may spend, and the two permissions that narrow what they buy.
 *
 * Both restrictions are `?: true` and omitted rather than `false`: this lands on
 * `turn.magic.pool` and therefore inside `digestState`'s `stableJson(state.turn)`.
 */
export interface MagicPool {
  readonly points: number
  /** Which elements these points may be spent as: the caster's species' elements,
   *  widened by a Standing Stones the casting army holds. */
  readonly elements: readonly Element[]
  /** Cantrip's second sentence: these points buy only `C`-marked spells. */
  readonly cantripOnly?: true
  /** Cast from the Reserve Area: only `R`-marked spells. */
  readonly fromReserves?: true
}

/**
 * The elements an army's magic may be spent as.
 *
 * Standing Stones -- "all units in your controlling army may convert any or all of
 * their magic results to an element this terrain contains" -- is the only thing that
 * widens it, and it comes live for free: `iconAt` returns null unless
 * `eighthFace: 'full'`, and `resolvesIcon` already gates the icon itself on
 * `magic: 'spells'`.
 */
export function castingElements(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
): readonly Element[] {
  const own = speciesElements(speciesOf(state, player))
  if (ref === 'reserve') return own
  if (iconAt(state, player, ref) !== 'standing_stones') return own

  const here = terrainType(terrainDie(state.terrains[ref].dieId).type).elements
  return [...own, ...here.filter((e) => !own.includes(e))]
}

/** The ordinary pool for a magic action. */
export function magicPool(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  points: number,
): MagicPool {
  return {
    points,
    elements: castingElements(state, player, ref),
    ...(ref === 'reserve' ? { fromReserves: true as const } : {}),
  }
}

/** Cantrip's restricted pool, from a non-magic non-maneuver roll. */
export function cantripPool(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  points: number,
): MagicPool {
  return { ...magicPool(state, player, ref, points), cantripOnly: true }
}

/** One spell this pool could buy, and how. */
export interface Castable {
  readonly spell: Spell
  /** The pool's elements this spell accepts: its own, or all of them if Elemental. */
  readonly elements: readonly Element[]
  /** How many combined castings the pool could afford. 1 for a non-cumulative spell,
   *  which gains nothing from a second casting on the same target. */
  readonly maxCount: number
}

/**
 * Every spell this pool could cast, for the announcement prompt.
 *
 * Pure -- no `GameState` -- so it is testable from a pool literal the way
 * `saiEffects` is testable from a face literal. The board question (which elements,
 * how many points) is answered by `magicPool` before this is called.
 *
 * It filters on `resolvesSpell`, which is what makes a half-built rung *playable*: a
 * spell the rules being played cannot resolve is never offered, so the throw behind
 * it guards only against a spell added to `data/` with no code behind it.
 */
export function castableSpells(
  pool: MagicPool,
  speciesId: string,
  ruleSet: RuleSet,
): readonly Castable[] {
  const out: Castable[] = []

  for (const s of SPELLS) {
    if (!resolvesSpell(s.id, ruleSet)) continue
    if (!spellAllowsSpecies(s, speciesId)) continue
    if (pool.cantripOnly === true && !s.cantrip) continue
    if (pool.fromReserves === true && !s.reserves) continue
    if (s.cost > pool.points) continue

    const elements = pool.elements.filter((e) => spellAcceptsElement(s, e))
    if (elements.length === 0) continue

    out.push({
      spell: s,
      elements,
      maxCount: s.cumulative ? Math.floor(pool.points / s.cost) : 1,
    })
  }

  return out
}

/**
 * "7 magic (water or earth)" -- the sentence every magic prompt and every magic log
 * line opens with.
 *
 * Here rather than in either client, for `saiPhrase`'s reason: the first draft of a
 * shared sentence gets written twice, and that is how the browser and the terminal
 * start describing one roll differently. Element names are the element ids -- there
 * is no display table to consult, and `ELEMENT_NAME` in `Elements.tsx` is an identity
 * map that exists as a place to hang one later.
 */
export function magicRolled(pool: MagicPool): string {
  const [last, ...front] = [...pool.elements].reverse()
  const which =
    last === undefined
      ? 'no element'
      : front.length === 0
        ? last
        : `${front.reverse().join(', ')} or ${last}`

  const limit =
    pool.cantripOnly === true
      ? ', cantrip spells only'
      : pool.fromReserves === true
        ? ', reserve spells only'
        : ''

  return `${pool.points} magic (${which}${limit})`
}
