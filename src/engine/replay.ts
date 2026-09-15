/**
 * Recording and replaying games.
 *
 * A game is fully described by its setup options plus the ordered list of decisions
 * taken. Nothing else needs storing: the RNG is a pure function of `{seed, counter}`
 * inside the state, so replaying the actions reproduces every die exactly.
 *
 * That makes a save file a few KB, an undo a truncated replay, and a bug report
 * something you can hand over and re-run.
 */
import { begin, reduce } from './reduce'
import { setupGame, type SetupOptions } from './setup'
import type { GameAction, GameState } from './types'

export interface GameRecord {
  readonly setup: SetupOptions
  readonly actions: readonly GameAction[]
}

export function replay(record: GameRecord): GameState {
  return record.actions.reduce((state, action) => reduce(state, action), begin(setupGame(record.setup)))
}

/** Replays only the first `count` decisions -- the basis for undo. */
export function replayTo(record: GameRecord, count: number): GameState {
  return replay({ setup: record.setup, actions: record.actions.slice(0, count) })
}
