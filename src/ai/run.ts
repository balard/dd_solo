/**
 * The headless harness: plays a game between two action sources and records it.
 *
 * Deterministic from `seed` and `aiSeed` alone, so a failure found by self-play can
 * be handed to someone as two integers.
 */
import { begin, reduce } from '../engine/reduce'
import type { GameRecord } from '../engine/replay'
import { rngFrom } from '../engine/rng'
import { setupGame, type SetupOptions } from '../engine/setup'
import { validateState } from '../engine/validate'
import type { GameAction, GameState, PlayerId } from '../engine/types'

import type { AiPlayer } from './types'

export interface RunOptions {
  readonly setup: SetupOptions
  readonly players: Readonly<Record<PlayerId, AiPlayer>>
  /** Seed for the AIs' own choices, kept separate from the game's dice. */
  readonly aiSeed?: number
  /** Give up after this many decisions. */
  readonly maxDecisions?: number
  /** Check every intermediate state. Slower; on by default because that is the point. */
  readonly validate?: boolean
}

export interface RunResult {
  readonly state: GameState
  readonly record: GameRecord
  readonly decisions: number
  readonly stoppedBecause: 'winner' | 'stuck' | 'cap'
}

export function runGame(options: RunOptions): RunResult {
  const shouldValidate = options.validate ?? true
  const cap = options.maxDecisions ?? 5000

  let state = begin(setupGame(options.setup))
  let rng = rngFrom(options.aiSeed ?? 1)
  const actions: GameAction[] = []

  while (state.winner === null && state.pending !== null && actions.length < cap) {
    const pending = state.pending
    const ai = options.players[pending.player]
    const [action, nextRng] = ai.decide(state, pending, rng)
    rng = nextRng

    state = reduce(state, action)
    actions.push(action)

    if (shouldValidate) {
      const problems = validateState(state)
      if (problems.length > 0) {
        throw new Error(
          `invalid state after decision ${actions.length} (${action.kind}), ` +
            `seed ${options.setup.seed}/ai ${options.aiSeed ?? 1}:\n  ${problems.join('\n  ')}`,
        )
      }
    }
  }

  const stoppedBecause =
    state.winner !== null ? 'winner' : state.pending === null ? 'stuck' : 'cap'

  return { state, record: { setup: options.setup, actions }, decisions: actions.length, stoppedBecause }
}
