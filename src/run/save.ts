/**
 * Saving a run (v3 Phase 3): a snapshot of `RunState`, not a record replayed.
 *
 * A game is saved as `{ setup, actions }` because replaying it reproduces it. A run
 * cannot be replayed -- its actions include battle outcomes, which only the battles
 * could recompute -- and its own rules (odds, pools, events) will move every playtest,
 * which would invalidate every replayed record. A snapshot survives anything that keeps
 * its shape, so the save is the state and a `RUN_VERSION` that guards the shape.
 *
 * **When a run is written: whenever it rests outside a battle**, and never in one. A
 * battle is a game in memory and nothing of it is kept, so leaving mid-battle comes back
 * to the encounter's start -- `arrange_force`, with the force as it was arranged -- and
 * `battleSetup` builds the same game from the run's seed, act and encounter. The plan
 * said "at the start of each encounter"; resting points inside an encounter are written
 * too, because the reward after a won battle is one, and a reload there must not throw
 * the win away and make the player fight it again.
 *
 * Pure: the clients own the I/O (`src/ui/run/runStore.ts`, the terminal's file).
 */
import { DRAGON_DICE, TERRAIN_DICE, UNIT_TYPES } from '../data/load'
import { readBuiltForce } from '../engine/force'

import { ENCOUNTERS_PER_ACT, type RunPending, type RunState } from './types'

/**
 * The shape of a saved run. Bump it when `RunState` or anything inside it changes
 * shape, and a save of the old shape is discarded with a message rather than read into
 * a run the code no longer understands.
 *
 * **Not** for a change of odds, pools or events: those are read from the code and the
 * data each time, so a run saved before a tweak simply goes on under the new numbers.
 * That is the point of saving a snapshot.
 *
 * 1: v3 Phase 3, the first.
 *
 * 2: v3 Phase 4b. `RunState` gained `history`, one entry per finished encounter, which the
 *    act strip and the run's end draw. A version-1 run has no record of its past, and
 *    inventing one would draw a strip that lies about it.
 */
export const RUN_VERSION = 2

export interface RunSave {
  readonly version: number
  readonly run: RunState
  readonly savedAt: string
}

export type RunLoad =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly run: RunState; readonly savedAt: string }
  | { readonly kind: 'outdated'; readonly found: number }
  | { readonly kind: 'unreadable'; readonly reason: string }

/** Whether this state is one to write: every resting point but a battle in progress. */
export function shouldSave(run: RunState): boolean {
  return run.pending.kind !== 'battle'
}

export function serializeRun(run: RunState, savedAt: string): string {
  const save: RunSave = { version: RUN_VERSION, run, savedAt }
  return JSON.stringify(save)
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 1
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

const KNOWN: Readonly<Record<'units' | 'dragons' | 'terrains', ReadonlySet<string>>> = {
  units: new Set(UNIT_TYPES.map((u) => u.id)),
  dragons: new Set(DRAGON_DICE.map((d) => d.id)),
  terrains: new Set(TERRAIN_DICE.map((d) => d.id)),
}

const PENDING_KINDS: ReadonlySet<RunPending['kind']> = new Set<RunPending['kind']>([
  'choose_race',
  'arrange_force',
  'battle',
  'reward',
  'event',
  'over',
])

/**
 * Why this value is not a run this code can carry on, or null. The checks are for the
 * shape, and for the one thing that can rot under a save with no change of shape: **a
 * die the data no longer has**, which would otherwise crash the first screen to draw it.
 */
function runProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'it holds no run'
  const { seed, rng, race, collection, force, act, encounter, current, drawn, pending, status } = value
  if (!isWhole(seed)) return 'it has no seed'
  if (!isRecord(rng) || !isWhole(rng['seed']) || !isWhole(rng['counter'])) return 'its random state is damaged'
  if (race !== null && typeof race !== 'string') return 'its race is damaged'
  if (act !== 1 && act !== 2 && act !== 3) return 'its act is damaged'
  if (!isWhole(encounter) || encounter >= ENCOUNTERS_PER_ACT) return 'its encounter number is damaged'
  if (status !== 'playing' && status !== 'won' && status !== 'lost') return 'its status is damaged'
  if (!Array.isArray(drawn) || !drawn.every((id) => typeof id === 'string')) return 'its drawn encounters are damaged'
  const history = value['history']
  if (!Array.isArray(history) || !history.every((h) => isRecord(h) && typeof h['id'] === 'string' && isRecord(h['outcome']))) {
    return 'its history is damaged'
  }
  if (current !== null && (!isRecord(current) || typeof current['id'] !== 'string')) return 'its encounter is damaged'
  if (!isRecord(pending) || !PENDING_KINDS.has(pending['kind'] as RunPending['kind'])) return 'its next question is damaged'

  if (!isRecord(collection)) return 'its pool is damaged'
  for (const kind of ['units', 'dragons', 'terrains'] as const) {
    const map = collection[kind]
    if (!isRecord(map)) return `its pool's ${kind} are damaged`
    for (const [id, count] of Object.entries(map)) {
      if (!isCount(count)) return `its pool's ${kind} are damaged`
      if (!KNOWN[kind].has(id)) return `its pool holds ${id}, which the data no longer has`
    }
  }
  const read = readBuiltForce(force, 'its force')
  if ('problem' in read) return read.problem
  return null
}

/** A save from what was stored, which is as untrusted as a file. */
export function parseRunSave(raw: string | null): RunLoad {
  if (raw === null) return { kind: 'none' }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { kind: 'unreadable', reason: 'the saved run is not valid JSON' }
  }
  if (!isRecord(value) || typeof value['version'] !== 'number') {
    return { kind: 'unreadable', reason: 'the saved run has no version' }
  }
  if (value['version'] !== RUN_VERSION) return { kind: 'outdated', found: value['version'] }
  const problem = runProblem(value['run'])
  if (problem !== null) return { kind: 'unreadable', reason: `the saved run is damaged: ${problem}` }
  return {
    kind: 'ok',
    run: value['run'] as unknown as RunState,
    savedAt: typeof value['savedAt'] === 'string' ? value['savedAt'] : 'unknown',
  }
}

/** What to tell the player when a save could not be carried on. */
export function loadMessage(load: RunLoad): string | null {
  switch (load.kind) {
    case 'none':
    case 'ok':
      return null
    case 'outdated':
      return `A run saved by an older version (${load.found}, now ${RUN_VERSION}) could not be continued, and was discarded.`
    case 'unreadable':
      return `A saved run could not be read (${load.reason}), and was discarded.`
  }
}
