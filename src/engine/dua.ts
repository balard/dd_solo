/**
 * The Dead Unit Area as a resource: promotion, recruitment, burial, and the general
 * exchange all three of them are built on.
 *
 * Nothing here rolls a die, writes to the log, or knows what phase it is. These are
 * state transforms the way `applyDamage` is one; the caller logs, exactly as
 * `applyAssignDamage` wraps it.
 *
 * **Promotion is an exchange, not a stat change** (full rules p. 30). Invariant 4
 * says damage kills whole units rather than reducing hit points, and the same logic
 * runs upward: a 2-health Oak promotes by *swapping places* with a 3-health Treefolk
 * unit in the DUA. With no partner in the DUA, promotion simply does not happen.
 * Nothing ever gains health.
 *
 * Which is why the swap moves `location` and never `typeId`. A unit id embeds its
 * type's short name (`setup.ts`), so rewriting the type would make every id -- and
 * every golden digest line -- say the wrong thing about the die it names.
 */
import { unitType } from '../data/load'

import {
  deadUnits,
  type GameState,
  type PlayerId,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from './types'

/**
 * One unit traded for one unit in the same player's DUA.
 *
 * `unitId` is in play and is going to the DUA; `partnerId` is in the DUA and is
 * taking its place.
 */
export interface Exchange {
  readonly unitId: UnitId
  readonly partnerId: UnitId
}

/** At a terrain or in Reserves -- as opposed to dead or buried. */
function isInPlay(unit: UnitInstance): boolean {
  return unit.location.kind === 'terrain' || unit.location.kind === 'reserve'
}

function lookup(state: GameState, id: UnitId, what: string): UnitInstance {
  const unit = state.units[id]
  if (unit === undefined) throw new Error(`${what}: unknown unit ${id}`)
  return unit
}

const healthOf = (unit: UnitInstance): number => unitType(unit.typeId).health
const speciesOfUnit = (unit: UnitInstance): string => unitType(unit.typeId).species

/**
 * The DUA units this one could promote into: same owner, same species, and exactly
 * one health larger.
 *
 * Class is deliberately not a constraint -- the rules do not mention it, so a heavy
 * melee Oak may come back as a magic die.
 */
export function promotionPartners(state: GameState, unitId: UnitId): readonly UnitInstance[] {
  const unit = lookup(state, unitId, 'promotionPartners')
  if (!isInPlay(unit)) return []

  const species = speciesOfUnit(unit)
  const wanted = healthOf(unit) + 1
  return deadUnits(state, unit.owner).filter(
    (dead) => speciesOfUnit(dead) === species && healthOf(dead) === wanted,
  )
}

/**
 * "Promote as many units as possible": one legal maximum set of pairings.
 *
 * A bucket count rather than a search. Every promotion is exactly +1 health and they
 * all resolve at once, so a unit demoted into the DUA by this exchange can never be
 * another pair's partner -- which means the health buckets do not interact, and the
 * answer for each is `min(candidates at h, DUA partners at h + 1)` independently.
 * Do not reach for the subset-sum in `damage.ts`: that solves a different problem.
 *
 * Health-budget promotion -- "X health-worth", where one unit may be promoted twice
 * to spend it -- belongs to Wild Growth and the City, and is not this.
 */
export function promotionMatching(
  state: GameState,
  player: PlayerId,
  unitIds: readonly UnitId[],
): readonly Exchange[] {
  const candidates = unitIds
    .map((id) => lookup(state, id, 'promotionMatching'))
    .filter((unit) => unit.owner === player && isInPlay(unit))

  // Partners are consumed as they are matched, so one dead Oak Lord cannot promote
  // two Oaks.
  const taken = new Set<UnitId>()
  const pairs: Exchange[] = []

  for (const unit of candidates) {
    const partner = promotionPartners(state, unit.id).find((dead) => !taken.has(dead.id))
    if (partner === undefined) continue
    taken.add(partner.id)
    pairs.push({ unitId: unit.id, partnerId: partner.id })
  }

  return pairs
}

/**
 * `exchangeWithDua`, with the promotion rule checked on every pair first: the
 * partner must be the same species and exactly one health larger.
 */
export function promote(state: GameState, pairs: readonly Exchange[]): GameState {
  for (const pair of pairs) {
    const unit = lookup(state, pair.unitId, 'promote')
    const partner = lookup(state, pair.partnerId, 'promote')

    if (speciesOfUnit(unit) !== speciesOfUnit(partner)) {
      throw new Error(
        `promote: ${unit.id} (${speciesOfUnit(unit)}) cannot promote into ${partner.id} ` +
          `(${speciesOfUnit(partner)}) -- a promotion stays within one species`,
      )
    }
    if (healthOf(partner) !== healthOf(unit) + 1) {
      throw new Error(
        `promote: ${unit.id} has ${healthOf(unit)} health and ${partner.id} has ` +
          `${healthOf(partner)} -- a promotion is exactly one health larger`,
      )
    }
  }

  return exchangeWithDua(state, pairs)
}

/**
 * Exchanges units in play for units in the same player's DUA.
 *
 * **All at once** (full rules p. 31): "identify any units that need to be exchanged,
 * then choose which units in the DUA they will be exchanged with *before* performing
 * the exchange." Every location below is read off the original `state`, so a unit
 * arriving in the DUA by this exchange cannot be another pair's partner and the
 * order of `pairs` cannot change the outcome.
 *
 * Two more consequences of the same paragraph fall out of the single pass, and are
 * pinned by tests rather than by code: an army whose every unit is exchanged is
 * never considered gone, because there is no intermediate state to observe it in;
 * and **exchanged units are never considered killed**, so nothing here logs a death
 * or fires the death trigger in `death.ts`.
 */
export function exchangeWithDua(state: GameState, pairs: readonly Exchange[]): GameState {
  if (pairs.length === 0) return state

  const seen = new Set<UnitId>()
  const units = { ...state.units }

  for (const pair of pairs) {
    const unit = lookup(state, pair.unitId, 'exchangeWithDua')
    const partner = lookup(state, pair.partnerId, 'exchangeWithDua')

    for (const id of [pair.unitId, pair.partnerId]) {
      if (seen.has(id)) throw new Error(`exchangeWithDua: ${id} appears in two exchanges`)
      seen.add(id)
    }
    if (unit.owner !== partner.owner) {
      throw new Error(`exchangeWithDua: ${unit.id} and ${partner.id} have different owners`)
    }
    if (!isInPlay(unit)) {
      throw new Error(`exchangeWithDua: ${unit.id} is not in play (${unit.location.kind})`)
    }
    if (partner.location.kind !== 'dua') {
      throw new Error(`exchangeWithDua: ${partner.id} is not in the DUA (${partner.location.kind})`)
    }

    units[unit.id] = { ...unit, location: partner.location }
    units[partner.id] = { ...partner, location: unit.location }
  }

  return { ...state, units }
}

/**
 * Moves one-health units from the DUA into an army.
 *
 * Not an exchange: nothing goes back the other way. "To recruit a unit, simply move
 * a small (one-health) unit from your DUA to the recruiting army."
 */
export function recruit(
  state: GameState,
  unitIds: readonly UnitId[],
  slot: TerrainSlot,
): GameState {
  if (unitIds.length === 0) return state

  const units = { ...state.units }

  for (const id of unitIds) {
    const unit = lookup(state, id, 'recruit')
    if (unit.location.kind !== 'dua') {
      throw new Error(`recruit: ${id} is not in the DUA (${unit.location.kind})`)
    }
    if (healthOf(unit) !== 1) {
      throw new Error(
        `recruit: ${id} has ${healthOf(unit)} health -- only small units are recruited`,
      )
    }
    units[id] = { ...unit, location: { kind: 'terrain', slot } }
  }

  return { ...state, units }
}

/**
 * Moves units to the Buried Unit Area, from the DUA or straight off the board.
 *
 * Both sources are real: the glossary routes burial through the DUA, but several
 * effects -- Flame, Fire breath, the Temple -- kill and bury in one step. One-way
 * for the two species in scope, neither of which has anything that recovers a buried
 * unit.
 *
 * The death trigger a burial can provoke is `buryUnits` in `death.ts`; this is the
 * movement alone.
 */
export function bury(state: GameState, unitIds: readonly UnitId[]): GameState {
  if (unitIds.length === 0) return state

  const units = { ...state.units }

  for (const id of unitIds) {
    const unit = lookup(state, id, 'bury')
    if (unit.location.kind === 'bua') throw new Error(`bury: ${id} is already buried`)
    units[id] = { ...unit, location: { kind: 'bua' } }
  }

  return { ...state, units }
}
