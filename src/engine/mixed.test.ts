/**
 * Mixed armies (v2 Phase 1): species belongs to a unit, not a player.
 *
 * No setup can produce a mixed force until Phase 2, and the goldens and the fuzzes
 * play only single-species games -- so this file is the whole of the proof that every
 * call site which used to ask "which species is this player" now asks about the dice.
 * A caller that kept the old question under a new name would compile everywhere and be
 * wrong only here, which is why each one has a test that builds a mixed board directly.
 */
import { describe, expect, it } from 'vitest'

import { expectedArmy, expectedMagicBySpecies } from '../ai/estimate'
import { frontierScore } from '../ai/greedy'
import { chooseAnnouncement } from '../ai/spells'
import { unitType } from '../data/load'

import { killUnits } from './death'
import { armyRoll } from './effects'
import {
  announcementProblem,
  cantripPool,
  castableSpells,
  castingElements,
  elementsFor,
  magicBySpecies,
  magicPool,
  magicRolled,
  poolSplit,
  spellPlan,
  spellTargetProblem,
  targetsFor,
  type MagicPool,
} from './magic'
import { savesAsMelee } from './pipeline'
import { reduce } from './reduce'
import { rngFrom, rollDie, type RngState } from './rng'
import { resolveFaces, rollPools, type RawDie, type RollSpec } from './roll'
import { DRAGON_ROLL_KINDS } from './sai'
import { setupGame, STARTER_FORCES } from './setup'
import { stepGame } from './turn'
import {
  forceSpecies,
  speciesIn,
  SPECIES_RULES,
  V1_RULES,
  type AnnouncedSpell,
  type CombatState,
  type GameState,
  type Location,
  type PlayerId,
  type RuleSet,
  type TerrainSlot,
  type UnitInstance,
} from './types'
import { validateState } from './validate'

// --- fixtures ------------------------------------------------------------------

interface Spec {
  readonly id: string
  readonly typeId: string
  readonly owner: PlayerId
  readonly at: Location
}

const at = (slot: TerrainSlot): Location => ({ kind: 'terrain', slot })
const dua: Location = { kind: 'dua' }

type Terrains = Readonly<Record<TerrainSlot, string>>

/** No air, no water, no fire at the homes, so nothing fires there by accident. */
const QUIET: Terrains = { p1_home: 'swampland_tower', frontier: 'highland_tower', p2_home: 'swampland_city' }

/** A board holding exactly these units, every terrain pinned. */
function board(ruleSet: RuleSet, terrains: Terrains, rng: RngState, ...specs: readonly Spec[]): GameState {
  const base = setupGame({ seed: 1, forces: STARTER_FORCES, ruleSet, terrains })
  const units: Record<string, UnitInstance> = {}
  for (const spec of specs) {
    units[spec.id] = { id: spec.id, typeId: spec.typeId, owner: spec.owner, location: spec.at }
  }
  return { ...base, units, rng }
}

function faceWith(typeId: string, face: string): number {
  const index = unitType(typeId).faces.findIndex((f) => `${f.count} ${f.icon === 'SAI' ? `SAI:${f.sai}` : f.icon}` === face)
  if (index < 0) throw new Error(`${typeId} has no ${face} face`)
  return index
}

/** A seed whose first draw on this die satisfies the test. */
function seedRolling(typeId: string, wanted: (faceIndex: number) => boolean): RngState {
  const count = unitType(typeId).faces.length
  for (let seed = 1; seed < 1000; seed += 1) {
    const rng = rngFrom(seed)
    if (wanted(rollDie(rng, count)[0])) return rng
  }
  throw new Error(`no seed rolls ${typeId} where the test needs it`)
}

const OAKLING = 'treefolk.oakling' // 1 ID, 1 MELEE x4, 2 SAVE
const OAK = 'treefolk.oak'
const HAMADRYAD = 'treefolk.hamadryad' // 1-health Treefolk magic
const DRYAD = 'treefolk.dryad' // 2-health Treefolk magic
const ELDAR_DRYAD = 'treefolk.eldar_dryad' // 4 SAI:Cantrip
const GUARDIAN = 'firewalkers.guardian' // 1 ID, 1 SAVE, 2 MELEE ...
const WATCHER = 'firewalkers.watcher' // 2-health Firewalker
const SUNBURST = 'firewalkers.sunburst' // 1-health Firewalker magic
const SUNFLARE = 'firewalkers.sunflare' // 2-health Firewalker magic
const ASHBRINGER = 'firewalkers.ashbringer' // 3 SAI:Cantrip

const raw = (unitId: string, typeId: string, face: string): RawDie => ({
  unitId,
  typeId,
  faceIndex: faceWith(typeId, face),
})

// --- species is read off the dice ----------------------------------------------

describe('a force of two species', () => {
  const state = board(
    SPECIES_RULES,
    QUIET,
    rngFrom(1),
    { id: 't', typeId: OAKLING, owner: 'p1', at: at('frontier') },
    { id: 'f', typeId: GUARDIAN, owner: 'p1', at: dua },
    { id: 'x', typeId: GUARDIAN, owner: 'p2', at: at('p2_home') },
  )

  it('lists both species, dead dice included, in id order', () => {
    expect(forceSpecies(state, 'p1')).toEqual(['firewalkers', 'treefolk'])
    expect(forceSpecies(state, 'p2')).toEqual(['firewalkers'])
    expect(speciesIn([state.units['t']!])).toEqual(['treefolk'])
  })

  it('is a valid state', () => {
    expect(validateState(state)).toEqual([])
  })
})

// --- the species abilities, per die ------------------------------------------------

describe('Replanting in a mixed army', () => {
  it('rolls the Treefolk die and draws nothing for the Firewalker beside it', () => {
    // Coastland contains water; the Oakling rolls its ID, so it roots.
    const rng = seedRolling(OAKLING, (i) => i === faceWith(OAKLING, '1 ID'))
    const state = board(
      SPECIES_RULES,
      { ...QUIET, frontier: 'coastland_tower' },
      rng,
      { id: 't', typeId: OAKLING, owner: 'p1', at: at('frontier') },
      { id: 'f', typeId: GUARDIAN, owner: 'p1', at: at('frontier') },
      { id: 'x', typeId: GUARDIAN, owner: 'p2', at: at('p2_home') },
    )
    const outcome = killUnits(state, ['t', 'f'])
    expect(outcome.replantDice.map((d) => d.unitId)).toEqual(['t'])
    expect(outcome.replanted).toEqual(['t'])
    // One die thrown, for the one Treefolk: the Firewalker draws nothing.
    expect(outcome.state.rng.counter).toBe(state.rng.counter + 1)
    expect(outcome.state.units['f']?.location).toEqual(dua)
  })
})

describe('Accelerated Growth in a mixed force', () => {
  const growing = (state: GameState): GameState => ({
    ...state,
    effects: [
      {
        source: 'Accelerated Growth',
        target: { kind: 'player', player: 'p1' },
        modifiers: [],
        trigger: 'accelerated_growth',
        expiresAtStartOfTurnOf: 'p1',
      },
    ],
  })

  it('offers a dying Treefolk its exchange, and never a Firewalker, whose DUA partner is right there', () => {
    const state = growing(
      board(
        SPECIES_RULES,
        QUIET,
        rngFrom(1),
        { id: 'oak', typeId: OAK, owner: 'p1', at: at('frontier') },
        { id: 'watcher', typeId: WATCHER, owner: 'p1', at: at('frontier') },
        { id: 'oakling', typeId: OAKLING, owner: 'p1', at: dua },
        { id: 'guardian', typeId: GUARDIAN, owner: 'p1', at: dua },
        { id: 'x', typeId: GUARDIAN, owner: 'p2', at: at('p2_home') },
      ),
    )
    const outcome = killUnits(state, ['oak', 'watcher'])
    // "When a two (or greater) health Treefolk unit is killed": the spell's own species.
    expect(outcome.offered).toEqual(['oak'])
    const offer = outcome.state.turn.growthOffers?.[0]
    expect(offer?.dying.map((d) => d.unitId)).toEqual(['oak'])
    expect(offer?.partners).toEqual(['oakling'])
  })
})

describe('Flaming Shields in a mixed army', () => {
  const armyAt = (frontier: string) =>
    board(
      SPECIES_RULES,
      { ...QUIET, frontier },
      rngFrom(1),
      { id: 't', typeId: OAKLING, owner: 'p1', at: at('frontier') },
      { id: 'f', typeId: GUARDIAN, owner: 'p1', at: at('frontier') },
      { id: 'x', typeId: GUARDIAN, owner: 'p2', at: at('p2_home') },
    )

  it('is granted for the Firewalkers in the army, by name', () => {
    const { modifiers } = armyRoll(armyAt('highland_tower'), 'p1', 'frontier', 'melee')
    expect(modifiers.filter((m) => m.kind === 'counts_as')).toEqual([savesAsMelee(['firewalkers'])])
  })

  it('is not granted to an army of Treefolk alone, even at a fire terrain', () => {
    const state = armyAt('highland_tower')
    const onlyTreefolk = { ...state, units: { t: state.units['t']!, x: state.units['x']! } }
    const { modifiers } = armyRoll(onlyTreefolk, 'p1', 'frontier', 'melee')
    expect(modifiers.some((m) => m.kind === 'counts_as')).toBe(false)
  })

  const spec = (kinds: RollSpec['kinds']): RollSpec => ({
    kinds,
    modifiers: [savesAsMelee(['firewalkers'])],
    context: { purpose: { kind: 'attack', action: 'melee' }, isCounter: false },
  })
  // The Oakling shows 2 SAVE, the Guardian 1 SAVE: only the Guardian's converts.
  const dice = [raw('t', OAKLING, '2 SAVE'), raw('f', GUARDIAN, '1 SAVE')]

  it("converts the Firewalker's saves and leaves the Treefolk's saves as saves", () => {
    const outcome = resolveFaces(dice, spec(['melee']), SPECIES_RULES)
    expect(outcome.totals.melee).toBe(1)
    expect(outcome.countedAs).toBe(1)
    expect(outcome.dice.map((d) => d.results)).toEqual([0, 1])
  })

  it('offers only the Firewalker saves to move in a combination roll', () => {
    expect(rollPools(dice, spec(DRAGON_ROLL_KINDS), SPECIES_RULES).shields).toBe(1)
  })

  it("is estimated per die: the fire terrain adds the Guardian's expected saves and not the Oakling's", () => {
    const fire = expectedArmy(armyAt('highland_tower'), 'p1', 'frontier', 'melee').total
    const none = expectedArmy(armyAt('coastland_tower'), 'p1', 'frontier', 'melee').total
    // The Guardian has one 1 SAVE face in six; the Oakling's 2 SAVE face must not count.
    expect(fire - none).toBeCloseTo(1 / 6, 10)
  })
})

describe('Rapid Growth in a mixed army', () => {
  function contestable(seed: number): GameState {
    const base = board(
      SPECIES_RULES,
      QUIET, // the Frontier is a Highland: it contains earth
      rngFrom(seed),
      { id: 't1', typeId: OAKLING, owner: 'p1', at: at('frontier') },
      { id: 't2', typeId: 'treefolk.willowling', owner: 'p1', at: at('frontier') },
      { id: 'f1', typeId: GUARDIAN, owner: 'p1', at: at('frontier') },
      { id: 'f2', typeId: WATCHER, owner: 'p1', at: at('frontier') },
      { id: 'm1', typeId: WATCHER, owner: 'p2', at: at('frontier') },
      { id: 'm2', typeId: WATCHER, owner: 'p2', at: at('frontier') },
    )
    return {
      ...base,
      turn: {
        ...base.turn,
        marching: 'p2',
        phase: 'march',
        marchIndex: 0,
        marchStep: 'contest_maneuver',
        marchingArmy: 'frontier',
        armiesMarched: ['frontier'],
        combat: null,
      },
      pending: { kind: 'contest_maneuver', player: 'p1', slot: 'frontier' },
    }
  }

  it('offers only the Treefolk dice to throw again', () => {
    let paused = 0
    for (let seed = 1; seed <= 300; seed++) {
      const state = reduce(contestable(seed), { kind: 'contest_maneuver', contest: true })
      if (state.pending?.kind !== 'rapid_growth') continue
      paused += 1
      expect(state.pending.options.length, `seed ${seed}`).toBeGreaterThan(0)
      for (const id of state.pending.options) expect(['t1', 't2'], `seed ${seed}`).toContain(id)
    }
    expect(paused, 'no contest paused for Rapid Growth, so this proved nothing').toBeGreaterThan(0)
  })
})

describe('Air Flight in a mixed force', () => {
  // The Frontier a Wasteland (air, fire) and p2's home a Coastland (air, water).
  const TERRAINS: Terrains = { p1_home: 'swampland_tower', frontier: 'wasteland_tower', p2_home: 'coastland_tower' }

  function retreatStep(...specs: readonly Spec[]): GameState {
    const base = board(SPECIES_RULES, TERRAINS, rngFrom(1), ...specs, {
      id: 'x',
      typeId: OAKLING,
      owner: 'p1',
      at: at('p1_home'),
    })
    return stepGame({
      ...base,
      pending: null,
      turn: { ...base.turn, marching: 'p2', phase: 'reserves_retreat', marchStep: 'select_army' },
    })
  }

  it('does not fly to an air terrain holding only your Treefolk, and never flies a Treefolk', () => {
    const state = retreatStep(
      { id: 'g', typeId: GUARDIAN, owner: 'p2', at: at('frontier') },
      { id: 't', typeId: OAKLING, owner: 'p2', at: at('p2_home') },
    )
    if (state.pending?.kind !== 'retreat') throw new Error('not at the Retreat Step')
    // "...to any other terrain that contains air and where you have at least one
    // Firewalker unit": the Coastland holds a unit of yours, but no Firewalker.
    expect(state.pending.flights).toBeUndefined()
  })

  it('flies the Firewalker to an air terrain where another Firewalker stands, and still not the Treefolk', () => {
    const state = retreatStep(
      { id: 'g', typeId: GUARDIAN, owner: 'p2', at: at('frontier') },
      { id: 't', typeId: OAKLING, owner: 'p2', at: at('frontier') },
      { id: 'w', typeId: WATCHER, owner: 'p2', at: at('p2_home') },
    )
    if (state.pending?.kind !== 'retreat') throw new Error('not at the Retreat Step')
    expect(state.pending.flights).toEqual([
      { unitId: 'g', options: ['p2_home'] },
      { unitId: 'w', options: ['frontier'] },
    ])
  })
})

// --- the magic pool --------------------------------------------------------------------

describe('the magic pool of a mixed force', () => {
  const state = board(
    V1_RULES,
    QUIET,
    rngFrom(1),
    { id: 'h', typeId: HAMADRYAD, owner: 'p1', at: at('frontier') },
    { id: 's', typeId: SUNBURST, owner: 'p1', at: at('frontier') },
    { id: 'dead_t', typeId: OAKLING, owner: 'p1', at: dua },
    { id: 'dead_f', typeId: GUARDIAN, owner: 'p1', at: dua },
    { id: 'x', typeId: GUARDIAN, owner: 'p2', at: at('frontier') },
  )
  const mixed = (treefolk: number, firewalkers: number, points = treefolk + firewalkers): MagicPool =>
    magicPool(state, 'p1', 'frontier', points, { treefolk, firewalkers })
  const cast = (spell: string, element: AnnouncedSpell['element'], count = 1): AnnouncedSpell => ({
    spell,
    element,
    count,
    target: { kind: 'none' },
  })

  it('is one supplier per species, each in its own elements', () => {
    const pool = mixed(3, 2)
    expect(pool.points).toBe(5)
    expect(pool.suppliers).toEqual([
      { species: 'firewalkers', points: 2, elements: ['air', 'fire'] },
      { species: 'treefolk', points: 3, elements: ['water', 'earth'] },
    ])
    expect([...pool.elements].sort()).toEqual(['air', 'earth', 'fire', 'water'])
    expect(magicRolled(pool)).toBe('5 magic (2 Firewalkers: air or fire; 3 Treefolk: water or earth)')
  })

  it("keeps a single-species force's pool exactly as it was: one number, no suppliers", () => {
    const single = board(
      V1_RULES,
      QUIET,
      rngFrom(1),
      { id: 'h', typeId: HAMADRYAD, owner: 'p1', at: at('frontier') },
      { id: 'x', typeId: GUARDIAN, owner: 'p2', at: at('frontier') },
    )
    expect(magicPool(single, 'p1', 'frontier', 4, { treefolk: 4 })).toEqual({ points: 4, elements: ['water', 'earth'] })
    expect(poolSplit(undefined)).toBeNull()
  })

  it("reads each species' share off the dice", () => {
    const dice = [
      { typeId: HAMADRYAD, results: 2 },
      { typeId: SUNBURST, results: 1 },
      { typeId: DRYAD, results: 3 },
      { typeId: SUNFLARE, results: 0 },
    ]
    expect(magicBySpecies(dice)).toEqual({ treefolk: 5, firewalkers: 1 })
  })

  it("offers a species spell only when that species' dice rolled enough for it", () => {
    const castable = (pool: MagicPool) => castableSpells(state, 'p1', pool, V1_RULES).map((c) => c.spell.id)
    // Flashfire is the Firewalkers' and costs 3; Wall of Thorns the Treefolk's and costs 5.
    expect(castable(mixed(5, 2))).not.toContain('flashfire')
    expect(castable(mixed(5, 2))).toContain('wall_of_thorns')
    expect(castable(mixed(2, 5))).toContain('flashfire')
    expect(castable(mixed(2, 5))).not.toContain('wall_of_thorns')
  })

  it('offers an element only where a supplier that may pay for the spell carries it', () => {
    const offer = castableSpells(state, 'p1', mixed(0, 4), V1_RULES)
    // Watery Double is water: nobody who rolled can pay in water, so it is not on offer.
    expect(offer.map((c) => c.spell.id)).not.toContain('watery_double')
    expect(offer.find((c) => c.spell.id === 'fiery_weapon')?.elements).toEqual(['fire'])
  })

  it('refuses an announcement no split of the pool pays for, and accepts one that has a split', () => {
    const pool = mixed(3, 2)
    // Stone Skin (earth) and Watery Double (water) both need Treefolk results: 4 of 3.
    expect(announcementProblem(pool, [cast('stone_skin', 'earth'), cast('watery_double', 'water')])).toMatch(
      /need 4 magic that only the Treefolk magic can pay, and 3 was rolled/,
    )
    // Stone Skin paid in earth and Hailstorm in air: Treefolk pays 2, Firewalkers 2.
    expect(announcementProblem(pool, [cast('stone_skin', 'earth'), cast('hailstorm', 'air')])).toBeNull()
  })

  it('refuses a Treefolk spell paid for with Firewalker results', () => {
    // Wall of Thorns costs 5 and is the Treefolk's; 3 + 2 is 5, and 2 of it is not theirs.
    expect(announcementProblem(mixed(3, 2), [cast('wall_of_thorns', 'earth')])).toMatch(/Treefolk/)
    expect(announcementProblem(mixed(5, 2), [cast('wall_of_thorns', 'earth')])).toBeNull()
  })

  it('lets the caster choose whose results an army modifier took (a house rule)', () => {
    // The dice rolled 3 + 2, and an Ash Storm left 4: any split of 4 is the caster's.
    const pool = mixed(3, 2, 4)
    expect(announcementProblem(pool, [cast('stone_skin', 'earth'), cast('hailstorm', 'air')])).toBeNull()
    // ...but no supplier pays past what its own dice rolled: Flash Flood is water, only
    // the Treefolk carry it, and they rolled 3.
    expect(announcementProblem(pool, [cast('flash_flood', 'water')])).toMatch(/Treefolk/)
    // And the whole spend stays within the total the modifier left.
    expect(
      announcementProblem(pool, [cast('stone_skin', 'earth'), cast('hailstorm', 'air'), cast('ash_storm', 'fire')]),
    ).toMatch(/only 4 rolled/)
  })

  it('prices what is left by species, not only by the number', () => {
    const pool = mixed(3, 2)
    const castable = castableSpells(state, 'p1', pool, V1_RULES)
    const staged = [{ spell: 'stone_skin', element: 'earth' as const, count: 1, target: { kind: 'army', player: 'p1', army: 'frontier' } as const }]
    const plan = spellPlan(castable, pool, staged)
    expect(plan.remaining).toBe(3)
    expect(plan.problem).toBeNull()
    const affordable = (id: string) => plan.offers.find((o) => o.castable.spell.id === id)?.affordable
    // Three points are left, but only one of them is Treefolk: no water spell for 2.
    expect(affordable('watery_double')).toBe(0)
    // The two Firewalker points still buy a Hailstorm.
    expect(affordable('hailstorm')).toBe(1)
  })

  it("filters Resurrect Dead's targets to the dead the offered elements could raise", () => {
    // Treefolk magic alone: water or earth. The dead Guardian carries neither.
    const offer = castableSpells(state, 'p1', mixed(6, 0), V1_RULES).find((c) => c.spell.id === 'resurrect_dead')
    const ids = offer?.targets.flatMap((t) => (t.target.kind === 'units' ? t.target.unitIds : []))
    expect(ids).toEqual(['dead_t'])
  })

  // v2 Phase 2's fuzz found this on its first mixed game: the offer said which dice,
  // not which colour raises which, and both AIs paid for a Firewalker in water.
  it('says which elements raise which dead die, and only where that narrows the choice', () => {
    const offer = castableSpells(state, 'p1', mixed(3, 3), V1_RULES).find((c) => c.spell.id === 'resurrect_dead')
    if (offer === undefined) throw new Error('Resurrect Dead is not offered')
    const tree = { kind: 'units', unitIds: ['dead_t'] } as const
    const fire = { kind: 'units', unitIds: ['dead_f'] } as const
    expect([...offer.elements].sort()).toEqual(['air', 'earth', 'fire', 'water'])
    expect([...elementsFor(offer, tree)].sort()).toEqual(['earth', 'water'])
    expect([...elementsFor(offer, fire)].sort()).toEqual(['air', 'fire'])
    const reached = (element: AnnouncedSpell['element']) =>
      targetsFor(offer, element).flatMap((t) => (t.target.kind === 'units' ? t.target.unitIds : []))
    expect(reached('water')).toEqual(['dead_t'])
    expect(reached('fire')).toEqual(['dead_f'])
    // And every pairing the offer allows, the engine accepts.
    for (const t of offer.targets) {
      for (const element of elementsFor(offer, t.target)) {
        expect(spellTargetProblem(state, { spell: 'resurrect_dead', element, count: 1, target: t.target })).toBeNull()
      }
    }
  })

  it('leaves the field off where the offered elements already decide it', () => {
    const offer = castableSpells(state, 'p1', mixed(6, 0), V1_RULES).find((c) => c.spell.id === 'resurrect_dead')
    expect(offer?.targets.every((t) => !('elements' in t))).toBe(true)
  })

  it("names each supplier's elements, and the whole force's by default", () => {
    expect([...castingElements(state, 'p1', 'frontier')].sort()).toEqual(['air', 'earth', 'fire', 'water'])
    expect(castingElements(state, 'p1', 'frontier', ['treefolk'])).toEqual(['water', 'earth'])
  })

  it('splits a Cantrip pool by the species of the dice that rolled it', () => {
    const cantrips = [raw('e', ELDAR_DRYAD, '4 SAI:Cantrip'), raw('a', ASHBRINGER, '3 SAI:Cantrip')]
    const withDice: GameState = {
      ...state,
      units: {
        ...state.units,
        e: { id: 'e', typeId: ELDAR_DRYAD, owner: 'p1', location: at('frontier') },
        a: { id: 'a', typeId: ASHBRINGER, owner: 'p1', location: at('frontier') },
      },
      turn: { ...state.turn, combat: { attack: { dice: cantrips } } as unknown as CombatState },
    }
    const pool = cantripPool(withDice, 'p1', 'frontier', 7)
    expect(pool.cantripOnly).toBe(true)
    expect(pool.suppliers?.map((s) => [s.species, s.points])).toEqual([
      ['firewalkers', 3],
      ['treefolk', 4],
    ])
  })

  /** A mixed army at the Frontier, paused on its magic action's announcement. */
  function magicAction(seed: number): GameState {
    const casting = board(
      V1_RULES,
      QUIET,
      rngFrom(seed),
      { id: 'd', typeId: DRYAD, owner: 'p1', at: at('frontier') },
      { id: 'h', typeId: HAMADRYAD, owner: 'p1', at: at('frontier') },
      { id: 'f', typeId: SUNFLARE, owner: 'p1', at: at('frontier') },
      { id: 's', typeId: SUNBURST, owner: 'p1', at: at('frontier') },
      { id: 'x', typeId: GUARDIAN, owner: 'p2', at: at('p2_home') },
    )
    const ready = stepGame({
      ...casting,
      // Highland's face 1 is magic.
      terrains: { ...casting.terrains, frontier: { ...casting.terrains.frontier, face: 1 } },
      pending: null,
      turn: {
        ...casting.turn,
        marching: 'p1',
        phase: 'march',
        marchIndex: 0,
        marchStep: 'action',
        marchingArmy: 'frontier',
        armiesMarched: ['frontier'],
        combat: null,
      },
    })
    expect(ready.pending?.kind).toBe('choose_action')
    return reduce(ready, { kind: 'choose_action', action: 'magic' })
  }

  it('is what a magic action rolls, logs, and holds an announcement to', () => {
    // A roll where both species rolled magic, and the Firewalkers fewer than the 3 a
    // Flashfire costs while the whole pool could cover it.
    for (let seed = 1; seed <= 200; seed++) {
      const rolled = magicAction(seed)
      if (rolled.pending?.kind !== 'announce_spells') throw new Error(`seed ${seed}: no announcement`)
      const entry = rolled.log.find((e) => e.kind === 'magic_rolled')
      if (entry?.kind !== 'magic_rolled') throw new Error(`seed ${seed}: no magic_rolled entry`)
      const split = magicBySpecies(entry.dice)
      const firewalkers = split['firewalkers'] ?? 0
      if (!(entry.total >= 3 && firewalkers > 0 && firewalkers < 3)) continue

      // The pool the announcement is held to is the log's, and its suppliers are the dice's.
      expect(rolled.pending.pool.suppliers).toEqual(entry.suppliers)
      expect(entry.suppliers?.map((s) => [s.species, s.points])).toEqual([
        ['firewalkers', firewalkers],
        ['treefolk', split['treefolk']],
      ])
      expect(validateState(rolled)).toEqual([])

      const flashfire: AnnouncedSpell = {
        spell: 'flashfire',
        element: 'fire',
        count: 1,
        target: { kind: 'army', player: 'p1', army: 'frontier' },
      }
      expect(() => reduce(rolled, { kind: 'announce_spells', casts: [flashfire] })).toThrow(/not castable/)
      return
    }
    throw new Error('no seed in 200 rolled the split this test needs')
  })
})

// --- the AI --------------------------------------------------------------------------

describe('GreedyAI over a mixed force', () => {
  const state = board(
    V1_RULES,
    QUIET,
    rngFrom(1),
    { id: 't', typeId: OAKLING, owner: 'p1', at: at('frontier') },
    { id: 'w', typeId: WATCHER, owner: 'p1', at: at('frontier') },
    { id: 'x', typeId: GUARDIAN, owner: 'p2', at: at('frontier') },
  )

  it('weighs a Frontier by the elements each die shares with it, by health', () => {
    // Swampland is water and earth: the Oakling (1 health) shares two, the Watcher
    // (2 health) none, so p1 shares 2/3 on average; the Guardian shares none.
    expect(frontierScore(state, 'p1', 'swampland_temple')).toBeCloseTo(2 / 3, 10)
    // A single-species force scores exactly as v1 did: the count of shared elements.
    expect(frontierScore(state, 'p2', 'wasteland_temple')).toBeCloseTo(2 - (1 * 0 + 2 * 2) / 3, 10)
  })

  it("splits an expected magic total by the species' expected dice, summing to the total", () => {
    const casting = board(
      V1_RULES,
      QUIET,
      rngFrom(1),
      { id: 'd', typeId: DRYAD, owner: 'p1', at: at('frontier') },
      { id: 'f', typeId: SUNFLARE, owner: 'p1', at: at('frontier') },
      { id: 'x', typeId: GUARDIAN, owner: 'p2', at: at('p2_home') },
    )
    const split = expectedMagicBySpecies(casting, 'p1', 'frontier', 5)
    expect(Object.values(split).reduce((a, b) => a + b, 0)).toBe(5)
    expect(Object.keys(split).sort()).toEqual(['firewalkers', 'treefolk'])
  })

  it('announces only what some split of a mixed pool pays for', () => {
    const pool = magicPool(state, 'p1', 'frontier', 9, { treefolk: 2, firewalkers: 7 })
    const castable = castableSpells(state, 'p1', pool, V1_RULES)
    const { casts } = chooseAnnouncement(state, 'p1', 'frontier', castable, pool)
    expect(casts.length).toBeGreaterThan(0)
    expect(announcementProblem(pool, casts)).toBeNull()
  })
})
