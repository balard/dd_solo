/**
 * Which board is drawn (v2 Phase 3d), and the one fact about a terrain only the
 * landscape board shows: whose side of the die owns it.
 *
 * Two layouts render from the same data. `cards` is the board as it was, three
 * terrain cards that stack into a column under 900px. `landscape` is a row per terrain,
 * your army on the left, the die in the middle, the enemy's on the right. 3a measured
 * both and found density a phone problem: held sideways a phone is under 900px wide,
 * so the cards stack into two to four screens of scrolling, and the rows fit. Hence
 * the rule below -- sideways opens on landscape, upright keeps the cards, and anywhere
 * else it is the viewer's choice.
 *
 * Pure, so the rule is tested in node like `newGame.ts`; `useLayout` binds it.
 */
import type { PlayerId, TerrainSlot } from '../../engine/types'

export type Layout = 'cards' | 'landscape'

export const LAYOUTS: readonly Layout[] = ['cards', 'landscape']

export interface Viewport {
  readonly width: number
  readonly height: number
}

/**
 * A phone held sideways: wider than tall, and short. 500px clears every phone's
 * landscape height (the 3a frame was 390) and no laptop window's.
 */
export function isPhoneSideways({ width, height }: Viewport): boolean {
  return width > height && height < 500
}

/**
 * A phone held upright. Landscape is not meant for it -- three columns at 390px is
 * three columns of nothing -- so the cards are its layout whatever was chosen, and no
 * choice is offered (3a: "phones held upright were measured for comparison only").
 */
export function isPhoneUpright({ width, height }: Viewport): boolean {
  return width < 600 && height >= width
}

export function canChooseLayout(viewport: Viewport): boolean {
  return !isPhoneUpright(viewport)
}

/**
 * The board to draw. A link's `?layout=` beats the viewer's remembered choice, which
 * beats the default; the default is landscape on a phone sideways and the cards
 * everywhere else. An upright phone gets the cards regardless.
 */
export function layoutFor(
  viewport: Viewport,
  chosen: Layout | null,
  linked: Layout | null,
): Layout {
  if (isPhoneUpright(viewport)) return 'cards'
  return linked ?? chosen ?? (isPhoneSideways(viewport) ? 'landscape' : 'cards')
}

export function asLayout(value: string | null | undefined): Layout | null {
  return LAYOUTS.find((layout) => layout === value) ?? null
}

/**
 * `?layout=landscape` or `?layout=cards`, beside the `forces`, `seed` and `ai` that
 * `parseGameRequest` reads. Apart from it on purpose: a layout is how the board is
 * drawn, not which game is played, so on its own it starts nothing -- the start
 * screen still opens. An unknown value is ignored, since it cannot change an outcome.
 */
export function parseLayout(search: string): Layout | null {
  return asLayout(new URLSearchParams(search).get('layout')?.trim())
}

/** Where a terrain's owner is marked: on your side of the die, the enemy's, or neither. */
export type TerrainTag = 'HOME' | 'HELD'

export interface TerrainTags {
  readonly mine: TerrainTag | null
  readonly theirs: TerrainTag | null
}

/**
 * Who a terrain belongs to, on the owner's side of the die (3a finding 6).
 *
 * A die in the middle of the row reads as neutral, which a Home Terrain is not. So the
 * home's owner gets HOME on their side, and whoever has captured the eighth face gets
 * HELD on theirs -- which wins over HOME when you hold your own home, since that is
 * the fact that can win the game. The Frontier is nobody's until it is held.
 */
export function terrainTags(
  slot: TerrainSlot,
  capturedBy: PlayerId | null,
  human: PlayerId,
): TerrainTags {
  const enemy: PlayerId = human === 'p1' ? 'p2' : 'p1'
  const home: PlayerId | null = slot === 'p1_home' ? 'p1' : slot === 'p2_home' ? 'p2' : null
  const tagOf = (player: PlayerId): TerrainTag | null =>
    capturedBy === player ? 'HELD' : home === player ? 'HOME' : null
  return { mine: tagOf(human), theirs: tagOf(enemy) }
}
