/**
 * The opponent interface.
 *
 * An AI is a pure function from a blocked game to the decision that unblocks it --
 * the same shape as a human answering `state.pending`. Nothing in the engine knows
 * which side is which, so a human, a `PassiveAI` and a search-based AI are all
 * interchangeable action sources.
 *
 * Randomness is threaded rather than ambient, for the same reason as in the engine:
 * a run is reproducible from its seeds.
 */
import type { RngState } from '../engine/rng'
import type { GameAction, GameState, Pending } from '../engine/types'

export interface AiPlayer {
  readonly name: string
  /**
   * Answers `state.pending`, which is passed separately so implementations get a
   * non-null `Pending` without re-narrowing.
   */
  decide(state: GameState, pending: Pending, rng: RngState): readonly [GameAction, RngState]
}
