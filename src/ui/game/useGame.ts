/**
 * Binds the engine to React.
 *
 * Thin on purpose: the engine already *is* the state machine, so this holds a
 * `GameState`, dispatches actions into `reduce`, records them for replay, and lets
 * the AI answer whenever the pending decision is not the human's.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { passiveAi } from '../../ai/passive'
import type { AiPlayer } from '../../ai/types'
import { begin, reduce } from '../../engine/reduce'
import type { GameRecord } from '../../engine/replay'
import { rngFrom, type RngState } from '../../engine/rng'
import { setupGame, type SetupOptions } from '../../engine/setup'
import type { GameAction, GameState, PlayerId } from '../../engine/types'

/** How long to let the player read the opponent's move before the next one. */
const AI_THINKING_MS = 650

export interface Game {
  readonly state: GameState
  readonly human: PlayerId
  readonly seed: number
  /** True while the opponent is deciding, so the UI can say so. */
  readonly opponentThinking: boolean
  readonly dispatch: (action: GameAction) => void
  readonly newGame: (seed?: number) => void
  readonly record: GameRecord
}

const newSeed = () => Math.floor(Math.random() * 100_000)

function freshGame(seed: number): { state: GameState; setup: SetupOptions } {
  const setup: SetupOptions = {
    seed,
    forces: { p1: 'treefolk_starter', p2: 'firewalkers_starter' },
  }
  return { state: begin(setupGame(setup)), setup }
}

export function useGame(initialSeed?: number, ai: AiPlayer = passiveAi): Game {
  const [seed, setSeed] = useState(initialSeed ?? newSeed)
  const [{ state, setup }, setGame] = useState(() => freshGame(initialSeed ?? seed))
  const [actions, setActions] = useState<GameAction[]>([])
  const [opponentThinking, setOpponentThinking] = useState(false)

  const aiRng = useRef<RngState>(rngFrom(seed ^ 0x5eed))
  const human: PlayerId = 'p1'

  const dispatch = useCallback((action: GameAction) => {
    setGame((current) => ({ ...current, state: reduce(current.state, action) }))
    setActions((current) => [...current, action])
  }, [])

  const newGame = useCallback((next?: number) => {
    const value = next ?? newSeed()
    setSeed(value)
    aiRng.current = rngFrom(value ^ 0x5eed)
    setGame(freshGame(value))
    setActions([])
  }, [])

  // The opponent answers anything addressed to it, after a beat so the player can
  // read what just happened rather than watching the board jump.
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
    opponentThinking,
    dispatch,
    newGame,
    record: { setup, actions },
  }
}
