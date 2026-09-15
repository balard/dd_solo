/**
 * The reducer.
 *
 * `reduce(state, action) => state`. Pure: no side effects, no clocks, no ambient
 * randomness. Randomness comes from `state.rng`, so replaying an action log
 * reproduces a game die for die.
 */
import { applyAction, stepGame } from './turn'
import { IllegalActionError, type GameAction, type GameState } from './types'

/**
 * How many advance steps before we assume the state machine is looping.
 *
 * A pure reducer that fails to reach a decision would otherwise hang the UI with no
 * clue why. This turns that into a loud, debuggable error -- worth having from the
 * start, since the fuzz harness in Phase 6 exists precisely to provoke it.
 */
const MAX_ADVANCE_STEPS = 1000

/**
 * Runs the game forward through every step that needs no decision, stopping at the
 * next `Pending` or at game over.
 *
 * This is what lets the UI animate a melee exchange -- attack roll, saves, damage --
 * from `state.log` while the engine treats the whole thing as one transition. It is
 * also where a future SAI with a delayed effect becomes a new stopping point rather
 * than a restructure of the turn loop.
 */
export function advance(state: GameState): GameState {
  let current = state

  for (let step = 0; step < MAX_ADVANCE_STEPS; step++) {
    if (current.winner !== null || current.pending !== null) {
      return current
    }

    const next = stepGame(current)
    if (next === current) {
      return current // nothing left to do without a decision
    }
    current = next
  }

  throw new Error(
    `advance did not settle after ${MAX_ADVANCE_STEPS} steps ` +
      `(phase ${current.turn.phase}, march ${current.turn.marchIndex}/${current.turn.marchStep})`,
  )
}

export function reduce(state: GameState, action: GameAction): GameState {
  if (state.winner !== null) {
    throw new IllegalActionError(`the game is over; ${state.winner} has won`)
  }

  const pending = state.pending
  if (pending === null) {
    throw new IllegalActionError(
      `received ${action.kind} but the engine is not waiting on a decision`,
    )
  }

  if (pending.kind !== action.kind) {
    throw new IllegalActionError(
      `received ${action.kind} but the engine is waiting for ${pending.kind}`,
    )
  }

  // `applyAction` clears `pending` and never sets one, so `advance` always runs at
  // least one `stepGame` -- which is what makes the victory check run after every
  // state change rather than only at end of turn.
  return advance(applyAction(state, action))
}

/**
 * Starts a freshly set-up game running: advances from the opening position to the
 * first real decision.
 */
export function begin(state: GameState): GameState {
  return advance(state)
}
