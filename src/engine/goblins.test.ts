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
import { spellResultTypes } from '../data/spells'
import { expectedArmy } from '../ai/estimate'

import { killUnits } from './death'
import { armyRoll, deathMagicImmune, isAsleep, isStunned, pruneEffects, unitRoll, type Effect } from './effects'
import { advance, reduce } from './reduce'
import { rollDice, type RngState } from './rng'
import { saiEffects, type RollContext } from './sai'
import { capPer24, duaCap } from './species'
import {
  V0_RULES,
  type GameState,
  type LogEntry,
  type RuleSet,
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
  p1: readonly string[],
  p2: readonly string[],
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
