/**
 * Every random thing a run does, each a pure function of an `RngState` (v3 Phase 0).
 *
 * **The order is the stream**, as it is in `setupGame`, and `run.test.ts` pins it:
 *
 *     pick_race  -> large die -> second medium's line -> dragon element -> dragon form
 *                -> Home terrain -> Frontier proposal -> Act I's schedule
 *     act start  -> the schedule: a shuffle of the slots between its two battles
 *     encounter  -> which one, of its slot's kind, from the act's pool
 *     reward     -> template -> each offer's dice in order, each die by `giveDie`:
 *                   flavour -> (similar) a copy of the pool [-> its element] -> the die
 *                              (general unit) shared or any -> the die
 *                              (general dragon, terrain) the die
 *     die event  -> its first small die -> its second, a different die   (when it opens)
 *     boon       -> die 1, similar -> die 2, by the pool's health -> die 3, general
 *     transform  -> which die of the same species and health          (when answered)
 *
 * A forced choice draws nothing -- the same-line medium, the five small dice, the opening
 * split, the battles that open and close an act -- the
 * setup rule for a pinned terrain. Every list a draw picks from is sorted by id, so
 * reordering a data file cannot reseat a run. Terrains are drawn by setup's own lists
 * (`homeDiceFor`, `terrainDiceSharing`), so "a Home of the race's own type" means here
 * exactly what it means when setup draws one.
 */
import type { Collection } from '../data/collections'
import { DRAGON_DICE, speciesElements, unitType } from '../data/load'
import type { Element, UnitSize, UnitType } from '../data/types'
import type { BuiltForce } from '../engine/force'
import { nextInt, type RngState } from '../engine/rng'
import { homeDiceFor, terrainDiceSharing } from '../engine/setup'

import { ALL_UNITS, byId, giveDie, pick } from './give'
import {
  ACT_PLAN,
  CLOSING_TEMPLATES,
  REWARD_TEMPLATES,
  fillsSlot,
  type Act,
  type BoonGives,
  type Encounter,
  type Grant,
  type Offer,
  type RunContent,
  type Slot,
} from './types'

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
 * Home and the proposal named, the dragon named.
 *
 * The split is fixed, not drawn: the large die and its same-line medium at Home (5
 * health), the other medium at the Frontier (2), and the five small dice in the Horde,
 * at the enemy's Home (5). No army is over half of 12, so it is legal by setup's rule.
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
  const armies = {
    home: [large.id, sameLine.id],
    campaign: [other.id],
    horde: smalls.map((u) => u.id),
  }
  return [
    { units, force: { armies, homeTerrain: home, frontierProposal: frontier, dragons: [dragon] } },
    afterFrontier,
  ] as const
}

/**
 * An act's schedule (v3 Phase 6): a battle, the act's other slots shuffled among its
 * remaining battles, and a battle. The first and last are forced and draw nothing; the
 * middle is a Fisher-Yates shuffle, one draw per place from the back.
 */
export function drawSchedule(act: Act, rng: RngState): readonly [readonly Slot[], RngState] {
  const plan = ACT_PLAN[act]
  if (plan.battles < 2) throw new Error(`act ${act} needs a battle to open and one to close`)
  const middle: Slot[] = [...Array<Slot>(plan.battles - 2).fill('battle'), ...plan.between]
  let state = rng
  for (let i = middle.length - 1; i > 0; i--) {
    const [j, next] = nextInt(state, i + 1)
    state = next
    ;[middle[i], middle[j]] = [middle[j] as Slot, middle[i] as Slot]
  }
  return [['battle', ...middle, 'battle'], state] as const
}

/** The encounter for one slot of an act: one of that kind, from what is left of the pool. */
export function drawEncounter(
  content: RunContent,
  act: Act,
  slot: Slot,
  drawn: readonly string[],
  rng: RngState,
): readonly [Encounter, RngState] {
  const left = byId(content.acts[act].filter((e) => fillsSlot(e, slot) && !drawn.includes(e.id)))
  return pick(left, rng, `an act ${act} ${slot}`)
}

/**
 * A battle's reward (v3 Phase 6): one template, uniformly -- of `CLOSING_TEMPLATES` for the
 * battle that closes Act I or II, else `REWARD_TEMPLATES` -- then each offer's dice in
 * order, each by `giveDie` against the pool as it stood when the battle was won.
 */
export function drawReward(collection: Collection, closing: boolean, rng: RngState): readonly [readonly Offer[], RngState] {
  const [template, afterTemplate] = pick(closing ? CLOSING_TEMPLATES : REWARD_TEMPLATES, rng, 'a reward template')
  let state = afterTemplate
  const offers = template.map((spec): Offer => {
    const grants = spec.map(({ kind, count }): Grant => {
      const [grant, next] = giveDie(kind, count, collection, state)
      state = next
      return grant
    })
    return { grants }
  })
  return [offers, state] as const
}

/**
 * A boon's three offers (v3 Phase 6): three different dice of one kind, the first always
 * similar, the second similar or general by the pool's health, the third always general.
 */
export function drawBoon(gives: BoonGives, collection: Collection, rng: RngState): readonly [readonly Offer[], RngState] {
  const taken: string[] = []
  let state = rng
  const offers = (['similar', undefined, 'general'] as const).map((forced): Offer => {
    const [grant, next] = giveDie(gives, 1, collection, state, forced === undefined ? { taken } : { forced, taken })
    state = next
    taken.push(grant.id)
    return { grants: [grant] }
  })
  return [offers, state] as const
}

/** A die event's two small dice, drawn when it opens: different dice, each similar or
 *  general by the pool's health. */
export function drawSmalls(collection: Collection, rng: RngState): readonly [readonly [string, string], RngState] {
  const [first, afterFirst] = giveDie('small', 1, collection, rng)
  const [second, afterSecond] = giveDie('small', 1, collection, afterFirst, { taken: [first.id] })
  return [[first.id, second.id], afterSecond] as const
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
