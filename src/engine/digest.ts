/**
 * A readable summary of a `GameState`, for the golden corpus.
 *
 * The goldens exist to prove that a refactor changed no outcome, and a hash would
 * only ever say *that* something moved. Every field here is a line of text instead,
 * so a failing golden prints a diff you can read: this unit is in the wrong place,
 * this terrain is on the wrong face, this log entry appeared.
 *
 * Everything not derivable is included -- unit positions, terrains, the turn state,
 * the RNG counter, the pending decision, the winner and the whole log. `ruleSet` is
 * not: it is an input to the game, and it is in the record's setup.
 *
 * Log entries are rendered as key-sorted JSON rather than prose. The UI and the CLI
 * both have prose renderers, but they are presentation and they change; this has to
 * stay stable for as long as the corpus does.
 *
 * The one thing rendered specially is a list of dice, which is most of a log by
 * weight: `unitId@faceIndex=results` rather than the whole `DieRoll`. It costs
 * nothing -- `typeId` and the face itself follow from the unit and the index, via
 * the same data the roll read them from -- and it is one rule that holds for every
 * log entry that carries dice, present or future, rather than a renderer per entry
 * kind that Phase 1 onwards would have to keep in step.
 */
import { TERRAIN_SLOTS, type GameState, type Location, type UnitId } from './types'

export interface StateDigest {
  /** `<unit id> <type> <where>`, sorted by unit id. */
  readonly units: readonly string[]
  readonly terrains: readonly string[]
  /** Effects with a duration, one stable-JSON line each. Empty in every recorded v0
   *  game, which is why the corpus predates the field and `golden.test.ts` reads an
   *  absent one as `[]` rather than the file being regenerated for it. */
  readonly effects: readonly string[]
  readonly turn: string
  readonly pending: string
  readonly rngCounter: number
  readonly winner: string
  readonly log: readonly string[]
}

/** `{ unitId, faceIndex, results, ... }`, the shape `rollArmy` puts in the log. */
function isDieRoll(value: unknown): value is { unitId: string; faceIndex: number; results: number } {
  if (value === null || typeof value !== 'object') return false
  const die = value as Record<string, unknown>
  return (
    typeof die['unitId'] === 'string' &&
    typeof die['faceIndex'] === 'number' &&
    typeof die['results'] === 'number'
  )
}

/**
 * Stable JSON: object keys in sorted order whatever order they were built in, and
 * dice as `unitId@faceIndex=results`.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) => {
    if (raw === null || typeof raw !== 'object') return raw
    if (Array.isArray(raw)) {
      return raw.every(isDieRoll)
        ? raw.map((die: { unitId: string; faceIndex: number; results: number }) =>
            `${die.unitId}@${die.faceIndex}=${die.results}`,
          )
        : raw
    }
    const entries = Object.entries(raw as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )
    return Object.fromEntries(entries)
  })
}

function whereIs(location: Location): string {
  switch (location.kind) {
    case 'terrain':
      return `terrain:${location.slot}`
    case 'reserve':
      return 'reserve'
    case 'dua':
      return 'dua'
    case 'bua':
      return 'bua'
  }
}


export function digestState(state: GameState): StateDigest {
  const unitIds = (Object.keys(state.units) as UnitId[]).sort()

  return {
    units: unitIds.map((id) => {
      const unit = state.units[id]
      if (unit === undefined) throw new Error(`digest: unit ${id} vanished between key and lookup`)
      return `${unit.id} ${unit.typeId} ${unit.owner} ${whereIs(unit.location)}`
    }),
    terrains: TERRAIN_SLOTS.map((slot) => {
      const terrain = state.terrains[slot]
      return `${slot} ${terrain.dieId} face ${terrain.face} held-by ${terrain.capturedBy ?? '-'}`
    }),
    effects: state.effects.map((effect) => stableJson(effect)),
    turn: stableJson(state.turn),
    pending: state.pending === null ? 'none' : stableJson(state.pending),
    rngCounter: state.rng.counter,
    winner: state.winner ?? 'none',
    log: state.log.map((entry) => stableJson(entry)),
  }
}
