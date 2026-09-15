import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'

import {
  applyDamage,
  assignmentProblem,
  chooseMaximalSubset,
  damageAssignmentProblem,
  damageOptions,
  isMaximalSubset,
  maxAbsorbable,
} from './damage'
import { setupGame } from './setup'
import { armyAt, deadUnits, livingUnits } from './types'
import { validateState } from './validate'

const sumAt = (healths: readonly number[], indices: readonly number[]) =>
  indices.reduce((total, i) => total + (healths[i] as number), 0)

describe('maxAbsorbable', () => {
  // The table from PLAN-V0.md Phase 3.
  it.each([
    { damage: 5, healths: [3, 2, 2, 1], expected: 5 },
    { damage: 4, healths: [3, 3], expected: 3 },
    { damage: 2, healths: [3], expected: 0 },
    { damage: 10, healths: [3, 2], expected: 5 },
    { damage: 0, healths: [3, 2, 1], expected: 0 },
  ])('absorbs $expected of $damage damage against $healths', ({ damage, healths, expected }) => {
    expect(maxAbsorbable(healths, damage)).toBe(expected)
  })

  it('absorbs nothing against an empty army', () => {
    expect(maxAbsorbable([], 7)).toBe(0)
  })

  it('ignores damage smaller than every unit, however large the army', () => {
    expect(maxAbsorbable([2, 2, 2, 2, 2], 1)).toBe(0)
  })

  it('never absorbs more than the damage dealt', () => {
    for (let damage = 0; damage <= 20; damage++) {
      expect(maxAbsorbable([4, 3, 3, 2, 2, 1], damage)).toBeLessThanOrEqual(damage)
    }
  })

  it('never absorbs more than the army has', () => {
    expect(maxAbsorbable([1, 1], 99)).toBe(2)
  })

  it('rejects nonsense input', () => {
    expect(() => maxAbsorbable([1], -1)).toThrow(RangeError)
    expect(() => maxAbsorbable([0], 5)).toThrow(RangeError)
    expect(() => maxAbsorbable([1.5], 5)).toThrow(RangeError)
  })
})

describe('chooseMaximalSubset', () => {
  /**
   * The case that rules greedy out. Taking the largest unit first strands 1 point
   * of damage; {2,2} absorbs all 4. Worth its own test because greedy looks correct
   * and would pass most of the other cases here.
   */
  it('beats greedy where greedy fails', () => {
    const healths = [3, 2, 2]
    const chosen = chooseMaximalSubset(healths, 4)
    expect(sumAt(healths, chosen)).toBe(4)
    expect(chosen.map((i) => healths[i]).sort()).toEqual([2, 2])
  })

  it('returns a set that absorbs exactly the maximum', () => {
    const cases: [number[], number][] = [
      [[3, 2, 2, 1], 5],
      [[3, 3], 4],
      [[3], 2],
      [[3, 2], 10],
      [[4, 4, 3, 2, 1], 7],
      [[1, 1, 1, 1], 3],
      [[], 5],
    ]
    for (const [healths, damage] of cases) {
      const chosen = chooseMaximalSubset(healths, damage)
      expect(sumAt(healths, chosen), `${healths} vs ${damage}`).toBe(
        maxAbsorbable(healths, damage),
      )
      expect(new Set(chosen).size, 'no unit chosen twice').toBe(chosen.length)
    }
  })

  it('kills nothing when damage is under the smallest unit', () => {
    expect(chooseMaximalSubset([3, 4], 2)).toEqual([])
  })

  // Brute force over every subset, for small armies, to prove the DP agrees.
  it('agrees with exhaustive search', () => {
    const healths = [4, 3, 3, 2, 2, 1, 1]
    for (let damage = 0; damage <= 18; damage++) {
      let best = 0
      for (let mask = 0; mask < 1 << healths.length; mask++) {
        let sum = 0
        for (let i = 0; i < healths.length; i++) {
          if (mask & (1 << i)) sum += healths[i] as number
        }
        if (sum <= damage && sum > best) best = sum
      }
      expect(maxAbsorbable(healths, damage), `damage ${damage}`).toBe(best)
    }
  })
})

describe('assignmentProblem', () => {
  const healths = [3, 2, 2, 1]

  it('accepts either maximal answer to the worked example', () => {
    expect(isMaximalSubset(healths, 5, [0, 1])).toBe(true) // {3,2}
    expect(isMaximalSubset(healths, 5, [1, 2, 3])).toBe(true) // {2,2,1}
  })

  it('rejects a legal-sized but non-maximal answer', () => {
    // Killing only the 3 absorbs 3 of 5 damage. Legal sum, illegal choice.
    expect(assignmentProblem(healths, 5, [0])).toMatch(/absorb 3, but 5 is possible/)
  })

  it('rejects taking more damage than was dealt', () => {
    expect(assignmentProblem(healths, 4, [0, 1])).toMatch(/absorb 5, more than the 4 damage/)
  })

  it('rejects an empty answer when something could die', () => {
    expect(assignmentProblem(healths, 3, [])).toMatch(/but 3 is possible/)
  })

  it('accepts an empty answer when nothing can die', () => {
    expect(isMaximalSubset([3, 4], 2, [])).toBe(true)
  })

  it('rejects the same unit twice', () => {
    expect(assignmentProblem(healths, 5, [1, 1])).toMatch(/chosen twice/)
  })

  it('rejects a unit that is not there', () => {
    expect(assignmentProblem(healths, 5, [9])).toMatch(/no such unit/)
  })
})

describe('unit-level damage', () => {
  const state = setupGame({
    seed: 1234,
    forces: { p1: 'treefolk_starter', p2: 'firewalkers_starter' },
    firstPlayer: 'p1',
  })

  it('suggests a legal maximal assignment for a real army', () => {
    const units = armyAt(state, 'p1', 'p1_home') // Oak Lord 3, Oak 2, Oakling 1, Pine 2, Dryad 2
    const { required, suggestion } = damageOptions(units, 5)
    expect(required).toBe(5)
    expect(damageAssignmentProblem(units, 5, suggestion)).toBeNull()

    const killed = suggestion.reduce(
      (sum, id) => sum + unitType(units.find((u) => u.id === id)!.typeId).health,
      0,
    )
    expect(killed).toBe(5)
  })

  it('requires nothing when no damage is dealt', () => {
    const units = armyAt(state, 'p1', 'p1_home')
    expect(damageOptions(units, 0)).toEqual({ required: 0, suggestion: [] })
  })

  it('names a unit from another army as not being in the one taking damage', () => {
    const defenders = armyAt(state, 'p1', 'p1_home')
    const outsider = armyAt(state, 'p2', 'frontier')[0]!
    expect(damageAssignmentProblem(defenders, 3, [outsider.id])).toMatch(
      /is not in the army taking damage/,
    )
  })

  it('moves the killed units to the DUA and leaves the state valid', () => {
    const units = armyAt(state, 'p1', 'p1_home')
    const { suggestion } = damageOptions(units, 5)
    const after = applyDamage(state, suggestion)

    expect(validateState(after)).toEqual([])
    expect(deadUnits(after, 'p1').map((u) => u.id).sort()).toEqual([...suggestion].sort())
    expect(livingUnits(after, 'p1')).toHaveLength(livingUnits(state, 'p1').length - suggestion.length)
    expect(armyAt(after, 'p1', 'p1_home')).toHaveLength(units.length - suggestion.length)
  })

  it('does not touch the state it is given', () => {
    const before = JSON.stringify(state)
    applyDamage(state, [armyAt(state, 'p1', 'p1_home')[0]!.id])
    expect(JSON.stringify(state)).toBe(before)
  })

  it('refuses to kill a unit twice', () => {
    const victim = armyAt(state, 'p1', 'p1_home')[0]!.id
    const after = applyDamage(state, [victim])
    expect(() => applyDamage(after, [victim])).toThrow(/already dead/)
  })

  it('wipes an army when the damage exceeds its total health', () => {
    const units = armyAt(state, 'p1', 'frontier')
    const total = units.reduce((sum, u) => sum + unitType(u.typeId).health, 0)
    const { required, suggestion } = damageOptions(units, total + 20)

    expect(required).toBe(total)
    expect(suggestion).toHaveLength(units.length)
    expect(armyAt(applyDamage(state, suggestion), 'p1', 'frontier')).toEqual([])
  })
})
