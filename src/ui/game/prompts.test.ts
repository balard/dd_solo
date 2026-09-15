import { describe, expect, it } from 'vitest'

import { unitType } from '../../data/load'
import { begin } from '../../engine/reduce'
import { setupGame, STARTER_FORCES } from '../../engine/setup'
import {
  TERRAIN_SLOTS,
  armyAt,
  type GameState,
  type Pending,
  type UnitId,
} from '../../engine/types'

import {
  damageSelection,
  focusedSlot,
  orderedForDisplay,
  promptFor,
  selectModeFor,
  selectableAt,
  slotLabel,
} from './prompts'

const fresh = () =>
  begin(
    setupGame({
      seed: 1234,
      forces: STARTER_FORCES,
      firstPlayer: 'p1',
    }),
  )

const damagePending = (damage: number): Extract<Pending, { kind: 'assign_damage' }> => ({
  kind: 'assign_damage',
  player: 'p1',
  slot: 'p1_home',
  damage,
})

describe('slotLabel', () => {
  it('names terrains from the reader point of view', () => {
    expect(slotLabel('p1_home', 'p1')).toBe('Your home')
    expect(slotLabel('p2_home', 'p1')).toBe('Enemy home')
    expect(slotLabel('p1_home', 'p2')).toBe('Enemy home')
    expect(slotLabel('frontier', 'p2')).toBe('Frontier')
  })
})

describe('promptFor', () => {
  it('always offers a way to decline a march', () => {
    const prompt = promptFor(
      { kind: 'choose_march_army', player: 'p1', options: ['frontier'] },
      'p1',
    )
    expect(prompt.choices.map((c) => c.label)).toEqual(['Frontier', 'Skip march'])
    expect(prompt.choices.at(-1)?.passive).toBe(true)
  })

  /**
   * The opponent has to decide whether to contest *before* the direction is chosen,
   * so the prompt must not hint at it. This is the UI half of the three-step
   * maneuver; the engine half is tested in turn.test.ts.
   */
  it('never leaks the maneuver direction while the contest is open', () => {
    const prompt = promptFor({ kind: 'contest_maneuver', player: 'p2', slot: 'frontier' }, 'p2')
    expect(JSON.stringify(prompt)).not.toMatch(/\bup\b|\bdown\b/i)
  })

  it('offers only the legal actions, plus passing', () => {
    const prompt = promptFor(
      { kind: 'choose_action', player: 'p1', slot: 'frontier', legal: ['melee'] },
      'p1',
    )
    expect(prompt.choices.map((c) => c.label)).toEqual(['Melee', 'No action'])
  })

  it('says so plainly when there is nothing to do', () => {
    const prompt = promptFor(
      { kind: 'choose_action', player: 'p1', slot: 'frontier', legal: [] },
      'p1',
    )
    expect(prompt.question).toMatch(/No action is available/)
    expect(prompt.choices).toHaveLength(1)
  })

  it('offers only the legal directions', () => {
    const prompt = promptFor(
      { kind: 'choose_direction', player: 'p1', slot: 'frontier', options: ['up'] },
      'p1',
    )
    expect(prompt.choices).toHaveLength(1)
    expect(prompt.choices[0]?.label).toMatch(/Up/)
  })

  it('hands damage, reinforce and retreat to their own surfaces', () => {
    expect(promptFor(damagePending(3), 'p1').custom).toBe('assign_damage')
    expect(promptFor({ kind: 'reinforce', player: 'p1' }, 'p1').custom).toBe('reinforce')
    expect(promptFor({ kind: 'retreat', player: 'p1' }, 'p1').custom).toBe('retreat')
  })
})

describe('damageSelection', () => {
  const state: GameState = fresh()
  // p1_home: Oak Lord 3, Oak 2, Oakling 1, Pine 2, Dryad 2
  const army = armyAt(state, 'p1', 'p1_home')
  const byName = (name: string): UnitId =>
    army.find((u) => unitType(u.typeId).name === name)!.id

  it('starts with nothing absorbed and a target to reach', () => {
    const selection = damageSelection(state, damagePending(5), new Set())
    expect(selection).toMatchObject({ absorbed: 0, required: 5, ready: false })
    expect(selection.suggestion.length).toBeGreaterThan(0)
  })

  /** The rule the confirm button exists to enforce. */
  it('is not ready while the selection absorbs less than it could', () => {
    const partial = new Set([byName('Oak Lord')]) // 3 of a possible 5
    expect(damageSelection(state, damagePending(5), partial)).toMatchObject({
      absorbed: 3,
      required: 5,
      ready: false,
    })
  })

  it('is ready on either maximal selection', () => {
    const a = new Set([byName('Oak Lord'), byName('Oak')]) // 3 + 2
    const b = new Set([byName('Oak'), byName('Pine'), byName('Oakling')]) // 2 + 2 + 1
    expect(damageSelection(state, damagePending(5), a).ready).toBe(true)
    expect(damageSelection(state, damagePending(5), b).ready).toBe(true)
  })

  it('is not ready once the selection overshoots', () => {
    const tooMany = new Set([byName('Oak Lord'), byName('Oak'), byName('Pine')]) // 7 vs 5
    expect(damageSelection(state, damagePending(5), tooMany)).toMatchObject({
      absorbed: 7,
      ready: false,
    })
  })

  it('accepts an empty selection only when nothing can die', () => {
    // Nothing in this army has fewer than 1 health, so 0 damage kills nothing.
    expect(damageSelection(state, damagePending(0), new Set())).toMatchObject({
      required: 0,
      ready: true,
    })
  })

  it('ignores units that are not in the army taking damage', () => {
    const outsider = armyAt(state, 'p2', 'frontier')[0]!.id
    expect(damageSelection(state, damagePending(5), new Set([outsider])).absorbed).toBe(0)
  })

  it('always suggests a selection the sheet would accept', () => {
    for (const damage of [0, 1, 2, 3, 4, 5, 7, 11, 40]) {
      const pending = damagePending(damage)
      const { suggestion } = damageSelection(state, pending, new Set())
      expect(
        damageSelection(state, pending, new Set(suggestion)).ready,
        `damage ${damage}`,
      ).toBe(true)
    }
  })
})

describe('focusedSlot', () => {
  it('follows the terrain the current decision is about', () => {
    const state = fresh()
    expect(focusedSlot({
      ...state,
      pending: { kind: 'choose_maneuver', player: 'p1', slot: 'p2_home' },
    })).toBe('p2_home')
  })

  it('falls back to the marching army when the decision names no terrain', () => {
    const state = fresh()
    expect(
      focusedSlot({
        ...state,
        pending: { kind: 'retreat', player: 'p1' },
        turn: { ...state.turn, marchingArmy: 'p1_home' },
      }),
    ).toBe('p1_home')
  })
})

describe('selection targeting', () => {
  const mine = (slot: 'p1_home' | 'frontier' | 'p2_home' | null) =>
    ({ side: 'mine', slot }) as const

  it('confines damage assignment to the terrain that was hit', () => {
    // `damagePending` puts the hit at p1_home.
    const mode = selectModeFor(damagePending(3), 'p1')
    expect(mode).toEqual(mine('p1_home'))
    expect(selectableAt(mode, 'p1_home')).toBe(true)
    expect(selectableAt(mode, 'frontier')).toBe(false)
    expect(selectableAt(mode, 'p2_home')).toBe(false)
  })

  it('lets a retreat pull from every terrain at once', () => {
    const mode = selectModeFor({ kind: 'retreat', player: 'p1' }, 'p1')
    expect(mode).toEqual(mine(null))
    for (const slot of TERRAIN_SLOTS) expect(selectableAt(mode, slot)).toBe(true)
  })

  it('selects nothing on the board while reinforcing from reserve', () => {
    const mode = selectModeFor({ kind: 'reinforce', player: 'p1' }, 'p1')
    expect(mode?.side).toBe('reserve')
    for (const slot of TERRAIN_SLOTS) expect(selectableAt(mode, slot)).toBe(false)
  })

  it('never offers the opponent’s decision to the human', () => {
    expect(selectModeFor(damagePending(3), 'p2')).toBeNull()
  })

  it('selects nothing when no decision is pending', () => {
    expect(selectModeFor(null, 'p1')).toBeNull()
    expect(selectableAt(null, 'frontier')).toBe(false)
  })
})

describe('display order', () => {
  const at = (state: GameState, slot: 'p1_home' | 'frontier' | 'p2_home') =>
    orderedForDisplay(armyAt(state, 'p1', slot)).map((u) => unitType(u.typeId))

  it('groups by class in HM, LM, MI, CA, MA order', () => {
    const order = ['heavy_melee', 'light_melee', 'missile', 'cavalry', 'magic']
    for (const slot of TERRAIN_SLOTS) {
      const seen = at(fresh(), slot).map((t) => order.indexOf(t.unitClass))
      expect(seen).toEqual([...seen].sort((a, b) => a - b))
    }
  })

  it('puts the biggest die first inside each class', () => {
    for (const slot of TERRAIN_SLOTS) {
      const types = at(fresh(), slot)
      for (let i = 1; i < types.length; i++) {
        const prev = types[i - 1]!
        const here = types[i]!
        if (prev.unitClass === here.unitClass) expect(prev.health).toBeGreaterThanOrEqual(here.health)
      }
    }
  })

  it('does not add, drop or duplicate units', () => {
    const units = armyAt(fresh(), 'p1', 'frontier')
    const ordered = orderedForDisplay(units)
    expect(ordered).toHaveLength(units.length)
    expect(new Set(ordered.map((u) => u.id))).toEqual(new Set(units.map((u) => u.id)))
  })

  it('leaves the caller’s array alone', () => {
    const units = armyAt(fresh(), 'p1', 'frontier')
    const before = units.map((u) => u.id)
    orderedForDisplay(units)
    expect(units.map((u) => u.id)).toEqual(before)
  })
})
