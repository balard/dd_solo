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
import { FORCE_SETS, namedForces, setupGame, type ForceSpec, type SetupOptions } from '../../engine/setup'
import { DUA_RULES, type GameAction, type GameState, type PlayerId } from '../../engine/types'

import { clearSave, readSave, writeSave } from './storage'

/** How long to let the player read the opponent's move before the next one. */
const AI_THINKING_MS = 650

/** How the current game came to be, so the UI can say something honest about it. */
export type GameOrigin =
  | { readonly kind: 'new' }
  | { readonly kind: 'resumed'; readonly savedAt: string }
  | { readonly kind: 'recovered'; readonly reason: string }
  /** Started from `?forces=` / `?seed=` in the address bar. */
  | { readonly kind: 'requested'; readonly forces: string | null; readonly seed: number }

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

/**
 * A game named in the address bar: `?forces=bestiary`, `?seed=1234`, or both.
 *
 * This is how the hand-authored pairings are reachable at all from the browser --
 * `data/presets.json` is content, and there is no reason a player should have to
 * rebuild the app to look at a board made of monsters. Returns null when the URL
 * asks for nothing, which is the ordinary case.
 *
 * An unrecognised `forces` name is reported rather than ignored: silently rolling a
 * random force would look exactly like a preset that does not work.
 */
export function parseGameRequest(
  search: string,
  fallbackSeed: number,
): { setup: SetupOptions; origin: GameOrigin } | null {
  const params = new URLSearchParams(search)
  // An empty value is the same as an absent one. `?seed=` reads back as `''`, and
  // `Number('')` is 0 -- a perfectly legal seed, and a silently different game from
  // the one a link like that was asking for, which is none.
  const given = (key: string): string | null => {
    const value = params.get(key)?.trim()
    return value === undefined || value === '' ? null : value
  }

  const name = given('forces')
  const seedParam = given('seed')
  if (name === null && seedParam === null) return null

  const parsed = seedParam === null ? NaN : Number(seedParam)
  const seed = Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackSeed

  let forces: ForceSpec = { kind: 'random' }
  let problem: string | null = null
  if (name !== null) {
    const found = namedForces(name)
    if (found === null) {
      problem = `there is no force named "${name}" -- try ${Object.keys(FORCE_SETS).join(' or ')}`
    } else {
      forces = found
    }
  }

  const setup: SetupOptions = { seed, forces, ruleSet: DUA_RULES }
  return problem === null
    ? { setup, origin: { kind: 'requested', forces: name, seed } }
    : { setup, origin: { kind: 'recovered', reason: problem } }
}

/** `parseGameRequest` against the real address bar. Split so the parsing can be
 *  tested without a DOM, the way `prompts.ts` is. */
function requestedFromUrl(): { setup: SetupOptions; origin: GameOrigin } | null {
  if (typeof window === 'undefined') return null
  return parseGameRequest(window.location.search, newSeed())
}

/**
 * Takes the request out of the address bar once it has been honoured.
 *
 * Without this a refresh restarts the game instead of resuming it, and losing a
 * game in progress to a reload is a worse bug than the feature is a feature. The
 * link still works for whoever it is sent to; it just does not re-fire.
 *
 * **Called from an effect, never from `restore`.** `restore` is a `useState`
 * initializer and StrictMode runs those twice in development: stripping the query
 * on the first pass left the second reading a bare URL and rolling a random game,
 * which is the whole feature not working and only in dev.
 */
function clearUrlRequest(): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') return
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
}

interface Session {
  readonly state: GameState
  readonly setup: SetupOptions
  readonly actions: readonly GameAction[]
  readonly origin: GameOrigin
}

function fresh(seed: number, origin: GameOrigin = { kind: 'new' }): Session {
  // Named explicitly rather than left to `setupGame`'s `V0_RULES` default, so the
  // record says which rules it was played under and replays under them for good.
  const setup: SetupOptions = { seed, forces: { kind: 'random' }, ruleSet: DUA_RULES }
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
  // The address bar wins over the save: `?forces=bestiary` that quietly resumed
  // yesterday's random game would look like a preset that does not work. The save
  // itself needs no clearing -- the persist effect writes this game over it on
  // mount -- and nothing here may have side effects anyway; see `clearUrlRequest`.
  const requested = requestedFromUrl()
  if (requested !== null) {
    return {
      state: begin(setupGame(requested.setup)),
      setup: requested.setup,
      actions: [],
      origin: requested.origin,
    }
  }

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

  // Honoured, so take it out of the address bar -- in an effect, because this is a
  // side effect and `restore` must stay callable twice.
  useEffect(() => {
    if (session.origin.kind === 'requested') clearUrlRequest()
    // Once, for the game the app opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
