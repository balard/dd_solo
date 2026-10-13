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
import type { UnitSize } from '../data/types'
import type { BuiltForce, ForcePool } from '../engine/force'
import type { RngState } from '../engine/rng'
import type { PlayerId } from '../engine/types'

export type Act = 1 | 2 | 3

export const ACTS: readonly Act[] = [1, 2, 3]

/** The force-size cap of each act, which is also the size of the enemies met there. */
export const ACT_SIZE: Readonly<Record<Act, number>> = { 1: 12, 2: 24, 3: 36 }

/** What one encounter of an act's schedule will be. */
export type Slot = 'battle' | 'event'

/**
 * The shape of each act (v3 Phase 6): how many battles, and the other slots between them.
 * An act opens and closes on a battle, and its middle is shuffled when the act starts
 * (`drawSchedule`). It is a schedule, not a draw per encounter, so an act always gives the
 * same number of rewards and events -- which is what lets the pool grow on a curve.
 */
export const ACT_PLAN: Readonly<Record<Act, { readonly battles: number; readonly between: readonly Slot[] }>> = {
  1: { battles: 7, between: ['event', 'event'] },
  2: { battles: 5, between: ['event'] },
  3: { battles: 5, between: ['event'] },
}

/** Encounters played in an act. The act's pool holds more of each kind, drawn without
 *  replacement. */
export const actLength = (act: Act): number => ACT_PLAN[act].battles + ACT_PLAN[act].between.length

/** How many of each slot an act's schedule holds. */
export function slotsIn(act: Act): Readonly<Record<Slot, number>> {
  const counts: Record<Slot, number> = { battle: ACT_PLAN[act].battles, event: 0 }
  for (const slot of ACT_PLAN[act].between) counts[slot]++
  return counts
}

/** The human's seat in every battle. `battle_ended` names a winner, and this is a win. */
export const RUN_PLAYER: PlayerId = 'p1'

export type EncounterKind = 'battle' | 'event'

/**
 * Who a battle is fought against: a force rolled at the act's size from a pool, or a
 * hand-built one, named by its file in `data/forces/enemies/`. Named rather than held
 * whole, so a run in hand picks up an edit to the file.
 */
export type EnemySpec = { readonly pool: ForcePool } | { readonly built: string }

interface EncounterBase {
  readonly id: string
  readonly act: Act
  readonly name: string
}

/**
 * A battle: one game against `enemy`, played by `opponent` -- an `OPPONENTS` name, held
 * as a string because `src/run/` may not import `src/ai/`; the client resolves it.
 */
export interface BattleEncounter extends EncounterBase {
  readonly kind: 'battle'
  readonly enemy: EnemySpec
  readonly opponent: string
}

/** An event: upgrade or transform one die of the pool, or skip. */
export interface EventEncounter extends EncounterBase {
  readonly kind: 'event'
}

/** One encounter of an act's pool, from `data/encounters.json`. */
export type Encounter = BattleEncounter | EventEncounter

/** Every encounter a run can draw, by act, and the hand-built enemy forces by name:
 *  the reducer's one input that is not state. */
export interface RunContent {
  readonly acts: Readonly<Record<Act, readonly Encounter[]>>
  readonly forces: Readonly<Record<string, BuiltForce>>
}

/**
 * Whether a die given is like the pool or from outside it (v3 Phase 6): a *similar* die
 * is drawn from the species and elements of a die the pool holds, a *general* one more
 * widely. See `give.ts` for each kind's rule.
 */
export type Flavour = 'similar' | 'general'

/**
 * The chance in 100 that a die given is similar, by the pool's health: as the pool grows,
 * more of what it is given comes from outside it. Read top down; the first band whose
 * `upTo` the health does not pass is the one.
 */
export const SIMILAR_IN_100: readonly { readonly upTo: number; readonly chance: number }[] = [
  { upTo: 24, chance: 99 },
  { upTo: 36, chance: 90 },
  { upTo: Infinity, chance: 70 },
]

/** A general unit die shares an element with the pool this many times in ten, else it is
 *  any die of its size. */
export const GENERAL_SHARED_IN_10 = 7

/** What a die given is, decided before anything about it is drawn: a unit by its size, a
 *  dragon or a terrain. */
export type GiftKind = UnitSize | 'dragon' | 'terrain'

/** One die a reward or a boon gives, `count` copies of it. */
export interface Grant {
  readonly kind: 'unit' | 'dragon' | 'terrain'
  readonly id: string
  readonly count: number
  readonly flavour: Flavour
}

/** One offer a reward makes: everything in it is taken together. */
export interface Offer {
  readonly grants: readonly Grant[]
}

/** One offer of a reward template: the dice it gives, by kind, before any is drawn. */
export type OfferSpec = readonly { readonly kind: GiftKind; readonly count: number }[]

const one = (kind: GiftKind, count = 1) => ({ kind, count })

/**
 * The rewards after a battle (v3 Phase 6): one template, uniformly, then its offers in
 * order. Every offer is at least 1 health, so no pick leaves the pool where it was.
 */
export const REWARD_TEMPLATES: readonly (readonly OfferSpec[])[] = [
  [[one('small'), one('dragon')], [one('medium')], [one('large')]],
  [[one('small'), one('terrain')], [one('medium')], [one('large')]],
  [[one('medium')], [one('large')], [one('monster')]],
]

/**
 * The reward of the battle that closes Acts I and II: four offers, each at least 3
 * health -- a small die three times over, a medium one twice.
 */
export const CLOSING_TEMPLATES: readonly (readonly OfferSpec[])[] = [
  [[one('small', 3), one('dragon')], [one('medium', 2)], [one('large')], [one('monster')]],
  [[one('small', 3), one('terrain')], [one('medium', 2)], [one('large')], [one('monster')]],
]

export type RunPending =
  | { readonly kind: 'choose_race'; readonly races: readonly string[] }
  /** Build the force for the battle in hand, under `cap`: `set_force` any number of
   *  times, then `ready`. The first step of every battle encounter, and nowhere else. */
  | { readonly kind: 'arrange_force'; readonly cap: number }
  | { readonly kind: 'battle'; readonly encounter: BattleEncounter }
  | { readonly kind: 'reward'; readonly offers: readonly Offer[] }
  /** `upgradable` and `transformable` are the unit dice in the pool each may act on. */
  | {
      readonly kind: 'event'
      readonly encounter: EventEncounter
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

/** How one encounter ended. A battle's reward is null only for the last battle of the run,
 *  which ends it with nothing left to spend a reward on. */
export type Outcome =
  | { readonly kind: 'won'; readonly took: Offer | null }
  | { readonly kind: 'lost' }
  | { readonly kind: 'upgrade' | 'transform'; readonly from: string; readonly to: string }
  | { readonly kind: 'skip' }

/**
 * One finished encounter (v3 Phase 4b). The act strip draws the run's past from these, the
 * run's end lists them, and the force screen marks the dice won since the last battle.
 * Nothing in the run's rules reads it: it is a record, kept in the state because a
 * snapshot is all a save holds.
 */
export interface HistoryEntry {
  readonly act: Act
  /** 0-based within the act. */
  readonly encounter: number
  readonly id: string
  readonly name: string
  readonly outcome: Outcome
}

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
  /** 0-based within the act, below `actLength(act)`. */
  readonly encounter: number
  /** The act's encounters by kind, drawn when the act starts: one slot per encounter.
   *  Empty until a race is picked. */
  readonly schedule: readonly Slot[]
  /** The encounter in hand, drawn when reached. */
  readonly current: Encounter | null
  /** This act's draws so far, so its pool is drawn without replacement. */
  readonly drawn: readonly string[]
  /** Every encounter finished, oldest first. */
  readonly history: readonly HistoryEntry[]
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
