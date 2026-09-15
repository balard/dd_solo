/**
 * The reducer.
 *
 * `reduce(state, action) => state`. Pure: no side effects, no clocks, no ambient
 * randomness. Randomness comes from `state.rng`, so replaying an action log
 * reproduces a game die for die.
 *
 * Phase 1 supplies the skeleton: the action/pending guard, and the auto-advance
 * loop. The phase handlers themselves land in Phases 4 and 5 -- until then
 * `advance` has nothing to do and every action is rejected, because no decision is
 * ever pending.
 */
import type { GameAction, GameState } from './types'
import { IllegalActionError } from './types'

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

    const next = step_(current)
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

/**
 * One step of the phase machine. Returns the same object when there is nothing to
 * do, which is how `advance` knows to stop.
 *
 * Phase 4 fills this in.
 */
function step_(state: GameState): GameState {
  return state
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

  // Phase 4-5 apply the action here. Until then the guard above is the whole
  // reducer, which is exactly what the phase can honestly claim to provide.
  return advance(state)
}
