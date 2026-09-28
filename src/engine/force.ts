/**
 * What a force is, and rolling one from the seed.
 *
 * **A force is input** (v2 Phase 2): a `BuiltForce` names the dice in each of the three
 * starting armies and, optionally, its Home Terrain, its Frontier proposal and its
 * dragons. Every force reaches `setupGame` as one -- a preset is a built force with
 * only its armies, a rolled force is one the RNG wrote, and the builder and v3's
 * encounters will write them by hand -- so there is one path into a game, and
 * `builtForceProblem` is the one statement of what a legal force is.
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
import { DRAGON_DICE, TERRAIN_DICE, UNIT_TYPES, unitType, unitsOfSpecies, SPECIES } from '../data/load'
import type { UnitType } from '../data/types'
import { PRESET_ARMY_NAMES, maxArmyHealth, type PresetArmyName } from '../data/presets'

import { nextInt, type RngState } from './rng'
import type { PlayerId } from './types'

/**
 * A force as setup takes it: the dice of each starting army, and optionally the three
 * things setup would otherwise draw. The species follow from the dice (v2 Phase 1), so
 * they are not a field here.
 *
 * **Absent means "draw it exactly as setup always has"**, and a present value draws
 * nothing at all -- not "the same draw" -- the rule a named force and a pinned terrain
 * slot already follow. That is what lets a preset be a built force with only its armies
 * and leave both golden corpora where they were.
 */
export interface BuiltForce {
  readonly armies: Readonly<Record<PresetArmyName, readonly string[]>>
  /** A terrain die id. `SetupOptions.terrains` still wins over it: a pin is applied last. */
  readonly homeTerrain?: string
  /** A terrain die id: this player's Frontier proposal, under either roll-off rung. */
  readonly frontierProposal?: string
  /** Dragon die ids, exactly `dragonCount` of them. Unused under `dragons: false`. */
  readonly dragons?: readonly string[]
}

const armyHealth = (ids: readonly string[]): number => ids.reduce((n, id) => n + unitType(id).health, 0)

/** The total health of a force's dice -- its force size, from which the setup cap and
 *  the dragon count both follow. */
export function builtForceHealth(force: BuiltForce): number {
  return PRESET_ARMY_NAMES.reduce((sum, name) => sum + armyHealth(force.armies[name]), 0)
}

/**
 * How many dragons a force brings: exactly one per 24 points, or part thereof (full
 * rules p. 8). One at 12 or 24 health, two at 30 or 36. Each force reads its own size,
 * so two sides of unequal size may bring different numbers.
 */
export function dragonCount(health: number): number {
  return Math.max(1, Math.ceil(health / 24))
}

const UNIT_IDS: ReadonlySet<string> = new Set(UNIT_TYPES.map((u) => u.id))
const TERRAIN_IDS: ReadonlySet<string> = new Set(TERRAIN_DICE.map((d) => d.id))
const DRAGON_IDS: ReadonlySet<string> = new Set(DRAGON_DICE.map((d) => d.id))

/**
 * A pair of built forces from parsed JSON -- a file a person wrote, so its shape is
 * checked before it is trusted with a type: `{ p1: BuiltForce, p2: BuiltForce }`, and
 * any other top-level key (a `_comment`) ignored. Only the shape: whether each force is
 * *legal* is `builtForceProblem`'s question, which `setupGame` asks of every force.
 */
export function readBuiltForces(
  value: unknown,
): { readonly forces: Readonly<Record<PlayerId, BuiltForce>> } | { readonly problem: string } {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((id) => typeof id === 'string')
  if (!isRecord(value)) return { problem: 'expected an object with a p1 and a p2 force' }

  const forces = {} as Record<PlayerId, BuiltForce>
  for (const player of ['p1', 'p2'] as const) {
    const raw = value[player]
    if (!isRecord(raw)) return { problem: `${player}: missing, or not an object` }
    if (!isRecord(raw['armies'])) return { problem: `${player}: missing its armies` }
    const armies = {} as Record<PresetArmyName, readonly string[]>
    for (const name of PRESET_ARMY_NAMES) {
      const ids = raw['armies'][name]
      if (!isIds(ids)) return { problem: `${player}: its ${name} army is not a list of unit ids` }
      armies[name] = ids
    }
    const { homeTerrain, frontierProposal, dragons } = raw
    if (homeTerrain !== undefined && typeof homeTerrain !== 'string') {
      return { problem: `${player}: homeTerrain is not a terrain die id` }
    }
    if (frontierProposal !== undefined && typeof frontierProposal !== 'string') {
      return { problem: `${player}: frontierProposal is not a terrain die id` }
    }
    if (dragons !== undefined && !isIds(dragons)) {
      return { problem: `${player}: dragons is not a list of dragon die ids` }
    }
    forces[player] = {
      armies,
      ...(homeTerrain !== undefined ? { homeTerrain } : {}),
      ...(frontierProposal !== undefined ? { frontierProposal } : {}),
      ...(dragons !== undefined ? { dragons } : {}),
    }
  }
  return { forces }
}

/**
 * Why a force may not start a game, or null when it may (full rules p. 8, checked per
 * force rather than per pair):
 * - every army holds at least one unit;
 * - no army holds more than half the force's health, rounded down;
 * - every die it names exists in the data;
 * - named dragons number exactly one per 24 health, or part of it.
 *
 * **Not checked: that the two sides are the same size.** That is a property of a
 * pairing, and an unequal one may be on purpose (v3's encounters) or a typo in a
 * builder, which only the screen that made it can tell apart. `newGame.ts` asks.
 */
export function builtForceProblem(force: BuiltForce): string | null {
  for (const name of PRESET_ARMY_NAMES) {
    // A force read from a file has only been cast to this type, so the army may be missing.
    const ids = force.armies[name] as readonly string[] | undefined
    if (!Array.isArray(ids)) return `it has no ${name} army`
    if (ids.length === 0) return `its ${name} army is empty; each army needs at least one unit`
    const unknown = ids.find((id) => !UNIT_IDS.has(id))
    if (unknown !== undefined) return `its ${name} army names ${unknown}, which is not a unit die`
  }

  const total = builtForceHealth(force)
  const cap = maxArmyHealth(total)
  for (const name of PRESET_ARMY_NAMES) {
    const health = armyHealth(force.armies[name])
    if (health > cap) {
      return `its ${name} army is ${health} health, over the setup cap of ${cap} (half of ${total})`
    }
  }

  for (const [field, dieId] of [
    ['home terrain', force.homeTerrain],
    ['frontier proposal', force.frontierProposal],
  ] as const) {
    if (dieId !== undefined && !TERRAIN_IDS.has(dieId)) return `its ${field} ${dieId} is not a terrain die`
  }

  if (force.dragons !== undefined) {
    const unknown = force.dragons.find((id) => !DRAGON_IDS.has(id))
    if (unknown !== undefined) return `it names ${unknown}, which is not a dragon die`
    const wanted = dragonCount(total)
    if (force.dragons.length !== wanted) {
      return (
        `it brings ${force.dragons.length} dragon${force.dragons.length === 1 ? '' : 's'}; ` +
        `a ${total}-health force brings exactly ${wanted}, one per 24 health or part of it`
      )
    }
  }

  return null
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
  return drawFromPool(unitsOfSpecies(speciesId), speciesId, budget, rng)
}

/**
 * Every unit die in the data, sorted by id: the pool a mixed force draws from. Sorted
 * for the terrain list's reason -- reordering the raw files must not reseat a game.
 */
const ALL_UNITS: readonly UnitType[] = [...UNIT_TYPES].sort((a, b) => a.id.localeCompare(b.id))

/** `drawForce` over any pool; `speciesId` names the pool in an error and nowhere else. */
function drawFromPool(
  pool: readonly UnitType[],
  speciesId: string,
  budget: number,
  rng: RngState,
): readonly [readonly string[], RngState] {
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
 *
 * A **mixed** draw (v2 Phase 2) has no race to draw: each side draws its units from
 * every die in the data at once, so its stream is
 *
 *     size -> p1 units -> p1 split -> p2 units -> p2 split
 *
 * Its order is load-bearing only for fuzz seeds -- both golden corpora use named
 * forces -- but it is written down all the same. Either way the result is armies only,
 * like a preset, so setup's own terrain and dragon draws run as for any other force.
 */
export function generateForces(
  rng: RngState,
  options: { readonly mixed?: boolean } = {},
): readonly [Readonly<Record<PlayerId, BuiltForce>>, RngState] {
  if (options.mixed === true) {
    const [sizeIndex, afterSize] = nextInt(rng, FORCE_SIZES.length)
    const budget = FORCE_SIZES[sizeIndex]
    if (budget === undefined) throw new Error(`drew force size ${sizeIndex}`)

    let state = afterSize
    const forces = {} as Record<PlayerId, BuiltForce>
    for (const player of ['p1', 'p2'] as const) {
      const [ids, afterUnits] = drawFromPool(ALL_UNITS, 'any species', budget, state)
      const [armies, afterSplit] = splitForce(ids, afterUnits)
      state = afterSplit
      forces[player] = { armies }
    }
    return [forces, state] as const
  }

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
  const forces = {} as Record<PlayerId, BuiltForce>

  for (const [index, player] of (['p1', 'p2'] as const).entries()) {
    const species = order[index]
    if (species === undefined) throw new Error(`no species for ${player}`)

    const [ids, afterUnits] = drawForce(species, budget, state)
    const [armies, afterSplit] = splitForce(ids, afterUnits)
    state = afterSplit
    forces[player] = { armies }
  }

  return [forces, state] as const
}
