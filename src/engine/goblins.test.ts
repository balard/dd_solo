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

import { spellResultTypes } from '../data/spells'
import { expectedArmy } from '../ai/estimate'

import { killUnits } from './death'
import { armyRoll, deathMagicImmune, isStunned, pruneEffects, unitRoll, type Effect } from './effects'
import { advance } from './reduce'
import type { RngState } from './rng'
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
