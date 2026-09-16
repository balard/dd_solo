import { describe, expect, it } from 'vitest'

import { unitType } from '../../data/load'
import type { UnitType } from '../../data/types'
import { begin } from '../../engine/reduce'
import { BESTIARY_FORCES, setupGame, STARTER_FORCES } from '../../engine/setup'
import {
  TERRAIN_SLOTS,
  armyAt,
  type GameState,
  type Pending,
  type TerrainFace,
  type UnitId,
} from '../../engine/types'

import {
  damageSelection,
  focusedSlot,
  orderedForDisplay,
  describeFace,
  plainLabel,
  promptFor,
  reinforcePlan,
  selectModeFor,
  selectableAt,
  sleepingIds,
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

/**
 * A board with a Highland at the Frontier on a chosen face.
 *
 * Highland runs magic on 1-3, missile on 4-5 and melee on 6-7, so it is the die with
 * a band wide enough to sit inside -- which is the case the labels exist for.
 */
const atFrontierFace = (face: TerrainFace): GameState => {
  const state = begin(
    setupGame({
      seed: 1234,
      forces: STARTER_FORCES,
      firstPlayer: 'p1',
      terrains: { frontier: 'highland_tower' },
    }),
  )
  return {
    ...state,
    terrains: {
      ...state.terrains,
      frontier: { ...state.terrains.frontier, face, capturedBy: null },
    },
  }
}

const maneuverPending: Pending = { kind: 'choose_maneuver', player: 'p1', slot: 'frontier' }

const directionPending = (options: readonly ('up' | 'down')[]): Pending => ({
  kind: 'choose_direction',
  player: 'p1',
  slot: 'frontier',
  options,
})

describe('the maneuver prompt shows the faces it could land on', () => {
  const HIGHLAND = 'highland_tower'

  it('offers every face a maneuver could reach, changed action or not', () => {
    // Face 3 is the top of Highland's magic band: up is face 4 (missile), down is
    // face 2 (still magic). Both are on offer, because the art carries the *number*
    // as well as the icon -- "go to face 2" is a different answer from "stay on 3"
    // even though neither changes what you can do.
    const prompt = promptFor(maneuverPending, 'p1', atFrontierFace(3))
    expect(prompt.choices[0]?.label).toBe('Maneuver (go to {} or {})')
    expect(prompt.choices[0]?.faces).toEqual([
      { dieId: HIGHLAND, face: 4 },
      { dieId: HIGHLAND, face: 2 },
    ])
  })

  it('offers one face at the ends of the die, where only one direction is legal', () => {
    expect(promptFor(maneuverPending, 'p1', atFrontierFace(1)).choices[0]).toMatchObject({
      label: 'Maneuver (go to {})',
      faces: [{ dieId: HIGHLAND, face: 2 }],
    })
    expect(promptFor(maneuverPending, 'p1', atFrontierFace(8)).choices[0]).toMatchObject({
      label: 'Maneuver (go to {})',
      faces: [{ dieId: HIGHLAND, face: 7 }],
    })
  })

  it('always says what declining leaves you on', () => {
    const decline = promptFor(maneuverPending, 'p1', atFrontierFace(6)).choices.at(-1)
    expect(decline?.passive).toBe(true)
    expect(decline?.label).toBe('No (stays at {})')
    expect(decline?.faces).toEqual([{ dieId: HIGHLAND, face: 6 }])
  })

  it('reaches the eighth face from face 7, which is how a terrain is captured', () => {
    const prompt = promptFor(maneuverPending, 'p1', atFrontierFace(7))
    expect(prompt.choices[0]?.faces).toContainEqual({ dieId: HIGHLAND, face: 8 })
  })
})

describe('describeFace', () => {
  it('names the number and the action, which is what the art draws', () => {
    expect(describeFace({ dieId: 'highland_tower', face: 4 })).toBe('face 4, missile')
    expect(describeFace({ dieId: 'highland_tower', face: 1 })).toBe('face 1, magic')
  })

  it('names the eighth-face icon instead, because face 8 has no action', () => {
    expect(describeFace({ dieId: 'highland_tower', face: 8 })).toBe('the eighth face, tower')
    expect(describeFace({ dieId: 'swampland_city', face: 8 })).toBe('the eighth face, city')
  })
})

describe('plainLabel', () => {
  it('spells out the faces, which reach a screen reader as nothing', () => {
    const prompt = promptFor(maneuverPending, 'p1', atFrontierFace(6))
    expect(plainLabel(prompt.choices[0]!)).toBe('Maneuver (go to face 7, melee or face 5, missile)')
    expect(plainLabel(prompt.choices.at(-1)!)).toBe('No (stays at face 6, melee)')
  })

  it('leaves a label with no faces alone', () => {
    expect(plainLabel({ label: 'Skip march', action: { kind: 'retreat', unitIds: [] } })).toBe(
      'Skip march',
    )
  })
})

describe('the direction prompt shows the face it lands on', () => {
  it('is the direction word and the face, and nothing else', () => {
    const prompt = promptFor(directionPending(['up', 'down']), 'p1', atFrontierFace(5))
    expect(prompt.choices.map((c) => c.label)).toEqual(['Up — {}', 'Down — {}'])
    expect(prompt.choices.map((c) => c.faces)).toEqual([
      [{ dieId: 'highland_tower', face: 6 }],
      [{ dieId: 'highland_tower', face: 4 }],
    ])
  })

  it('keeps the direction word, because only one way captures the terrain', () => {
    expect(plainLabel(promptFor(directionPending(['up']), 'p1', atFrontierFace(7)).choices[0]!)).toBe(
      'Up — the eighth face, tower',
    )
  })
})

describe('promptFor', () => {
  it('always offers a way to decline a march', () => {
    const prompt = promptFor(
{ kind: 'choose_march_army', player: 'p1', options: ['frontier'] },
'p1',
fresh(),
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
    const prompt = promptFor({ kind: 'contest_maneuver', player: 'p2', slot: 'frontier' }, 'p2', fresh())
    expect(JSON.stringify(prompt)).not.toMatch(/\bup\b|\bdown\b/i)
  })

  it('offers only the legal actions, plus passing', () => {
    const prompt = promptFor(
{ kind: 'choose_action', player: 'p1', slot: 'frontier', legal: ['melee'] },
'p1',
fresh(),
)
    expect(prompt.choices.map((c) => c.label)).toEqual(['Melee', 'No action'])
  })

  it('says so plainly when there is nothing to do', () => {
    const prompt = promptFor(
{ kind: 'choose_action', player: 'p1', slot: 'frontier', legal: [] },
'p1',
fresh(),
)
    expect(prompt.question).toMatch(/No action is available/)
    expect(prompt.choices).toHaveLength(1)
  })

  it('offers only the legal directions', () => {
    const prompt = promptFor(
{ kind: 'choose_direction', player: 'p1', slot: 'frontier', options: ['up'] },
'p1',
fresh(),
)
    expect(prompt.choices).toHaveLength(1)
    expect(prompt.choices[0]?.label).toMatch(/Up/)
  })

  it('hands damage, reinforce and retreat to their own surfaces', () => {
    expect(promptFor(damagePending(3), 'p1', fresh()).custom).toBe('assign_damage')
    expect(promptFor({ kind: 'reinforce', player: 'p1' }, 'p1', fresh()).custom).toBe('reinforce')
    expect(promptFor({ kind: 'retreat', player: 'p1' }, 'p1', fresh()).custom).toBe('retreat')
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

/**
 * "You may move any or all of them to any terrains. You may split the reserve units
 * up, sending some to one terrain and some to another."
 *
 * The sheet used to send every chosen die to one destination and dispatch on the
 * spot, so a reserve could only ever be committed to a single terrain per turn.
 * The destination buttons now stage into this plan instead.
 */
describe('reinforcePlan', () => {
  /** Puts the whole of p1's force into Reserves, so there is something to split. */
  const withReserves = (): GameState => {
    const state = fresh()
    const units = { ...state.units }
    for (const unit of Object.values(units)) {
      if (unit.owner === 'p1') units[unit.id] = { ...unit, location: { kind: 'reserve' } }
    }
    return { ...state, units }
  }

  const ids = (state: GameState) =>
    Object.values(state.units)
      .filter((u) => u.owner === 'p1')
      .map((u) => u.id)

  it('offers every reserve die while nothing is staged', () => {
    const state = withReserves()
    const plan = reinforcePlan(state, 'p1', [])

    expect(plan.unassigned).toHaveLength(ids(state).length)
    expect(plan.moves).toEqual([])
    expect(plan.byDestination).toEqual([])
  })

  it('splits a reserve across two terrains, which is the whole point', () => {
    const state = withReserves()
    const [a, b, c] = ids(state)
    const staged = [
      { unitId: a!, slot: 'p1_home' as const },
      { unitId: b!, slot: 'frontier' as const },
      { unitId: c!, slot: 'frontier' as const },
    ]

    const plan = reinforcePlan(state, 'p1', staged)

    expect(plan.moves).toEqual(staged)
    expect(plan.byDestination.map((g) => [g.slot, g.units.map((u) => u.id)])).toEqual([
      ['p1_home', [a]],
      ['frontier', [b, c]],
    ])
  })

  it('drops a staged die from the pool, so it cannot be sent twice', () => {
    const state = withReserves()
    const [a] = ids(state)
    const plan = reinforcePlan(state, 'p1', [{ unitId: a!, slot: 'frontier' }])

    expect(plan.unassigned.some((u) => u.id === a)).toBe(false)
    expect(plan.unassigned).toHaveLength(ids(state).length - 1)
  })

  it('ignores a staged die that is no longer in reserve', () => {
    // A draft is a draft: it is filtered against the live reserve rather than
    // trusted, so a stale entry cannot reach the engine as an illegal move.
    const state = withReserves()
    const [a] = ids(state)
    const moved = {
      ...state,
      units: { ...state.units, [a!]: { ...state.units[a!]!, location: { kind: 'dua' as const } } },
    }

    expect(reinforcePlan(moved, 'p1', [{ unitId: a!, slot: 'frontier' }]).moves).toEqual([])
  })

  it('lists destinations in board order, whatever order they were staged in', () => {
    const state = withReserves()
    const [a, b] = ids(state)
    const plan = reinforcePlan(state, 'p1', [
      { unitId: a!, slot: 'p2_home' },
      { unitId: b!, slot: 'p1_home' },
    ])

    expect(plan.byDestination.map((g) => g.slot)).toEqual(['p1_home', 'p2_home'])
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

  it('names the sleeping dice, which the grid must not offer', () => {
    // The engine refuses a sleeping unit as a retreat either way; this is what keeps
    // the button from being offered, and what gives the die a visible reason.
    const state = fresh()
    expect(sleepingIds(state).size).toBe(0)

    const victim = armyAt(state, 'p1', 'p1_home')[0]!
    const asleep: GameState = {
      ...state,
      effects: [
        {
          source: 'Sleep',
          target: { kind: 'unit', unitId: victim.id },
          modifiers: [],
          asleep: true,
          expiresAtStartOfTurnOf: 'p2',
        },
      ],
    }
    expect([...sleepingIds(asleep)]).toEqual([victim.id])
  })
})

describe('display order', () => {
  const at = (state: GameState, slot: 'p1_home' | 'frontier' | 'p2_home') =>
    orderedForDisplay(armyAt(state, 'p1', slot)).map((u) => unitType(u.typeId))

  it('groups by class in HM, LM, MI, CA, MA order, monsters ahead of all of them', () => {
    const order = ['heavy_melee', 'light_melee', 'missile', 'cavalry', 'magic']
    const rank = (t: UnitType) => (t.size === 'monster' ? -1 : order.indexOf(t.unitClass))
    for (const slot of TERRAIN_SLOTS) {
      const seen = at(fresh(), slot).map(rank)
      expect(seen).toEqual([...seen].sort((a, b) => a - b))
    }
  })

  /** A monster is filed under a class in the data -- Strangle Vine under missile --
   *  and plays none of it, so it must not sort into that line. A bestiary army is
   *  what shows the difference: the starters field one monster each, and both of
   *  those happen to be heavy melee, which already sorts first. */
  it('keeps monsters together whatever class line they are filed under', () => {
    const state = begin(setupGame({ seed: 5, forces: BESTIARY_FORCES, firstPlayer: 'p1' }))
    for (const slot of TERRAIN_SLOTS) {
      const types = orderedForDisplay(armyAt(state, 'p1', slot)).map((u) => unitType(u.typeId))
      const monsters = types.filter((t) => t.size === 'monster')
      expect(types.slice(0, monsters.length)).toEqual(monsters)
    }
  })

  it('puts the biggest die first inside each group', () => {
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
