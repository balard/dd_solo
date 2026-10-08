/**
 * Every random thing a run does, each a pure function of an `RngState` (v3 Phase 0).
 *
 * **The order is the stream**, as it is in `setupGame`, and `run.test.ts` pins it:
 *
 *     pick_race  -> large die -> second medium's line -> dragon element -> dragon form
 *                -> Home terrain -> Frontier proposal -> split
 *     encounter  -> battle or event (7 in 10) -> which one, from the act's pool
 *     reward     -> unit 1 (race or any, then which die) -> unit 2 -> unit 3
 *                -> dragon element -> dragon form -> terrain
 *     transform  -> which die of the same species and health
 *
 * A forced choice draws nothing -- the same-line medium, the five small dice -- the
 * setup rule for a pinned terrain. Every list a draw picks from is sorted by id, so
 * reordering a data file cannot reseat a run. Terrains are drawn by setup's own lists
 * (`homeDiceFor`, `terrainDiceSharing`), so "a Home of the race's own type" means here
 * exactly what it means when setup draws one.
 */
import { DRAGON_DICE, speciesElements, unitType } from '../data/load'
import type { Element, UnitSize, UnitType } from '../data/types'
import { PRESET_ARMY_NAMES } from '../data/presets'
import { splitForce, type BuiltForce } from '../engine/force'
import { PLAYABLE_UNITS } from '../engine/playable'
import { nextInt, type RngState } from '../engine/rng'
import { homeDiceFor, terrainDiceSharing } from '../engine/setup'

import { BATTLE_IN_10, RACE_DIE_IN_10, UNIT_OFFERS, type Act, type Encounter, type Offer, type RunContent } from './types'

const byId = <T extends { readonly id: string }>(list: readonly T[]): readonly T[] =>
  [...list].sort((a, b) => a.id.localeCompare(b.id))

/** One item, uniformly. Throws on an empty list, naming what was being drawn. */
function pick<T>(list: readonly T[], rng: RngState, what: string): readonly [T, RngState] {
  if (list.length === 0) throw new Error(`nothing to draw ${what} from`)
  const [index, next] = nextInt(rng, list.length)
  const item = list[index]
  if (item === undefined) throw new Error(`drew ${what} ${index} of ${list.length}`)
  return [item, next] as const
}

/** Every playable die, sorted by id: the 30% draw of a reward, and the 70%'s source. */
const ALL_UNITS: readonly UnitType[] = byId(PLAYABLE_UNITS)

const raceUnits = (race: string): readonly UnitType[] => ALL_UNITS.filter((u) => u.species === race)

const DRAGON_ELEMENTS: ReadonlySet<string> = new Set(DRAGON_DICE.map((d) => d.element))

/**
 * A dragon of one of these elements: the element, then the form (0 a drake, 1 a wyrm,
 * setup's mapping). Two draws, so every element is equally likely whatever the data
 * holds of it. Elements no dragon carries (ivory) are dropped first.
 */
function drawDragon(elements: readonly Element[], rng: RngState): readonly [string, RngState] {
  const usable = [...new Set(elements)].filter((e) => DRAGON_ELEMENTS.has(e)).sort()
  const [element, afterElement] = pick(usable, rng, 'a dragon element')
  const [formIndex, afterForm] = nextInt(afterElement, 2)
  const dieId = `${element}_${formIndex === 0 ? 'drake' : 'wyrm'}`
  if (!DRAGON_DICE.some((d) => d.id === dieId)) throw new Error(`no dragon die ${dieId} in the data`)
  return [dieId, afterForm] as const
}

/**
 * The opening of a run, for a race (which must be playable): eight dice, one dragon and
 * two terrains, exactly 12 health, and the force they make -- every die fielded, the
 * Home and the proposal named, the dragon named, split by `splitForce` so the opening
 * is legal by the rule setup uses.
 *
 * - one random large die, and the medium die of its class line (Oak Lord -> Oak);
 * - one medium die of a different class line, random;
 * - the race's five small dice;
 * - a dragon sharing an element with the race;
 * - a Home die of the race's own terrain type, and a Frontier die sharing an element.
 */
export function rollStart(
  race: string,
  rng: RngState,
): readonly [{ readonly units: readonly string[]; readonly force: BuiltForce }, RngState] {
  const dice = raceUnits(race)
  if (dice.length === 0) throw new Error(`${race} is not a playable race`)
  const ofSize = (size: UnitSize) => dice.filter((u) => u.size === size)

  const [large, afterLarge] = pick(ofSize('large'), rng, `a large ${race} die`)
  const sameLine = ofSize('medium').find((u) => u.unitClass === large.unitClass)
  if (sameLine === undefined) throw new Error(`${race} has no medium ${large.unitClass} die`)
  const [other, afterOther] = pick(
    ofSize('medium').filter((u) => u.unitClass !== large.unitClass),
    afterLarge,
    `a second medium ${race} die`,
  )
  const smalls = ofSize('small')

  const elements = speciesElements(race)
  const [dragon, afterDragon] = drawDragon(elements, afterOther)
  const [home, afterHome] = pick(homeDiceFor(race), afterDragon, `a Home for ${race}`)
  const [frontier, afterFrontier] = pick(terrainDiceSharing(elements), afterHome, `a Frontier for ${race}`)

  const units = [large, sameLine, other, ...smalls].map((u) => u.id)
  const [armies, afterSplit] = splitForce(units, afterFrontier)
  return [
    { units, force: { armies, homeTerrain: home, frontierProposal: frontier, dragons: [dragon] } },
    afterSplit,
  ] as const
}

/**
 * The next encounter of an act: a battle seven times in ten, then one encounter of that
 * kind from what is left of the act's pool. A half that has run out gives way to the
 * other, so the odds hold however the pool is filled and a short half never sticks.
 */
export function drawEncounter(
  content: RunContent,
  act: Act,
  drawn: readonly string[],
  rng: RngState,
): readonly [Encounter, RngState] {
  const left = byId(content.acts[act].filter((e) => !drawn.includes(e.id)))
  const [roll, afterKind] = nextInt(rng, 10)
  const wanted = roll < BATTLE_IN_10 ? 'battle' : 'event'
  const ofKind = left.filter((e) => e.kind === wanted)
  return pick(ofKind.length > 0 ? ofKind : left, afterKind, `an act ${act} encounter`)
}

/**
 * Every element of every species a force fields, death included -- what a reward's
 * dragon and terrain read. A die in the pool and not the force widens nothing.
 */
export function forceElements(force: BuiltForce): readonly Element[] {
  const species = new Set(PRESET_ARMY_NAMES.flatMap((army) => force.armies[army]).map((id) => unitType(id).species))
  return [...new Set([...species].sort().flatMap((s) => speciesElements(s)))]
}

/**
 * A reward's five offers, after a battle won by `force`:
 * - three distinct unit dice, each of the race seven times in ten and of any playable
 *   species otherwise -- a duplicate is drawn again from where the stream left off;
 * - one dragon sharing an element with the force;
 * - one terrain sharing a (non-death: no terrain carries it) element with the force.
 */
export function drawReward(race: string, force: BuiltForce, rng: RngState): readonly [readonly Offer[], RngState] {
  const units: string[] = []
  let state = rng
  while (units.length < UNIT_OFFERS) {
    const [roll, afterSource] = nextInt(state, 10)
    const source = roll < RACE_DIE_IN_10 ? raceUnits(race) : ALL_UNITS
    const [unit, afterUnit] = pick(source, afterSource, 'a unit offer')
    state = afterUnit
    if (!units.includes(unit.id)) units.push(unit.id)
  }

  const elements = forceElements(force)
  const [dragon, afterDragon] = drawDragon(elements, state)
  const [terrain, afterTerrain] = pick(terrainDiceSharing(elements), afterDragon, 'a terrain offer')

  return [
    [
      ...units.map((id): Offer => ({ kind: 'unit', id })),
      { kind: 'dragon', id: dragon },
      { kind: 'terrain', id: terrain },
    ],
    afterTerrain,
  ] as const
}

const NEXT_SIZE: Readonly<Partial<Record<UnitSize, UnitSize>>> = { small: 'medium', medium: 'large' }

/** The die one step up a unit's class line (small -> medium -> large), or null for a
 *  large die or a monster, which cannot be upgraded. */
export function upgradeOf(typeId: string): string | null {
  const unit = unitType(typeId)
  const size = NEXT_SIZE[unit.size]
  if (size === undefined) return null
  const found = ALL_UNITS.find((u) => u.species === unit.species && u.unitClass === unit.unitClass && u.size === size)
  return found?.id ?? null
}

/** What a transform may turn a die into: every other die of its species and health. */
export function transformsOf(typeId: string): readonly string[] {
  const unit = unitType(typeId)
  return ALL_UNITS.filter((u) => u.species === unit.species && u.health === unit.health && u.id !== typeId).map(
    (u) => u.id,
  )
}

/** A transform's result: one of `transformsOf`, uniformly. */
export function drawTransform(typeId: string, rng: RngState): readonly [string, RngState] {
  return pick(transformsOf(typeId), rng, `a transform of ${typeId}`)
}
