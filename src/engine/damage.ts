/**
 * Resolving damage.
 *
 * The rule most likely to be built wrong by reflex, because it does not work like
 * hit points. From RULES-V0.md section 6:
 *
 * > Move that many health worth of units into the Dead Unit Area. You must take as
 * > much damage as possible, but not more than needed. If a die takes less damage
 * > than it has health, the damage is ignored.
 *
 * So damage kills *whole units*, the defender picks which, and the picked set must
 * be **maximal**: no other legal set absorbs more. Excess damage is simply lost.
 *
 * 5 damage against units of health 3, 2, 2, 1 can kill {3,2} or {2,2,1} -- both
 * absorb 5. Killing only the 3 absorbs 3 and is illegal, even though 3 <= 5.
 *
 * That makes this a constrained subset-sum with a genuine player choice, not a
 * subtraction.
 */
import { unitType } from '../data/load'

import type { GameState, UnitId, UnitInstance } from './types'

/** Flat index into the (items+1) x (damage+1) reachability table. */
const at = (width: number, item: number, sum: number): number => item * width + sum

interface Table {
  readonly reachable: readonly boolean[]
  readonly width: number
  readonly healths: readonly number[]
}

function buildTable(healths: readonly number[], damage: number): Table {
  if (!Number.isInteger(damage) || damage < 0) {
    throw new RangeError(`damage must be a non-negative integer, got ${damage}`)
  }
  for (const health of healths) {
    if (!Number.isInteger(health) || health < 1) {
      throw new RangeError(`unit health must be a positive integer, got ${health}`)
    }
  }

  const n = healths.length
  const width = damage + 1
  const reachable = new Array<boolean>((n + 1) * width).fill(false)
  reachable[at(width, 0, 0)] = true

  // Standard 0/1 subset-sum: each unit may be killed at most once.
  for (let i = 1; i <= n; i++) {
    const health = healths[i - 1] as number
    for (let sum = 0; sum <= damage; sum++) {
      const without = reachable[at(width, i - 1, sum)] ?? false
      const with_ = sum >= health ? (reachable[at(width, i - 1, sum - health)] ?? false) : false
      reachable[at(width, i, sum)] = without || with_
    }
  }

  return { reachable, width, healths }
}

/**
 * The most health that can actually be killed by `damage`.
 *
 * O(units x damage), which for armies of a dozen dice and single-digit damage is
 * nothing. Deliberately *not* an enumeration of every maximal subset: that is
 * exponential in the worst case and produces a list no UI can usefully render.
 * The damage sheet instead lets the player toggle units against this number.
 */
export function maxAbsorbable(healths: readonly number[], damage: number): number {
  const table = buildTable(healths, damage)
  const n = healths.length
  for (let sum = damage; sum >= 0; sum--) {
    if (table.reachable[at(table.width, n, sum)] ?? false) return sum
  }
  return 0 // unreachable: sum 0 is always achievable by killing nothing
}

/**
 * One legal maximal set, as indices into `healths`.
 *
 * Greedy does not work here and is worth spelling out, because it looks like it
 * should: 4 damage against 3, 2, 2 -- greedy takes the 3, cannot fit another, and
 * stops at 3, while {2,2} absorbs the full 4. Hence the DP with reconstruction.
 *
 * Which maximal set to prefer is a *strategic* question, not a rules one -- the
 * surviving health is identical either way, but the surviving number of dice is
 * not. This returns a deterministic legal answer and leaves the choice to the
 * player or the AI.
 */
export function chooseMaximalSubset(healths: readonly number[], damage: number): readonly number[] {
  const table = buildTable(healths, damage)
  const n = healths.length

  let sum = maxAbsorbable(healths, damage)
  const chosen: number[] = []

  for (let i = n; i >= 1; i--) {
    // If the target was already reachable without unit i, it was not needed.
    if (table.reachable[at(table.width, i - 1, sum)] ?? false) continue
    chosen.push(i - 1)
    sum -= healths[i - 1] as number
  }

  return chosen.reverse()
}

/** Why an assignment is illegal, or `null` if it is fine. */
export function assignmentProblem(
  healths: readonly number[],
  damage: number,
  chosen: readonly number[],
): string | null {
  const seen = new Set<number>()
  for (const index of chosen) {
    if (!Number.isInteger(index) || index < 0 || index >= healths.length) {
      return `no such unit at index ${index}`
    }
    if (seen.has(index)) return `unit at index ${index} was chosen twice`
    seen.add(index)
  }

  const absorbed = chosen.reduce((total, i) => total + (healths[i] as number), 0)
  if (absorbed > damage) {
    return `the chosen units absorb ${absorbed}, more than the ${damage} damage dealt`
  }

  const best = maxAbsorbable(healths, damage)
  if (absorbed < best) {
    return `the chosen units absorb ${absorbed}, but ${best} is possible -- you must take as much damage as you can`
  }

  return null
}

export function isMaximalSubset(
  healths: readonly number[],
  damage: number,
  chosen: readonly number[],
): boolean {
  return assignmentProblem(healths, damage, chosen) === null
}

// --- unit-level wrappers -----------------------------------------------------

export function healthsOf(units: readonly UnitInstance[]): readonly number[] {
  return units.map((u) => unitType(u.typeId).health)
}

export interface DamageOptions {
  /** How much health must be killed. Confirm is blocked until the selection hits this. */
  readonly required: number
  /** One legal answer, for an AI or an "auto" button. */
  readonly suggestion: readonly UnitId[]
}

export function damageOptions(units: readonly UnitInstance[], damage: number): DamageOptions {
  const healths = healthsOf(units)
  return {
    required: maxAbsorbable(healths, damage),
    suggestion: chooseMaximalSubset(healths, damage).map((i) => (units[i] as UnitInstance).id),
  }
}

/** Why this set of units is an illegal answer to `damage`, or `null` if it is fine. */
export function damageAssignmentProblem(
  units: readonly UnitInstance[],
  damage: number,
  unitIds: readonly UnitId[],
): string | null {
  const indexById = new Map(units.map((u, i) => [u.id, i]))
  const indices: number[] = []

  for (const id of unitIds) {
    const index = indexById.get(id)
    if (index === undefined) return `${id} is not in the army taking damage`
    indices.push(index)
  }

  return assignmentProblem(healthsOf(units), damage, indices)
}

/**
 * Moves the chosen units to the Dead Unit Area.
 *
 * Does not check for victory: that belongs to the caller, because the win check
 * runs after every state change and not only after damage.
 */
export function applyDamage(state: GameState, unitIds: readonly UnitId[]): GameState {
  const units = { ...state.units }

  for (const id of unitIds) {
    const unit = units[id]
    if (unit === undefined) throw new Error(`cannot kill unknown unit ${id}`)
    if (unit.location.kind === 'dua') throw new Error(`${id} is already dead`)
    units[id] = { ...unit, location: { kind: 'dua' } }
  }

  return { ...state, units }
}
