/**
 * The opponents a player can pick, by name (v1 Phase 10d).
 *
 * One table for all three places a name arrives from -- the start screen, `?ai=` and
 * the terminal's `--ai` -- so the three cannot disagree about what "greedy" means or
 * which opponent a game gets when nobody says. The `FORCE_SETS` pattern, for the same
 * reason.
 *
 * `RandomAI` is not here. It is a test tool, not an opponent: the terminal reaches it
 * through its own flag, and the app never offers it.
 */
import { greedyAi } from './greedy'
import { passiveAi } from './passive'
import type { AiPlayer } from './types'

export const OPPONENTS = {
  greedy: greedyAi,
  passive: passiveAi,
} as const satisfies Readonly<Record<string, AiPlayer>>

export type OpponentName = keyof typeof OPPONENTS

/** What a game gets when nothing names an opponent: the one that plays. */
export const DEFAULT_OPPONENT: OpponentName = 'greedy'

export const OPPONENT_NAMES = Object.keys(OPPONENTS) as readonly OpponentName[]

/** The named opponent, or null -- so a caller reports a name nobody recognises
 *  rather than quietly handing over a different opponent. */
export function opponentNamed(name: string): OpponentName | null {
  return (OPPONENT_NAMES as readonly string[]).includes(name) ? (name as OpponentName) : null
}
