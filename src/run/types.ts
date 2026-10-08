/**
 * The run (v3): a roguelike layer **above** the engine.
 *
 * A run is a reducer like a game is -- `reduceRun(run, action) => run`, pure and seeded,
 * the RNG in the state -- and its next decision is an explicit `run.pending` the clients
 * render from: the engine's invariants 1 and 3, one level up. A battle is not inside a
 * run's state. The run asks for one (`pending: battle`) and is told only who won.
 *
 * `src/run/` depends on `src/engine/` and `src/data/`, never on `src/ui/` or `src/ai/`
 * (`purity.test.ts`). The engine does not know runs exist.
 */
import type { Collection } from '../data/collections'
import type { BuiltForce } from '../engine/force'
import type { RngState } from '../engine/rng'
import type { PlayerId } from '../engine/types'

export type Act = 1 | 2 | 3

export const ACTS: readonly Act[] = [1, 2, 3]

/** The force-size cap of each act, which is also the size of the enemies met there. */
export const ACT_SIZE: Readonly<Record<Act, number>> = { 1: 12, 2: 24, 3: 36 }

/** Encounters played in each act. The act's pool holds more, drawn without replacement. */
export const ENCOUNTERS_PER_ACT = 12

/** One in ten draws: seven battles to three events, and seven race dice to three of any. */
export const BATTLE_IN_10 = 7
export const RACE_DIE_IN_10 = 7

/** How many unit dice a reward offers, beside its one dragon and one terrain. */
export const UNIT_OFFERS = 3

/** The human's seat in every battle. `battle_ended` names a winner, and this is a win. */
export const RUN_PLAYER: PlayerId = 'p1'

export type EncounterKind = 'battle' | 'event'

/**
 * One encounter of an act's pool. Phase 0 knows only what the run itself reads: what
 * kind it is and how to name it. Phase 1 adds the enemy and the opponent, from
 * `data/encounters.json`.
 */
export interface Encounter {
  readonly id: string
  readonly act: Act
  readonly kind: EncounterKind
  readonly name: string
}

/** Every encounter a run can draw, by act: the reducer's one input that is not state. */
export interface RunContent {
  readonly acts: Readonly<Record<Act, readonly Encounter[]>>
}

/** One of a reward's five offers. */
export type Offer =
  | { readonly kind: 'unit'; readonly id: string }
  | { readonly kind: 'dragon'; readonly id: string }
  | { readonly kind: 'terrain'; readonly id: string }

export type RunPending =
  | { readonly kind: 'choose_race'; readonly races: readonly string[] }
  /** Build the force for the battle in hand, under `cap`: `set_force` any number of
   *  times, then `ready`. The first step of every battle encounter, and nowhere else. */
  | { readonly kind: 'arrange_force'; readonly cap: number }
  | { readonly kind: 'battle'; readonly encounter: Encounter }
  | { readonly kind: 'reward'; readonly offers: readonly Offer[] }
  /** `upgradable` and `transformable` are the unit dice in the pool each may act on. */
  | {
      readonly kind: 'event'
      readonly encounter: Encounter
      readonly upgradable: readonly string[]
      readonly transformable: readonly string[]
    }
  | { readonly kind: 'over' }

export type RunAction =
  | { readonly kind: 'pick_race'; readonly race: string }
  | { readonly kind: 'set_force'; readonly force: BuiltForce }
  | { readonly kind: 'ready' }
  | { readonly kind: 'battle_ended'; readonly winner: PlayerId }
  | { readonly kind: 'take_offer'; readonly index: number }
  | { readonly kind: 'upgrade'; readonly unit: string }
  | { readonly kind: 'transform'; readonly unit: string }
  | { readonly kind: 'skip' }

export type RunStatus = 'playing' | 'won' | 'lost'

export interface RunState {
  readonly seed: number
  /** The run's own stream, as a game carries its own. Battles draw from theirs. */
  readonly rng: RngState
  /** The race picked at the start, null until then. What the 70% race draw reads, even
   *  after the pool has gathered other species. */
  readonly race: string | null
  /** The pool: every die the player owns, at finite counts. */
  readonly collection: Collection
  /** What is fielded, kept between encounters. Not always legal: an upgrade can leave
   *  an army empty, and `ready` waits for the player to fix it. */
  readonly force: BuiltForce
  readonly act: Act
  /** 0..11 within the act. */
  readonly encounter: number
  /** The encounter in hand, drawn when reached. */
  readonly current: Encounter | null
  /** This act's draws so far, so its pool is drawn without replacement. */
  readonly drawn: readonly string[]
  readonly pending: RunPending
  readonly status: RunStatus
}

/** Thrown when an action does not answer `run.pending`, or answers it illegally. */
export class IllegalRunAction extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalRunAction'
  }
}
