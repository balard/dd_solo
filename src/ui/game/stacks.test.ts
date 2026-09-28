import { describe, expect, it } from 'vitest'

import { begin } from '../../engine/reduce'
import { setupGame, STARTER_FORCES } from '../../engine/setup'
import type { GameState, UnitInstance } from '../../engine/types'

import {
  COMPACT_PORTRAIT_SIZE,
  COMPACT_TILE_SIZE,
  LADDER,
  PORTRAIT_SIZE,
  TILE_SIZE,
  densityFor,
  linesNeeded,
  singledIds,
  stackIdentical,
} from './stacks'

let next = 0
const die = (typeId: string): UnitInstance => ({
  id: `u${next++}`,
  typeId,
  owner: 'p1',
  location: { kind: 'terrain', slot: 'frontier' },
})
const many = (typeId: string, n: number) => Array.from({ length: n }, () => die(typeId))
const NONE: ReadonlySet<string> = new Set()

describe('the size ladder', () => {
  /** 3a finding 4: at most one step down, and never under the tap target. */
  it('never draws a tile under 44px or art under 30px', () => {
    for (const side of Object.values(COMPACT_TILE_SIZE)) expect(side).toBeGreaterThanOrEqual(44)
    for (const side of Object.values(COMPACT_PORTRAIT_SIZE)) expect(side).toBeGreaterThanOrEqual(30)
  })

  it('keeps the die sizes apart at both steps, and the art inside its tile', () => {
    for (const [tiles, art] of [
      [TILE_SIZE, PORTRAIT_SIZE],
      [COMPACT_TILE_SIZE, COMPACT_PORTRAIT_SIZE],
    ] as const) {
      expect(tiles.small).toBeLessThan(tiles.medium)
      expect(tiles.medium).toBeLessThan(tiles.large)
      expect(tiles.large).toBeLessThan(tiles.monster)
      for (const size of ['small', 'medium', 'large', 'monster'] as const) {
        expect(art[size]).toBeLessThan(tiles[size])
      }
    }
  })

  it('is today, today stacked, compact stacked -- in that order', () => {
    expect(LADDER).toEqual([
      { compact: false, stacked: false },
      { compact: false, stacked: true },
      { compact: true, stacked: true },
    ])
  })
})

describe('stackIdentical', () => {
  it('puts dice of one type together, in display order', () => {
    const army = [die('treefolk.oakling'), die('treefolk.darktree'), die('treefolk.oakling'), die('treefolk.oak')]
    const stacks = stackIdentical(army, NONE)
    expect(stacks.map((stack) => [stack[0]?.typeId, stack.length])).toEqual([
      ['treefolk.darktree', 1],
      ['treefolk.oak', 1],
      ['treefolk.oakling', 2],
    ])
  })

  /** A sleeping die, or one under any effect aimed at that unit: the effect follows the
   *  die and not its twins, so a shared tile would claim it of all of them. */
  it('never stacks a singled die with its twins', () => {
    const oaks = many('treefolk.oak', 3)
    const stacks = stackIdentical(oaks, new Set([oaks[1]?.id ?? '']))
    expect(stacks.map((stack) => stack.length).sort()).toEqual([1, 2])
    expect(stacks.find((stack) => stack.length === 1)?.[0]).toBe(oaks[1])
  })

  it('loses no die', () => {
    const army = [...many('treefolk.oakling', 4), ...many('treefolk.pine', 2), die('treefolk.unicorn')]
    const ids = stackIdentical(army, NONE).flat().map((unit) => unit.id)
    expect(ids.sort()).toEqual(army.map((unit) => unit.id).sort())
  })
})

describe('singledIds', () => {
  it('is every unit an effect is aimed at, and no army', () => {
    const state: GameState = begin(setupGame({ seed: 1, forces: STARTER_FORCES, firstPlayer: 'p1' }))
    const [first] = Object.keys(state.units)
    const withEffects: GameState = {
      ...state,
      effects: [
        {
          source: 'Sleep',
          target: { kind: 'unit', unitId: first ?? '' },
          modifiers: [],
          asleep: true,
          expiresAtStartOfTurnOf: 'p2',
        },
        {
          source: 'Stone Skin',
          target: { kind: 'army', player: 'p1', army: 'frontier' },
          modifiers: [],
          expiresAtStartOfTurnOf: 'p1',
        },
      ],
    }
    expect([...singledIds(withEffects)]).toEqual([first])
  })
})

describe('linesNeeded', () => {
  it('wraps the way flex-wrap does', () => {
    expect(linesNeeded([], 100, 5)).toBe(0)
    expect(linesNeeded([48, 48], 101, 5)).toBe(1)
    expect(linesNeeded([48, 48], 100, 5)).toBe(2)
    // A tile wider than the room still takes a line of its own, not two.
    expect(linesNeeded([200, 48], 100, 5)).toBe(2)
  })
})

describe('densityFor', () => {
  it("draws today's tiles until the width is measured", () => {
    expect(densityFor([many('treefolk.oakling', 30)], NONE, 0, 1)).toEqual(LADDER[0])
  })

  it("keeps today's tiles when they fit", () => {
    expect(densityFor([many('treefolk.oakling', 3)], NONE, 300, 1)).toEqual(LADDER[0])
  })

  it('stacks before it shrinks', () => {
    // Eight small dice need two lines at 300px, and stack into one tile.
    expect(densityFor([many('treefolk.oakling', 8)], NONE, 300, 1)).toEqual(LADDER[1])
  })

  it('shrinks one step when stacking alone does not fit, and no further', () => {
    // Six different dice, no twins: stacking gains nothing, Compact gains a line.
    const varied = ['oakling', 'pineling', 'willowling', 'hamadryad', 'nymph', 'oak'].map((name) =>
      die(`treefolk.${name}`),
    )
    expect(densityFor([varied], NONE, 300, 1)).toEqual(LADDER[2])
    // And a pile-up that fits nowhere stays at the last rung: a scroll, not a smaller die.
    const pileUp = ['oakling', 'pineling', 'willowling', 'hamadryad', 'nymph', 'oak', 'pine', 'willow']
      .map((name) => die(`treefolk.${name}`))
    expect(densityFor([pileUp], NONE, 150, 1)).toEqual(LADDER[2])
  })

  /** The taller side decides, so the armies facing each other share one scale. */
  it('takes one rung for both sides of a place', () => {
    const few = many('treefolk.oakling', 1)
    const crowded = ['oakling', 'pineling', 'willowling', 'hamadryad', 'nymph', 'oak'].map((name) =>
      die(`treefolk.${name}`),
    )
    expect(densityFor([few, crowded], NONE, 300, 1)).toEqual(densityFor([crowded], NONE, 300, 1))
  })
})
