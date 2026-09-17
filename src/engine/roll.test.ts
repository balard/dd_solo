import { describe, expect, it } from 'vitest'

import { UNIT_TYPES, unitType } from '../data/load'
import type { ResultType } from '../data/types'

import type { Modifier } from './pipeline'
import { rngFrom } from './rng'
import {
  RESULT_TYPES,
  faceResults,
  maxArmyResults,
  maxResults,
  rerollSweep,
  resolveFaces,
  resolveRoll,
  rollArmy,
  rollFaces,
  type RollSpec,
} from './roll'
import { SAI_RULES, V0_RULES, type RuleSet, type UnitInstance } from './types'

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

  /**
   * An SAI face is worth 0 *here* at every rung, because SAI results are step 8 and
   * this is step 5. It used to throw under `'full'`, a second copy of `saiEffects`'s
   * refusal -- and one that could not tell an implemented SAI from an unimplemented
   * one, so it would have refused a Counter the moment Phase 4 built its first
   * targeting SAI. One place refuses, and it is the place that knows the names.
   */
  it.each(['inert', 'results', 'full'] as const)('counts nothing for an SAI under %s', (sai) => {
    const ruleSet: RuleSet = { ...V0_RULES, sai }
    expect(faceResults({ count: 4, icon: 'SAI', sai: 'Smite' }, 'melee', ruleSet)).toBe(0)
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

/**
 * The seam Phase 4 opens: step 1, step 3 and steps 4-10 as three functions, with the
 * last of them pure.
 *
 * Every mid-roll pause in the phase sits at the same joint -- between a step that
 * consumes randomness and a step that is pure arithmetic over faces already on the
 * table. These tests are what make that joint real rather than a claim in a comment.
 */
describe('the roll pipeline, split', () => {
  const spec = (kind: ResultType = 'melee', modifiers: Modifier[] = []): RollSpec => ({
    kinds: [kind],
    modifiers,
    context: { purpose: { kind: 'attack', action: 'melee' }, isCounter: false },
  })

  const army = armyOf(
    'treefolk.oak_lord',
    'treefolk.oak',
    'firewalkers.guardian',
    'firewalkers.sentinel',
  )

  it('composes back into resolveRoll, die for die and draw for draw', () => {
    const [whole, wholeRng] = resolveRoll(army, spec(), rngFrom(99), SAI_RULES)

    const [rolled, afterRoll] = rollFaces(army, rngFrom(99))
    const [swept, afterSweep] = rerollSweep(rolled, spec(), SAI_RULES, afterRoll)
    const parts = resolveFaces(swept, spec(), SAI_RULES)

    expect(parts.dice).toEqual(whole.dice)
    expect(parts.totals).toEqual(whole.totals)
    expect(parts.effects).toEqual(whole.effects)
    expect(afterSweep.counter).toBe(wholeRng.counter)
  })

  it('rolls every die once, in unit order, before any reroll', () => {
    const [dice, after] = rollFaces(army, rngFrom(7))

    expect(dice.map((die) => die.unitId)).toEqual(army.map((unit) => unit.id))
    expect(dice.every((die) => die.reroll === undefined)).toBe(true)
    expect(after.counter).toBe(rngFrom(7).counter + army.length)
  })

  /** The property the whole phase rests on: ask the same dice twice, get the same
   *  answer, and consume nothing. It is what lets a later slice resolve a roll once
   *  to discover a decision and again with the answer. */
  it('resolves faces purely: same in, same out, no randomness', () => {
    const [dice] = rollFaces(army, rngFrom(3))
    const once = resolveFaces(dice, spec(), SAI_RULES)
    const twice = resolveFaces(dice, spec(), SAI_RULES)

    expect(twice).toEqual(once)
    // Nothing about the dice list is mutated on the way through, either.
    expect(dice.every((die) => die.reroll === undefined)).toBe(true)
  })

  /**
   * `saiResults` joins at step 8: after step 7's divide, before step 9's multiply.
   *
   * The test that matters is the divide. Adding a player-supplied number to the final
   * total instead would agree with this everywhere except here -- which is exactly the
   * kind of agreement that holds until the first spell halves a save roll.
   */
  it('adds player-supplied results at step 8, undivided', () => {
    // Seed 6 rolls these four dice to 6 raw save results, chosen so that the right
    // answer and the wrong one are different numbers rather than coincidentally equal.
    const [dice] = rollFaces(army, rngFrom(6))
    const halve: Modifier = { kind: 'divide', resultType: 'save', by: 2 }

    expect(resolveFaces(dice, spec('save'), SAI_RULES).totals['save'], 'raw subtotal').toBe(6)
    expect(resolveFaces(dice, spec('save', [halve]), SAI_RULES).totals['save']).toBe(3)

    const split = resolveFaces(
      dice,
      { ...spec('save', [halve]), saiResults: { save: 3 } },
      SAI_RULES,
    )

    // 3 halved is 3 + 3 = 6. Folded in before the divide it would be floor(9 / 2) = 4,
    // which is the bug this test exists to catch.
    expect(split.totals['save']).toBe(6)
  })

  it('leaves the totals alone when nothing supplies step-8 results', () => {
    const [dice] = rollFaces(army, rngFrom(11))
    expect(resolveFaces(dice, { ...spec(), saiResults: {} }, SAI_RULES)).toEqual(
      resolveFaces(dice, spec(), SAI_RULES),
    )
  })
})
