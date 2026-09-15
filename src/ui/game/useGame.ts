/**
 * Binds the engine to React, and keeps the game on disk.
 *
 * Thin on purpose: the engine already *is* the state machine, so this holds a
 * `GameState`, dispatches actions into `reduce`, records them for replay, lets the
 * AI answer whatever is addressed to it, and persists the record after every move.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { passiveAi } from '../../ai/passive'
import type { AiPlayer } from '../../ai/types'
import { begin, reduce } from '../../engine/reduce'
import { replay, type GameRecord } from '../../engine/replay'
import { rngFrom, type RngState } from '../../engine/rng'
import { setupGame, type SetupOptions } from '../../engine/setup'
import type { GameAction, GameState, PlayerId } from '../../engine/types'

import { clearSave, readSave, writeSave } from './storage'

/** How long to let the player read the opponent's move before the next one. */
const AI_THINKING_MS = 650

/** How the current game came to be, so the UI can say something honest about it. */
export type GameOrigin =
  | { readonly kind: 'new' }
  | { readonly kind: 'resumed'; readonly savedAt: string }
  | { readonly kind: 'recovered'; readonly reason: string }

export interface Game {
  readonly state: GameState
  readonly human: PlayerId
  readonly seed: number
  readonly origin: GameOrigin
  /** False when the browser refused to store the game (private window, full quota). */
  readonly saving: boolean
  readonly opponentThinking: boolean
  readonly dispatch: (action: GameAction) => void
  readonly newGame: (seed?: number) => void
  readonly record: GameRecord
}

const newSeed = () => Math.floor(Math.random() * 100_000)

interface Session {
  readonly state: GameState
  readonly setup: SetupOptions
  readonly actions: readonly GameAction[]
  readonly origin: GameOrigin
}

function fresh(seed: number, origin: GameOrigin = { kind: 'new' }): Session {
  const setup: SetupOptions = { seed, forces: { kind: 'random' } }
  return { state: begin(setupGame(setup)), setup, actions: [], origin }
}

/**
 * Restores the saved game, or explains why it could not and starts a new one.
 *
 * Replay can fail even on a well-formed save if the rules have changed underneath
 * it -- a decision that was legal last week may not be now. That is a recoverable
 * situation, not a crash, so it is caught here and reported.
 */
function restore(): Session {
  const result = readSave()

  switch (result.kind) {
    case 'none':
      return fresh(newSeed())
    case 'outdated':
      clearSave()
      return fresh(newSeed(), {
        kind: 'recovered',
        reason: 'that save was made by an older version of the rules',
      })
    case 'unreadable':
      clearSave()
      return fresh(newSeed(), { kind: 'recovered', reason: result.reason })
    case 'ok':
      break
  }

  try {
    const state = replay(result.save.record)
    return {
      state,
      setup: result.save.record.setup,
      actions: result.save.record.actions,
      origin: { kind: 'resumed', savedAt: result.save.savedAt },
    }
  } catch (error) {
    clearSave()
    return fresh(newSeed(), {
      kind: 'recovered',
      reason: `the saved moves no longer replay (${String(error)})`,
    })
  }
}

export function useGame(ai: AiPlayer = passiveAi): Game {
  const [session, setSession] = useState<Session>(restore)
  const [saving, setSaving] = useState(true)
  const [opponentThinking, setOpponentThinking] = useState(false)

  const human: PlayerId = 'p1'
  const seed = session.setup.seed
  const aiRng = useRef<RngState>(rngFrom(seed ^ 0x5eed))

  // The AI's own randomness is derived from the seed and how far the game has got,
  // so a resumed game continues the same way a live one would.
  useEffect(() => {
    aiRng.current = rngFrom((seed ^ 0x5eed) + session.actions.length)
    // Only on a change of game, not on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  const dispatch = useCallback((action: GameAction) => {
    setSession((current) => ({
      ...current,
      state: reduce(current.state, action),
      actions: [...current.actions, action],
    }))
  }, [])

  const newGame = useCallback((next?: number) => {
    const value = next ?? newSeed()
    aiRng.current = rngFrom(value ^ 0x5eed)
    clearSave()
    setSession(fresh(value))
  }, [])

  // Persist after every move. Writing the record rather than the state means this
  // stays a few KB however long the game runs.
  const record: GameRecord = { setup: session.setup, actions: session.actions }
  useEffect(() => {
    setSaving(writeSave(record))
    // The action count is what changes; the setup does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, session.actions.length])

  // The opponent answers anything addressed to it, after a beat so the player can
  // read what just happened rather than watching the board jump.
  const { state } = session
  const pending = state.pending
  useEffect(() => {
    if (state.winner !== null || pending === null || pending.player === human) {
      setOpponentThinking(false)
      return
    }

    setOpponentThinking(true)
    const timer = setTimeout(() => {
      const [action, nextRng] = ai.decide(state, pending, aiRng.current)
      aiRng.current = nextRng
      dispatch(action)
    }, AI_THINKING_MS)

    return () => clearTimeout(timer)
  }, [state, pending, ai, dispatch, human])

  return {
    state,
    human,
    seed,
    origin: session.origin,
    saving,
    opponentThinking,
    dispatch,
    newGame,
    record,
  }
}
