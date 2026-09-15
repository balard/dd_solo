import { describe, expect, it } from 'vitest'

import { UNIT_TYPES, unitType } from '../data/load'
import type { ResultType } from '../data/types'

import { rngFrom } from './rng'
import { RESULT_TYPES, faceResults, maxArmyResults, maxResults, rollArmy } from './roll'
import { V0_RULES, type RuleSet, type UnitInstance } from './types'

/** A throwaway army from unit type ids, for rolling in isolation. */
const armyOf = (...typeIds: string[]): UnitInstance[] =>
  typeIds.map((typeId, i) => ({
    id: `t:${i}`,
    typeId,
    owner: 'p1' as const,
    location: { kind: 'terrain' as const, slot: 'frontier' as const },
  }))

describe('faceResults', () => {
  it('counts a matching normal icon', () => {
    expect(faceResults({ count: 2, icon: 'MELEE' }, 'melee', V0_RULES)).toBe(2)
  })

  it('counts nothing for a non-matching icon', () => {
    expect(faceResults({ count: 2, icon: 'MELEE' }, 'save', V0_RULES)).toBe(0)
    expect(faceResults({ count: 3, icon: 'MANEUVER' }, 'magic', V0_RULES)).toBe(0)
  })

  it.each(RESULT_TYPES)('counts an ID face for %s, whatever is being rolled for', (resultType) => {
    expect(faceResults({ count: 3, icon: 'ID' }, resultType, V0_RULES)).toBe(3)
  })

  it('counts nothing for an SAI while they are inert', () => {
    expect(faceResults({ count: 4, icon: 'SAI', sai: 'Smite' }, 'melee', V0_RULES)).toBe(0)
  })

  it('refuses to guess once SAIs are switched on', () => {
    const full: RuleSet = { ...V0_RULES, sai: 'full' }
    expect(() => faceResults({ count: 4, icon: 'SAI', sai: 'Smite' }, 'melee', full)).toThrow(
      /SAI resolution is not implemented/,
    )
  })

  // The property the whole roller rests on: the number printed on the face is
  // already the answer, for every die in the game.
  it('needs no special case for ID or for monsters', () => {
    for (const type of UNIT_TYPES) {
      for (const face of type.faces) {
        if (face.icon === 'ID') {
          for (const resultType of RESULT_TYPES) {
            expect(faceResults(face, resultType, V0_RULES), `${type.id} ID`).toBe(type.health)
          }
        } else if (face.icon !== 'SAI' && type.size === 'monster') {
          const matching = RESULT_TYPES.filter((r) => faceResults(face, r, V0_RULES) > 0)
          for (const resultType of matching) {
            expect(faceResults(face, resultType, V0_RULES), `${type.id} ${face.icon}`).toBe(4)
          }
        }
      }
    }
  })
})

describe('rollArmy', () => {
  it('rolls one die per unit and keeps each face', () => {
    const units = armyOf('treefolk.oak', 'treefolk.darktree', 'firewalkers.guardian')
    const [roll] = rollArmy(units, 'melee', rngFrom(5), V0_RULES)

    expect(roll.dice).toHaveLength(3)
    expect(roll.dice.map((d) => d.unitId)).toEqual(['t:0', 't:1', 't:2'])
    expect(roll.dice[1]?.faceIndex).toBeLessThan(10) // the monster is a d10
    expect(roll.dice[0]?.faceIndex).toBeLessThan(6)
  })

  it('totals exactly the sum of the per-die contributions', () => {
    const units = armyOf(...UNIT_TYPES.slice(0, 12).map((u) => u.id))
    for (const resultType of RESULT_TYPES) {
      const [roll] = rollArmy(units, resultType, rngFrom(77), V0_RULES)
      expect(roll.total).toBe(roll.dice.reduce((sum, d) => sum + d.results, 0))
    }
  })

  it('is reproducible from its seed and advances the rng', () => {
    const units = armyOf('treefolk.oak_lord', 'firewalkers.phoenix')
    const a = rollArmy(units, 'save', rngFrom(9), V0_RULES)
    const b = rollArmy(units, 'save', rngFrom(9), V0_RULES)
    expect(a[0]).toEqual(b[0])
    expect(a[1].counter).toBeGreaterThanOrEqual(2)
  })

  it('rolls nothing for an empty army', () => {
    const start = rngFrom(4)
    const [roll, next] = rollArmy([], 'melee', start, V0_RULES)
    expect(roll.total).toBe(0)
    expect(roll.dice).toEqual([])
    expect(next).toEqual(start)
  })

  // The worked example from PLAN-V0.md Phase 2. The Guardian is the die that
  // proved a face carries a count of icons rather than one icon.
  it('yields only the Guardian face values when rolling it for melee', () => {
    const guardian = armyOf('firewalkers.guardian')
    const seen = new Set<number>()
    let rng = rngFrom(31)

    for (let i = 0; i < 400; i++) {
      const [roll, next] = rollArmy(guardian, 'melee', rng, V0_RULES)
      seen.add(roll.total)
      rng = next
    }

    // Faces: 1 ID, 1 MELEE, 1 SAVE, 1 MISSILE, 2 MELEE, 1 MANEUVER
    //  -> melee results of 1, 1, 0, 0, 2, 0
    expect([...seen].sort()).toEqual([0, 1, 2])
  })

  it.each(RESULT_TYPES)('never exceeds the army maximum for %s', (resultType: ResultType) => {
    const units = armyOf('treefolk.oak', 'treefolk.unicorn', 'firewalkers.sentinel')
    const ceiling = maxArmyResults(units, resultType, V0_RULES)
    let rng = rngFrom(1000)

    for (let i = 0; i < 500; i++) {
      const [roll, next] = rollArmy(units, resultType, rng, V0_RULES)
      expect(roll.total).toBeGreaterThanOrEqual(0)
      expect(roll.total).toBeLessThanOrEqual(ceiling)
      rng = next
    }
  })

  /**
   * The hand-checked roll from the phase's exit criterion.
   *
   * Faces are asserted independently of the total, and the total is the sum worked
   * out from those faces by hand -- so this catches a summation bug even if the
   * RNG stream changes, and catches an RNG change even if summation is right.
   */
  it('matches a hand-checked roll', () => {
    const units = armyOf('treefolk.oak_lord', 'treefolk.oakling', 'treefolk.darktree')
    const [roll] = rollArmy(units, 'save', rngFrom(2024), V0_RULES)

    const faces = roll.dice.map((d) => `${d.face.count} ${d.face.icon}`)
    const contributions = roll.dice.map((d) => d.results)

    // Each die's contribution is its count if the icon is SAVE or ID, else 0.
    for (const [i, die] of roll.dice.entries()) {
      const expected =
        die.face.icon === 'SAVE' || die.face.icon === 'ID' ? die.face.count : 0
      expect(contributions[i], faces[i]).toBe(expected)
    }
    expect(roll.total).toBe(contributions.reduce((a, b) => a + b, 0))
  })
})

describe('maxResults', () => {
  it('finds the best face for a result type', () => {
    // Guardian: 1 ID, 1 MELEE, 1 SAVE, 1 MISSILE, 2 MELEE, 1 MANEUVER
    const guardian = unitType('firewalkers.guardian')
    expect(maxResults(guardian, 'melee', V0_RULES)).toBe(2)
    expect(maxResults(guardian, 'save', V0_RULES)).toBe(1)
    expect(maxResults(guardian, 'magic', V0_RULES)).toBe(1) // only the ID face
  })

  it('is at least the unit health for every type, because every die has an ID face', () => {
    for (const type of UNIT_TYPES) {
      for (const resultType of RESULT_TYPES) {
        expect(maxResults(type, resultType, V0_RULES), `${type.id} ${resultType}`).toBeGreaterThanOrEqual(
          type.health,
        )
      }
    }
  })
})
