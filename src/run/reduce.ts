/**
 * The run's reducer (v3 Phase 0): `reduceRun(run, action, content) => run`.
 *
 * **One encounter, start to finish:**
 *
 *     battle:  arrange_force -> battle -> reward      (or -> over, lost)
 *     event:   event
 *
 * then the next encounter is drawn at once, so a run always rests at the start of an
 * encounter or inside one -- which is what lets Phase 3 save it "at the start of each
 * encounter" as a plain snapshot. Twelve encounters make an act; the twelfth of Act III
 * ends the run won, with no reward after it, since there is nothing left to spend one on.
 *
 * **`arrange_force` is the first step of every battle encounter, and nowhere else.** The
 * plan has it "after every reward and every event, and before the first battle", which
 * read literally asks twice in a row whenever a reward is followed by a battle. Arranging
 * matters only for the battle it is fielded in, so it is asked exactly there: a reward or
 * an event followed by a battle reaches it next, and one followed by an event does not
 * need it.
 *
 * `content` is the encounter pools, `RUN_CONTENT` from `data/encounters.json` unless a
 * test passes its own.
 */
import type { Collection, CollectionKind } from '../data/collections'
import { PRESET_ARMY_NAMES, maxArmyHealth, type PresetArmyName } from '../data/presets'
import type { BuiltForce } from '../engine/force'
import { forceHealth, forceProblems, healthOf, used } from '../engine/forceProblems'
import { PLAYABLE_SPECIES } from '../engine/playable'
import { rngFrom } from '../engine/rng'

import { RUN_CONTENT } from './encounters'
import { drawEncounter, drawReward, drawTransform, rollStart, transformsOf, upgradeOf } from './draws'
import {
  ACT_SIZE,
  ENCOUNTERS_PER_ACT,
  IllegalRunAction,
  RUN_PLAYER,
  type Act,
  type HistoryEntry,
  type Outcome,
  type RunAction,
  type RunContent,
  type RunPending,
  type RunState,
} from './types'

const EMPTY_COLLECTION: Collection = { id: 'run', name: 'Your dice', units: {}, dragons: {}, terrains: {} }
const EMPTY_ARMIES: BuiltForce = { armies: { home: [], campaign: [], horde: [] } }

/** A run before anything is drawn: the race is the first question. */
export function newRun(seed: number): RunState {
  return {
    seed,
    rng: rngFrom(seed),
    race: null,
    collection: EMPTY_COLLECTION,
    force: EMPTY_ARMIES,
    act: 1,
    encounter: 0,
    current: null,
    drawn: [],
    history: [],
    pending: { kind: 'choose_race', races: PLAYABLE_SPECIES.map((s) => s.id) },
    status: 'playing',
  }
}

/** The pool with `delta` copies of a die more (or fewer); a count of 0 is no entry. */
function adjust(collection: Collection, kind: CollectionKind, id: string, delta: number): Collection {
  const count = (collection[kind][id] ?? 0) + delta
  if (count < 0) throw new Error(`the pool holds no ${id} to take away`)
  const { [id]: _old, ...rest } = collection[kind]
  return { ...collection, [kind]: count === 0 ? rest : { ...rest, [id]: count } }
}

/** Every unit die the pool owns, sorted by id. */
const ownedUnits = (collection: Collection): readonly string[] =>
  Object.keys(collection.units)
    .filter((id) => (collection.units[id] ?? 0) > 0)
    .sort()

/** The pending an encounter opens on. */
function openingPending(run: RunState): RunPending {
  const encounter = run.current
  if (encounter === null) throw new Error('no encounter in hand')
  switch (encounter.kind) {
    case 'battle':
      return { kind: 'arrange_force', cap: ACT_SIZE[run.act] }
    case 'event': {
      const units = ownedUnits(run.collection)
      return {
        kind: 'event',
        encounter,
        upgradable: units.filter((id) => upgradeOf(id) !== null),
        transformable: units.filter((id) => transformsOf(id).length > 0),
      }
    }
  }
}

/** Draws the encounter at `run.act` / `run.encounter` and opens it. */
function startEncounter(run: RunState, content: RunContent): RunState {
  const [encounter, rng] = drawEncounter(content, run.act, run.drawn, run.rng)
  const next: RunState = { ...run, rng, current: encounter, drawn: [...run.drawn, encounter.id] }
  return { ...next, pending: openingPending(next) }
}

/** The run with the encounter in hand written into its history. */
function record(run: RunState, outcome: Outcome): RunState {
  const encounter = run.current
  if (encounter === null) throw new Error('an encounter finished with none in hand')
  const entry: HistoryEntry = { act: run.act, encounter: run.encounter, id: encounter.id, name: encounter.name, outcome }
  return { ...run, history: [...run.history, entry] }
}

/** The encounter in hand is over: recorded, then on to the next, the next act, or the end
 *  of the run. */
function finishEncounter(run: RunState, outcome: Outcome, content: RunContent): RunState {
  const done = record(run, outcome)
  if (done.encounter + 1 < ENCOUNTERS_PER_ACT) return startEncounter({ ...done, encounter: done.encounter + 1 }, content)
  if (done.act === 3) return { ...done, status: 'won', pending: { kind: 'over' } }
  return startEncounter({ ...done, act: (done.act + 1) as Act, encounter: 0, drawn: [] }, content)
}

const isLastEncounter = (run: RunState): boolean => run.act === 3 && run.encounter === ENCOUNTERS_PER_ACT - 1

/** The force with the first copy of `from` (in army order) changed to `to`, and the
 *  army it stood in; null when the force fields no `from`. */
function swapFirst(force: BuiltForce, from: string, to: string): { force: BuiltForce; army: PresetArmyName } | null {
  for (const army of PRESET_ARMY_NAMES) {
    const ids = force.armies[army]
    const at = ids.indexOf(from)
    if (at < 0) continue
    const swapped = ids.map((id, i) => (i === at ? to : id))
    return { force: { ...force, armies: { ...force.armies, [army]: swapped } }, army }
  }
  return null
}

/** The force with the first copy of `id` (in army order) taken out. */
function dropFirst(force: BuiltForce, id: string): BuiltForce {
  for (const army of PRESET_ARMY_NAMES) {
    const at = force.armies[army].indexOf(id)
    if (at >= 0) {
      return { ...force, armies: { ...force.armies, [army]: force.armies[army].filter((_, i) => i !== at) } }
    }
  }
  return force
}

/**
 * What an event would do to the force, changing one copy of `from` into `to` (v3 Phase 4b:
 * the event screen asks this before the choice, and the reducer applies the same answer).
 *
 * **An unfielded copy changes first**, so the force is untouched whenever it can be:
 * the event acts on a die *in the pool*, and the pool counts copies, not dice. Only when
 * every copy owned is fielded does a fielded one change:
 * - a **transform** keeps its place: same health, so nothing can break;
 * - an **upgrade** keeps its place only if the two rules a heavier die can break still
 *   hold -- the act's cap, and half the force for the army it stands in. Otherwise it
 *   **leaves the force** and waits in the pool, and an army it empties is the player's
 *   to fill at the next `ready`.
 */
export interface EventEffect {
  /** `pool`: a spare copy changed, the force did not. `in_place`: the fielded die changed
   *  where it stands. `benched`: the fielded die left the force, the new one waits. */
  readonly effect: 'pool' | 'in_place' | 'benched'
  /** The army the fielded die stood in; null for a spare copy. */
  readonly army: PresetArmyName | null
  readonly force: BuiltForce
}

export function eventEffect(run: RunState, from: string, to: string, kind: 'upgrade' | 'transform'): EventEffect {
  const owned = run.collection.units[from] ?? 0
  const swapped = owned > used(run.force, 'units', from) ? null : swapFirst(run.force, from, to)
  if (swapped === null) return { effect: 'pool', army: null, force: run.force }
  if (kind === 'transform') return { effect: 'in_place', army: swapped.army, force: swapped.force }
  const total = forceHealth(swapped.force)
  const fits = total <= ACT_SIZE[run.act] && healthOf(swapped.force.armies[swapped.army]) <= maxArmyHealth(total)
  return fits
    ? { effect: 'in_place', army: swapped.army, force: swapped.force }
    : { effect: 'benched', army: swapped.army, force: dropFirst(run.force, from) }
}

/** What upgrading this die of the pool would do, or null when it cannot be upgraded. */
export function upgradePreview(run: RunState, unit: string): (EventEffect & { readonly to: string }) | null {
  const to = upgradeOf(unit)
  if (to === null || (run.collection.units[unit] ?? 0) === 0) return null
  return { ...eventEffect(run, unit, to, 'upgrade'), to }
}

/** One die of the pool becomes another, by an event, as `eventEffect` says. */
function replaceDie(run: RunState, from: string, to: string, kind: 'upgrade' | 'transform'): RunState {
  const collection = adjust(adjust(run.collection, 'units', from, -1), 'units', to, 1)
  return { ...run, collection, force: eventEffect(run, from, to, kind).force }
}

function refuse(run: RunState, action: RunAction): never {
  throw new IllegalRunAction(`${action.kind} does not answer the run's ${run.pending.kind}`)
}

export function reduceRun(run: RunState, action: RunAction, content: RunContent = RUN_CONTENT): RunState {
  const pending = run.pending
  switch (pending.kind) {
    case 'choose_race': {
      if (action.kind !== 'pick_race') return refuse(run, action)
      if (!pending.races.includes(action.race)) throw new IllegalRunAction(`${action.race} is not a race to pick`)
      const [start, rng] = rollStart(action.race, run.rng)
      let collection = EMPTY_COLLECTION
      for (const id of start.units) collection = adjust(collection, 'units', id, 1)
      for (const id of start.force.dragons ?? []) collection = adjust(collection, 'dragons', id, 1)
      for (const id of [start.force.homeTerrain, start.force.frontierProposal]) {
        if (id !== undefined) collection = adjust(collection, 'terrains', id, 1)
      }
      return startEncounter({ ...run, rng, race: action.race, collection, force: start.force }, content)
    }

    case 'arrange_force': {
      if (action.kind === 'set_force') return { ...run, force: action.force }
      if (action.kind !== 'ready') return refuse(run, action)
      const problems = forceProblems(run.collection, pending.cap, run.force, 'at_most')
      if (problems.length > 0) {
        throw new IllegalRunAction(`the force cannot fight: ${problems.map((p) => p.text).join('; ')}`)
      }
      const encounter = run.current
      if (encounter?.kind !== 'battle') throw new Error('arranging a force with no battle in hand')
      return { ...run, pending: { kind: 'battle', encounter } }
    }

    case 'battle': {
      if (action.kind !== 'battle_ended') return refuse(run, action)
      if (action.winner !== RUN_PLAYER) return { ...record(run, { kind: 'lost' }), status: 'lost', pending: { kind: 'over' } }
      if (isLastEncounter(run)) return { ...record(run, { kind: 'won', took: null }), status: 'won', pending: { kind: 'over' } }
      const race = run.race
      if (race === null) throw new Error('a battle in a run with no race')
      const [offers, rng] = drawReward(race, run.force, run.rng)
      return { ...run, rng, pending: { kind: 'reward', offers } }
    }

    case 'reward': {
      if (action.kind !== 'take_offer') return refuse(run, action)
      const offer = pending.offers[action.index]
      if (offer === undefined) throw new IllegalRunAction(`there is no offer ${action.index}`)
      const kind: CollectionKind = offer.kind === 'unit' ? 'units' : offer.kind === 'dragon' ? 'dragons' : 'terrains'
      const took = { ...run, collection: adjust(run.collection, kind, offer.id, 1) }
      return finishEncounter(took, { kind: 'won', took: offer }, content)
    }

    case 'event': {
      switch (action.kind) {
        case 'skip':
          return finishEncounter(run, { kind: 'skip' }, content)
        case 'upgrade': {
          const to = upgradeOf(action.unit)
          if (!pending.upgradable.includes(action.unit) || to === null) {
            throw new IllegalRunAction(`${action.unit} is not a die in the pool that can be upgraded`)
          }
          const upgraded = replaceDie(run, action.unit, to, 'upgrade')
          return finishEncounter(upgraded, { kind: 'upgrade', from: action.unit, to }, content)
        }
        case 'transform': {
          if (!pending.transformable.includes(action.unit)) {
            throw new IllegalRunAction(`${action.unit} is not a die in the pool that can be transformed`)
          }
          const [to, rng] = drawTransform(action.unit, run.rng)
          const transformed = replaceDie({ ...run, rng }, action.unit, to, 'transform')
          return finishEncounter(transformed, { kind: 'transform', from: action.unit, to }, content)
        }
        default:
          return refuse(run, action)
      }
    }

    case 'over':
      throw new IllegalRunAction(`the run is over (${run.status}); nothing answers it`)
  }
}
