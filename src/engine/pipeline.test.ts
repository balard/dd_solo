import { describe, expect, it } from 'vitest'

import type { ResultType } from '../data/types'

import {
  allocateIds,
  applyModifiers,
  doubleIdsModifier,
  type Modifier,
  type Share,
} from './pipeline'
import { rngFrom } from './rng'
import { defaultContextFor, faceResults, resolveRoll, rollArmy } from './roll'
import { V0_RULES, type UnitInstance } from './types'

const share = (id: number, normal: number, sai = 0): Share => ({ id, normal, sai })

const subtract = (amount: number, resultType: ResultType = 'melee'): Modifier => ({
  kind: 'subtract',
  resultType,
  amount,
})
const divide = (by: number, resultType: ResultType = 'melee'): Modifier => ({
  kind: 'divide',
  resultType,
  by,
})
const multiply = (by: number, resultType: ResultType = 'melee'): Modifier => ({
  kind: 'multiply',
  resultType,
  by,
  share: 'all',
})
const add = (amount: number, resultType: ResultType = 'melee'): Modifier => ({
  kind: 'add',
  resultType,
  amount,
})

const armyOf = (...typeIds: string[]): UnitInstance[] =>
  typeIds.map((typeId, i) => ({
    id: `t:${i}`,
    typeId,
    owner: 'p1' as const,
    location: { kind: 'terrain' as const, slot: 'frontier' as const },
  }))

describe('the pipeline runs its steps in the rulebook order', () => {
  /**
   * The reason the whole phase exists. Both modifiers are in the list; which one
   * lands first is the pipeline's business, not the list's, so the array order is
   * deliberately the wrong one.
   */
  it('subtracts (6) before it divides (7)', () => {
    expect(applyModifiers(share(0, 10), 'melee', [divide(2), subtract(2)])).toBe(4)
    // Dividing first would give 10 / 2 - 2 = 3.
  })

  it('divides (7) before it adds SAI results (8), which are never divided', () => {
    expect(applyModifiers(share(0, 4, 3), 'melee', [divide(2)])).toBe(5)
    // Dividing the SAI results too would give (4 + 3) / 2 = 3.
  })

  it('multiplies (9) before it adds (10)', () => {
    expect(applyModifiers(share(0, 2), 'melee', [add(3), multiply(2)])).toBe(7)
    // Adding first would give (2 + 3) * 2 = 10.
  })

  it('multiplies SAI results, which have joined the subtotal by step 9', () => {
    expect(applyModifiers(share(0, 0, 3), 'melee', [multiply(2)])).toBe(6)
  })

  it('rounds a division down', () => {
    expect(applyModifiers(share(0, 7), 'melee', [divide(2)])).toBe(3)
  })

  it('never reduces a result below zero', () => {
    expect(applyModifiers(share(1, 1), 'melee', [subtract(10)])).toBe(0)
  })

  it('leaves a roll alone when there are no modifiers', () => {
    expect(applyModifiers(share(3, 4), 'melee', [])).toBe(7)
  })
})

describe('ID results are the last to be removed', () => {
  /**
   * "When results are subtracted or divided, ID results are the last results to be
   * removed by those modifiers" (full rules, Roll Modifiers, p. 28). It only shows
   * up in the total once something treats the ID share differently -- so each case
   * here follows the removal with the eighth face's ID doubling, which is exactly
   * that something.
   */
  it('subtracts from the normal share first', () => {
    // 3 ID + 4 normal, less 5: the normal share goes, then one ID.
    expect(applyModifiers(share(3, 4), 'melee', [subtract(5)])).toBe(2)
    expect(applyModifiers(share(3, 4), 'melee', [subtract(5), doubleIdsModifier('melee')])).toBe(4)
    // Removing ID first would leave 0 ID and 2 normal, which doubles to 2.
  })

  it('divides the normal share away first', () => {
    // 3 ID + 4 normal halves to 3 results, and all three of them are ID.
    expect(applyModifiers(share(3, 4), 'melee', [divide(2)])).toBe(3)
    expect(applyModifiers(share(3, 4), 'melee', [divide(2), doubleIdsModifier('melee')])).toBe(6)
  })

  it('takes ID results when there is nothing else left to take', () => {
    expect(applyModifiers(share(6, 1), 'melee', [divide(2)])).toBe(3)
    expect(applyModifiers(share(6, 1), 'melee', [divide(2), doubleIdsModifier('melee')])).toBe(6)
  })
})

describe('the one-modifier rules', () => {
  it('rejects two dividers on one result type', () => {
    expect(() => applyModifiers(share(0, 8), 'melee', [divide(2), divide(2)])).toThrow(/at most one/)
  })

  it('rejects two multipliers on one result type', () => {
    expect(() => applyModifiers(share(0, 8), 'melee', [multiply(2), multiply(3)])).toThrow(/at most one/)
  })

  it('rejects two ID doublings', () => {
    expect(() =>
      applyModifiers(share(2, 0), 'melee', [doubleIdsModifier('melee'), doubleIdsModifier('melee')]),
    ).toThrow(/at most one/)
  })

  /**
   * The eighth face's doubling is its type's one multiplier, not a free extra:
   * "there may never be more than one modifier that multiplies applied to each type
   * of result" says nothing about which part of the roll each one multiplies. What
   * two multipliers on one type would compute is unanswerable until Phase 7, when a
   * spell can produce the second -- and nothing before then can reach it, so the
   * strict reading costs nothing and invents nothing.
   */
  it('counts an ID doubling as the one multiplier that type is allowed', () => {
    expect(() =>
      applyModifiers(share(2, 3), 'melee', [doubleIdsModifier('melee'), multiply(2)]),
    ).toThrow(/at most one/)
  })

  it('counts per result type, and picks its own type out of the list', () => {
    // A save divider is not a melee divider, and must not be mistaken for one.
    expect(applyModifiers(share(0, 8), 'melee', [divide(2), divide(2, 'save')])).toBe(4)
    expect(applyModifiers(share(0, 8), 'save', [divide(2), divide(2, 'save')])).toBe(4)
    expect(applyModifiers(share(0, 8), 'magic', [divide(2), divide(2, 'save')])).toBe(8)
  })
})

describe('allocateIds', () => {
  it('gives every ID to the only type on offer', () => {
    expect(allocateIds(5, ['melee'], undefined).get('melee')).toBe(5)
  })

  it('refuses an allocation for a roll with nothing to allocate', () => {
    expect(() => allocateIds(5, ['melee'], { melee: 5 })).toThrow(/no ID allocation to make/)
  })

  it('requires one for a combination roll, where the owner chooses', () => {
    expect(() => allocateIds(5, ['melee', 'save'], undefined)).toThrow(/needs an ID allocation/)
  })

  it('makes the allocation spend the pool exactly', () => {
    expect(() => allocateIds(5, ['melee', 'save'], { melee: 2, save: 2 })).toThrow(/spends 4 of 5/)
    expect(() => allocateIds(5, ['melee', 'save'], { melee: 4, save: 2 })).toThrow(/spends 6 of 5/)
  })

  it('rejects a type the roll does not count', () => {
    expect(() => allocateIds(5, ['melee', 'save'], { melee: 5, magic: 0 })).toThrow(
      /does not count/,
    )
  })
})

describe('a combination roll', () => {
  /**
   * A dragon attack is one roll counted for melee, missile and save at once. The
   * dice are the same dice either way -- the seed is shared here on purpose -- so
   * the only question is how the ID results are spent, and the answer must be
   * "once".
   */
  const units = armyOf(
    'treefolk.oak_lord',
    'treefolk.oak',
    'treefolk.darktree',
    'firewalkers.guardian',
    'firewalkers.phoenix',
  )
  const kinds: ResultType[] = ['melee', 'missile', 'save']
  const rng = rngFrom(31)

  const [reference] = resolveRoll(units, { kinds: ['melee'], modifiers: [], context: defaultContextFor('melee') }, rng, V0_RULES)
  const idPool = reference.dice.reduce(
    (sum, die) => sum + (die.face.icon === 'ID' ? die.face.count : 0),
    0,
  )
  /** What each type is worth before any ID is spent on it. */
  const withoutIds = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      reference.dice.reduce(
        (sum, die) => sum + (die.face.icon === 'ID' ? 0 : faceResults(die.face, kind, V0_RULES)),
        0,
      ),
    ]),
  ) as Record<ResultType, number>

  it('has ID results to spend, or it is not testing anything', () => {
    expect(idPool).toBeGreaterThan(0)
    // And something other than ID, or "spent once" is trivially true.
    expect(kinds.reduce((sum, kind) => sum + withoutIds[kind], 0)).toBeGreaterThan(0)
  })

  it('spends each ID result on exactly one type', () => {
    const allocation = { melee: idPool, missile: 0, save: 0 }
    const [outcome] = resolveRoll(units, { kinds, modifiers: [], context: defaultContextFor('melee'), idAllocation: allocation }, rng, V0_RULES)

    const total = kinds.reduce((sum, kind) => sum + (outcome.totals[kind] ?? 0), 0)
    const expected = kinds.reduce((sum, kind) => sum + withoutIds[kind], 0) + idPool
    expect(total).toBe(expected)
  })

  it('splits them however the owner likes, without changing the sum', () => {
    const spread = { melee: 0, missile: 1, save: idPool - 1 }
    const [outcome] = resolveRoll(units, { kinds, modifiers: [], context: defaultContextFor('melee'), idAllocation: spread }, rng, V0_RULES)

    expect(outcome.totals['missile']).toBe(withoutIds['missile'] + 1)
    expect(outcome.totals['save']).toBe(withoutIds['save'] + idPool - 1)
    expect(outcome.totals['melee']).toBe(withoutIds['melee'])
  })

  it('rolls the same dice as any other roll of the same army on the same seed', () => {
    const [outcome, after] = resolveRoll(
      units,
      {
        kinds,
        modifiers: [],
        context: defaultContextFor('melee'),
        idAllocation: { melee: idPool, missile: 0, save: 0 },
      },
      rng,
      V0_RULES,
    )
    const [, afterSingle] = resolveRoll(units, { kinds: ['melee'], modifiers: [], context: defaultContextFor('melee') }, rng, V0_RULES)

    expect(outcome.dice.map((d) => d.faceIndex)).toEqual(reference.dice.map((d) => d.faceIndex))
    // Counting a roll for three types costs no more randomness than counting it
    // for one, which is what keeps a dragon attack replayable.
    expect(after).toEqual(afterSingle)
  })
})

describe('rollArmy over the pipeline', () => {
  const units = armyOf('treefolk.oak_lord', 'treefolk.darktree', 'firewalkers.guardian')

  it('agrees with resolveRoll, which it is a door onto', () => {
    const [roll, afterRoll] = rollArmy(units, 'melee', rngFrom(12), V0_RULES)
    const [outcome, afterResolve] = resolveRoll(
      units,
      { kinds: ['melee'], modifiers: [], context: defaultContextFor('melee') },
      rngFrom(12),
      V0_RULES,
    )

    expect(roll.total).toBe(outcome.totals['melee'])
    expect(roll.dice).toEqual(outcome.dice)
    expect(afterRoll).toEqual(afterResolve)
  })

  it('doubles ID results as a step-9 modifier, and says so on the die', () => {
    const [plain] = rollArmy(units, 'melee', rngFrom(12), V0_RULES, false)
    const [doubled] = rollArmy(units, 'melee', rngFrom(12), V0_RULES, true)

    const idDice = plain.dice.filter((d) => d.face.icon === 'ID')
    const idResults = idDice.reduce((sum, d) => sum + d.results, 0)

    expect(doubled.total).toBe(plain.total + idResults)
    // The per-die number the log shows has to agree with the total it is part of.
    expect(doubled.dice.reduce((sum, d) => sum + d.results, 0)).toBe(doubled.total)
  })
})
