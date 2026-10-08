/**
 * The run model (v3 Phase 0): its draws, its reducer, and a fuzz of whole runs with
 * random answers and random battle outcomes. No battle is played -- `battle_ended` is
 * answered directly -- so the whole file costs well under a second.
 */
import { describe, expect, it } from 'vitest'

import type { Collection } from '../data/collections'
import { UNIT_TYPES, speciesElements, terrainDie, terrainType, unitType } from '../data/load'
import { PRESET_ARMY_NAMES } from '../data/presets'
import { builtForceProblem, dragonCount, splitForce, type BuiltForce } from '../engine/force'
import { forceHealth, forceProblems, used } from '../engine/forceProblems'
import { PLAYABLE_SPECIES, PLAYABLE_UNITS } from '../engine/playable'
import { nextInt, rngFrom, type RngState } from '../engine/rng'
import { homeDiceFor, setupGame, terrainDiceSharing } from '../engine/setup'
import { V1_RULES } from '../engine/types'

import { drawEncounter, drawReward, forceElements, rollStart, transformsOf, upgradeOf } from './draws'
import { newRun, reduceRun, upgradePreview } from './reduce'
import {
  ACTS,
  ACT_SIZE,
  ENCOUNTERS_PER_ACT,
  IllegalRunAction,
  type Act,
  type Encounter,
  type RunAction,
  type RunContent,
  type RunPending,
  type RunState,
} from './types'

/** Sixteen encounters an act, eleven battles and five events: more than twelve, and
 *  both halves deep enough that the 7-in-10 draw rarely has to fall back. */
function content(battles = 11, events = 5): RunContent {
  const act = (n: Act): readonly Encounter[] => [
    ...Array.from({ length: battles }, (_, i) => ({
      id: `act${n}.battle-${i}`,
      act: n,
      kind: 'battle' as const,
      name: `Battle ${i}`,
      enemy: { pool: { kind: 'mixed' as const } },
      opponent: 'greedy',
    })),
    ...Array.from({ length: events }, (_, i) => ({ id: `act${n}.event-${i}`, act: n, kind: 'event' as const, name: `Event ${i}` })),
  ]
  return { acts: { 1: act(1), 2: act(2), 3: act(3) }, forces: {} }
}

const CONTENT = content()

const sortedIds = (list: readonly { id: string }[]): string[] => list.map((u) => u.id).sort()

function at<T>(list: readonly T[], index: number): T {
  const item = list[index]
  if (item === undefined) throw new Error(`no item ${index} of ${list.length}`)
  return item
}

const ownedHealth = (c: Collection): number =>
  Object.entries(c.units).reduce((sum, [id, n]) => sum + unitType(id).health * n, 0)

/** Every die the force fields is one the pool holds, copy for copy. */
function fieldsOnlyOwned(run: RunState): boolean {
  const fielded = {
    units: PRESET_ARMY_NAMES.flatMap((a) => run.force.armies[a]),
    dragons: run.force.dragons ?? [],
    terrains: [run.force.homeTerrain, run.force.frontierProposal].filter((id): id is string => id !== undefined),
  }
  return (['units', 'dragons', 'terrains'] as const).every((kind) =>
    fielded[kind].every((id) => used(run.force, kind, id) <= (run.collection[kind][id] ?? 0)),
  )
}

/** Answers a run's pending with `action`, through the reducer. */
const step = (run: RunState, action: RunAction, c: RunContent = CONTENT): RunState => reduceRun(run, action, c)

/** A run past `pick_race`, standing at its first encounter. */
const started = (seed: number, race = 'treefolk', c: RunContent = CONTENT): RunState =>
  step(newRun(seed), { kind: 'pick_race', race }, c)

/** The first seed whose run opens on this kind of encounter. */
function seedOpeningOn(kind: RunPending['kind'], race = 'treefolk', c: RunContent = CONTENT): number {
  for (let seed = 1; seed < 500; seed++) if (started(seed, race, c).pending.kind === kind) return seed
  throw new Error(`no seed opens on ${kind}`)
}

/**
 * A run standing on its first event. No run opens on one -- the first encounter is a
 * battle -- so the battles before it are won and each reward is the first offer.
 */
function firstEvent(race = 'treefolk'): RunState {
  for (let seed = 1; seed < 500; seed++) {
    let run = started(seed, race)
    while (run.pending.kind === 'arrange_force' || run.pending.kind === 'battle' || run.pending.kind === 'reward') {
      const kind: RunPending['kind'] = run.pending.kind
      run = step(
        run,
        kind === 'arrange_force'
          ? { kind: 'ready' }
          : kind === 'battle'
            ? { kind: 'battle_ended', winner: 'p1' }
            : { kind: 'take_offer', index: 0 },
      )
    }
    if (run.pending.kind === 'event') return run
  }
  throw new Error('no run reaches an event')
}

describe('newRun', () => {
  it('asks for a race, from the playable species, and holds nothing yet', () => {
    const run = newRun(7)
    expect(run.pending).toEqual({ kind: 'choose_race', races: PLAYABLE_SPECIES.map((s) => s.id) })
    expect(run.race).toBeNull()
    expect(run.status).toBe('playing')
    expect(ownedHealth(run.collection)).toBe(0)
  })

  it('refuses a race that is not offered, and any other action', () => {
    expect(() => step(newRun(1), { kind: 'pick_race', race: 'elves' })).toThrow(IllegalRunAction)
    expect(() => step(newRun(1), { kind: 'ready' })).toThrow(/ready does not answer the run's choose_race/)
  })
})

describe('the opening draw', () => {
  /** The stream, step by step: large die -> second medium's line -> dragon element ->
   *  dragon form -> Home -> Frontier. A reorder of any two moves this test. */
  it('draws in the pinned order', () => {
    const seed = 41
    const race = 'treefolk'
    const dice = UNIT_TYPES.filter((u) => u.species === race)
    let rng: RngState = rngFrom(seed)
    let i: number

    ;[i, rng] = nextInt(rng, 5)
    const large = at(sortedIds(dice.filter((u) => u.size === 'large')), i)
    const sameLine = dice.find((u) => u.size === 'medium' && u.unitClass === unitType(large).unitClass)?.id
    const others = sortedIds(dice.filter((u) => u.size === 'medium' && u.unitClass !== unitType(large).unitClass))
    ;[i, rng] = nextInt(rng, others.length)
    const other = at(others, i)
    ;[i, rng] = nextInt(rng, 2)
    const element = at([...speciesElements(race)].sort(), i)
    ;[i, rng] = nextInt(rng, 2)
    const dragon = `${element}_${i === 0 ? 'drake' : 'wyrm'}`
    ;[i, rng] = nextInt(rng, homeDiceFor(race).length)
    const home = at(homeDiceFor(race), i)
    ;[i, rng] = nextInt(rng, terrainDiceSharing(speciesElements(race)).length)
    const frontier = at(terrainDiceSharing(speciesElements(race)), i)
    const smalls = sortedIds(dice.filter((u) => u.size === 'small'))
    const units = [large, sameLine, other, ...smalls]
    // The split is fixed, and draws nothing.
    const armies = { home: [large, sameLine], campaign: [other], horde: smalls }
    const afterSplit = rng

    const [start, after] = rollStart(race, rngFrom(seed))
    expect(start.units).toEqual(units)
    expect(start.force).toEqual({ armies, homeTerrain: home, frontierProposal: frontier, dragons: [dragon] })
    expect(after).toEqual(afterSplit)

    // pick_race draws exactly this, then the first encounter.
    const run = started(seed, race)
    const [first] = drawEncounter(CONTENT, 1, [], afterSplit)
    expect(run.force).toEqual(start.force)
    expect(run.current).toEqual(first)
  })

  it.each(PLAYABLE_SPECIES.map((s) => s.id))('opens %s on 12 health in eight dice, a legal force of all of them', (race) => {
    for (let seed = 1; seed <= 25; seed++) {
      const run = started(seed, race)
      const units = Object.entries(run.collection.units).flatMap(([id, n]) => Array<string>(n).fill(id))
      expect(units).toHaveLength(8)
      expect(ownedHealth(run.collection)).toBe(12)
      expect(units.every((id) => unitType(id).species === race)).toBe(true)

      const sizes = units.map((id) => unitType(id).size).sort()
      expect(sizes).toEqual(['large', 'medium', 'medium', 'small', 'small', 'small', 'small', 'small'])
      const large = unitType(units.find((id) => unitType(id).size === 'large') as string)
      const mediums = units.filter((id) => unitType(id).size === 'medium').map((id) => unitType(id).unitClass)
      expect(mediums).toContain(large.unitClass)
      expect(new Set(mediums).size).toBe(2) // the second medium is of a different line
      expect(new Set(units.filter((id) => unitType(id).size === 'small')).size).toBe(5)

      const dragon = Object.keys(run.collection.dragons)
      expect(dragon).toHaveLength(1)
      expect(speciesElements(race)).toContain(dragon[0]?.split('_')[0])
      expect(homeDiceFor(race)).toContain(run.force.homeTerrain)
      expect(terrainDiceSharing(speciesElements(race))).toContain(run.force.frontierProposal)

      // Every die fielded, and legal by both statements of the rule.
      expect(PRESET_ARMY_NAMES.flatMap((a) => run.force.armies[a]).sort()).toEqual([...units].sort())
      expect(forceProblems(run.collection, 12, run.force, 'at_most')).toEqual([])
      expect(builtForceProblem(run.force)).toBeNull()
    }
  })

  it('splits the opening by size: the large die and its line at Home, the other medium at the Frontier, the smalls in the Horde', () => {
    for (const species of PLAYABLE_SPECIES) {
      for (let seed = 1; seed <= 10; seed++) {
        const { armies } = started(seed, species.id).force
        const sizes = (ids: readonly string[]) => ids.map((id) => unitType(id).size)
        expect(sizes(armies.home)).toEqual(['large', 'medium'])
        expect(unitType(at(armies.home, 0)).unitClass).toBe(unitType(at(armies.home, 1)).unitClass)
        expect(sizes(armies.campaign)).toEqual(['medium'])
        expect(sizes(armies.horde)).toEqual(['small', 'small', 'small', 'small', 'small'])
      }
    }
  })

  it('makes a force setup plays, against itself', () => {
    for (const species of PLAYABLE_SPECIES) {
      const { force } = started(3, species.id)
      expect(() =>
        setupGame({ seed: 3, ruleSet: V1_RULES, forces: { kind: 'built', forces: { p1: force, p2: force } } }),
      ).not.toThrow()
    }
  })
})

describe('the encounter draw', () => {
  it('opens every run on a battle, drawing no kind for it', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = rngFrom(seed)
      const [encounter, after] = drawEncounter(CONTENT, 1, [], rng)
      expect(encounter.kind).toBe('battle')
      // One draw, the battle itself: the kind is forced.
      const battles = [...CONTENT.acts[1]].filter((e) => e.kind === 'battle').sort((a, b) => a.id.localeCompare(b.id))
      const [i, afterPick] = nextInt(rng, battles.length)
      expect(encounter).toEqual(battles[i])
      expect(after).toEqual(afterPick)
    }
    // So no run opens on an event. (Act II's first draw still draws the kind: the
    // seven-in-ten test below counts exactly those.)
    expect(() => seedOpeningOn('event')).toThrow(/no seed opens on event/)
  })

  it('draws twelve different encounters an act, battles about seven in ten', () => {
    let battles = 0
    let total = 0
    for (let seed = 1; seed <= 200; seed++) {
      let rng = rngFrom(seed)
      const drawn: string[] = []
      for (let n = 0; n < ENCOUNTERS_PER_ACT; n++) {
        const [encounter, next] = drawEncounter(CONTENT, 2, drawn, rng)
        rng = next
        expect(encounter.act).toBe(2)
        drawn.push(encounter.id)
        if (n === 0) {
          total++
          if (encounter.kind === 'battle') battles++
        }
      }
      expect(new Set(drawn).size).toBe(ENCOUNTERS_PER_ACT)
    }
    expect(battles / total).toBeGreaterThan(0.6)
    expect(battles / total).toBeLessThan(0.8)
  })

  it('falls back to the other half when one runs out', () => {
    const short = content(12, 1)
    let rng = rngFrom(9)
    const drawn: string[] = []
    for (let n = 0; n < ENCOUNTERS_PER_ACT; n++) {
      const [encounter, next] = drawEncounter(short, 1, drawn, rng)
      rng = next
      drawn.push(encounter.id)
    }
    // Twelve drawn from thirteen: whatever the 7-in-10 said, no draw stuck.
    expect(new Set(drawn).size).toBe(12)
    const onlyEvent = content(0, 13)
    expect(drawEncounter(onlyEvent, 3, [], rngFrom(1))[0].kind).toBe('event')
  })
})

describe('the reward draw', () => {
  const force: BuiltForce = started(5).force

  it('offers three distinct units, a dragon and a terrain, sharing the force\'s elements', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const [offers] = drawReward('treefolk', force, rngFrom(seed))
      expect(offers.map((o) => o.kind)).toEqual(['unit', 'unit', 'unit', 'dragon', 'terrain'])
      expect(new Set(offers.slice(0, 3).map((o) => o.id)).size).toBe(3)
      for (const o of offers.slice(0, 3)) expect(PLAYABLE_UNITS.map((u) => u.id)).toContain(o.id)
      const elements = forceElements(force)
      expect(elements).toContain(offers[3]?.id.split('_')[0])
      const terrain = terrainType(terrainDie(offers[4]?.id as string).type)
      expect(terrain.elements.some((e) => elements.includes(e))).toBe(true)
    }
  })

  it('draws in the pinned order: each unit is source then die, then dragon element, form and terrain', () => {
    const seed = 17
    const race = 'treefolk'
    const raceDice = sortedIds(PLAYABLE_UNITS.filter((u) => u.species === race))
    const allDice = sortedIds(PLAYABLE_UNITS)
    let rng = rngFrom(seed)
    let i: number
    const units: string[] = []
    while (units.length < 3) {
      ;[i, rng] = nextInt(rng, 10)
      const source = i < 7 ? raceDice : allDice
      ;[i, rng] = nextInt(rng, source.length)
      const id = at(source, i)
      if (!units.includes(id)) units.push(id)
    }
    const elements = [...forceElements(force)].sort()
    ;[i, rng] = nextInt(rng, elements.length)
    const element = at(elements, i)
    ;[i, rng] = nextInt(rng, 2)
    const dragon = `${element}_${i === 0 ? 'drake' : 'wyrm'}`
    const terrains = terrainDiceSharing(forceElements(force))
    ;[i, rng] = nextInt(rng, terrains.length)

    const [offers, after] = drawReward(race, force, rngFrom(seed))
    expect(offers.map((o) => o.id)).toEqual([...units, dragon, at(terrains, i)])
    expect(after).toEqual(rng)
  })

  it('draws race dice about seven times in ten', () => {
    let race = 0
    let total = 0
    for (let seed = 1; seed <= 300; seed++) {
      const [offers] = drawReward('firewalkers', force, rngFrom(seed))
      for (const o of offers.slice(0, 3)) {
        total++
        if (unitType(o.id).species === 'firewalkers') race++
      }
    }
    // 70% race, plus the race's share of the 30% drawn from every playable die.
    const expected = 0.7 + 0.3 / PLAYABLE_SPECIES.length
    expect(race / total).toBeGreaterThan(expected - 0.08)
    expect(race / total).toBeLessThan(expected + 0.08)
  })

  it('reads every element of every species fielded, death included', () => {
    const goblins: BuiltForce = {
      armies: { home: ['goblins.thug'], campaign: ['goblins.pelter'], horde: ['coral_elves.fighter'] },
    }
    expect([...forceElements(goblins)].sort()).toEqual(['air', 'death', 'earth', 'water'])
  })

  it('always has a terrain to offer: every species carries a non-death element', () => {
    for (const species of PLAYABLE_SPECIES) {
      expect(terrainDiceSharing(speciesElements(species.id)).length, species.id).toBeGreaterThan(0)
    }
  })
})

describe('upgrades and transforms', () => {
  it('steps a die up its class line, and stops at large', () => {
    expect(upgradeOf('treefolk.oakling')).toBe('treefolk.oak')
    expect(upgradeOf('treefolk.oak')).toBe('treefolk.oak_lord')
    expect(upgradeOf('treefolk.oak_lord')).toBeNull()
    expect(upgradeOf('treefolk.darktree')).toBeNull()
  })

  it('transforms into another die of the same species and health', () => {
    expect([...transformsOf('treefolk.oak')].sort()).toEqual([
      'treefolk.dryad',
      'treefolk.naiad',
      'treefolk.pine',
      'treefolk.willow',
    ])
    expect(transformsOf('firewalkers.genie')).toHaveLength(4)
  })

  /** A run standing on an event, with this pool and force, its lists read afresh. */
  function eventRun(collection: Collection, force: BuiltForce): RunState {
    const run = firstEvent()
    if (run.pending.kind !== 'event') throw new Error('not an event')
    const units = Object.keys(collection.units).sort()
    return {
      ...run,
      collection,
      force,
      pending: {
        ...run.pending,
        upgradable: units.filter((id) => upgradeOf(id) !== null),
        transformable: units.filter((id) => transformsOf(id).length > 0),
      },
    }
  }

  const base = firstEvent()

  it('changes an unfielded copy first, leaving the force alone', () => {
    const collection = { ...base.collection, units: { ...base.collection.units, 'treefolk.oakling': 2 } }
    const run = eventRun(collection, base.force)
    const after = step(run, { kind: 'upgrade', unit: 'treefolk.oakling' })
    expect(after.force).toEqual(base.force)
    expect(after.collection.units['treefolk.oakling']).toBe(1)
    expect(after.collection.units['treefolk.oak']).toBe((base.collection.units['treefolk.oak'] ?? 0) + 1)
  })

  it('upgrades a fielded die in place when the force stays legal', () => {
    const force: BuiltForce = {
      ...base.force,
      armies: { home: ['treefolk.oakling'], campaign: ['treefolk.pineling'], horde: ['treefolk.nymph'] },
    }
    const collection: Collection = {
      ...base.collection,
      units: { 'treefolk.oakling': 1, 'treefolk.pineling': 1, 'treefolk.nymph': 1 },
    }
    const after = step(eventRun(collection, force), { kind: 'upgrade', unit: 'treefolk.pineling' })
    // 1 + 2 + 1 = 4, half is 2: the Pine fits where the Pineling stood.
    expect(after.force.armies.campaign).toEqual(['treefolk.pine'])
    expect(after.collection.units).toEqual({ 'treefolk.oakling': 1, 'treefolk.pine': 1, 'treefolk.nymph': 1 })
  })

  it('takes an upgraded die out of the force when it no longer fits, and ready waits', () => {
    const force: BuiltForce = {
      ...base.force,
      armies: { home: ['treefolk.oak'], campaign: ['treefolk.pineling'], horde: ['treefolk.nymph'] },
    }
    const collection: Collection = {
      ...base.collection,
      units: { 'treefolk.oak': 1, 'treefolk.pineling': 1, 'treefolk.nymph': 1 },
    }
    const after = step(eventRun(collection, force), { kind: 'upgrade', unit: 'treefolk.oak' })
    // An Oak Lord at home would be 3 of 5, over half: it leaves, and home is empty.
    expect(after.force.armies.home).toEqual([])
    expect(after.collection.units['treefolk.oak_lord']).toBe(1)
    expect(fieldsOnlyOwned(after)).toBe(true)
  })

  it('transforms a fielded die in place, in its own army', () => {
    const force: BuiltForce = {
      ...base.force,
      armies: { home: ['treefolk.oak'], campaign: ['treefolk.pineling'], horde: ['treefolk.nymph'] },
    }
    const collection: Collection = {
      ...base.collection,
      units: { 'treefolk.oak': 1, 'treefolk.pineling': 1, 'treefolk.nymph': 1 },
    }
    const after = step(eventRun(collection, force), { kind: 'transform', unit: 'treefolk.oak' })
    const home = after.force.armies.home
    expect(home).toHaveLength(1)
    expect(transformsOf('treefolk.oak')).toContain(home[0])
    expect(after.collection.units['treefolk.oak']).toBeUndefined()
    expect(ownedHealth(after.collection)).toBe(4)
  })

  it('refuses an upgrade of a die that cannot be upgraded, or is not in the pool', () => {
    const run = base
    const large = Object.keys(run.collection.units).find((id) => unitType(id).size === 'large') as string
    expect(() => step(run, { kind: 'upgrade', unit: large })).toThrow(IllegalRunAction)
    expect(() => step(run, { kind: 'transform', unit: 'firewalkers.genie' })).toThrow(IllegalRunAction)
  })
})

describe('the history', () => {
  it('records every encounter a run finished, in order, with how it ended', () => {
    let run = started(21)
    const outcomes: string[] = []
    while (run.pending.kind !== 'over') {
      const pending = run.pending
      const action: RunAction =
        pending.kind === 'arrange_force'
          ? { kind: 'ready' }
          : pending.kind === 'battle'
            ? { kind: 'battle_ended', winner: run.act === 2 && run.encounter === 3 ? 'p2' : 'p1' }
            : pending.kind === 'reward'
              ? { kind: 'take_offer', index: 4 }
              : pending.kind === 'event'
                ? { kind: 'skip' }
                : (() => {
                    throw new Error(pending.kind)
                  })()
      run = step(run, action)
    }
    // Act I whole, then Act II up to the battle lost at its fourth encounter.
    expect(run.history).toHaveLength(12 + 4)
    expect(run.history.map((h) => [h.act, h.encounter])).toEqual([
      ...Array.from({ length: 12 }, (_, i) => [1, i]),
      ...Array.from({ length: 4 }, (_, i) => [2, i]),
    ])
    const last = run.history[run.history.length - 1]
    expect(last?.outcome.kind).toBe('lost')
    for (const entry of run.history.slice(0, -1)) {
      expect(['won', 'skip']).toContain(entry.outcome.kind)
      if (entry.outcome.kind === 'won') expect(entry.outcome.took?.kind).toBe('terrain')
    }
    outcomes.push(...run.history.map((h) => h.outcome.kind))
    expect(outcomes).toContain('won')
  })

  it('ends a won run on a battle with no reward taken', () => {
    let run = started(2)
    while (run.pending.kind !== 'over') {
      const pending = run.pending.kind
      run = step(
        run,
        pending === 'arrange_force'
          ? { kind: 'ready' }
          : pending === 'battle'
            ? { kind: 'battle_ended', winner: 'p1' }
            : pending === 'reward'
              ? { kind: 'take_offer', index: 0 }
              : { kind: 'skip' },
      )
    }
    expect(run.status).toBe('won')
    expect(run.history).toHaveLength(36)
    const last = run.history[35]
    expect(last?.outcome.kind === 'won' || last?.outcome.kind === 'skip').toBe(true)
    if (last?.outcome.kind === 'won') expect(last.outcome.took).toBeNull()
  })
})

describe('upgradePreview', () => {
  const base = firstEvent()
  it('says a spare copy changes in the pool, a fielded one in place or benched', () => {
    const spare = { ...base, collection: { ...base.collection, units: { ...base.collection.units, 'treefolk.oakling': 2 } } }
    expect(upgradePreview(spare, 'treefolk.oakling')).toMatchObject({ to: 'treefolk.oak', effect: 'pool', army: null })
    const force: BuiltForce = { ...base.force, armies: { home: ['treefolk.oak'], campaign: ['treefolk.pineling'], horde: ['treefolk.nymph'] } }
    const small: RunState = { ...base, force, collection: { ...base.collection, units: { 'treefolk.oak': 1, 'treefolk.pineling': 1, 'treefolk.nymph': 1 } } }
    expect(upgradePreview(small, 'treefolk.pineling')).toMatchObject({ to: 'treefolk.pine', effect: 'in_place', army: 'campaign' })
    expect(upgradePreview(small, 'treefolk.oak')).toMatchObject({ to: 'treefolk.oak_lord', effect: 'benched', army: 'home' })
    expect(upgradePreview(small, 'treefolk.oak_lord')).toBeNull()
  })
})

describe('a battle encounter', () => {
  const run = started(seedOpeningOn('arrange_force'))

  it('asks for the force under the act\'s cap, and refuses one that breaks a rule', () => {
    expect(run.pending).toEqual({ kind: 'arrange_force', cap: 12 })
    const over: BuiltForce = { ...run.force, armies: { ...run.force.armies, horde: [...run.force.armies.horde, 'treefolk.darktree'] } }
    expect(() => step(step(run, { kind: 'set_force', force: over }), { kind: 'ready' })).toThrow(
      /over the cap of 12.*which the collection does not hold/,
    )
    const noDragon: BuiltForce = { armies: run.force.armies, homeTerrain: run.force.homeTerrain as string, frontierProposal: run.force.frontierProposal as string }
    expect(() => step(step(run, { kind: 'set_force', force: noDragon }), { kind: 'ready' })).toThrow(/choose a dragon/)
  })

  it('fights, then offers five rewards, then draws the next encounter', () => {
    const battle = step(run, { kind: 'ready' })
    expect(battle.pending).toEqual({ kind: 'battle', encounter: run.current })
    const reward = step(battle, { kind: 'battle_ended', winner: 'p1' })
    if (reward.pending.kind !== 'reward') throw new Error(reward.pending.kind)
    expect(reward.pending.offers).toHaveLength(5)
    const offer = reward.pending.offers[0]
    const after = step(reward, { kind: 'take_offer', index: 0 })
    expect(after.encounter).toBe(1)
    expect(after.collection.units[offer?.id as string]).toBe((run.collection.units[offer?.id as string] ?? 0) + 1)
    expect(after.force).toEqual(run.force) // a reward goes to the pool, not the force
    expect(['arrange_force', 'event']).toContain(after.pending.kind)
  })

  it('ends the run on a loss, and a conceded battle is one', () => {
    const lost = step(step(run, { kind: 'ready' }), { kind: 'battle_ended', winner: 'p2' })
    expect(lost.status).toBe('lost')
    expect(lost.pending).toEqual({ kind: 'over' })
    expect(() => step(lost, { kind: 'skip' })).toThrow(/the run is over \(lost\)/)
  })
})

/**
 * A random player for the fuzz: answers every pending, and builds forces from the pool
 * the way a player would -- sometimes keeping the last one, sometimes trying something
 * illegal first so `ready`'s refusal is exercised too.
 */
function pick<T>(list: readonly T[], rng: RngState): readonly [T, RngState] {
  const [i, next] = nextInt(rng, list.length)
  return [at(list, i), next] as const
}

function randomForce(run: RunState, cap: number, rng: RngState): readonly [BuiltForce, RngState] {
  const copies = (kind: 'units' | 'dragons' | 'terrains') =>
    Object.entries(run.collection[kind]).flatMap(([id, n]) => Array<string>(n).fill(id))
  let state = rng
  for (let attempt = 0; attempt < 200; attempt++) {
    // Shuffle the pool's dice, then take each that fits under the cap.
    const pool = [...copies('units')]
    for (let i = pool.length - 1; i > 0; i--) {
      let j: number
      ;[j, state] = nextInt(state, i + 1)
      ;[pool[i], pool[j]] = [pool[j] as string, pool[i] as string]
    }
    const units: string[] = []
    let health = 0
    for (const id of pool) {
      if (health + unitType(id).health <= cap) {
        units.push(id)
        health += unitType(id).health
      }
    }
    if (units.length < 3) continue
    let armies: BuiltForce['armies']
    ;[armies, state] = splitForce(units, state)

    const terrains = [...copies('terrains')]
    let home: string
    ;[home, state] = pick(terrains, state)
    terrains.splice(terrains.indexOf(home), 1)
    let frontier: string
    ;[frontier, state] = pick(terrains, state)

    const dragonPool = [...copies('dragons')]
    let count: number
    ;[count, state] = nextInt(state, Math.min(dragonCount(health), dragonPool.length))
    const dragons: string[] = []
    for (let i = 0; i <= count; i++) {
      let d: string
      ;[d, state] = pick(dragonPool, state)
      dragonPool.splice(dragonPool.indexOf(d), 1)
      dragons.push(d)
    }
    const force: BuiltForce = { armies, homeTerrain: home, frontierProposal: frontier, dragons }
    if (forceProblems(run.collection, cap, force, 'at_most').length === 0) return [force, state] as const
  }
  throw new Error(`no legal force from ${JSON.stringify(run.collection)} under ${cap}`)
}

function randomActions(run: RunState, winChance: number, rng: RngState): readonly [readonly RunAction[], RngState] {
  const pending = run.pending
  let state = rng
  let roll: number
  switch (pending.kind) {
    case 'choose_race': {
      let race: string
      ;[race, state] = pick(pending.races, state)
      return [[{ kind: 'pick_race', race }], state] as const
    }
    case 'arrange_force': {
      const actions: RunAction[] = []
      ;[roll, state] = nextInt(state, 10)
      if (roll === 0) {
        // Something illegal first: every die doubled is over any cap the pool reaches.
        const all = PRESET_ARMY_NAMES.flatMap((a) => run.force.armies[a])
        actions.push({ kind: 'set_force', force: { ...run.force, armies: { ...run.force.armies, home: [...all, ...all] } } })
        actions.push({ kind: 'ready' })
      }
      const keep = forceProblems(run.collection, pending.cap, run.force, 'at_most').length === 0
      if (roll >= 5 && keep && actions.length === 0) return [[{ kind: 'ready' }], state] as const
      let force: BuiltForce
      ;[force, state] = randomForce(run, pending.cap, state)
      actions.push({ kind: 'set_force', force }, { kind: 'ready' })
      return [actions, state] as const
    }
    case 'battle':
      ;[roll, state] = nextInt(state, 1000)
      return [[{ kind: 'battle_ended', winner: roll < winChance * 1000 ? 'p1' : 'p2' }], state] as const
    case 'reward':
      ;[roll, state] = nextInt(state, pending.offers.length)
      return [[{ kind: 'take_offer', index: roll }], state] as const
    case 'event': {
      const options: RunAction[] = [{ kind: 'skip' }]
      if (pending.upgradable.length > 0) {
        let unit: string
        ;[unit, state] = pick(pending.upgradable, state)
        options.push({ kind: 'upgrade', unit })
      }
      if (pending.transformable.length > 0) {
        let unit: string
        ;[unit, state] = pick(pending.transformable, state)
        options.push({ kind: 'transform', unit })
      }
      let action: RunAction
      ;[action, state] = pick(options, state)
      return [[action], state] as const
    }
    case 'over':
      return [[], state] as const
  }
}

/** Plays one run to its end. Returns the run, every action applied, and what it saw. */
function playRun(
  seed: number,
  winChance: number,
  seen: { pendings: Record<RunPending['kind'], number>; actions: Record<RunAction['kind'], number> },
): { readonly run: RunState; readonly actions: readonly RunAction[] } {
  let run = newRun(seed)
  let rng = rngFrom(seed ^ 0x5eed)
  const applied: RunAction[] = []
  for (let n = 0; n < 2000 && run.pending.kind !== 'over'; n++) {
    seen.pendings[run.pending.kind]++
    let actions: readonly RunAction[]
    ;[actions, rng] = randomActions(run, winChance, rng)
    for (const action of actions) {
      seen.actions[action.kind]++
      const before = run
      try {
        run = reduceRun(run, action) // the real encounters, from data/encounters.json
      } catch (error) {
        // The only refusal the random player provokes on purpose is an illegal ready.
        expect(error, `${action.kind} at ${before.pending.kind}`).toBeInstanceOf(IllegalRunAction)
        expect(action.kind).toBe('ready')
        continue
      }
      applied.push(action)

      // Plain checks rather than `expect`: tens of thousands of matcher calls were most
      // of this fuzz's time. A failure throws, naming the run and the step.
      const fail = (what: string) => {
        throw new Error(`run ${seed}, ${action.kind} at ${before.pending.kind}: ${what}`)
      }
      // The event screen's preview is the reducer's own answer (v3 Phase 4b).
      if (action.kind === 'upgrade') {
        const preview = upgradePreview(before, action.unit)
        if (preview === null) fail('an upgrade the preview says cannot happen')
        else if (JSON.stringify(preview.force) !== JSON.stringify(run.force)) fail(`the preview said ${preview.effect}`)
      }
      if (action.kind !== 'set_force' && action.kind !== 'ready' && action.kind !== 'pick_race') {
        const finished = run.history.length - before.history.length
        const expected = action.kind === 'battle_ended' && run.pending.kind === 'reward' ? 0 : 1
        if (finished !== expected) fail(`the history grew by ${finished}`)
      }
      if (action.kind === 'ready') {
        const cap = ACT_SIZE[before.act]
        const problems = forceProblems(run.collection, cap, run.force, 'at_most')
        if (problems.length > 0) fail(`ready accepted ${JSON.stringify(problems)}`)
        const engine = builtForceProblem(run.force)
        if (engine !== null) fail(`ready accepted a force setup refuses: ${engine}`)
        if (forceHealth(run.force) > cap) fail(`ready accepted ${forceHealth(run.force)} health over ${cap}`)
      }
      const grew = ownedHealth(run.collection) - ownedHealth(before.collection)
      const expected = action.kind === 'transform' ? grew === 0 : action.kind === 'upgrade' ? grew === 1 : grew >= 0
      if (!expected) fail(`the pool's health moved by ${grew}`)
      if (action.kind !== 'set_force' && !fieldsOnlyOwned(run)) fail('the force fields a die the pool does not hold')
    }
  }
  seen.pendings[run.pending.kind]++
  return { run, actions: applied }
}

describe('the run fuzz', () => {
  it('plays hundreds of runs to their end, reaching every pending and every action', () => {
    const seen = {
      pendings: { choose_race: 0, arrange_force: 0, battle: 0, reward: 0, event: 0, over: 0 } satisfies Record<
        RunPending['kind'],
        number
      >,
      actions: {
        pick_race: 0,
        set_force: 0,
        ready: 0,
        battle_ended: 0,
        take_offer: 0,
        upgrade: 0,
        transform: 0,
        skip: 0,
      } satisfies Record<RunAction['kind'], number>,
    }
    const ends = { won: 0, lost: 0 }
    const acts = new Set<Act>()

    for (let seed = 1; seed <= 300; seed++) {
      // Half the runs never lose a battle, so `won` is reached as often as `lost`.
      const { run } = playRun(seed, seed % 2 === 0 ? 1 : 0.95, seen)
      expect(run.pending.kind, `run ${seed} stuck`).toBe('over')
      expect(run.status).not.toBe('playing')
      if (run.status === 'won') {
        ends.won++
        expect(run.act).toBe(3)
        expect(run.encounter).toBe(ENCOUNTERS_PER_ACT - 1)
      } else ends.lost++
      acts.add(run.act)
    }

    for (const [kind, count] of Object.entries(seen.pendings)) expect(count, kind).toBeGreaterThan(0)
    for (const [kind, count] of Object.entries(seen.actions)) expect(count, kind).toBeGreaterThan(0)
    expect(ends.won).toBeGreaterThan(100)
    expect(ends.lost).toBeGreaterThan(0)
    expect([...acts].sort()).toEqual([...ACTS])
  })

  it('replays the same run from the same seed and answers', () => {
    const seen = {
      pendings: { choose_race: 0, arrange_force: 0, battle: 0, reward: 0, event: 0, over: 0 },
      actions: { pick_race: 0, set_force: 0, ready: 0, battle_ended: 0, take_offer: 0, upgrade: 0, transform: 0, skip: 0 },
    }
    for (const seed of [4, 8, 15]) {
      const first = playRun(seed, 1, seen)
      let replay = newRun(seed)
      for (const action of first.actions) replay = reduceRun(replay, action)
      expect(replay).toEqual(first.run)
      expect(replay.status).toBe('won')
    }
  })
})
