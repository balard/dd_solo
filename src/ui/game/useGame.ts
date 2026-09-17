/**
 * Binds the engine to React.
 *
 * Thin on purpose: the engine already *is* the state machine, so this holds a
 * `GameState`, dispatches actions into `reduce`, records them for replay, and lets
 * the AI answer whatever is addressed to it.
 *
 * It has two phases, because there is no longer a game until someone asks for one.
 * `null` is the start screen; a `Session` is a game in progress. Saving is off (see
 * `storage.ts`), so every launch and every reload starts at the screen -- which is
 * the point of it while the rules underneath are still changing weekly.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { passiveAi } from '../../ai/passive'
import type { AiPlayer } from '../../ai/types'
import { begin, reduce } from '../../engine/reduce'
import { type GameRecord } from '../../engine/replay'
import { rngFrom, type RngState } from '../../engine/rng'
import {
  FORCE_SETS,
  namedForces,
  setupGame,
  type ForceSpec,
  type SetupOptions,
} from '../../engine/setup'
import { FULL_RULES, type GameAction, type GameState, type PlayerId } from '../../engine/types'

import { clearSave } from './storage'

/** How long to let the player read the opponent's move before the next one. */
const AI_THINKING_MS = 650

/** How the current game came to be, so the UI can say something honest about it. */
export type GameOrigin =
  | { readonly kind: 'chosen' }
  | { readonly kind: 'recovered'; readonly reason: string }
  /** Started from `?forces=` / `?seed=` in the address bar. */
  | { readonly kind: 'requested'; readonly forces: string | null; readonly seed: number }

export interface ChoosingGame {
  readonly phase: 'choosing'
  readonly start: (setup: SetupOptions) => void
}

export interface PlayingGame {
  readonly phase: 'playing'
  readonly state: GameState
  readonly human: PlayerId
  readonly seed: number
  readonly origin: GameOrigin
  readonly opponentThinking: boolean
  readonly dispatch: (action: GameAction) => void
  /** Back to the start screen, to pick forces again. */
  readonly newGame: () => void
  readonly record: GameRecord
}

export type Game = ChoosingGame | PlayingGame

export const newSeed = () => Math.floor(Math.random() * 100_000)

/**
 * A game named in the address bar: `?forces=bestiary`, `?seed=1234`, or both.
 *
 * The start screen has covered most of what this was for, but a link is still the
 * one way to hand someone the exact board you are looking at, and it is how the
 * pairings in `FORCE_SETS` stay reachable without a rebuild. Returns null when the
 * URL asks for nothing, which is the ordinary case.
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

  const setup: SetupOptions = { seed, forces, ruleSet: FULL_RULES }
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
 * Without this a refresh re-runs the link instead of landing on the start screen,
 * and a link you cannot get back out of is a worse feature than no link. It still
 * works for whoever it is sent to; it just does not re-fire.
 *
 * **Called from an effect, never from the `useState` initializer.** StrictMode runs
 * those twice in development: stripping the query on the first pass left the second
 * reading a bare URL and showing the start screen, which is the whole feature not
 * working and only in dev.
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

function sessionFrom(setup: SetupOptions, origin: GameOrigin): Session {
  return { state: begin(setupGame(setup)), setup, actions: [], origin }
}

/** The address bar, or the start screen. Nothing is read from storage: saving is
 *  off, so there is never a game to resume. */
function opening(): Session | null {
  const requested = requestedFromUrl()
  return requested === null ? null : sessionFrom(requested.setup, requested.origin)
}

/**
 * The record of the game on screen, for `ErrorBoundary` to print when everything
 * else has gone.
 *
 * A module-level variable rather than a prop, because the boundary sits *above* the
 * hook -- by the time it renders, the tree that held the game is gone. It used to
 * read the record back out of `localStorage`, which stopped working when saving did,
 * and the seed plus the moves is the one thing worth having off a crash: a game is
 * its record, so that is enough to reproduce the failure exactly.
 */
let lastRecord: GameRecord | null = null

export function currentRecord(): GameRecord | null {
  return lastRecord
}

export function useGame(ai: AiPlayer = passiveAi): Game {
  const [session, setSession] = useState<Session | null>(opening)
  const [opponentThinking, setOpponentThinking] = useState(false)

  const human: PlayerId = 'p1'
  const seed = session?.setup.seed ?? -1

  useEffect(() => {
    // Honoured, so take it out of the address bar -- in an effect, because this is a
    // side effect and `opening` must stay callable twice.
    if (session?.origin.kind === 'requested') clearUrlRequest()
    // A save written back when the app still saved would otherwise sit there for good.
    clearSave()
    // Once, for whatever the app opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const aiRng = useRef<RngState>(rngFrom(seed ^ 0x5eed))

  const dispatch = useCallback((action: GameAction) => {
    setSession((current) =>
      current === null
        ? current
        : {
            ...current,
            state: reduce(current.state, action),
            actions: [...current.actions, action],
          },
    )
  }, [])

  const start = useCallback((setup: SetupOptions) => {
    aiRng.current = rngFrom(setup.seed ^ 0x5eed)
    setSession(sessionFrom(setup, { kind: 'chosen' }))
  }, [])

  const newGame = useCallback(() => setSession(null), [])

  // The opponent answers anything addressed to it, after a beat so the player can
  // read what just happened rather than watching the board jump.
  const state = session?.state ?? null
  const pending = state?.pending ?? null
  useEffect(() => {
    if (state === null || state.winner !== null || pending === null || pending.player === human) {
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

  if (session === null) {
    lastRecord = null
    return { phase: 'choosing', start }
  }

  const record: GameRecord = { setup: session.setup, actions: session.actions }
  lastRecord = record

  return {
    phase: 'playing',
    state: session.state,
    human,
    seed,
    origin: session.origin,
    opponentThinking,
    dispatch,
    newGame,
    record,
  }
}
