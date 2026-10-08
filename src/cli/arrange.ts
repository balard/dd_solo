/**
 * Arranging a run's force in the terminal (v3 Phase 2), without any I/O.
 *
 * The draft is the run's own `force`: every edit is a `set_force`, which the reducer
 * takes any number of times, so there is no second copy of "the force being arranged" to
 * fall out of step with the run. This module turns one typed line into the next force,
 * or says why it cannot; `runPlay.ts` prints and asks.
 *
 *     3 h         field spare die 3 in the Home army (h home, c campaign, d horde)
 *     x c 2       take the second die of the Campaign army back to the pool
 *     home t2     the Home Terrain is owned terrain 2; front t1 the Frontier proposal
 *     dragon d1   field owned dragon 1, or take it back if it is fielded
 *     auto        the autopilot's force: as much of the pool as fits, legally
 *     ready       fight with this force (an empty line too)
 */
import { unitType } from '../data/load'
import type { PresetArmyName } from '../data/presets'
import type { BuiltForce } from '../engine/force'
import { copiesLeft } from '../engine/forceProblems'
import { suggestForce } from '../run/autopilot'
import type { RunState } from '../run/types'

export const ARMY_KEYS: Readonly<Record<string, PresetArmyName>> = {
  h: 'home',
  home: 'home',
  c: 'campaign',
  campaign: 'campaign',
  d: 'horde',
  horde: 'horde',
}

/** The pool's dice that are not fielded, one entry per spare copy, heaviest first. */
export function spareUnits(run: RunState): readonly string[] {
  return Object.keys(run.collection.units)
    .sort((a, b) => unitType(b).health - unitType(a).health || unitType(a).name.localeCompare(unitType(b).name))
    .flatMap((id) => Array<string>(Math.max(0, copiesLeft(run.collection, run.force, 'units', id))).fill(id))
}

/** The terrain or dragon dice the pool owns, each once, sorted by id. */
export function owned(run: RunState, kind: 'terrains' | 'dragons'): readonly string[] {
  return Object.keys(run.collection[kind]).sort()
}

// The builder's draft edits (`src/ui/game/builder.ts`) do the same; the terminal does not
// reach into the UI for four one-line functions.
const withArmy = (force: BuiltForce, army: PresetArmyName, ids: readonly string[]): BuiltForce => ({
  ...force,
  armies: { ...force.armies, [army]: ids },
})

const withDragons = (force: BuiltForce, dragons: readonly string[]): BuiltForce => {
  const { dragons: _dropped, ...rest } = force
  return dragons.length === 0 ? rest : { ...rest, dragons }
}

export type ArrangeReply =
  | { readonly kind: 'force'; readonly force: BuiltForce }
  | { readonly kind: 'ready' }
  | { readonly kind: 'quit' }
  | { readonly kind: 'problem'; readonly text: string }

const problem = (text: string): ArrangeReply => ({ kind: 'problem', text })

/** The n-th (1-based) item of a list, from a token that may carry a letter prefix. */
function nth<T>(list: readonly T[], token: string | undefined, prefix = ''): T | undefined {
  if (token === undefined) return undefined
  const digits = token.toLowerCase().startsWith(prefix) ? token.slice(prefix.length) : token
  if (!/^\d+$/.test(digits)) return undefined
  return list[Number(digits) - 1]
}

/** What one typed line does to the force under arrangement. */
export function arrangeCommand(run: RunState, cap: number, line: string): ArrangeReply {
  const words = line.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const [first, second, third] = words
  if (first === undefined || first === 'ready' || first === 'r') return { kind: 'ready' }
  if (first === 'q') return { kind: 'quit' }

  if (first === 'auto') {
    const force = suggestForce(run, cap)
    return force === null ? problem('the pool cannot make a legal force on its own') : { kind: 'force', force }
  }

  if (first === 'x') {
    const army = ARMY_KEYS[second ?? '']
    if (army === undefined) return problem('x takes an army (h, c or d) and a number: x c 2')
    const index = Number(third) - 1
    if (!Number.isInteger(index) || run.force.armies[army][index] === undefined) {
      return problem(`the ${army} army has no die ${third ?? ''}`.trimEnd())
    }
    return { kind: 'force', force: withArmy(run.force, army, run.force.armies[army].filter((_, i) => i !== index)) }
  }

  if (first === 'home' || first === 'front') {
    const die = nth(owned(run, 'terrains'), second, 't')
    if (die === undefined) return problem(`${first} takes an owned terrain: ${first} t1`)
    return { kind: 'force', force: { ...run.force, [first === 'home' ? 'homeTerrain' : 'frontierProposal']: die } }
  }

  if (first === 'dragon') {
    const die = nth(owned(run, 'dragons'), second, 'd')
    if (die === undefined) return problem('dragon takes an owned dragon: dragon d1')
    const dragons = run.force.dragons ?? []
    const at = dragons.indexOf(die)
    return {
      kind: 'force',
      force: withDragons(run.force, at >= 0 ? dragons.filter((_, i) => i !== at) : [...dragons, die]),
    }
  }

  const die = nth(spareUnits(run), first)
  if (die !== undefined) {
    const army = ARMY_KEYS[second ?? '']
    if (army === undefined) return problem(`which army? ${first} h, ${first} c or ${first} d`)
    return { kind: 'force', force: withArmy(run.force, army, [...run.force.armies[army], die]) }
  }

  return problem(`"${line.trim()}" is not a command; enter on its own is ready`)
}
