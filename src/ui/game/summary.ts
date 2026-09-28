/**
 * What a finished game leaves behind (v2 Phase 3e): the data point a pacing test is
 * after -- how it ended, on which turn, after how long, and how much of each side was
 * left standing.
 *
 * Pure, like `prompts.ts`. The clock is the one input the state does not hold: it is
 * the client's, and never enters the engine.
 */
import { unitType } from '../../data/load'
import { forceSize, livingUnits, type GameState, type PlayerId } from '../../engine/types'

export type EndedBy = 'captures' | 'elimination' | 'concession'

export interface SideLeft {
  /** Health still in play: at a terrain or in Reserves. */
  readonly left: number
  /** What the side brought, dead and buried included. */
  readonly of: number
}

export interface GameSummary {
  readonly won: boolean
  readonly endedBy: EndedBy
  /** The sentence: "You captured two terrains", "The enemy conceded". */
  readonly headline: string
  /** The turn it ended on, as the header counts; 0 when it ended before the first. */
  readonly turn: number
  readonly elapsedMs: number
  readonly mine: SideLeft
  readonly theirs: SideLeft
}

/**
 * The turn the game is on, as the header shows it: turns finished, plus the one in
 * progress. Each player's turn counts on its own, the way the rules count them.
 */
export function turnNumber(state: GameState): number {
  return state.log.filter((e) => e.kind === 'turn_end').length + 1
}

const healthIn = (state: GameState, player: PlayerId): SideLeft => ({
  left: livingUnits(state, player).reduce((sum, unit) => sum + unitType(unit.typeId).health, 0),
  of: forceSize(state, player),
})

function headline(endedBy: EndedBy, won: boolean): string {
  switch (endedBy) {
    case 'captures':
      return won ? 'You captured two terrains' : 'The enemy captured two terrains'
    case 'elimination':
      return won ? 'The enemy has no units left' : 'You have no units left'
    case 'concession':
      return won ? 'The enemy conceded' : 'You conceded'
  }
}

/** The summary of a finished game, or null while it is still being played. */
export function gameSummary(state: GameState, human: PlayerId, elapsedMs: number): GameSummary | null {
  if (state.winner === null) return null
  const victory = [...state.log].reverse().find((e) => e.kind === 'victory')
  if (victory?.kind !== 'victory') throw new Error('a game with a winner has no victory entry')
  const enemy: PlayerId = human === 'p1' ? 'p2' : 'p1'
  const won = state.winner === human
  return {
    won,
    endedBy: victory.reason,
    headline: headline(victory.reason, won),
    // Given up at the roll-off, the choice is still open: no turn was ever played.
    turn: state.rollOff !== undefined ? 0 : turnNumber(state),
    elapsedMs,
    mine: healthIn(state, human),
    theirs: healthIn(state, enemy),
  }
}

/** "0:07", "12:40", "1:02:09": minutes and seconds, and hours once there are any. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`
}
