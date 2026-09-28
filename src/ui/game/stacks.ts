/**
 * How big a die is drawn, and when identical dice share one tile (v2 Phase 3d).
 *
 * 3a measured the landscape board against a 36-health pile-up and settled on a ladder
 * of three steps: today's tiles, today's tiles with identical dice stacked, and
 * Compact -- the 44px tap-target floor -- stacked. Never smaller than that: the bare
 * class shapes that went lower were a mockup artefact, legible only because the
 * mockup had no art to lose (3a finding 5). So a crowded terrain costs a short scroll
 * rather than a tile under the thumb.
 *
 * Pure, like `prompts.ts`: the board measures one width and asks this what fits.
 */
import { unitType } from '../../data/load'
import type { UnitSize } from '../../data/types'
import type { GameState, UnitId, UnitInstance } from '../../engine/types'

import { orderedForDisplay } from './prompts'

/**
 * The tile's side per die size, so a tile reads at a glance the way the physical dice
 * do -- a monster die really is the big one in the hand. Two floors box these in:
 * 44px, the smallest comfortable tap, and 30px of art, below which a glyph reads
 * better than the real face (measured, `OVERVIEW.md` section 5).
 */
export const TILE_SIZE: Record<UnitSize, number> = { small: 48, medium: 54, large: 60, monster: 70 }
/** One step down, and the last one (3a finding 4): the smallest tile sits on the tap floor. */
export const COMPACT_TILE_SIZE: Record<UnitSize, number> = { small: 44, medium: 46, large: 50, monster: 56 }

/**
 * The ID face inside the tile. **Larger in 3d** than the 30/34/38/46 it was: 3b left it
 * alone because stacking is what frees the room, and a portrait sized before that
 * would have been sized twice. Corner badge and health overlap its margins, not its
 * middle, and an ID face's figure is in the middle.
 */
export const PORTRAIT_SIZE: Record<UnitSize, number> = { small: 34, medium: 38, large: 44, monster: 54 }
/** Compact never goes under the 30px art floor, which is why small stops at 32. */
export const COMPACT_PORTRAIT_SIZE: Record<UnitSize, number> = { small: 32, medium: 34, large: 38, monster: 44 }

export function tileSize(typeId: string, compact: boolean): number {
  const size: UnitSize = unitType(typeId).size
  return (compact ? COMPACT_TILE_SIZE : TILE_SIZE)[size]
}

export function portraitSize(typeId: string, compact: boolean): number {
  const size: UnitSize = unitType(typeId).size
  return (compact ? COMPACT_PORTRAIT_SIZE : PORTRAIT_SIZE)[size]
}

/**
 * Dice that can never share a tile: every die under an effect aimed at that one unit,
 * Sleep among them. The effect follows the die, not its twins, so a stack of three
 * Oaks with one asleep would be a claim about all three that is true of one.
 */
export function singledIds(state: GameState): ReadonlySet<UnitId> {
  const ids = new Set<UnitId>()
  for (const effect of state.effects) {
    if (effect.target.kind === 'unit') ids.add(effect.target.unitId)
  }
  return ids
}

/**
 * An army as tiles: identical dice together, in display order.
 *
 * **Identical means the same type in the same state** (3a finding 3). A die in
 * `singled` is always a tile of its own. Each stack lists its dice in display order,
 * and the first is the one the tile draws and a tap inspects -- identical dice are
 * interchangeable, which is the whole reason a count can stand for them.
 */
export function stackIdentical(
  units: readonly UnitInstance[],
  singled: ReadonlySet<UnitId>,
): readonly (readonly UnitInstance[])[] {
  const stacks: UnitInstance[][] = []
  const byType = new Map<string, UnitInstance[]>()
  for (const unit of orderedForDisplay(units)) {
    if (singled.has(unit.id)) {
      stacks.push([unit])
      continue
    }
    const seen = byType.get(unit.typeId)
    if (seen !== undefined) {
      seen.push(unit)
      continue
    }
    const stack = [unit]
    stacks.push(stack)
    byType.set(unit.typeId, stack)
  }
  return stacks
}

/** The gap between tiles in a grid, and in a stacked one: the ×N badge and the second
 *  edge stick out past a stack's tile, so stacked tiles stand further apart. */
export const GRID_GAP = 5
export const STACKED_GAP = 12

/** How many lines a row of tiles wraps to in `room` pixels, as `flex-wrap` lays it out. */
export function linesNeeded(widths: readonly number[], room: number, gap: number): number {
  let lines = 0
  let used = 0
  for (const width of widths) {
    if (lines === 0) {
      lines = 1
      used = width
    } else if (used + gap + width > room) {
      lines += 1
      used = width
    } else {
      used += gap + width
    }
  }
  return lines
}

/** One rung of 3a's ladder. */
export interface Density {
  readonly compact: boolean
  readonly stacked: boolean
}

export const LADDER: readonly Density[] = [
  { compact: false, stacked: false },
  { compact: false, stacked: true },
  { compact: true, stacked: true },
]

/** How many lines the armies at one place take on a rung: the taller side decides. */
export function linesAt(
  sides: readonly (readonly UnitInstance[])[],
  singled: ReadonlySet<UnitId>,
  room: number,
  rung: Density,
): number {
  return Math.max(
    0,
    ...sides.map((units) => {
      const tiles = rung.stacked ? stackIdentical(units, singled).map((s) => s[0] as UnitInstance) : units
      return linesNeeded(
        tiles.map((unit) => tileSize(unit.typeId, rung.compact)),
        room,
        rung.stacked ? STACKED_GAP : GRID_GAP,
      )
    }),
  )
}

/**
 * The rung a place is drawn at: the first whose taller side fits in `budget` lines, or
 * the last rung when none does -- the overflow is a short scroll, not a smaller die.
 *
 * Both sides of one place take the same rung, so the two armies facing each other are
 * drawn at one scale and can be compared by eye. `room` of zero means the width is not
 * measured yet, and draws today's tiles.
 */
export function densityFor(
  sides: readonly (readonly UnitInstance[])[],
  singled: ReadonlySet<UnitId>,
  room: number,
  budget: number,
): Density {
  const first = LADDER[0] as Density
  if (room <= 0) return first
  return (
    LADDER.find((rung) => linesAt(sides, singled, room, rung) <= budget) ??
    (LADDER[LADDER.length - 1] as Density)
  )
}
