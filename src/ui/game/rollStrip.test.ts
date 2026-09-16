import { describe, expect, it } from 'vitest'

import { chainRerolls, type StripDie } from './DiceGrid'

/**
 * The engine appends rerolls at the end of a roll, because that is the order the
 * dice were thrown and the order the RNG was consumed. The strip has to show them
 * beside the die they came from instead, or a Rend sits at the front with its second
 * face near the back and nothing joining them.
 */
const die = (unitId: string, faceIndex: number, reroll?: true): StripDie => ({
  unitId,
  typeId: 'treefolk.strangle_vine',
  faceIndex,
  face: { count: 4, icon: 'MELEE' },
  results: 4,
  ...(reroll === undefined ? {} : { reroll }),
})

const shape = (dice: readonly StripDie[]) =>
  chainRerolls(dice).map((chain) => chain.map((d) => `${d.unitId}@${d.faceIndex}`))

describe('chainRerolls', () => {
  it('leaves a roll with no rerolls exactly as it was', () => {
    expect(shape([die('a', 1), die('b', 2), die('c', 3)])).toEqual([['a@1'], ['b@2'], ['c@3']])
  })

  it('pulls a reroll back beside the die that caused it', () => {
    // What `resolveRoll` actually produces: every die once, then the rerolls.
    expect(shape([die('a', 8), die('b', 2), die('a', 0, true)])).toEqual([
      ['a@8', 'a@0'],
      ['b@2'],
    ])
  })

  it('keeps a chain in the order it was rolled, because the arrow means "and then"', () => {
    expect(shape([die('a', 8), die('a', 8, true), die('a', 3, true)])).toEqual([
      ['a@8', 'a@8', 'a@3'],
    ])
  })

  it('chains two rerolling dice independently', () => {
    expect(shape([die('a', 8), die('b', 8), die('a', 1, true), die('b', 2, true)])).toEqual([
      ['a@8', 'a@1'],
      ['b@8', 'b@2'],
    ])
  })

  it('never drops a die, whatever the order', () => {
    const dice = [die('a', 8), die('b', 2), die('a', 1, true), die('c', 3), die('a', 5, true)]
    expect(chainRerolls(dice).flat()).toHaveLength(dice.length)
  })

  /** A reroll with nothing to attach to should still be drawn rather than lost. */
  it('stands a stray reroll on its own', () => {
    expect(shape([die('a', 1, true), die('b', 2)])).toEqual([['a@1'], ['b@2']])
  })
})
