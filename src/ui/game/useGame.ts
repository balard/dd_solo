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

import {
  DEFAULT_OPPONENT,
  OPPONENT_NAMES,
  OPPONENTS,
  opponentNamed,
  type OpponentName,
} from '../../ai/opponents'
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
import { V1_RULES, type GameAction, type GameState, type PlayerId, type UnitId } from '../../engine/types'

import { boardAt, marksIn } from './boardView'
import { advanceCursor, heldBack, pastEverything, rollStops, type RollCursor, type RollStep } from './presentation'
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
  readonly start: (setup: SetupOptions, opponent: OpponentName) => void
}

export interface PlayingGame {
  readonly phase: 'playing'
  readonly state: GameState
  /**
   * What the board, the ticker and the log draw (v2 Phase 9c): `state` itself, or --
   * while a roll card is up -- the state as far as the cards have got, so no outcome
   * shows before its card. Every decision still reads `state`.
   */
  readonly board: GameState
  /** The dice the card on screen is about to change, and how: "falls", "Flame". */
  readonly marks: ReadonlyMap<UnitId, string>
  readonly human: PlayerId
  readonly seed: number
  /** Who is answering the other side's decisions. */
  readonly opponent: OpponentName
  readonly origin: GameOrigin
  readonly opponentThinking: boolean
  readonly dispatch: (action: GameAction) => void
  /**
   * The roll the player has not seen yet (v2 Phase 3c), or null when none is waiting.
   * While one is, the game does not move on: the opponent does not act, and the
   * player's own decision is not offered until they continue.
   */
  readonly rollShown: RollShown | null
  /** Back to the start screen, to pick forces again. */
  readonly newGame: () => void
  /** Starts another game in place of this one: a run's next battle (v3 Phase 4b). */
  readonly start: (setup: SetupOptions, opponent: OpponentName) => void
  readonly record: GameRecord
  /**
   * The game's clock (v2 Phase 3e): wall time from the moment it started, and the
   * moment it ended, or null while it is on. Client state only -- no clock ever enters
   * the engine -- and the record does not carry it, since replay is not play.
   */
  readonly startedAt: number
  readonly endedAt: number | null
}

export type Game = ChoosingGame | PlayingGame

export interface RollShown {
  readonly step: RollStep
  /** 1-based, out of `of`: the rolls waiting since the game last moved on. */
  readonly number: number
  readonly of: number
  /** On to the next roll, or back to the game after the last one. */
  readonly next: () => void
  /** Past every roll still waiting. */
  readonly skip: () => void
}

const NO_MARKS: ReadonlyMap<UnitId, string> = new Map()

export const newSeed = () => Math.floor(Math.random() * 100_000)

/** What the address bar asked for, once read. */
export interface GameRequest {
  readonly setup: SetupOptions
  readonly opponent: OpponentName
  readonly origin: GameOrigin
}

/**
 * A game named in the address bar: `?forces=bestiary`, `?seed=1234`, `?ai=passive`,
 * or any of them together.
 *
 * The start screen has covered most of what this was for, but a link is still the
 * one way to hand someone the exact board you are looking at, and it is how the
 * pairings in `FORCE_SETS` stay reachable without a rebuild. Returns null when the
 * URL asks for nothing, which is the ordinary case.
 *
 * An unrecognised `forces` name is reported rather than ignored: silently rolling a
 * random force would look exactly like a preset that does not work.
 */
export function parseGameRequest(search: string, fallbackSeed: number): GameRequest | null {
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
  const aiParam = given('ai')
  if (name === null && seedParam === null && aiParam === null) return null

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

  // The same rule for the opponent: a name nobody knows is reported, never swapped
  // for the default without a word.
  let opponent: OpponentName = DEFAULT_OPPONENT
  if (aiParam !== null) {
    const found = opponentNamed(aiParam)
    if (found === null) {
      problem ??= `there is no opponent named "${aiParam}" -- try ${OPPONENT_NAMES.join(' or ')}`
    } else {
      opponent = found
    }
  }

  const setup: SetupOptions = { seed, forces, ruleSet: V1_RULES }
  return problem === null
    ? { setup, opponent, origin: { kind: 'requested', forces: name, seed } }
    : { setup, opponent, origin: { kind: 'recovered', reason: problem } }
}

/** `parseGameRequest` against the real address bar. Split so the parsing can be
 *  tested without a DOM, the way `prompts.ts` is. */
function requestedFromUrl(): GameRequest | null {
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
  /**
   * The state the last action started from (v2 Phase 9c). Every entry the cards have
   * not shown yet was written since it -- nothing acts while a card is up -- so the
   * board on screen is rebuilt forwards from here (`boardView.ts`).
   */
  readonly before: GameState
  readonly setup: SetupOptions
  /** Chosen with the forces, and fixed for the game: the record replays without it,
   *  since it stores the actions the opponent produced and never asks it again. */
  readonly opponent: OpponentName
  readonly actions: readonly GameAction[]
  readonly origin: GameOrigin
  /**
   * How far through the log's rolls the player has looked (v2 Phase 3c). The one
   * thing the step-through needs that the state does not hold; the steps themselves
   * are `rollSteps` of the log from here.
   */
  readonly rolls: RollCursor
  readonly startedAt: number
  /** Set by the action that produced a winner, whoever sent it. */
  readonly endedAt: number | null
}

function sessionFrom(setup: SetupOptions, opponent: OpponentName, origin: GameOrigin): Session {
  const set = setupGame(setup)
  return {
    state: begin(set),
    before: set,
    setup,
    opponent,
    actions: [],
    origin,
    rolls: { log: 0, step: 0 },
    // Reading the clock has no side effect, so this may run twice under StrictMode.
    startedAt: Date.now(),
    endedAt: null,
  }
}

/** The address bar, or the start screen. Nothing is read from storage: saving is
 *  off, so there is never a game to resume. */
function opening(): Session | null {
  const requested = requestedFromUrl()
  return requested === null ? null : sessionFrom(requested.setup, requested.opponent, requested.origin)
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

export function useGame(): Game {
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
    setSession((current) => {
      if (current === null) return current
      const state = reduce(current.state, action)
      return {
        ...current,
        state,
        before: current.state,
        actions: [...current.actions, action],
        endedAt: current.endedAt ?? (state.winner !== null ? Date.now() : null),
      }
    })
  }, [])
  const nextRoll = useCallback(() => {
    setSession((current) =>
      current === null ? current : { ...current, rolls: advanceCursor(current.state, current.rolls, human) },
    )
  }, [])
  const skipRolls = useCallback(() => {
    setSession((current) =>
      current === null ? current : { ...current, rolls: pastEverything(current.state) },
    )
  }, [])

  const start = useCallback((setup: SetupOptions, opponent: OpponentName) => {
    aiRng.current = rngFrom(setup.seed ^ 0x5eed)
    setSession(sessionFrom(setup, opponent, { kind: 'chosen' }))
  }, [])

  const newGame = useCallback(() => setSession(null), [])

  // The opponent answers anything addressed to it, after a beat so the player can
  // read what just happened rather than watching the board jump.
  const state = session?.state ?? null
  const pending = state?.pending ?? null
  const ai = OPPONENTS[session?.opponent ?? DEFAULT_OPPONENT]
  const steps = session === null ? [] : rollStops(session.state, session.rolls, human)
  const waiting = session === null ? 0 : steps.length - session.rolls.step
  useEffect(() => {
    // A roll the player has not seen yet holds the game where it is.
    if (state === null || state.winner !== null || pending === null || pending.player === human || waiting > 0) {
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
  }, [state, pending, ai, dispatch, human, waiting])

  if (session === null) {
    lastRecord = null
    return { phase: 'choosing', start }
  }

  const record: GameRecord = { setup: session.setup, actions: session.actions }
  lastRecord = record

  // The board waits for the card (v2 Phase 9c).
  const held = waiting > 0 ? heldBack(steps, session.rolls.step) : null

  return {
    phase: 'playing',
    state: session.state,
    board: held === null ? session.state : boardAt(session.state, session.before, held.from),
    marks: held === null ? NO_MARKS : marksIn(session.state.log.slice(held.marking[0], held.marking[1])),
    human,
    seed,
    opponent: session.opponent,
    origin: session.origin,
    opponentThinking,
    dispatch,
    rollShown:
      waiting > 0
        ? {
            step: steps[session.rolls.step] as RollStep,
            number: session.rolls.step + 1,
            of: steps.length,
            next: nextRoll,
            skip: skipRolls,
          }
        : null,
    newGame,
    start,
    record,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  }
}
