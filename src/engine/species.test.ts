/**
 * Species abilities (v1 Phase 8): the table, the phase, and each ability firing only
 * where it should -- with a test for every "not", which is the phase's exit criterion.
 */
import { describe, expect, it } from 'vitest'

import { passiveAi } from '../ai/passive'
import { randomAi } from '../ai/random'
import { runGame } from '../ai/run'
import { SPECIES, UNIT_TYPES, unitType } from '../data/load'

import { buryUnits, deathEntries, killAndBury, killedIds, killUnits } from './death'
import { armyRoll } from './effects'
import { savesAsMelee, type Modifier } from './pipeline'
import { begin, reduce } from './reduce'
import { rngFrom, rollDie, type RngState } from './rng'
import { resolveFaces, rollPools, type RawDie, type RollSpec } from './roll'
import { DRAGON_ROLL_KINDS } from './sai'
import { BESTIARY_FORCES, setupGame, STARTER_FORCES, type ForceSpec } from './setup'
import {
  ABILITY_TEXT,
  SPECIES_ABILITIES,
  unitHasAbility,
  terrainHas,
  type AbilityName,
} from './species'
import { stepGame } from './turn'
import {
  SPECIES_RULES,
  SPELL_RULES,
  V0_RULES,
  V1_RULES,
  type DragonInPlay,
  type GameState,
  type Location,
  type PlayerId,
  type RuleSet,
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

const at = (slot: 'p1_home' | 'frontier' | 'p2_home'): Location => ({ kind: 'terrain', slot })
const reserve: Location = { kind: 'reserve' }

/**
 * A board with exactly these units, the Frontier pinned to a named terrain die.
 *
 * Every unit a test does not name is gone, so a species is read off the dice the test
 * put there -- and a test that forgets to give a player a unit finds out at once.
 */
function board(
  ruleSet: RuleSet,
  frontier: string,
  rng: RngState,
  ...specs: readonly Spec[]
): GameState {
  const base = setupGame({ seed: 1, forces: STARTER_FORCES, ruleSet, terrains: { frontier } })
  const units: Record<string, UnitInstance> = {}
  for (const spec of specs) {
    units[spec.id] = { id: spec.id, typeId: spec.typeId, owner: spec.owner, location: spec.at }
  }
  return { ...base, units, rng }
}

/** The first face index of a type showing an icon, so no test hardcodes a number. */
function faceWith(typeId: string, icon: string): number {
  const index = unitType(typeId).faces.findIndex((face) => face.icon === icon)
  if (index < 0) throw new Error(`${typeId} has no ${icon} face`)
  return index
}

/** A seed whose first draw on this die lands on a face the test wants. */
function seedRolling(typeId: string, wanted: (faceIndex: number) => boolean): RngState {
  const faceCount = unitType(typeId).faces.length
  for (let seed = 1; seed < 1000; seed += 1) {
    const rng = rngFrom(seed)
    const [faceIndex] = rollDie(rng, faceCount)
    if (wanted(faceIndex)) return rng
  }
  throw new Error(`no seed under 1000 rolls ${typeId} where the test needs it`)
}

const OAKLING = 'treefolk.oakling'
/** A Firewalker with a plain `1 SAVE` face and a `1 MELEE` one. */
const GUARDIAN = 'firewalkers.guardian'
/** Flaming Shields' permission as `armyRoll` gathers it for a Firewalker army. */
const SAVES_AS_MELEE = savesAsMelee(['firewalkers'])
/** `2 SAVE` and `3 MELEE`. */
const WATCHER = 'firewalkers.watcher'

const die = (unitId: string, typeId: string, icon: string): RawDie => ({
  unitId,
  typeId,
  faceIndex: faceWith(typeId, icon),
})

// --- the table -----------------------------------------------------------------

describe('the species ability table', () => {
  it('names every species in the data, so a new one fails here rather than playing with none', () => {
    for (const species of SPECIES) {
      expect(SPECIES_ABILITIES[species.id], species.id).toBeDefined()
    }
  })

  it('has the rule text for every ability it names', () => {
    for (const abilities of Object.values(SPECIES_ABILITIES)) {
      for (const ability of abilities) expect(ABILITY_TEXT[ability]).toMatch(/\w/)
    }
  })

  it('is off in every rung below SPECIES_RULES, and on in V1_RULES, which only adds the roll-off', () => {
    expect(V0_RULES.speciesAbilities).toBe(false)
    expect(SPELL_RULES.speciesAbilities).toBe(false)
    expect(V1_RULES).toEqual({ ...SPECIES_RULES, rollOff: 'choice' })

    const units: Spec[] = [
      { id: 't', typeId: OAKLING, owner: 'p1', at: at('frontier') },
      { id: 'f', typeId: GUARDIAN, owner: 'p2', at: at('frontier') },
    ]
    const off = board(SPELL_RULES, 'swampland_tower', rngFrom(1), ...units)
    const on = board(SPECIES_RULES, 'swampland_tower', rngFrom(1), ...units)

    const has = (state: GameState, id: string, ability: AbilityName) =>
      unitHasAbility(state.ruleSet, state.units[id]!, ability)
    const all: AbilityName[] = ['Rapid Growth', 'Replanting', 'Air Flight', 'Flaming Shields']
    for (const ability of all) {
      expect(has(off, 't', ability)).toBe(false)
      expect(has(off, 'f', ability)).toBe(false)
    }
    expect(has(on, 't', 'Replanting')).toBe(true)
    expect(has(on, 't', 'Rapid Growth')).toBe(true)
    expect(has(on, 't', 'Flaming Shields')).toBe(false)
    expect(has(on, 'f', 'Air Flight')).toBe(true)
    expect(has(on, 'f', 'Flaming Shields')).toBe(true)
    expect(has(on, 'f', 'Replanting')).toBe(false)
  })

  it("reads a terrain's elements off its die, and the Reserve Area contains nothing", () => {
    const state = board(SPECIES_RULES, 'feyland_tower', rngFrom(1), {
      id: 't',
      typeId: OAKLING,
      owner: 'p1',
      at: at('frontier'),
    })
    expect(terrainHas(state, 'frontier', 'water')).toBe(true)
    expect(terrainHas(state, 'frontier', 'fire')).toBe(true)
    expect(terrainHas(state, 'frontier', 'earth')).toBe(false)
    expect(terrainHas(state, 'reserve', 'water')).toBe(false)
  })
})

// --- the phase -----------------------------------------------------------------

describe('the Species Abilities Phase', () => {
  it('sits between the Dragon Attack Phase and the march, and asks nothing', () => {
    for (const ruleSet of [V0_RULES, SPECIES_RULES]) {
      const base = begin(setupGame({ seed: 3, forces: STARTER_FORCES, ruleSet }))
      // The dragon phase with no dragon anywhere ends on its first step.
      const dragons: GameState = {
        ...base,
        pending: null,
        dragons: {},
        turn: { ...base.turn, phase: 'dragon_attack' },
      }

      const species = stepGame(dragons)
      expect(species.turn.phase).toBe('species_abilities')
      expect(species.pending).toBeNull()

      const march = stepGame(species)
      expect(march.turn.phase).toBe('march')
      expect(march.turn.marchStep).toBe('select_army')
      expect(march.pending).toBeNull()
      // It draws nothing and logs nothing: a phase that does nothing in this box.
      expect(march.rng).toEqual(dragons.rng)
      expect(march.log).toEqual(dragons.log)
    }
  })
})

// --- Flaming Shields -------------------------------------------------------------

const meleeSpec = (modifiers: readonly Modifier[], isCounter = false): RollSpec => ({
  kinds: ['melee'],
  modifiers,
  context: { purpose: { kind: 'attack', action: 'melee' }, isCounter },
})

describe('Flaming Shields', () => {
  // One `1 SAVE`, one `3 MELEE`: three melee, one save.
  const dice = [die('g', GUARDIAN, 'SAVE'), { unitId: 'w', typeId: WATCHER, faceIndex: 1 }]

  it('counts rolled saves as melee in a melee attack, at step 10', () => {
    expect(unitType(WATCHER).faces[1]).toEqual({ count: 3, icon: 'MELEE' })

    const plain = resolveFaces(dice, meleeSpec([]), SPECIES_RULES)
    const shielded = resolveFaces(dice, meleeSpec([SAVES_AS_MELEE]), SPECIES_RULES)

    expect(plain.totals.melee).toBe(3)
    expect(shielded.totals.melee).toBe(4)
    expect(shielded.countedAs).toBe(1)
    expect(plain.countedAs).toBeUndefined()
  })

  it("draws the save die as contributing, so the strip does not grey it out", () => {
    const shielded = resolveFaces(dice, meleeSpec([SAVES_AS_MELEE]), SPECIES_RULES)
    expect(shielded.dice.map((d) => d.results)).toEqual([1, 3])
    // And the dice add up to the total, which is what the strip's `12 → 8` checks.
    expect(shielded.dice.reduce((sum, d) => sum + d.results, 0)).toBe(shielded.totals.melee)
  })

  it('does not apply to a counter-attack', () => {
    const counter = resolveFaces(dice, meleeSpec([SAVES_AS_MELEE], true), SPECIES_RULES)
    expect(counter.totals.melee).toBe(3)
    expect(counter.countedAs).toBeUndefined()
    expect(counter.dice.map((d) => d.results)).toEqual([0, 3])
  })

  it('does nothing in a roll that does not count melee', () => {
    const missile: RollSpec = {
      kinds: ['missile'],
      modifiers: [SAVES_AS_MELEE],
      context: { purpose: { kind: 'attack', action: 'missile' }, isCounter: false },
    }
    const outcome = resolveFaces(dice, missile, SPECIES_RULES)
    expect(outcome.countedAs).toBeUndefined()
    expect(outcome.totals.melee).toBeUndefined()
  })

  it('converts an SAI’s rolled save results, since they came off a die', () => {
    // Counter in a save roll against nothing -- Wall of Thorns' purpose -- gives
    // four saves, which that roll does not count. Flaming Shields turns them into
    // melee, which it does.
    const counterFace = unitType('firewalkers.expeditioner').faces.findIndex(
      (face) => face.icon === 'SAI' && face.sai === 'Counter',
    )
    const thorns: RollSpec = {
      kinds: ['melee'],
      modifiers: [SAVES_AS_MELEE],
      context: { purpose: { kind: 'save', against: null }, isCounter: false, isTrigger: true },
    }
    const outcome = resolveFaces(
      [{ unitId: 'e', typeId: 'firewalkers.expeditioner', faceIndex: counterFace }],
      thorns,
      SPECIES_RULES,
    )
    expect(outcome.totals.melee).toBe(4)
    expect(outcome.countedAs).toBe(4)
  })

  describe('in a combination roll, where it is a choice', () => {
    // `1 SAVE`, `2 SAVE`, `3 MELEE`: three saves on the dice, three melee.
    const combo = [
      die('g', GUARDIAN, 'SAVE'),
      die('w1', WATCHER, 'SAVE'),
      { unitId: 'w2', typeId: WATCHER, faceIndex: 1 },
    ]
    const spec = (savesAsMelee?: number, extra: readonly Modifier[] = []): RollSpec => ({
      kinds: DRAGON_ROLL_KINDS,
      modifiers: [SAVES_AS_MELEE, ...extra],
      context: { purpose: { kind: 'dragon_attack' }, isCounter: false },
      idAllocation: { melee: 0, missile: 0, save: 0 },
      ...(savesAsMelee === undefined ? {} : { savesAsMelee }),
    })

    it('reports how many saves there are to move, and converts none unasked', () => {
      expect(rollPools(combo, spec(), SPECIES_RULES).shields).toBe(3)
      const none = resolveFaces(combo, spec(), SPECIES_RULES)
      expect(none.totals).toMatchObject({ melee: 3, save: 3 })
      expect(none.countedAs).toBeUndefined()
    })

    it('moves exactly the chosen number from save to melee', () => {
      const moved = resolveFaces(combo, spec(2), SPECIES_RULES)
      expect(moved.totals).toMatchObject({ melee: 5, save: 1 })
      expect(moved.countedAs).toBe(2)
    })

    it("never converts a spell's saves: only what the dice rolled", () => {
      const stoneSkin: Modifier = { kind: 'add', resultType: 'save', amount: 4 }
      expect(rollPools(combo, spec(undefined, [stoneSkin]), SPECIES_RULES).shields).toBe(3)
      expect(() => resolveFaces(combo, spec(4, [stoneSkin]), SPECIES_RULES)).toThrow(/from 3 rolled/)
    })

    it('refuses a conversion the roll has no Flaming Shields for', () => {
      const bare: RollSpec = { ...spec(1), modifiers: [] }
      expect(() => resolveFaces(combo, bare, SPECIES_RULES)).toThrow(/no Flaming Shields/)
      expect(rollPools(combo, { ...spec(), modifiers: [] }, SPECIES_RULES).shields).toBe(0)
    })

    it('has nothing to ask in a single-kind roll, where it converts everything', () => {
      expect(rollPools(dice, meleeSpec([SAVES_AS_MELEE]), SPECIES_RULES).shields).toBe(0)
      expect(() =>
        resolveFaces(dice, { ...meleeSpec([SAVES_AS_MELEE]), savesAsMelee: 1 }, SPECIES_RULES),
      ).toThrow(/converts every save/)
    })
  })

  describe('where armyRoll grants it', () => {
    const units = (frontierUnit: string, owner: PlayerId): Spec[] => [
      { id: 'u', typeId: frontierUnit, owner, at: at('frontier') },
      // The other side needs a die too, or its species cannot be read.
      { id: 'x', typeId: owner === 'p1' ? GUARDIAN : OAKLING, owner: owner === 'p1' ? 'p2' : 'p1', at: at('p1_home') },
    ]
    const grants = (ruleSet: RuleSet, frontier: string, typeId: string, owner: PlayerId, type = 'melee' as const) =>
      armyRoll(board(ruleSet, frontier, rngFrom(1), ...units(typeId, owner)), owner, 'frontier', type)
        .modifiers.some((m) => m.kind === 'counts_as')

    it('to Firewalkers rolling melee at a terrain containing fire', () => {
      expect(grants(SPECIES_RULES, 'highland_tower', GUARDIAN, 'p2')).toBe(true)
      expect(grants(SPECIES_RULES, 'wasteland_city', GUARDIAN, 'p2')).toBe(true)
      expect(grants(SPECIES_RULES, 'feyland_temple', GUARDIAN, 'p2')).toBe(true)
    })

    it('not at a terrain without fire', () => {
      expect(grants(SPECIES_RULES, 'swampland_tower', GUARDIAN, 'p2')).toBe(false)
      expect(grants(SPECIES_RULES, 'coastland_tower', GUARDIAN, 'p2')).toBe(false)
    })

    it('not to Treefolk, and not with the flag off', () => {
      expect(grants(SPECIES_RULES, 'highland_tower', OAKLING, 'p1')).toBe(false)
      expect(grants(SPELL_RULES, 'highland_tower', GUARDIAN, 'p2')).toBe(false)
    })

    it('not on a roll for anything but melee', () => {
      const state = board(SPECIES_RULES, 'highland_tower', rngFrom(1), ...units(GUARDIAN, 'p2'))
      for (const type of ['missile', 'magic', 'save', 'maneuver'] as const) {
        expect(armyRoll(state, 'p2', 'frontier', type).modifiers).not.toContainEqual(SAVES_AS_MELEE)
      }
    })
  })

  /**
   * The one place converting costs something, so the one place it is asked -- and a
   * fuzz reaches it too rarely to prove it, so it is a named test: Firewalkers marching
   * at a fire Frontier with a water dragon there.
   */
  it('is offered in the dragon allocation, and the log says how many it moved', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const base = setupGame({
        seed,
        forces: STARTER_FORCES,
        firstPlayer: 'p2',
        ruleSet: SPECIES_RULES,
        terrains: { frontier: 'highland_tower' },
      })
      const dragon: DragonInPlay = {
        id: 'p1_water',
        dieId: 'water_drake',
        owner: 'p1',
        location: { kind: 'terrain', slot: 'frontier' },
      }
      let state = begin({
        ...base,
        dragons: { [dragon.id]: dragon },
        turn: { ...base.turn, phase: 'dragon_attack' },
      })
      let rng = rngFrom(seed)

      for (let step = 0; step < 50 && state.pending !== null && state.turn.phase === 'dragon_attack'; step++) {
        const pending = state.pending
        if (pending.kind === 'dragon_allocate' && (pending.shields ?? 0) > 0) {
          const [answer] = randomAi.decide(state, pending, rng)
          if (answer.kind !== 'dragon_allocate') throw new Error('wrong answer kind')
          const moved = pending.shields ?? 0
          // Asking for more than the dice rolled is refused before anything moves.
          expect(() => reduce(state, { ...answer, savesAsMelee: moved + 1 })).toThrow(/Flaming Shields/)

          state = reduce(state, { ...answer, savesAsMelee: moved })
          expect(validateState(state)).toEqual([])
          const logged = state.log.findLast((entry) => entry.kind === 'dragon_roll')
          expect(logged?.kind === 'dragon_roll' && logged.flamingShields).toBe(moved)
          return
        }
        const [action, next] = randomAi.decide(state, pending, rng)
        rng = next
        state = reduce(state, action)
      }
    }
    throw new Error('no dragon allocation with Flaming Shields in 200 seeds')
  })
})

// --- Replanting ------------------------------------------------------------------

describe('Replanting', () => {
  const idFace = (typeId: string) => (index: number) => unitType(typeId).faces[index]?.icon === 'ID'
  const notId = (typeId: string) => (index: number) => !idFace(typeId)(index)

  const other: Spec = { id: 'f', typeId: GUARDIAN, owner: 'p2', at: at('p2_home') }
  const oakAt = (where: Location): Spec => ({ id: 'o', typeId: OAKLING, owner: 'p1', at: where })

  it('sends a Treefolk that rolls an ID at a water terrain to Reserves, not the DUA', () => {
    const state = board(SPECIES_RULES, 'swampland_tower', seedRolling(OAKLING, idFace(OAKLING)), oakAt(at('frontier')), other)
    const outcome = killUnits(state, ['o'])

    expect(outcome.replanted).toEqual(['o'])
    expect(outcome.state.units['o']?.location).toEqual(reserve)
    expect(outcome.state.rng.counter).toBe(state.rng.counter + 1)
    // **Not killed**, so no kill line names it.
    expect(killedIds(outcome, ['o'])).toEqual([])
    expect(deathEntries(outcome, 'p1', 'frontier', ['o']).map((e) => e.kind)).toEqual([
      'replanting',
    ])
    expect(validateState(outcome.state)).toEqual([])
  })

  it('lets one that rolls anything else die, having drawn one die for it', () => {
    const state = board(SPECIES_RULES, 'coastland_tower', seedRolling(OAKLING, notId(OAKLING)), oakAt(at('frontier')), other)
    const outcome = killUnits(state, ['o'])

    expect(outcome.replanted).toEqual([])
    expect(outcome.state.units['o']?.location.kind).toBe('dua')
    expect(outcome.state.rng.counter).toBe(state.rng.counter + 1)
    // **The miss is logged too**, ahead of the death it failed to prevent. It used to
    // leave no trace at all, so a player could not tell a failed roll from no roll.
    const entries = deathEntries(outcome, 'p1', 'frontier', ['o'])
    expect(entries.map((e) => e.kind)).toEqual(['replanting', 'units_killed'])
    const roll = entries[0]
    if (roll?.kind !== 'replanting') throw new Error('no replanting entry')
    expect(roll.rooted).toEqual([])
    expect(roll.dice.map((d) => [d.unitId, d.results])).toEqual([['o', 0]])
  })

  const drawsNothing = (state: GameState) => {
    const outcome = killUnits(state, ['o'])
    expect(outcome.replanted).toEqual([])
    expect(outcome.replantDice).toEqual([])
    expect(outcome.state.units['o']?.location.kind).toBe('dua')
    expect(outcome.state.rng).toEqual(state.rng)
  }

  it('does not fire at a terrain without water, and draws nothing there', () => {
    drawsNothing(board(SPECIES_RULES, 'highland_tower', seedRolling(OAKLING, idFace(OAKLING)), oakAt(at('frontier')), other))
  })

  it('does not fire in the Reserve Area, which holds no terrain', () => {
    drawsNothing(board(SPECIES_RULES, 'swampland_tower', seedRolling(OAKLING, idFace(OAKLING)), oakAt(reserve), other))
  })

  it('does not fire with the flag off -- no draw, which is what keeps the goldens', () => {
    drawsNothing(board(SPELL_RULES, 'swampland_tower', seedRolling(OAKLING, idFace(OAKLING)), oakAt(at('frontier')), other))
    drawsNothing(board(V0_RULES, 'swampland_tower', seedRolling(OAKLING, idFace(OAKLING)), oakAt(at('frontier')), other))
  })

  it('is Treefolk only: a Firewalker dying at a water terrain draws nothing', () => {
    const state = board(
      SPECIES_RULES,
      'swampland_tower',
      seedRolling(GUARDIAN, idFace(GUARDIAN)),
      { id: 'o', typeId: GUARDIAN, owner: 'p2', at: at('frontier') },
      { id: 't', typeId: OAKLING, owner: 'p1', at: at('p1_home') },
    )
    drawsNothing(state)
  })

  it('survives a kill-and-bury: a replanted unit is not buried, and bury does not throw', () => {
    const state = board(SPECIES_RULES, 'swampland_tower', seedRolling(OAKLING, idFace(OAKLING)), oakAt(at('frontier')), other)
    const outcome = killAndBury(state, ['o'])
    expect(outcome.replanted).toEqual(['o'])
    expect(outcome.state.units['o']?.location).toEqual(reserve)
  })

  it('does not fire on a burial out of the DUA: that unit was killed long ago', () => {
    const state = board(SPECIES_RULES, 'swampland_tower', seedRolling(OAKLING, idFace(OAKLING)), oakAt({ kind: 'dua' }), other)
    const outcome = buryUnits(state, ['o'])
    expect(outcome.replanted).toEqual([])
    expect(outcome.state.units['o']?.location.kind).toBe('bua')
    expect(outcome.state.rng).toEqual(state.rng)
  })

  /**
   * Two things that both say "instead", which the rules do not order. Since Phase 9b
   * that is no house rule: Replanting rolls, and the owner is asked about the exchange
   * having seen it -- a hit is never offered, a miss still is.
   */
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

  it('rolls before Accelerated Growth is offered, so a replanted die is never offered', () => {
    const oak = 'treefolk.oak'
    const base = board(
      SPECIES_RULES,
      'swampland_tower',
      seedRolling(oak, idFace(oak)),
      { id: 'o', typeId: oak, owner: 'p1', at: at('frontier') },
      { id: 'small', typeId: OAKLING, owner: 'p1', at: { kind: 'dua' } },
      other,
    )
    const outcome = killUnits(growing(base), ['o'])
    expect(outcome.replanted).toEqual(['o'])
    expect(outcome.offered).toEqual([])
    expect(outcome.state.turn.growthOffers).toBeUndefined()
    expect(outcome.state.units['small']?.location.kind).toBe('dua')
  })

  it('still offers the exchange for a die whose Replanting roll missed', () => {
    const oak = 'treefolk.oak'
    const base = board(
      SPECIES_RULES,
      'swampland_tower',
      seedRolling(oak, notId(oak)),
      { id: 'o', typeId: oak, owner: 'p1', at: at('frontier') },
      { id: 'small', typeId: OAKLING, owner: 'p1', at: { kind: 'dua' } },
      other,
    )
    const outcome = killUnits(growing(base), ['o'])
    expect(outcome.replanted).toEqual([])
    expect(outcome.replantDice).toHaveLength(1)
    expect(outcome.offered).toEqual(['o'])
  })

  /**
   * "Does a sleeping Treefolk replant?" cannot come up, and this is why: Sleep is only
   * on dice of the species that has Replanting, and it targets an *opponent's* unit.
   * Checked against the data rather than trusted, the way Phase 7e checked that Rise
   * from the Ashes and Accelerated Growth never meet.
   */
  it('never meets Sleep, because Sleep is only on Treefolk dice and aims at opponents', () => {
    const sleepers = UNIT_TYPES.filter((type) =>
      type.faces.some((face) => face.icon === 'SAI' && face.sai === 'Sleep'),
    )
    expect(sleepers.length).toBeGreaterThan(0)
    for (const type of sleepers) {
      expect(SPECIES_ABILITIES[type.species], type.id).toContain('Replanting')
    }
  })
})

// --- Rapid Growth ----------------------------------------------------------------

describe('Rapid Growth', () => {
  /** Treefolk at the Frontier facing a Firewalker march there -- or the reverse. */
  const armies = (treefolkContest: boolean): Spec[] => {
    const treefolk: PlayerId = treefolkContest ? 'p1' : 'p2'
    const firewalkers: PlayerId = treefolkContest ? 'p2' : 'p1'
    return [
      { id: 't1', typeId: OAKLING, owner: treefolk, at: at('frontier') },
      { id: 't2', typeId: 'treefolk.willowling', owner: treefolk, at: at('frontier') },
      // Smite on four of its six faces: the die that tests "did not roll an SAI".
      { id: 't3', typeId: 'treefolk.oak_lord', owner: treefolk, at: at('frontier') },
      { id: 'f1', typeId: WATCHER, owner: firewalkers, at: at('frontier') },
      { id: 'f2', typeId: GUARDIAN, owner: firewalkers, at: at('frontier') },
    ]
  }

  /** A board paused where the opponent decides whether to contest p2's maneuver. */
  function contestable(ruleSet: RuleSet, frontier: string, seed: number, treefolkContest = true): GameState {
    const base = board(ruleSet, frontier, rngFrom(seed), ...armies(treefolkContest))
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

  const contested = (state: GameState) => reduce(state, { kind: 'contest_maneuver', contest: true })

  /** The first seed whose contest pauses for Rapid Growth. */
  function paused(ruleSet = SPECIES_RULES, frontier = 'swampland_tower'): GameState {
    for (let seed = 1; seed <= 300; seed++) {
      const state = contested(contestable(ruleSet, frontier, seed))
      if (state.pending?.kind === 'rapid_growth') return state
    }
    throw new Error('no contest paused for Rapid Growth in 300 seeds')
  }

  it('asks the losing Treefolk which dice to throw again, at a terrain containing earth', () => {
    const state = paused()
    const pending = state.pending
    if (pending?.kind !== 'rapid_growth') throw new Error('not paused')

    expect(pending.player).toBe('p1')
    expect(state.turn.marchStep).toBe('rapid_growth')
    // Still losing (the marcher wins a tie), or it would not have been asked.
    expect(pending.defender).toBeLessThanOrEqual(pending.marcher)
    expect(validateState(state)).toEqual([])
    // Nothing is decided yet: no contest line until the answer is in.
    expect(state.log.some((e) => e.kind === 'maneuver_contested')).toBe(false)
  })

  it('offers only the dice that did not roll an SAI', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const state = contested(contestable(SPECIES_RULES, 'swampland_tower', seed))
      const pending = state.pending
      if (pending?.kind !== 'rapid_growth') continue
      const parked = state.turn.contest?.defender ?? []
      for (const die of parked) {
        const face = unitType(die.typeId).faces[die.faceIndex]
        expect(pending.options.includes(die.unitId), `seed ${seed} ${die.unitId}`).toBe(face?.icon !== 'SAI')
      }
    }
  })

  it('replaces the chosen faces rather than adding dice, and then decides the contest', () => {
    const state = paused()
    const pending = state.pending
    if (pending?.kind !== 'rapid_growth') throw new Error('not paused')

    const answered = reduce(state, { kind: 'rapid_growth', unitIds: pending.options })
    expect(answered.rng.counter).toBe(state.rng.counter + pending.options.length)
    expect(answered.turn.contest).toBeUndefined()
    expect(validateState(answered)).toEqual([])

    const kinds = answered.log.slice(state.log.length).map((e) => e.kind)
    expect(kinds.slice(0, 2)).toEqual(['rapid_growth', 'maneuver_contested'])
    const contest = answered.log.find((e) => e.kind === 'maneuver_contested')
    if (contest?.kind !== 'maneuver_contested') throw new Error('no contest logged')
    // As many dice as the army threw: replaced, not appended.
    expect(contest.defenderDice).toHaveLength(state.turn.contest?.defender.length ?? -1)
  })

  it('keeps the roll, drawing nothing, when declined', () => {
    const state = paused()
    const pending = state.pending
    if (pending?.kind !== 'rapid_growth') throw new Error('not paused')

    const kept = reduce(state, { kind: 'rapid_growth', unitIds: [] })
    expect(kept.rng).toEqual(state.rng)
    const contest = kept.log.find((e) => e.kind === 'maneuver_contested')
    if (contest?.kind !== 'maneuver_contested') throw new Error('no contest logged')
    expect(contest.marcher).toBe(pending.marcher)
    expect(contest.defender).toBe(pending.defender)
    expect(contest.marcherWins).toBe(true)
    expect(kept.log.some((e) => e.kind === 'rapid_growth')).toBe(false)
  })

  it('refuses a die that rolled an SAI, or one that is not in the roll', () => {
    const state = paused()
    const pending = state.pending
    if (pending?.kind !== 'rapid_growth') throw new Error('not paused')
    expect(() => reduce(state, { kind: 'rapid_growth', unitIds: ['f1'] })).toThrow(/Rapid Growth/)
    const sai = (state.turn.contest?.defender ?? []).find(
      (die) => unitType(die.typeId).faces[die.faceIndex]?.icon === 'SAI',
    )
    if (sai !== undefined) {
      expect(() => reduce(state, { kind: 'rapid_growth', unitIds: [sai.unitId] })).toThrow(/Rapid Growth/)
    }
  })

  /** Every seed in the range plays its contest through without a Rapid Growth pause. */
  const neverAsks = (make: (seed: number) => GameState) => {
    let contests = 0
    for (let seed = 1; seed <= 150; seed++) {
      const state = contested(make(seed))
      expect(state.pending?.kind, `seed ${seed}`).not.toBe('rapid_growth')
      if (state.log.some((e) => e.kind === 'maneuver_contested')) contests++
    }
    expect(contests).toBe(150)
  }

  it('is not offered at a terrain without earth', () => {
    neverAsks((seed) => contestable(SPECIES_RULES, 'coastland_tower', seed))
    neverAsks((seed) => contestable(SPECIES_RULES, 'feyland_tower', seed))
  })

  it('is not offered to the maneuvering army, only to the one counter-maneuvering', () => {
    neverAsks((seed) => contestable(SPECIES_RULES, 'swampland_tower', seed, false))
  })

  it('is not offered with the flag off', () => {
    neverAsks((seed) => contestable(SPELL_RULES, 'swampland_tower', seed))
  })

  it('is not offered to a contester already winning', () => {
    let winning = 0
    let asked = 0
    for (let seed = 1; seed <= 300; seed++) {
      const state = contested(contestable(SPECIES_RULES, 'swampland_tower', seed))
      const pending = state.pending
      if (pending?.kind === 'rapid_growth') {
        asked++
        // Every question is put to an army that is losing or tied.
        expect(pending.defender, `seed ${seed}`).toBeLessThanOrEqual(pending.marcher)
        continue
      }
      const contest = state.log.find((e) => e.kind === 'maneuver_contested')
      if (contest?.kind === 'maneuver_contested' && !contest.marcherWins) winning++
    }
    // Both happened: contests the Treefolk won outright were decided on the spot,
    // without a question, and the rest were asked about.
    expect(winning).toBeGreaterThan(0)
    expect(asked).toBeGreaterThan(0)
  })
})

// --- Air Flight ------------------------------------------------------------------

describe('Air Flight', () => {
  /**
   * The Firewalkers' Retreat Step with all three terrains pinned: Frontier a
   * Wasteland (air, fire), their home a Coastland (air, water), the other home a
   * Swampland (no air). Units as given; the Treefolk get one die so their species
   * can be read.
   */
  function retreatStep(
    ruleSet: RuleSet,
    terrains: { p1_home: string; frontier: string; p2_home: string },
    ...specs: readonly Spec[]
  ): GameState {
    const base = setupGame({ seed: 1, forces: STARTER_FORCES, ruleSet, terrains })
    const units: Record<string, UnitInstance> = {
      t: { id: 't', typeId: OAKLING, owner: 'p1', location: at('p1_home') },
    }
    for (const spec of specs) {
      units[spec.id] = { id: spec.id, typeId: spec.typeId, owner: spec.owner, location: spec.at }
    }
    const ready: GameState = {
      ...base,
      units,
      pending: null,
      turn: { ...base.turn, marching: 'p2', phase: 'reserves_retreat', marchStep: 'select_army' },
    }
    return stepGame(ready)
  }

  const TERRAINS = { p1_home: 'swampland_tower', frontier: 'wasteland_tower', p2_home: 'coastland_tower' }
  const fliers: Spec[] = [
    { id: 'g', typeId: GUARDIAN, owner: 'p2', at: at('frontier') },
    { id: 'w', typeId: WATCHER, owner: 'p2', at: at('p2_home') },
    // At a terrain with no air: it may retreat, and it may not fly.
    { id: 's', typeId: GUARDIAN, owner: 'p2', at: at('p1_home') },
  ]

  it('offers each Firewalker at an air terrain the other air terrains holding a Firewalker', () => {
    const state = retreatStep(SPECIES_RULES, TERRAINS, ...fliers)
    const pending = state.pending
    if (pending?.kind !== 'retreat') throw new Error('not at the Retreat Step')
    expect(pending.flights).toEqual([
      { unitId: 'g', options: ['p2_home'] },
      { unitId: 'w', options: ['frontier'] },
    ])
  })

  it('moves the flyers, logs both ends, and still retreats the rest', () => {
    const state = retreatStep(SPECIES_RULES, TERRAINS, ...fliers)
    const done = reduce(state, {
      kind: 'retreat',
      unitIds: ['s'],
      flights: [{ unitId: 'g', slot: 'p2_home' }],
    })
    expect(done.units['g']?.location).toEqual(at('p2_home'))
    expect(done.units['s']?.location).toEqual(reserve)
    const entries = done.log.slice(state.log.length).map((e) => e.kind)
    expect(entries.slice(0, 2)).toEqual(['retreated', 'air_flight'])
    const flight = done.log.find((e) => e.kind === 'air_flight')
    expect(flight).toEqual({
      kind: 'air_flight',
      player: 'p2',
      moves: [{ unitId: 'g', from: 'frontier', to: 'p2_home' }],
    })
    expect(validateState(done)).toEqual([])
  })

  it('judges destinations at the start of the step, so two armies may swap', () => {
    const state = retreatStep(SPECIES_RULES, TERRAINS, ...fliers)
    const done = reduce(state, {
      kind: 'retreat',
      unitIds: [],
      flights: [
        { unitId: 'g', slot: 'p2_home' },
        { unitId: 'w', slot: 'frontier' },
      ],
    })
    expect(done.units['g']?.location).toEqual(at('p2_home'))
    expect(done.units['w']?.location).toEqual(at('frontier'))
  })

  it('refuses a flight to a terrain without air, or with no Firewalker there', () => {
    const noFirewalker = { ...TERRAINS, p1_home: 'flatland_tower' }
    const state = retreatStep(SPECIES_RULES, noFirewalker, fliers[0]!, fliers[1]!)
    const pending = state.pending
    if (pending?.kind !== 'retreat') throw new Error('not at the Retreat Step')
    // Flatland has air, but none of their dice stand there.
    expect(pending.flights?.find((o) => o.unitId === 'g')?.options).toEqual(['p2_home'])
    expect(() =>
      reduce(state, { kind: 'retreat', unitIds: [], flights: [{ unitId: 'g', slot: 'p1_home' }] }),
    ).toThrow(/cannot fly to/)
  })

  it('refuses a unit that would both retreat and fly, and one at a terrain without air', () => {
    const state = retreatStep(SPECIES_RULES, TERRAINS, ...fliers)
    expect(() =>
      reduce(state, { kind: 'retreat', unitIds: ['g'], flights: [{ unitId: 'g', slot: 'p2_home' }] }),
    ).toThrow(/both retreat and fly/)
    expect(() =>
      reduce(state, { kind: 'retreat', unitIds: [], flights: [{ unitId: 's', slot: 'frontier' }] }),
    ).toThrow(/cannot fly/)
  })

  it('does not offer a sleeping unit, which "cannot leave the terrain"', () => {
    const awake = retreatStep(SPECIES_RULES, TERRAINS, ...fliers)
    const slept: GameState = {
      ...awake,
      effects: [
        {
          source: 'Sleep',
          target: { kind: 'unit', unitId: 'g' },
          modifiers: [],
          asleep: true,
          expiresAtStartOfTurnOf: 'p1',
        },
      ],
      pending: null,
    }
    const pending = stepGame(slept).pending
    if (pending?.kind !== 'retreat') throw new Error('not at the Retreat Step')
    expect(pending.flights?.map((o) => o.unitId)).toEqual(['w'])
  })

  it('offers nothing with one air terrain, to Treefolk, or with the flag off', () => {
    const oneAir = { ...TERRAINS, p2_home: 'highland_tower' }
    const single = retreatStep(SPECIES_RULES, oneAir, ...fliers).pending
    expect(single?.kind === 'retreat' && single.flights).toBeUndefined()

    const off = retreatStep(SPELL_RULES, TERRAINS, ...fliers).pending
    expect(off?.kind === 'retreat' && off.flights).toBeUndefined()

    // The same board with the forces swapped: Treefolk have no Air Flight.
    const treefolk = retreatStep(
      SPECIES_RULES,
      TERRAINS,
      { id: 'a', typeId: OAKLING, owner: 'p2', at: at('frontier') },
      { id: 'b', typeId: OAKLING, owner: 'p2', at: at('p2_home') },
    )
    const swapped: GameState = {
      ...treefolk,
      units: { ...treefolk.units, t: { id: 't', typeId: GUARDIAN, owner: 'p1', location: at('p1_home') } },
      pending: null,
    }
    const asked = stepGame(swapped).pending
    expect(asked?.kind === 'retreat' && asked.flights).toBeUndefined()
  })
})

// --- the fuzz --------------------------------------------------------------------

describe('the fuzz', () => {
  /**
   * 200 `SPECIES_RULES` games, and a counter for every ability -- a clean run over
   * rules nothing reached would prove nothing.
   *
   * Three force sets rather than two: a rolled force puts dice on boards the named
   * ones never make, and Air Flight in particular needs two air terrains holding
   * Firewalkers, which is a fact about the board more than the force. Every fifth
   * game gives p1 to `PassiveAI`, whose Rapid Growth answer ("the dice that gave it
   * nothing") is a different path from `RandomAI`'s.
   *
   * Two things this cannot reach often enough to prove, and each has a named test
   * above instead: Flaming Shields in Wall of Thorns' roll, and the dragon roll's
   * choice.
   */
  // Its own timeout, like the fuzzes in `ai.test.ts`: about 25 s alone, and the shared
  // 30 s default failed it once the live-rules fuzz (v2 Phase 0b) ran beside it.
  it('plays 200 SPECIES_RULES games with every ability firing', { timeout: 180_000 }, () => {
    let stuck = 0
    let replanted = 0
    let replantMisses = 0
    let shields = 0
    let growthTaken = 0
    let growthDeclined = 0
    let flights = 0
    let longest = 0

    const sets: readonly [ForceSpec, number][] = [
      [STARTER_FORCES, 70],
      [BESTIARY_FORCES, 70],
      [{ kind: 'random' }, 60],
    ]
    for (const [forces, games] of sets) {
      for (let seed = 1; seed <= games; seed++) {
        const result = runGame({
          setup: { seed, forces, ruleSet: SPECIES_RULES },
          players: { p1: seed % 5 === 0 ? passiveAi : randomAi, p2: randomAi },
          aiSeed: seed,
          // The spell fuzz's cap and reason (Reserve magic tripled a game's length);
          // the longest game here is recorded below so a raise is measured, not guessed.
          // Raised from 20,000 after the terrain draw changed (homes of the species' own
          // type): bestiary seed 25, passive against random, runs 58,784 decisions and
          // then ends in a win. The next longest of the 200 is 13,865 -- one slow random
          // walk, not a stall, and it finishes.
          maxDecisions: 100_000,
        })
        if (result.stoppedBecause === 'stuck') stuck += 1
        expect(result.stoppedBecause, `seed ${seed}`).not.toBe('cap')
        longest = Math.max(longest, result.record.actions.length)
        for (const action of result.record.actions) {
          if (action.kind === 'rapid_growth') {
            if (action.unitIds.length > 0) growthTaken += 1
            else growthDeclined += 1
          }
        }
        for (const entry of result.state.log) {
          if (entry.kind === 'replanting') {
            replanted += entry.rooted.length
            replantMisses += entry.dice.length - entry.rooted.length
          }
          if (entry.kind === 'combat_resolved' && entry.flamingShields !== undefined) shields += 1
          if (entry.kind === 'air_flight') flights += entry.moves.length
        }
      }
    }

    expect(stuck).toBe(0)
    expect(replanted).toBeGreaterThan(0)
    expect(replantMisses).toBeGreaterThan(0)
    expect(shields).toBeGreaterThan(0)
    // Both answers to Rapid Growth, or the path that keeps the roll is unproven.
    expect(growthTaken).toBeGreaterThan(0)
    expect(growthDeclined).toBeGreaterThan(0)
    expect(flights).toBeGreaterThan(0)
    expect(longest).toBeLessThan(100_000)
  })
})
