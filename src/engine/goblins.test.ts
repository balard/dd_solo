/**
 * The Goblins (v2 Phase 7), and the seams their rules stand on.
 *
 * 7b built the machinery before anything used it, so its tests drive each piece
 * directly: the DUA-count cap Foul Stench will read, the turn-level burial check that
 * Stomp moved onto and Soiled Ground will join, the stunned status, the non-maneuver
 * wildcard Palsy will use, and the Temple's death-magic predicate.
 *
 * Boards are hand-built, because the Goblins are not playable until 7d and `setupGame`
 * would refuse them.
 */
import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'
import { spell, spellResultTypes } from '../data/spells'
import { expectedArmy } from '../ai/estimate'

import { killUnits } from './death'
import { armyRoll, deathMagicImmune, isAsleep, isStunned, pruneEffects, unitRoll, type Effect } from './effects'
import { spellTargets } from './magic'
import { advance, reduce } from './reduce'
import { rollDice, type RngState } from './rng'
import { meleeAsManeuver } from './pipeline'
import { saiEffects, type RollContext } from './sai'
import { targetTasks } from './targeting'
import { capPer24, duaCap } from './species'
import { castSpell, spellEffect, type SpellContext } from './spells'
import {
  V0_RULES,
  type GameState,
  type LogEntry,
  type RuleSet,
  type SpellTarget,
  type TerrainSlot,
  type TurnState,
  type UnitInstance,
} from './types'
import { validateState } from './validate'

const RULES: RuleSet = { ...V0_RULES, sai: 'full', dua: 'active', speciesAbilities: true, eighthFace: 'full' }

const OAK = 'treefolk.oak'
const WATCHER = 'firewalkers.watcher'

interface Die {
  readonly typeId: string
  readonly at?: UnitInstance['location']
}

/** p1's and p2's dice (at the Frontier unless placed), p1 to march. */
function board(
  p1: readonly (string | Die)[],
  p2: readonly (string | Die)[],
  options: { rng?: RngState; turn?: Partial<TurnState>; dieId?: string } = {},
): GameState {
  const units: Record<string, UnitInstance> = {}
  for (const [owner, dice] of [['p1', p1], ['p2', p2]] as const) {
    dice.forEach((die, i) => {
      const id = `${owner}:${i}`
      const { typeId, at } = typeof die === 'string' ? { typeId: die, at: undefined } : die
      units[id] = { id, typeId, owner, location: at ?? { kind: 'terrain', slot: 'frontier' } }
    })
  }
  const terrain = (slot: TerrainSlot) => ({
    slot,
    dieId: options.dieId ?? 'highland_tower',
    face: 6 as const,
    capturedBy: null,
  })
  return {
    ruleSet: RULES,
    rng: options.rng ?? { seed: 1, counter: 0 },
    units,
    effects: [],
    dragons: {},
    terrains: { p1_home: terrain('p1_home'), frontier: terrain('frontier'), p2_home: terrain('p2_home') },
    turn: {
      marching: 'p1',
      phase: 'march',
      marchIndex: 0,
      marchStep: 'select_army',
      marchingArmy: null,
      armiesMarched: [],
      combat: null,
      ...options.turn,
    },
    pending: null,
    log: [],
    winner: null,
  }
}

const entries = <K extends LogEntry['kind']>(state: GameState, kind: K) =>
  state.log.filter((e): e is Extract<LogEntry, { kind: K }> => e.kind === kind)

// --- the DUA-count cap (7b) ----------------------------------------------------------

describe('duaCap', () => {
  it('allows the stated number per 24 health of force size, or part of 24', () => {
    // p. 21: "a limit of 5 in games up to 24 points, a limit of 10 in games from 25 to 48".
    expect([12, 24, 25, 36, 48, 49].map((size) => capPer24(size, 3))).toEqual([3, 3, 6, 6, 6, 9])
    expect(capPer24(24, 5)).toBe(5)
    expect(capPer24(25, 5)).toBe(10)
  })

  it("reads the holder's own force, dead and buried dice included", () => {
    // Thirteen health for p1 (Oaks are 2), two of it dead and two buried: 6, not 3.
    const oaks = Array.from({ length: 11 }, () => OAK)
    const state = board(
      [...oaks, { typeId: OAK, at: { kind: 'dua' } }, { typeId: OAK, at: { kind: 'bua' } }],
      [WATCHER],
    )
    expect(duaCap(state, 'p1', 3)).toBe(6)
    expect(duaCap(state, 'p2', 3)).toBe(3)
  })
})

// --- the turn-level burial check (7b) ----------------------------------------------

describe('the burial check owed on the turn', () => {
  const owed = (state: GameState, unitIds: readonly string[]): GameState => ({
    ...state,
    turn: {
      ...state.turn,
      burialDue: [{ source: 'Stomp', player: 'p2', slot: 'frontier', unitIds }],
    },
  })

  it('is settled by the next machine step and cleared, rolling each die still in the DUA', () => {
    const state = owed(board([WATCHER], [WATCHER, { typeId: OAK, at: { kind: 'dua' } }]), ['p2:1'])
    const after = advance(state)

    expect(after.turn.burialDue).toBeUndefined()
    const roll = entries(after, 'sai_sub_roll')
    expect(roll).toHaveLength(1)
    expect(roll[0]?.source).toBe('Stomp')
    expect(roll[0]?.dice.map((d) => d.unitId)).toEqual(['p2:1'])
    expect(after.rng.counter).toBe(state.rng.counter + 1)
    expect(validateState(after)).toEqual([])
  })

  it('rolls nothing for a die that left the DUA before the check came due', () => {
    // A Phoenix that rose, or a die an exchange brought back: no longer dead.
    const state = owed(board([WATCHER], [WATCHER, OAK]), ['p2:1'])
    const after = advance(state)

    expect(after.turn.burialDue).toBeUndefined()
    expect(entries(after, 'sai_sub_roll')).toEqual([])
    expect(after.rng).toEqual(state.rng)
  })

  it("runs after pruning, so a dead die's own Sleep is gone before it rolls", () => {
    // With the check before the prune, the Sleep would still be on the die, `unitRoll`
    // would call it unrollable, and it would fail its save without a die drawn.
    const asleep: Effect = {
      source: 'Sleep',
      target: { kind: 'unit', unitId: 'p2:1' },
      modifiers: [],
      asleep: true,
      expiresAtStartOfTurnOf: 'p1',
    }
    const base = board([WATCHER], [WATCHER, { typeId: OAK, at: { kind: 'dua' } }])
    const after = advance(owed({ ...base, effects: [asleep] }, ['p2:1']))

    expect(after.effects).toEqual([])
    expect(entries(after, 'sai_sub_roll')[0]?.dice.map((d) => d.unitId)).toEqual(['p2:1'])
  })
})

// --- the stunned status (7b) ---------------------------------------------------------

describe('a stunned die', () => {
  const stun = (unitId: string, slot: TerrainSlot = 'frontier'): Effect => ({
    source: 'Stun',
    target: { kind: 'unit', unitId },
    modifiers: [],
    stunned: true,
    anchor: { unitId, slot },
    expiresAtStartOfTurnOf: 'p1',
  })
  const stunned = (): GameState => ({ ...board([WATCHER], [WATCHER, OAK]), effects: [stun('p2:1')] })

  it('sits out every army roll, and so the estimate of one', () => {
    const state = stunned()
    expect(isStunned(state, 'p2:1')).toBe(true)
    expect(armyRoll(state, 'p2', 'frontier', 'save').units.map((u) => u.id)).toEqual(['p2:0'])
    expect(expectedArmy(state, 'p2', 'frontier', 'save').total).toBe(
      expectedArmy(board([WATCHER], [WATCHER]), 'p2', 'frontier', 'save').total,
    )
  })

  it('is still rolled by a sub-roll: "unless they are the target of an individual-targeting effect"', () => {
    expect(unitRoll(stunned(), 'p2:1').rollable).toBe(true)
  })

  it('stops being stunned the moment it leaves the terrain, by any means', () => {
    const state = stunned()
    const moved: GameState = {
      ...state,
      units: { ...state.units, 'p2:1': { ...state.units['p2:1']!, location: { kind: 'reserve' } } },
    }
    expect(pruneEffects(state)).toBe(state)
    expect(pruneEffects(moved).effects).toEqual([])
  })

  it('does not replant: Replanting is not a roll an individual-targeting effect forces', () => {
    // A Treefolk at a water terrain whose next die is its ID: it would replant if rolled.
    for (let counter = 0; counter < 1000; counter += 1) {
      const base = board([WATCHER], [WATCHER, OAK], { rng: { seed: 1, counter }, dieId: 'swampland_tower' })
      const free = killUnits(base, ['p2:1'])
      if (free.replanted.length === 0) continue
      const outcome = killUnits({ ...base, effects: [stun('p2:1')] }, ['p2:1'])
      expect(outcome.replanted).toEqual([])
      expect(outcome.replantDice).toEqual([])
      expect(outcome.state.rng).toEqual(base.rng)
      return
    }
    throw new Error('no counter replants the Oak')
  })
})

// --- the non-maneuver wildcard (7b) --------------------------------------------------

describe('spellResultTypes', () => {
  it("expands '*' to every type and 'non_maneuver' to every type but maneuver", () => {
    expect(spellResultTypes('*')).toEqual(['melee', 'missile', 'magic', 'save', 'maneuver'])
    expect(spellResultTypes('non_maneuver')).toEqual(['melee', 'missile', 'magic', 'save'])
    expect(spellResultTypes('melee')).toEqual(['melee'])
  })
})

// --- the Temple's death-magic predicate (7b) ----------------------------------------

describe('deathMagicImmune', () => {
  const held = (dieId: string, face: 7 | 8, capturedBy: 'p1' | null): GameState => {
    const state = board([WATCHER], [WATCHER])
    return {
      ...state,
      terrains: { ...state.terrains, frontier: { slot: 'frontier', dieId, face, capturedBy } },
    }
  }

  it("covers the army holding a Temple on its eighth face, and only that player's", () => {
    const state = held('highland_temple', 8, 'p1')
    expect(deathMagicImmune(state, 'p1', 'frontier')).toBe(true)
    expect(deathMagicImmune(state, 'p2', 'frontier')).toBe(false)
    expect(deathMagicImmune(state, 'p1', 'p1_home')).toBe(false)
    expect(deathMagicImmune(state, 'p1', 'reserve')).toBe(false)
  })

  it('ends with the capture, and is no other icon', () => {
    expect(deathMagicImmune(held('highland_temple', 7, null), 'p1', 'frontier')).toBe(false)
    expect(deathMagicImmune(held('highland_tower', 8, 'p1'), 'p1', 'frontier')).toBe(false)
  })
})

// --- Screech, Poison, Net, Stun (7c) -------------------------------------------------

const CANNIBAL = 'goblins.cannibal'
const DEATH_NAGA = 'goblins.death_naga'
const HARPY = 'goblins.harpy'
/** Oak: face 0 `2 ID`, 1-4 `2 MELEE`, 5 `4 SAVE`. No maneuver face but its ID. */
const OAK_MELEE = 1
const OAK_SAVE = 5

const faceOf = (typeId: string, label: string): number => {
  const index = unitType(typeId).faces.findIndex((f) => (f.icon === 'SAI' ? `SAI:${f.sai}` : f.icon) === label)
  if (index < 0) throw new Error(`${typeId} has no ${label} face`)
  return index
}

/** The RNG counter at which these dice, in this order, show these faces. */
function rngShowing(typeIds: readonly string[], faces: readonly number[]): RngState {
  const counts = typeIds.map((id) => unitType(id).faces.length)
  for (let counter = 0; counter < 400_000; counter += 1) {
    const [indices] = rollDice({ seed: 1, counter }, counts)
    if (faces.every((face, i) => indices[i] === face)) return { seed: 1, counter }
  }
  throw new Error(`no counter shows ${typeIds.join(', ')} on faces ${faces.join(', ')}`)
}

/** p1 attacks p2's army at the Frontier, from a board where the attack is about to roll.
 *  p2 keeps a die at home, so no exchange here ends the game. */
const attackAt = (
  action: 'melee' | 'missile',
  p1: readonly (string | Die)[],
  p2: readonly (string | Die)[],
  rng: RngState,
): GameState =>
  board(p1, [...p2, { typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }], {
    rng,
    turn: {
      marchStep: 'resolve_attack',
      marchingArmy: 'frontier',
      armiesMarched: ['frontier'],
      combat: { action, targetSlot: 'frontier', damage: 0 },
    },
  })

describe('the Goblins SAIs, face by face', () => {
  const melee: RollContext = { purpose: { kind: 'attack', action: 'melee' }, isCounter: false }
  const missile: RollContext = { purpose: { kind: 'attack', action: 'missile' }, isCounter: false }
  const subSave: RollContext = { purpose: { kind: 'save', against: null }, isCounter: false, isSubRoll: true }
  const armySave: RollContext = { purpose: { kind: 'save', against: 'melee' }, isCounter: false }
  const face = (sai: string) => ({ count: 4, icon: 'SAI', sai }) as const

  it('Screech takes saves off the answer to a melee attack, and nothing else', () => {
    expect(saiEffects(face('Screech'), melee, RULES).effects).toEqual([{ kind: 'screech', amount: 4 }])
    expect(saiEffects(face('Screech'), missile, RULES).effects).toEqual([])
    expect(
      saiEffects(face('Screech'), { purpose: { kind: 'maneuver', marching: true }, isCounter: false }, RULES).effects,
    ).toEqual([])
  })

  it('Net targets in melee and missile alike, and saves only in a sub-roll', () => {
    for (const ctx of [melee, missile]) {
      expect(saiEffects(face('Net'), ctx, RULES).effects).toEqual([
        { kind: 'target_enemy', health: 4, escape: 'maneuver', fate: 'net' },
      ])
    }
    expect(saiEffects(face('Net'), subSave, RULES).results).toEqual({ save: 4 })
    // An army's save roll is not "saving against an individual targeting effect".
    expect(saiEffects(face('Net'), armySave, RULES)).toEqual({ results: {}, effects: [], reroll: false })
  })

  it('Stun and Poison are melee only', () => {
    expect(saiEffects(face('Stun'), missile, RULES).effects).toEqual([])
    expect(saiEffects(face('Poison'), missile, RULES).effects).toEqual([])
    expect(saiEffects(face('Poison'), melee, RULES).effects).toEqual([
      { kind: 'target_enemy', health: 4, escape: 'save', fate: 'save_or_bury' },
    ])
  })
})

describe('Screech', () => {
  it('takes X saves off the defenders, and the roll says it was Screech', () => {
    // A Watcher's 3 melee beside the Harpy's Screech; the Oak shows 4 SAVE.
    const rng = rngShowing(
      [HARPY, WATCHER, OAK],
      [faceOf(HARPY, 'SAI:Screech'), faceOf(WATCHER, 'MELEE'), OAK_SAVE],
    )
    const done = advance(attackAt('melee', [HARPY, WATCHER], [OAK], rng))

    const fight = entries(done, 'combat_resolved')[0]
    expect(fight?.saveTotal).toBe(0)
    expect(fight?.saveMath?.steps).toEqual([{ source: 'Screech', delta: -4 }])
    expect(validateState(done)).toEqual([])
  })
})

describe('Poison', () => {
  it('kills what fails its save, then buries what fails a second save', () => {
    // Two Oaks show melee and die; their burial saves show 4 SAVE, then melee.
    const rng = rngShowing(
      [DEATH_NAGA, OAK, OAK, OAK, OAK],
      [faceOf(DEATH_NAGA, 'SAI:Poison'), OAK_MELEE, OAK_MELEE, OAK_SAVE, OAK_MELEE],
    )
    const asked = advance(attackAt('melee', [DEATH_NAGA], [OAK, OAK], rng))
    expect(asked.pending).toMatchObject({ kind: 'sai_target', sai: 'Poison', limit: { kind: 'health', budget: 4 } })

    const done = reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] })
    expect(entries(done, 'sai_sub_roll')).toMatchObject([
      { source: 'Poison', test: 'save', escaped: [] },
      { source: 'Poison', test: 'save', fate: 'bury', escaped: ['p2:0'] },
    ])
    expect(done.units['p2:0']?.location).toEqual({ kind: 'dua' })
    expect(done.units['p2:1']?.location).toEqual({ kind: 'bua' })
    expect(done.turn.burialDue).toBeUndefined()
    expect(validateState(done)).toEqual([])
  })
})

describe('Net', () => {
  const netting = () =>
    advance(
      attackAt(
        'melee',
        [CANNIBAL, WATCHER],
        [OAK, OAK, OAK],
        rngShowing(
          [CANNIBAL, WATCHER, OAK, OAK],
          [faceOf(CANNIBAL, 'SAI:Net'), faceOf(WATCHER, 'MELEE'), OAK_MELEE, OAK_MELEE],
        ),
      ),
    )

  it("holds what fails its maneuver with Sleep's status, under Net's name", () => {
    const asked = netting()
    expect(asked.pending).toMatchObject({ kind: 'sai_target', sai: 'Net' })
    const done = reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] })

    expect(entries(done, 'sai_sub_roll')).toMatchObject([{ source: 'Net', test: 'maneuver', fate: 'net', escaped: [] }])
    expect(entries(done, 'effect_cast').map((e) => [e.source, e.unitId])).toEqual([
      ['Net', 'p2:0'],
      ['Net', 'p2:1'],
    ])
    // Netted, not killed: still standing, and out of the save roll that follows.
    expect(done.units['p2:0']?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
    expect(isAsleep(done, 'p2:0') && isAsleep(done, 'p2:1')).toBe(true)
    expect(entries(done, 'units_killed')).toEqual([])
    // A Watcher's melee earns the defenders a save roll, and only the free Oak makes it.
    const saved = entries(done, 'combat_resolved')[0]?.saveDice ?? []
    expect(saved.map((d) => d.unitId)).toEqual(['p2:2'])
    expect(validateState(done)).toEqual([])
  })

  it("does nothing in a missile attack on a Reserve Army, a Tower's only missile there", () => {
    const rng = rngShowing([CANNIBAL], [faceOf(CANNIBAL, 'SAI:Net')])
    const base = attackAt('missile', [CANNIBAL], [], rng)
    const reserves: GameState = {
      ...base,
      units: {
        ...base.units,
        'p2:r': { id: 'p2:r', typeId: OAK, owner: 'p2', location: { kind: 'reserve' } },
      },
      turn: { ...base.turn, combat: { action: 'missile', targetSlot: 'reserve', damage: 0 } },
    }
    const after = advance(reserves)
    expect(after.pending?.kind).not.toBe('sai_target')
    expect(entries(after, 'sai_resolved')).toEqual([])
  })

  it('asks at a terrain in a missile attack', () => {
    const rng = rngShowing([CANNIBAL], [faceOf(CANNIBAL, 'SAI:Net')])
    expect(advance(attackAt('missile', [CANNIBAL], [OAK], rng)).pending).toMatchObject({
      kind: 'sai_target',
      sai: 'Net',
    })
  })
})

describe('Stun', () => {
  it('takes what fails its maneuver out of the save roll, anchored where it stands', () => {
    // A Watcher's melee earns the defenders a save roll, which the stunned dice sit out.
    const rng = rngShowing(
      [CANNIBAL, WATCHER, OAK, OAK],
      [faceOf(CANNIBAL, 'SAI:Stun'), faceOf(WATCHER, 'MELEE'), OAK_MELEE, OAK_MELEE],
    )
    const asked = advance(attackAt('melee', [CANNIBAL, WATCHER], [OAK, OAK, OAK], rng))
    expect(asked.pending).toMatchObject({ kind: 'sai_target', sai: 'Stun' })
    const done = reduce(asked, { kind: 'sai_target', unitIds: ['p2:0', 'p2:1'] })

    expect(entries(done, 'sai_sub_roll')).toMatchObject([{ source: 'Stun', fate: 'stun', escaped: [] }])
    expect(isStunned(done, 'p2:0') && isStunned(done, 'p2:1')).toBe(true)
    expect(isAsleep(done, 'p2:0')).toBe(false)
    const stun = done.effects.find((e) => e.target.kind === 'unit' && e.target.unitId === 'p2:0')
    expect(stun).toMatchObject({ source: 'Stun', stunned: true, anchor: { unitId: 'p2:0', slot: 'frontier' } })
    expect(stun?.expiresAtStartOfTurnOf).toBe('p1')
    const saved = entries(done, 'combat_resolved')[0]?.saveDice ?? []
    expect(saved.map((d) => d.unitId)).toEqual(['p2:2'])
    expect(validateState(done)).toEqual([])
  })
})

// --- Regenerate, Swamp Mastery, Foul Stench (7d) ------------------------------------

const TROLL = 'goblins.troll'
const THUG = 'goblins.thug'
const CUTTHROAT = 'goblins.cutthroat'
const OAK_LORD = 'treefolk.oak_lord'
const dead = (typeId: string): Die => ({ typeId, at: { kind: 'dua' } })

describe('Regenerate', () => {
  const face = { count: 4, icon: 'SAI', sai: 'Regenerate' } as const

  it('is a choice on any non-maneuver roll, and the saves where there is no room for one', () => {
    const save: RollContext = { purpose: { kind: 'save', against: 'melee' }, isCounter: false }
    expect(saiEffects(face, save, RULES).effects).toEqual([{ kind: 'regenerate', budget: 4 }])
    expect(saiEffects(face, { purpose: { kind: 'maneuver' }, isCounter: false }, RULES).effects).toEqual([])
    expect(saiEffects(face, { ...save, isSubRoll: true }, RULES).results).toEqual({ save: 4 })
    expect(saiEffects(face, { purpose: { kind: 'dragon_attack' }, isCounter: false }, RULES).results).toEqual({
      save: 4,
    })
  })

  it('combines into one choice of their sum', () => {
    const effect = (unitId: string) => ({ kind: 'regenerate', budget: 4, sai: 'Regenerate', unitId }) as const
    expect(targetTasks([effect('a'), effect('b')])).toEqual([{ kind: 'regenerate', sai: 'Regenerate', budget: 8 }])
  })

  // p1's Watcher attacks for 3; p2's Troll answers with Regenerate, an Oak in p2's DUA.
  const defending = () =>
    advance(
      attackAt(
        'melee',
        [WATCHER],
        [TROLL, dead(OAK), dead(OAK_LORD)],
        rngShowing([WATCHER, TROLL], [faceOf(WATCHER, 'MELEE'), faceOf(TROLL, 'SAI:Regenerate')]),
      ),
    )

  it("asks the defender at its save roll, offering every dead die that fits", () => {
    const asked = defending()
    expect(asked.pending).toMatchObject({
      kind: 'sai_regenerate',
      player: 'p2',
      budget: 4,
      saveResultsCount: true,
      slot: 'frontier',
      eligible: ['p2:1', 'p2:2'],
    })
  })

  it('as saves: X more on the roll, named on its line', () => {
    const done = advance(reduce(defending(), { kind: 'sai_regenerate', choice: { kind: 'saves' } }))
    const fight = entries(done, 'combat_resolved')[0]
    expect(fight?.saveMath?.steps).toContainEqual({ source: 'Regenerate', delta: 4 })
    expect(fight?.damage).toBe(0)
    expect(entries(done, 'units_regenerated')).toMatchObject([{ player: 'p2', unitIds: [], saveResults: 4 }])
    expect(validateState(done)).toEqual([])
  })

  it('as units: back in the army before the damage is assigned, and they can take it', () => {
    const done = advance(
      reduce(defending(), { kind: 'sai_regenerate', choice: { kind: 'units', unitIds: ['p2:1'] } }),
    )
    expect(done.units['p2:1']?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
    expect(entries(done, 'units_regenerated')).toMatchObject([{ player: 'p2', unitIds: ['p2:1'], slot: 'frontier' }])
    // 3 damage against a Troll (4) and the Oak (2) that just came back: the Oak takes it.
    expect(done.pending).toMatchObject({ kind: 'assign_damage', player: 'p2', damage: 3 })
    expect(validateState(done)).toEqual([])
  })

  it('refuses more health than the budget, and a die not in the DUA', () => {
    const asked = defending()
    expect(() =>
      reduce(asked, { kind: 'sai_regenerate', choice: { kind: 'units', unitIds: ['p2:1', 'p2:2'] } }),
    ).toThrow(/up to 4 health-worth/)
    expect(() => reduce(asked, { kind: 'sai_regenerate', choice: { kind: 'units', unitIds: ['p2:0'] } })).toThrow(
      /not in your DUA/,
    )
  })

  it('takes the saves without asking when nothing in the DUA fits', () => {
    const done = advance(
      attackAt(
        'melee',
        [WATCHER],
        [TROLL],
        rngShowing([WATCHER, TROLL], [faceOf(WATCHER, 'MELEE'), faceOf(TROLL, 'SAI:Regenerate')]),
      ),
    )
    expect(entries(done, 'units_regenerated')).toMatchObject([{ unitIds: [], saveResults: 4 }])
    expect(entries(done, 'combat_resolved')[0]?.damage).toBe(0)
  })

  it("on the attacker's roll offers only the units: an attack counts no saves", () => {
    const asked = advance(
      attackAt(
        'melee',
        [TROLL, WATCHER, dead(OAK)],
        [OAK],
        rngShowing([TROLL, WATCHER], [faceOf(TROLL, 'SAI:Regenerate'), faceOf(WATCHER, 'MELEE')]),
      ),
    )
    expect(asked.pending).toMatchObject({ kind: 'sai_regenerate', player: 'p1', saveResultsCount: false, eligible: ['p1:2'] })
    const done = reduce(asked, { kind: 'sai_regenerate', choice: { kind: 'units', unitIds: ['p1:2'] } })
    expect(done.units['p1:2']?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
  })
})

describe('Swamp Mastery', () => {
  it('lets a Goblin count melee as maneuver at earth, named as its own', () => {
    const at = (dieId: string) => armyRoll(board([THUG], [OAK], { dieId }), 'p1', 'frontier', 'maneuver').modifiers
    expect(at('highland_tower')).toContainEqual(meleeAsManeuver(['goblins'], 'Swamp Mastery'))
    expect(at('wasteland_tower').some((m) => m.kind === 'counts_as')).toBe(false)
  })
})

describe('Foul Stench', () => {
  // p1's Thug shows a save: no melee, so p2's Oaks all survive to be offered a counter.
  const goblinsAttack = (p1Dead: readonly string[], p2: readonly string[]): GameState => {
    const base = attackAt('melee', [THUG, ...p1Dead.map(dead)], p2, rngShowing([THUG], [faceOf(THUG, 'SAVE')]))
    const combat = base.turn.combat
    if (combat === null) throw new Error('no combat')
    return { ...base, turn: { ...base.turn, combat: { ...combat, foulStench: true } } }
  }

  it('is flagged when an army containing Goblins takes a melee action', () => {
    const start = board([THUG], [OAK], {
      dieId: 'wasteland_tower',
      turn: { marchStep: 'action', marchingArmy: 'frontier', armiesMarched: ['frontier'] },
    })
    const chosen = reduce(advance(start), { kind: 'choose_action', action: 'melee' })
    expect(chosen.turn.combat?.foulStench).toBe(true)
    const dwarf = board(['dwarves.footman'], [OAK], {
      dieId: 'wasteland_tower',
      turn: { marchStep: 'action', marchingArmy: 'frontier', armiesMarched: ['frontier'] },
    })
    expect(reduce(advance(dwarf), { kind: 'choose_action', action: 'melee' }).turn.combat?.foulStench).toBeUndefined()
  })

  it('says how many will sit out, asks once the counter is accepted, and benches them', () => {
    const offered = advance(goblinsAttack([CUTTHROAT, CUTTHROAT], [OAK, OAK, OAK]))
    expect(offered.pending).toMatchObject({ kind: 'choose_counter_attack', player: 'p2', foulStench: 2 })

    const asked = reduce(offered, { kind: 'choose_counter_attack', counter: true })
    expect(asked.pending).toEqual({ kind: 'foul_stench', player: 'p2', slot: 'frontier', count: 2 })
    expect(() => reduce(asked, { kind: 'foul_stench', unitIds: ['p2:0'] })).toThrow(/exactly 2/)

    const done = advance(reduce(asked, { kind: 'foul_stench', unitIds: ['p2:1', 'p2:0'] }))
    expect(entries(done, 'foul_stench')).toMatchObject([{ player: 'p2', unitIds: ['p2:0', 'p2:1'] }])
    const counter = entries(done, 'combat_resolved').find((e) => e.isCounter)
    expect(counter?.attackDice.map((d) => d.unitId)).toEqual(['p2:2'])
    // The bench ends with the exchange.
    expect(done.turn.combat?.benched).toBeUndefined()
    expect(validateState(done)).toEqual([])
  })

  it('offers no counter at all when it benches the whole army', () => {
    const done = advance(goblinsAttack([CUTTHROAT, CUTTHROAT], [OAK, OAK]))
    expect(done.pending?.kind).not.toBe('choose_counter_attack')
    expect(entries(done, 'foul_stench')).toMatchObject([{ unitIds: ['p2:0', 'p2:1'], noCounter: true }])
  })

  it('counts at most three per 24 health of the Goblin force, and nothing with no dead', () => {
    // Nine health: four dead Cutthroats and the Thug -- capped at three.
    const capped = advance(goblinsAttack([CUTTHROAT, CUTTHROAT, CUTTHROAT, CUTTHROAT], [OAK, OAK, OAK, OAK]))
    expect(capped.pending).toMatchObject({ kind: 'choose_counter_attack', foulStench: 3 })
    const none = advance(goblinsAttack([], [OAK, OAK]))
    expect(none.pending).toMatchObject({ kind: 'choose_counter_attack' })
    expect(none.pending).not.toHaveProperty('foulStench')
  })
})

// --- Death magic: the five spells and the Temple (7e) -----------------------------

const ctxFor = (count: number, target: SpellTarget, caster: 'p1' | 'p2' = 'p1'): SpellContext => ({
  caster,
  army: 'frontier',
  element: 'death',
  count,
  target,
})
const p2Front: SpellTarget = { kind: 'army', player: 'p2', army: 'frontier' }

describe('Palsy and Decay', () => {
  it('Palsy takes one per casting off every non-maneuver roll, and nothing off a maneuver', () => {
    const palsy = spellEffect(spell('palsy'), ctxFor(2, p2Front))
    expect(palsy.modifiers).toEqual(
      ['melee', 'missile', 'magic', 'save'].map((resultType) => ({ kind: 'subtract', resultType, amount: 2 })),
    )
    expect(palsy.expiresAtStartOfTurnOf).toBe('p1')
    expect(spell('palsy')).toMatchObject({ element: 'death', species: 'any', cost: 2, cantrip: true, cumulative: true })
  })

  it('Decay takes two melee per casting, and is the Goblins’ own', () => {
    expect(spellEffect(spell('decay'), ctxFor(3, p2Front)).modifiers).toEqual([
      { kind: 'subtract', resultType: 'melee', amount: 6 },
    ])
    expect(spell('decay')).toMatchObject({ element: 'death', species: 'goblins', cost: 3 })
  })
})

describe('Finger of Death', () => {
  const finger = (count: number) =>
    castSpell(board([], [OAK, OAK]), spell('finger_of_death'), ctxFor(count, { kind: 'units', unitIds: ['p2:0'] }))
      .state

  it('kills when the castings reach the die’s health, with no roll at all', () => {
    const before = board([], [OAK, OAK])
    const state = finger(2)
    expect(state.units['p2:0']?.location).toEqual({ kind: 'dua' })
    expect(entries(state, 'units_killed')).toMatchObject([{ unitIds: ['p2:0'] }])
    expect(entries(state, 'sai_sub_roll')).toEqual([])
    expect(state.rng).toEqual(before.rng)
  })

  it('does nothing below the health, so the offer asks for the health in castings', () => {
    expect(finger(1).units['p2:0']?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
    const offers = spellTargets(board([WATCHER], [OAK, CANNIBAL]), 'p1', spell('finger_of_death'))
    expect(offers.map((o) => [o.target.kind === 'units' ? o.target.unitIds[0] : null, o.minCount])).toEqual([
      ['p2:0', 2],
      ['p2:1', 4],
    ])
  })
})

describe('Scent of Fear', () => {
  it('sends the opponent’s dice home, with no roll and no death', () => {
    const before = board([WATCHER], [OAK, OAK])
    const state = castSpell(before, spell('scent_of_fear'), {
      ...ctxFor(1, { kind: 'units', unitIds: ['p2:0'] }),
      element: 'earth',
    }).state
    expect(state.units['p2:0']?.location).toEqual({ kind: 'reserve' })
    expect(entries(state, 'units_sent_home')).toEqual([
      { kind: 'units_sent_home', player: 'p2', source: 'Scent of Fear', slot: 'frontier', unitIds: ['p2:0'] },
    ])
    expect(entries(state, 'units_killed')).toEqual([])
    expect(state.rng).toEqual(before.rng)
  })

  it('is offered at the opponent’s dice at terrains, three health a casting', () => {
    const state = board(
      [WATCHER],
      [OAK, CANNIBAL, { typeId: OAK, at: { kind: 'reserve' } }, { typeId: OAK, at: { kind: 'terrain', slot: 'p1_home' } }],
    )
    const offers = spellTargets(state, 'p1', spell('scent_of_fear'))
    expect(offers.map((o) => [o.target.kind === 'units' ? o.target.unitIds[0] : null, o.minCount]).sort()).toEqual([
      ['p2:0', 1],
      ['p2:1', 2],
      ['p2:3', 1],
    ])
  })
})

describe('Soiled Ground', () => {
  const soiled = (base: GameState, caster: 'p1' | 'p2' = 'p1'): GameState =>
    castSpell(base, spell('soiled_ground'), ctxFor(1, { kind: 'terrain', slot: 'frontier' }, caster)).state

  it('stands on the terrain until the caster’s next turn, and no roll gathers it', () => {
    const state = soiled(board([WATCHER], [OAK]))
    expect(state.effects).toEqual([
      {
        source: 'Soiled Ground',
        target: { kind: 'terrain', slot: 'frontier', scope: 'deaths' },
        modifiers: [],
        trigger: 'soiled_ground',
        expiresAtStartOfTurnOf: 'p1',
      },
    ])
    expect(armyRoll(state, 'p2', 'frontier', 'save').modifiers).toEqual([])
  })

  it('owes a burial check for a die killed there, either side’s, and rolls it a step later', () => {
    const state = soiled(board([WATCHER], [OAK, { typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }]))
    const killed = killUnits(state, ['p2:0', 'p2:1', 'p1:0'])
    // The die at the Enemy home was not killed on Soiled Ground, and rolls nothing.
    expect(killed.state.turn.burialDue).toEqual([
      { source: 'Soiled Ground', player: 'p1', slot: 'frontier', unitIds: ['p1:0'] },
      { source: 'Soiled Ground', player: 'p2', slot: 'frontier', unitIds: ['p2:0'] },
    ])
    const after = advance(killed.state)
    expect(entries(after, 'sai_sub_roll').map((e) => [e.source, e.player, e.fate])).toEqual([
      ['Soiled Ground', 'p1', 'bury'],
      ['Soiled Ground', 'p2', 'bury'],
    ])
    expect(after.turn.burialDue).toBeUndefined()
  })

  it('owes nothing for a kill that buries anyway', () => {
    const state = soiled(board([WATCHER], [OAK]))
    expect(killUnits(state, ['p2:0'], { bury: true }).state.turn.burialDue).toBeUndefined()
  })
})

describe('the Temple against death magic', () => {
  /** p2 holds a Temple at the Frontier, on its eighth face; or held it, at 7. */
  const temple = (face: 7 | 8, p1: readonly (string | Die)[] = [WATCHER], p2: readonly (string | Die)[] = [OAK, OAK]) => {
    const base = board(p1, p2)
    return {
      ...base,
      terrains: {
        ...base.terrains,
        frontier: { slot: 'frontier' as const, dieId: 'highland_temple', face, capturedBy: face === 8 ? ('p2' as const) : null },
      },
    }
  }
  const palsied = (state: GameState): GameState => ({
    ...state,
    effects: [spellEffect(spell('palsy'), ctxFor(1, p2Front))],
  })

  it('holds an opponent’s Palsy off the army while the capture stands, and lets it bite again after', () => {
    // Holding the eighth face doubles the army's IDs too; what matters is no Palsy.
    const held = palsied(temple(8))
    expect(armyRoll(held, 'p2', 'frontier', 'melee').modifiers.filter((m) => m.source === 'Palsy')).toEqual([])
    const lost = palsied(temple(7))
    expect(
      armyRoll(lost, 'p2', 'frontier', 'melee')
        .modifiers.filter((m) => m.source === 'Palsy')
        .map((m) => m.resultType),
    ).toEqual(['melee', 'missile', 'magic', 'save'])
  })

  it('is not offered as a target of a death spell, and still is of any other', () => {
    const state = temple(8, [WATCHER], [OAK, { typeId: OAK, at: { kind: 'terrain', slot: 'p2_home' } }])
    const armies = (id: string) =>
      spellTargets(state, 'p1', spell(id)).map((o) => (o.target.kind === 'army' ? o.target.army : null))
    expect(armies('palsy')).toEqual(['p2_home'])
    expect(armies('transmute_rock_to_mud')).toEqual(['frontier', 'p2_home'])
    const units = spellTargets(state, 'p1', spell('finger_of_death')).map((o) =>
      o.target.kind === 'units' ? o.target.unitIds[0] : null,
    )
    expect(units).toEqual(['p2:1'])
  })

  it('spares the holder’s dice from an opponent’s Soiled Ground, and not the other side’s', () => {
    const state = castSpell(temple(8), spell('soiled_ground'), ctxFor(1, { kind: 'terrain', slot: 'frontier' })).state
    expect(killUnits(state, ['p2:0', 'p1:0']).state.turn.burialDue).toEqual([
      { source: 'Soiled Ground', player: 'p1', slot: 'frontier', unitIds: ['p1:0'] },
    ])
  })
})
