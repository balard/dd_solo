import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'
import type { Face } from '../data/types'
import type { Effect } from '../engine/effects'
import { rngFrom, type RngState } from '../engine/rng'
import { defaultContextFor, faceResults, rollArmy } from '../engine/roll'
import { setupGame, STARTER_FORCES } from '../engine/setup'
import {
  SPECIES_RULES,
  type GameState,
  type Location,
  type PlayerId,
  type TerrainSlot,
  type UnitInstance,
} from '../engine/types'

import {
  contestOdds,
  expectedArmy,
  expectedAttack,
  expectedDie,
  expectedFace,
  killValue,
  leastValuableMaximal,
  mostValuableMaximal,
  unitValue,
} from './estimate'

const rules = SPECIES_RULES
const at = (slot: TerrainSlot): Location => ({ kind: 'terrain', slot })

interface Spec {
  readonly id: string
  readonly typeId: string
  readonly owner?: PlayerId
  readonly at?: Location
}

/** A real setup with its roster replaced, so terrains and turn state stay legal. The
 *  Frontier is pinned to a Wasteland (air and fire) for Flaming Shields. */
function board(specs: readonly Spec[], effects: readonly Effect[] = []): GameState {
  const base = setupGame({
    seed: 1,
    forces: STARTER_FORCES,
    ruleSet: rules,
    terrains: { p1_home: 'swampland_tower', frontier: 'wasteland_city', p2_home: 'swampland_city' },
  })
  const units: Record<string, UnitInstance> = {}
  for (const spec of specs) {
    units[spec.id] = {
      id: spec.id,
      typeId: spec.typeId,
      owner: spec.owner ?? 'p1',
      location: spec.at ?? at('frontier'),
    }
  }
  return { ...base, units, effects }
}

const sum = (share: { id: number; normal: number; sai: number }): number =>
  share.id + share.normal + share.sai

describe('expectedDie', () => {
  it('is the plain mean of the faces for a die with no SAI', () => {
    // Oak: 2 ID, 2 MELEE x4, 4 SAVE -- enumerated through `faceResults`, the roll's own
    // three lines, rather than restated by hand.
    const faces = unitType('treefolk.oak').faces
    const mean = faces.reduce((total, face) => total + faceResults(face, 'melee', rules), 0) / faces.length
    const die = expectedDie('treefolk.oak', 'melee', defaultContextFor('melee'), rules)
    expect(sum(die.share)).toBeCloseTo(mean)
    expect(die.share.id).toBeCloseTo(2 / 6)
    expect(die.share.normal).toBeCloseTo(8 / 6)
  })

  it('keeps Smite out of the total and counts it as unsavable instead', () => {
    // Oak Lord: 3 ID, 3 MELEE, 3 Smite, 3 Smite, 3 MELEE, 4 SAVE.
    const die = expectedDie('treefolk.oak_lord', 'melee', defaultContextFor('melee'), rules)
    expect(die.share).toEqual({ id: 0.5, normal: 1, sai: 0 })
    expect(die.unsavable).toBeCloseTo(1)
  })

  it('agrees with the real roller over many throws', () => {
    // The estimate's claim, checked against `rollArmy` itself: two Oak Lords average
    // three melee a throw, Smite not included -- it is an effect, not a result.
    const units = [
      { id: 'a', typeId: 'treefolk.oak_lord', owner: 'p1', location: at('frontier') },
      { id: 'b', typeId: 'treefolk.oak_lord', owner: 'p1', location: at('frontier') },
    ] as const
    let rng: RngState = rngFrom(7)
    let total = 0
    const throws = 4000
    for (let i = 0; i < throws; i++) {
      const [roll, next] = rollArmy(units, 'melee', rng, rules)
      total += roll.total
      rng = next
    }
    expect(total / throws).toBeCloseTo(3, 1)
  })

  it('makes a rerolling face worth a whole extra die: E = sum / (faces - rerolls)', () => {
    // Strangle Vine rerolls on two of its ten faces in a melee attack (Rend and Double
    // Strike), so its expectation is its printed results over eight, not over ten.
    const faces = unitType('treefolk.strangle_vine').faces
    const printedId = faces.filter((f) => f.icon === 'ID').reduce((t, f) => t + f.count, 0)
    const die = expectedDie('treefolk.strangle_vine', 'melee', defaultContextFor('melee'), rules)
    expect(die.share.id).toBeCloseTo(printedId / 8)
    expect(die.share.id).toBeGreaterThan(printedId / faces.length)
  })

  it('counts a Counter on a save roll against melee as saves and a riposte', () => {
    const ctx = { purpose: { kind: 'save' as const, against: 'melee' as const }, isCounter: false }
    const die = expectedDie('treefolk.lady_nereid', 'save', ctx, rules)
    expect(die.riposte).toBeGreaterThan(0)
    // Against nothing -- Wall of Thorns, a spell's save roll -- it saves and sends
    // nothing back.
    const alone = expectedDie('treefolk.lady_nereid', 'save', defaultContextFor('save'), rules)
    expect(alone.riposte).toBe(0)
  })
})

describe('expectedFace', () => {
  const fly: Face = { count: 4, icon: 'SAI', sai: 'Fly' }

  it('gives a Fly on a monster nothing in a melee attack, whatever the face shows', () => {
    const worth = expectedFace(fly, 'melee', defaultContextFor('melee'), rules)
    expect(sum(worth.share)).toBe(0)
  })

  it('gives the same Fly its four in a maneuver roll', () => {
    const worth = expectedFace(fly, 'maneuver', defaultContextFor('maneuver'), rules)
    expect(sum(worth.share)).toBe(4)
  })
})

describe('expectedArmy', () => {
  const galeforce = (army: TerrainSlot): Effect => ({
    source: 'Galeforce',
    target: { kind: 'army', player: 'p2', army },
    modifiers: [
      { kind: 'subtract', resultType: 'save', amount: 4 },
      { kind: 'subtract', resultType: 'maneuver', amount: 4 },
    ],
    expiresAtStartOfTurnOf: 'p1',
  })

  it('sees a Galeforce through armyRoll: minus four saves', () => {
    const oaks = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, typeId: 'treefolk.oak', owner: 'p2' as const }))
    const plain = expectedArmy(board(oaks), 'p2', 'frontier', 'save')
    const gusty = expectedArmy(board(oaks, [galeforce('frontier')]), 'p2', 'frontier', 'save')
    expect(plain.total).toBeGreaterThan(4)
    expect(gusty.total).toBeCloseTo(plain.total - 4)
  })

  it('floors a Galeforce at zero rather than going negative', () => {
    const one = [{ id: 'a', typeId: 'treefolk.oakling', owner: 'p2' as const }]
    expect(expectedArmy(board(one, [galeforce('frontier')]), 'p2', 'frontier', 'save').total).toBe(0)
  })

  it('doubles only the ID share for the eighth-face holder', () => {
    const oaks = [{ id: 'a', typeId: 'treefolk.oak', at: at('p1_home') }]
    const state = board(oaks)
    const held: GameState = {
      ...state,
      terrains: { ...state.terrains, p1_home: { ...state.terrains.p1_home, face: 8, capturedBy: 'p1' } },
    }
    const before = expectedArmy(state, 'p1', 'p1_home', 'melee')
    const after = expectedArmy(held, 'p1', 'p1_home', 'melee')
    expect(after.total - before.total).toBeCloseTo(before.share.id)
    expect(before.share.id).toBeGreaterThan(0)
  })

  it('leaves a sleeping die out, because armyRoll does', () => {
    const state = board([
      { id: 'a', typeId: 'treefolk.oak' },
      { id: 'b', typeId: 'treefolk.oak' },
    ])
    const asleep: Effect = {
      source: 'Sleep',
      target: { kind: 'unit', unitId: 'b' },
      modifiers: [],
      asleep: true,
      expiresAtStartOfTurnOf: 'p2',
    }
    const awake = expectedArmy(state, 'p1', 'frontier', 'melee').total
    const dozing = expectedArmy({ ...state, effects: [asleep] }, 'p1', 'frontier', 'melee').total
    expect(dozing).toBeCloseTo(awake / 2)
  })

  it('adds Flaming Shields at a fire terrain, and not on a counter-attack', () => {
    // Watcher: 2 SAVE on one face in six. At the Wasteland Frontier those saves are melee.
    const state = board([{ id: 'w', typeId: 'firewalkers.watcher' }])
    const attack = expectedArmy(state, 'p1', 'frontier', 'melee')
    const counter = expectedArmy(state, 'p1', 'frontier', 'melee', {
      context: { purpose: { kind: 'attack', action: 'melee' }, isCounter: true },
    })
    expect(attack.total - counter.total).toBeCloseTo(2 / 6)
  })
})

describe('expectedAttack', () => {
  it('counts no IDs in a missile at a Reserve Army, as a Tower allows', () => {
    const state = board([
      { id: 'p', typeId: 'treefolk.pine', at: at('p1_home') },
      { id: 'r', typeId: 'treefolk.oak', owner: 'p2', at: { kind: 'reserve' } },
      { id: 'f', typeId: 'treefolk.oak', owner: 'p2', at: at('frontier') },
    ])
    const atReserve = expectedAttack(state, 'p1', 'p1_home', 'missile', 'reserve')
    const atFrontier = expectedAttack(state, 'p1', 'p1_home', 'missile', 'frontier')
    expect(atReserve.attack.share.id).toBe(0)
    expect(atFrontier.attack.share.id).toBeGreaterThan(0)
  })

  it('subtracts the saves and adds what no save touches', () => {
    const state = board([
      { id: 'l', typeId: 'treefolk.oak_lord' },
      { id: 'o', typeId: 'treefolk.oakling', owner: 'p2' },
    ])
    const { attack, save, damage } = expectedAttack(state, 'p1', 'frontier', 'melee', 'frontier')
    expect(damage).toBeCloseTo(Math.max(0, attack.total - save.total) + attack.unsavable)
    expect(attack.unsavable).toBeCloseTo(1)
  })
})

describe('killValue', () => {
  it('kills whole units: 3 damage does nothing to a lone monster', () => {
    const monster = [{ id: 'm', typeId: 'treefolk.darktree', owner: 'p2', location: at('frontier') }] as const
    expect(killValue(monster, 3)).toBe(0)
    expect(killValue(monster, 4)).toBe(4)
  })

  it('rounds an expectation, so 0.9 damage reads as a kill against a 1-health die', () => {
    const small = [{ id: 's', typeId: 'treefolk.oakling', owner: 'p2', location: at('frontier') }] as const
    expect(killValue(small, 0.9)).toBe(1)
  })
})

describe('maximal sets', () => {
  const army = (typeIds: readonly string[]): readonly UnitInstance[] =>
    typeIds.map((typeId, i) => ({ id: `u${i}`, typeId, owner: 'p1', location: at('frontier') }))

  it('takes {2,2} and not the 3 for 4 damage -- the section 6 example', () => {
    const units = army(['treefolk.oak_lord', 'treefolk.oak', 'treefolk.oak'])
    expect(leastValuableMaximal(units, 4, rules)).toEqual(['u1', 'u2'])
    expect(mostValuableMaximal(units, 4, rules)).toEqual(['u1', 'u2'])
  })

  it('loses the cheaper of two dice with the same health, and takes the dearer', () => {
    const units = army(['treefolk.oak', 'treefolk.willow'])
    const worth = (u: UnitInstance): number => (u.typeId === 'treefolk.oak' ? 5 : 3)
    expect(leastValuableMaximal(units, 2, rules, worth)).toEqual(['u1'])
    expect(mostValuableMaximal(units, 2, rules, worth)).toEqual(['u0'])
  })

  it('still takes the maximum when the cheapest dice would absorb less', () => {
    // 5 damage against 3, 2, 1, 1: {3, 2} and {3, 1, 1} both absorb 5; the 1s are the
    // cheapest dice but {2, 1, 1} absorbs only 4 and is illegal.
    const units = army(['treefolk.oak_lord', 'treefolk.oak', 'treefolk.oakling', 'treefolk.oakling'])
    const lost = leastValuableMaximal(units, 5, rules)
    const health = lost.reduce((t, id) => t + unitType(units.find((u) => u.id === id)!.typeId).health, 0)
    expect(health).toBe(5)
  })

  it('takes nothing when nothing fits', () => {
    expect(leastValuableMaximal(army(['treefolk.darktree']), 3, rules)).toEqual([])
  })

  it('values a monster over a small die', () => {
    expect(unitValue('treefolk.darktree', rules)).toBeGreaterThan(unitValue('treefolk.oakling', rules))
  })
})

describe('contestOdds', () => {
  it('favours the army with more maneuver', () => {
    const state = board([
      { id: 'n', typeId: 'treefolk.naiad' },
      { id: 'o', typeId: 'treefolk.oakling', owner: 'p2' },
    ])
    const odds = contestOdds(state, 'p1', 'frontier')
    expect(odds.margin).toBeGreaterThan(0)
    expect(contestOdds(state, 'p2', 'frontier').margin).toBeCloseTo(-odds.margin)
  })
})
