/**
 * Rolling a force from the seed.
 *
 * The alpha shipped two hand-authored 30-health lists, which made every game open
 * from the same position with the same dice. A force is now drawn: the race, the
 * size, the units and the split across Home, Campaign and Horde, in that order,
 * because the order *is* the RNG stream.
 *
 * Two things this buys beyond variety. A rolled force draws from all 20 dice of its
 * species, so the eight monsters neither starter list fields turn up constantly --
 * and with them the SAIs the fuzz could never reach. And the setup itself becomes
 * something a seed can reproduce, so "seed 4812" is a whole game, not half of one.
 *
 * Pure, like everything else in here: it takes an `RngState` and returns the next
 * one. The named-force path must not call any of this -- not even for the same
 * number of draws -- or a named game lands on a different board than v0 gave it.
 */
import { unitType, unitsOfSpecies, SPECIES } from '../data/load'
import type { UnitType } from '../data/types'
import { PRESET_ARMY_NAMES, maxArmyHealth, type PresetArmyName } from '../data/presets'

import { nextInt, type RngState } from './rng'
import type { PlayerId } from './types'

/** A force as setup needs it: who they are, and how they are split. */
export interface GeneratedForce {
  readonly species: string
  readonly armies: Readonly<Record<PresetArmyName, readonly string[]>>
}

/**
 * The two sizes a game can be played at, shared by both players.
 *
 * Rolling a size per side would make force size an asymmetry rather than a variety
 * knob, which is a balance decision wearing a dice roll.
 */
export const FORCE_SIZES: readonly number[] = [24, 36]

/** Random deals that break the setup constraints are retried this many times before
 *  the deterministic repair below takes over. */
const MAX_SPLIT_ATTEMPTS = 50

/**
 * Which unit type to add next, drawn uniformly from those that still fit.
 *
 * **This is the distribution knob.** Uniform over *types* is not uniform over
 * *health*: each species has exactly five dice at each health from 1 to 4, so a
 * draw averages 2.5 and a force comes out around 10 dice at 24 health and 14 at 36,
 * about a quarter of them monsters. Weighting toward the small end gives more,
 * weaker dice and longer games; toward the large end, a handful of monsters and
 * swingy ones. It is one function so that it can be changed without touching setup,
 * and it is worth changing deliberately rather than inheriting whichever one got
 * written first.
 *
 * Drawing only from what fits, rather than drawing and rejecting, is what makes the
 * budget land exactly on zero in a bounded number of draws.
 */
function drawUnitType(
  fitting: readonly UnitType[],
  rng: RngState,
): readonly [UnitType, RngState] {
  const [index, next] = nextInt(rng, fitting.length)
  const type = fitting[index]
  if (type === undefined) throw new Error(`drew unit ${index} of ${fitting.length}`)
  return [type, next] as const
}

/**
 * Draws units until the health budget is spent exactly.
 *
 * Terminates because every species has 1-health dice, so something always fits and
 * the budget strictly decreases. Duplicates are allowed -- the real game lets you
 * field several copies of a die.
 */
export function drawForce(
  speciesId: string,
  budget: number,
  rng: RngState,
): readonly [readonly string[], RngState] {
  const pool = unitsOfSpecies(speciesId)
  if (pool.length === 0) throw new Error(`no unit types for species ${speciesId}`)

  const ids: string[] = []
  let remaining = budget
  let state = rng

  while (remaining > 0) {
    const fitting = pool.filter((type) => type.health <= remaining)
    if (fitting.length === 0) {
      throw new Error(
        `species ${speciesId} has no die of ${remaining} health or less, so a force ` +
          `cannot land on its budget exactly`,
      )
    }
    const [type, next] = drawUnitType(fitting, state)
    state = next
    ids.push(type.id)
    remaining -= type.health
  }

  return [ids, state] as const
}

const healthOf = (ids: readonly string[]): number =>
  ids.reduce((sum, id) => sum + unitType(id).health, 0)

function isLegalSplit(armies: Record<PresetArmyName, string[]>, total: number): boolean {
  const cap = maxArmyHealth(total)
  return PRESET_ARMY_NAMES.every((name) => {
    const army = armies[name]
    return army.length > 0 && healthOf(army) <= cap
  })
}

/**
 * The repair, and the reason this function always terminates: heaviest die first
 * into the lightest army.
 *
 * It cannot fail. With three armies, dice of at most 4 health and a force of at
 * least 24, the heaviest army ends at no more than `ceil(total / 3) + 3` -- 11 of a
 * 24-health force, 15 of a 36 -- which is inside the half-health cap either way.
 * The first three dice necessarily land in three different armies, so none is left
 * empty.
 *
 * Exported so the tests can reach it: the random deal above almost always succeeds
 * inside 50 attempts, so a test that went through `splitForce` would be asserting
 * about the retry and calling it the repair.
 */
export function repairSplit(ids: readonly string[]): Readonly<Record<PresetArmyName, string[]>> {
  const armies = { home: [], campaign: [], horde: [] } as Record<PresetArmyName, string[]>
  const heaviestFirst = [...ids].sort((a, b) => unitType(b).health - unitType(a).health)

  for (const id of heaviestFirst) {
    let lightest: PresetArmyName = 'home'
    for (const name of PRESET_ARMY_NAMES) {
      if (healthOf(armies[name]) < healthOf(armies[lightest])) lightest = name
    }
    armies[lightest].push(id)
  }

  return armies
}

/**
 * Deals a force into Home, Campaign and Horde.
 *
 * A uniform deal breaks the setup constraints -- every army non-empty, none over
 * half the force's health -- often enough that the repair path is the real work, so
 * it is a bounded retry rather than a loop that can spin.
 */
export function splitForce(
  ids: readonly string[],
  rng: RngState,
): readonly [Readonly<Record<PresetArmyName, readonly string[]>>, RngState] {
  const total = healthOf(ids)
  let state = rng

  for (let attempt = 0; attempt < MAX_SPLIT_ATTEMPTS; attempt++) {
    const armies = { home: [], campaign: [], horde: [] } as Record<PresetArmyName, string[]>
    for (const id of ids) {
      const [index, next] = nextInt(state, PRESET_ARMY_NAMES.length)
      state = next
      const name = PRESET_ARMY_NAMES[index]
      if (name === undefined) throw new Error(`dealt to army ${index}`)
      armies[name].push(id)
    }
    if (isLegalSplit(armies, total)) return [armies, state] as const
  }

  return [repairSplit(ids), state] as const
}

/**
 * The whole draw, in the order the RNG stream runs it:
 *
 *     race -> size -> p1 units -> p1 split -> p2 units -> p2 split
 *
 * and then, back in `setupGame`, the Horde roll-off and the terrain faces.
 */
export function generateForces(
  rng: RngState,
): readonly [Readonly<Record<PlayerId, GeneratedForce>>, RngState] {
  // Two species is the whole of v1's scope, and one draw decides which side is
  // which. A third species would need a different draw here, and this is the only
  // place that would have to change.
  if (SPECIES.length !== 2) {
    throw new Error(
      `force generation assumes exactly two species, found ${SPECIES.length}; ` +
        `see PLAN-V1.md, scope`,
    )
  }
  const speciesIds = SPECIES.map((s) => s.id).sort()
  const [first, afterRace] = nextInt(rng, speciesIds.length)
  const order: string[] = first === 0 ? speciesIds : [...speciesIds].reverse()

  const [sizeIndex, afterSize] = nextInt(afterRace, FORCE_SIZES.length)
  const budget = FORCE_SIZES[sizeIndex]
  if (budget === undefined) throw new Error(`drew force size ${sizeIndex}`)

  let state = afterSize
  const forces = {} as Record<PlayerId, GeneratedForce>

  for (const [index, player] of (['p1', 'p2'] as const).entries()) {
    const species = order[index]
    if (species === undefined) throw new Error(`no species for ${player}`)

    const [ids, afterUnits] = drawForce(species, budget, state)
    const [armies, afterSplit] = splitForce(ids, afterUnits)
    state = afterSplit
    forces[player] = { species, armies }
  }

  return [forces, state] as const
}
