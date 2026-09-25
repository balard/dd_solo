import { describe, expect, it } from 'vitest'

import { unitType } from '../../data/load'
import type { UnitType } from '../../data/types'
import { ALL_RESULT_TYPES } from '../../engine/pipeline'
import { castingsFor } from '../../engine/magic'
import { spell } from '../../data/spells'
import { begin } from '../../engine/reduce'
import { BESTIARY_FORCES, setupGame, STARTER_FORCES } from '../../engine/setup'
import {
  TERRAIN_SLOTS,
  armyAt,
  type GameState,
  type LogEntry,
  type Pending,
  type TerrainFace,
  type UnitId,
} from '../../engine/types'

import {
  damageSelection,
  effectsOnArmy,
  effectsOnPlayer,
  cityAnswer,
  growthDraft,
  pickModeFor,
  pickableIn,
  tapMeaning,
  treasureAnswer,
  rollsBehind,
  effectsOnTerrain,
  focusedSlot,
  orderedForDisplay,
  describeFace,
  plainLabel,
  pendingKey,
  promptFor,
  reinforcePlan,
  retreatPlan,
  saiTargetSelection,
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

  /**
   * A targeting SAI is the first decision that picks from the army *opposite*, so it
   * is the first time `side` has had to mean anything: before it, "selectable" always
   * meant "mine", and `Board` hard-coded the enemy half unselectable.
   */
  it('offers the enemy army, and only at the terrain the SAI is aimed at', () => {
    const pending = {
      kind: 'sai_target',
      player: 'p1',
      sai: 'Flame',
      target: 'p2',
      slot: 'frontier',
      limit: { kind: 'health', budget: 2 },
      remaining: 1,
    } as const

    const mode = selectModeFor(pending, 'p1')
    expect(mode).toEqual({ side: 'theirs', slot: 'frontier' })

    expect(selectableAt(mode, 'frontier', 'theirs')).toBe(true)
    expect(selectableAt(mode, 'p1_home', 'theirs')).toBe(false)
    // And my own dice stay out of it: this decision is about somebody else's army.
    for (const slot of TERRAIN_SLOTS) expect(selectableAt(mode, slot, 'mine')).toBe(false)
  })

  it('asks the roller, not the army’s owner', () => {
    const pending = {
      kind: 'sai_target',
      player: 'p1',
      sai: 'Flame',
      target: 'p2',
      slot: 'frontier',
      limit: { kind: 'health', budget: 2 },
      remaining: 1,
    } as const

    // p2 owns the dice being picked from and is not the one choosing.
    expect(selectModeFor(pending, 'p2')).toBeNull()
  })

  /**
   * The rest of the targeting sheet, without a DOM.
   *
   * The engine tests prove Flame resolves; these prove the surface that answers it
   * counts the right army. Getting that wrong is invisible to every engine test --
   * the tally would sit at zero however many enemy dice were lit up, and the confirm
   * button would never enable.
   */
  it('tallies the targeted army, not your own', () => {
    const state = fresh()
    const enemy = armyAt(state, 'p2', 'p2_home')
    const pending = {
      kind: 'sai_target',
      player: 'p1',
      sai: 'Flame',
      target: 'p2',
      slot: 'p2_home',
      limit: { kind: 'health', budget: 2 },
      remaining: 1,
    } as const

    const empty = saiTargetSelection(state, pending, new Set())
    expect(empty.absorbed).toBe(0)
    expect(empty.required).toBeGreaterThan(0)
    expect(empty.ready).toBe(false)

    // The engine's own suggestion is always a legal answer, so it must read as ready.
    const auto = saiTargetSelection(state, pending, new Set(empty.suggestion))
    expect(auto.absorbed).toBe(auto.required)
    expect(auto.ready).toBe(true)

    // One of my own dice counts for nothing here, whatever its health.
    const mine = armyAt(state, 'p1', 'p1_home')[0]!
    expect(saiTargetSelection(state, pending, new Set([mine.id])).absorbed).toBe(0)
    expect(enemy.length).toBeGreaterThan(0)
  })

  /**
   * The Satyr carries Sleep on two faces, so two of them produce two consecutive
   * `sai_target` pendings with the same kind and the same player. On kind and player
   * alone the key does not change, `App` keeps the first answer's selection, and
   * Confirm is enabled for a question nothing has been picked for.
   */
  it('gives two consecutive Sleeps two different draft keys', () => {
    const sleep = (remaining: number) =>
      ({
        kind: 'sai_target',
        player: 'p1',
        sai: 'Sleep',
        target: 'p2',
        slot: 'frontier',
        limit: { kind: 'one' },
        remaining,
      }) as const

    expect(pendingKey(sleep(2))).not.toBe(pendingKey(sleep(1)))
    // And a pending with no `remaining` still keys on kind and player, as before.
    expect(pendingKey(damagePending(3))).toBe('assign_damage:p1')
    expect(pendingKey(null)).toBe('none')
  })

  it('counts dice rather than health when the SAI takes one unit', () => {
    const state = fresh()
    const army = armyAt(state, 'p2', 'p2_home')
    const pending = {
      kind: 'sai_target',
      player: 'p1',
      sai: 'Sleep',
      target: 'p2',
      slot: 'p2_home',
      limit: { kind: 'one' },
      remaining: 1,
    } as const

    expect(saiTargetSelection(state, pending, new Set())).toMatchObject({
      absorbed: 0,
      required: 1,
      ready: false,
    })
    // One die is ready whatever it weighs -- there is no maximum to reach.
    const big = army.reduce((a, b) =>
      unitType(a.typeId).health >= unitType(b.typeId).health ? a : b,
    )
    expect(saiTargetSelection(state, pending, new Set([big.id])).ready).toBe(true)
    // Two is not "more"; it is illegal, and the sheet must not offer to confirm it.
    const two = army.slice(0, 2).map((u) => u.id)
    expect(saiTargetSelection(state, pending, new Set(two)).ready).toBe(false)
  })

  it('names the SAI and the terrain in the question', () => {
    const state = fresh()
    const prompt = promptFor(
      {
        kind: 'sai_target',
        player: 'p1',
        sai: 'Flame',
        target: 'p2',
        slot: 'frontier',
        limit: { kind: 'health', budget: 2 },
        remaining: 1,
      },
      'p1',
      state,
    )
    expect(prompt.custom).toBe('sai_target')
    expect(prompt.question).toContain('Flame')
    expect(prompt.question).toContain('Frontier')
    expect(prompt.choices).toEqual([])
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

describe('the eighth face (Phase 9f)', () => {
  it('makes keeping it the answer, and going down the small one', () => {
    // Going down gives up the capture and its power. It used to be the green button.
    const base = fresh()
    const state: GameState = {
      ...base,
      terrains: { ...base.terrains, p1_home: { ...base.terrains.p1_home, face: 8, capturedBy: 'p1' } },
    }
    const prompt = promptFor({ kind: 'choose_maneuver', player: 'p1', slot: 'p1_home' }, 'p1', state)
    expect(prompt.choices[0]?.action).toEqual({ kind: 'choose_maneuver', maneuver: false })
    expect(prompt.choices[0]?.emphasis).toBeUndefined()
    expect(prompt.choices[1]?.action).toEqual({ kind: 'choose_maneuver', maneuver: true })
    expect(prompt.choices[1]).toMatchObject({ passive: true, emphasis: 'low' })
  })

  it('leaves an ordinary maneuver as it was', () => {
    const prompt = promptFor({ kind: 'choose_maneuver', player: 'p1', slot: 'frontier' }, 'p1', fresh())
    expect(prompt.choices[0]?.action).toEqual({ kind: 'choose_maneuver', maneuver: true })
    expect(prompt.choices.some((c) => c.emphasis === 'low')).toBe(false)
  })
})

describe('one way to pick (Phase 9f)', () => {
  const none = new Set<string>()

  it('lights exactly the dice a City could take, wherever they lie', () => {
    const pending = {
      kind: 'eighth_face_city',
      player: 'p1',
      slot: 'p1_home',
      recruits: ['p1:oakling#2'],
      promotions: [{ unitId: 'p1:oak#1', partnerId: 'p1:oak_lord#0' }],
    } as const satisfies Pending
    const state = fresh()
    // Before a die of yours is picked: the recruit and the die that could grow.
    expect([...(pickModeFor(state, pending, 'p1', none, [], null)?.only ?? [])].sort()).toEqual(
      ['p1:oak#1', 'p1:oakling#2'],
    )
    // After: its partner lights up too.
    const chosen = new Set(['p1:oak#1'])
    expect(pickModeFor(state, pending, 'p1', chosen, [], null)?.only?.has('p1:oak_lord#0')).toBe(true)

    // A tap on the board die is a radio pick among board dice; on a dead one, among
    // the dead -- so the answer never holds two of either.
    expect(tapMeaning(state, pending, none, [], null, 'p1:oak#1')).toMatchObject({ kind: 'radio' })
    expect(cityAnswer(pending, new Set(['p1:oakling#2']))).toEqual({ kind: 'recruit', unitId: 'p1:oakling#2' })
    expect(cityAnswer(pending, new Set(['p1:oak#1', 'p1:oak_lord#0']))).toEqual({
      kind: 'promote',
      pair: { unitId: 'p1:oak#1', partnerId: 'p1:oak_lord#0' },
    })
    // Half a promotion is no answer yet.
    expect(cityAnswer(pending, chosen)).toBeNull()
  })

  it('reads a treasure promotion off the two dice picked', () => {
    const pending = {
      kind: 'dragon_treasure',
      player: 'p1',
      slot: 'frontier',
      promotions: [{ unitId: 'a', partnerId: 'b' }],
    } as const satisfies Pending
    expect(treasureAnswer(pending, new Set(['a']))).toBeNull()
    expect(treasureAnswer(pending, new Set(['a', 'b']))).toEqual({ unitId: 'a', partnerId: 'b' })
  })

  it('lets a Temple burial be tapped in the DUA', () => {
    const pending = { kind: 'temple_bury', player: 'p1', options: ['x', 'y'] } as unknown as Pending
    expect([...(pickModeFor(fresh(), pending, 'p1', none, [], null)?.only ?? [])]).toEqual(['x', 'y'])
  })

  it('aims a unit spell with a tap on the die, castings and all', () => {
    const castable = {
      spell: spell('lightning_strike'),
      elements: ['air'],
      maxCount: 1,
      targets: [{ target: { kind: 'units', unitIds: ['p2:genie#0'] }, minCount: 1 }],
    } as const
    const pending = {
      kind: 'announce_spells',
      player: 'p1',
      slot: 'frontier',
      pool: { points: 6, elements: ['air'] },
      castable: [castable],
    } as unknown as Pending
    const aiming = { spell: 'lightning_strike' }
    expect([...(pickModeFor(fresh(), pending, 'p1', none, [], aiming)?.only ?? [])]).toEqual(['p2:genie#0'])
    expect(tapMeaning(fresh(), pending, none, [], aiming, 'p2:genie#0')).toEqual({
      kind: 'cast',
      target: { kind: 'units', unitIds: ['p2:genie#0'] },
      count: 1,
    })
    // Nothing is aimed yet: no die answers.
    expect(pickModeFor(fresh(), pending, 'p1', none, [], null)).toBeNull()
  })
})

describe('castingsFor (Phase 9f)', () => {
  it('takes the stepper where the count scales the spell, and never less than the target asks', () => {
    expect(castingsFor({ spell: 'stone_skin', count: 3 }, spell('stone_skin'), 1)).toBe(3)
    // Path moves one unit a casting: a second casting at one target buys nothing.
    expect(castingsFor({ spell: 'path', count: 3 }, spell('path'), 1)).toBe(1)
    // Resurrect Dead's price is its target's health.
    expect(castingsFor({ spell: 'resurrect_dead', count: 5 }, spell('resurrect_dead'), 2)).toBe(2)
    // Not cumulative at all.
    expect(castingsFor({ spell: 'lightning_strike', count: 2 }, spell('lightning_strike'), 1)).toBe(1)
  })
})

describe('rollsBehind', () => {
  const resolved = {
    kind: 'combat_resolved',
    attacker: 'p2',
    defender: 'p1',
    attackerSlot: 'frontier',
    defenderSlot: 'frontier',
    action: 'melee',
    isCounter: false,
    attackTotal: 6,
    saveTotal: 2,
    damage: 4,
    attackDice: [],
    saveDice: [],
  } as const satisfies LogEntry
  const killed = { kind: 'units_killed', player: 'p1', slot: 'frontier', unitIds: [] } as const satisfies LogEntry
  const asking = (kind: Pending['kind']) => ({ kind, player: 'p1' }) as unknown as Pending

  it('shows the enemy attack a damage assignment answers, from the log', () => {
    // Phase 9d: you were asked who dies without seeing the roll that killed them.
    const state: GameState = { ...fresh(), log: [...fresh().log, resolved, killed] }
    expect(rollsBehind(state, asking('assign_damage'))).toEqual({ kind: 'logged', entries: [resolved] })
    // And the same roll behind the offer to counter-attack it.
    expect(rollsBehind(state, asking('choose_counter_attack'))).toEqual({
      kind: 'logged',
      entries: [resolved],
    })
  })

  it('shows nothing behind a decision no roll caused', () => {
    const state: GameState = { ...fresh(), log: [...fresh().log, resolved] }
    expect(rollsBehind(state, asking('choose_march_army'))).toBeNull()
    expect(rollsBehind(state, null)).toBeNull()
  })

  it("brings the dragons' throw along with the damage it did", () => {
    const attack = { kind: 'dragon_attack', slot: 'frontier', defender: 'p1', dragons: [] } as const satisfies LogEntry
    const answer = {
      kind: 'dragon_roll',
      player: 'p1',
      slot: 'frontier',
      dice: [],
      totals: { melee: 4, missile: 0, save: 2 },
    } as const satisfies LogEntry
    const damage = {
      kind: 'dragon_damage',
      player: 'p1',
      slot: 'frontier',
      incoming: { inflicted: 6, saves: 2, damage: 4 },
    } as const satisfies LogEntry
    const state: GameState = { ...fresh(), log: [...fresh().log, resolved, attack, answer, damage] }
    expect(rollsBehind(state, asking('assign_damage'))).toEqual({
      kind: 'logged',
      entries: [attack, answer, damage],
    })
  })
})

describe('pickableIn', () => {
  it('lets a Confuse or a Choke pick from the dice it is aimed at', () => {
    const state = fresh()
    const pending = {
      kind: 'sai_target',
      player: 'p1',
      sai: 'Choke',
      target: 'p2',
      slot: 'frontier',
      limit: { kind: 'health', budget: 4 },
      eligible: ['p2:genie#0'],
      remaining: 1,
    } as unknown as Pending
    expect([...(pickableIn(pending, state) ?? [])]).toEqual(['p2:genie#0'])
    expect(pickableIn(null, state)).toBeNull()
  })
})

describe('growthDraft', () => {
  const pending = {
    kind: 'accelerated_growth',
    player: 'p1',
    dying: ['p1:oak#1', 'p1:willow#8'],
    partners: ['p1:oakling#2', 'p1:nymph#12', 'p1:pineling#13'],
  } as const

  it('answers "let them all die" with nothing selected', () => {
    expect(growthDraft(pending, new Set())).toEqual({ saving: [], bringing: [], pairs: [] })
  })

  it('pairs the two halves itself, because which pairs with which does not matter', () => {
    const draft = growthDraft(pending, new Set(['p1:willow#8', 'p1:pineling#13', 'p1:oak#1', 'p1:nymph#12']))
    // In the offer's order, not the order they were tapped.
    expect(draft.pairs).toEqual([
      { unitId: 'p1:oak#1', partnerId: 'p1:nymph#12' },
      { unitId: 'p1:willow#8', partnerId: 'p1:pineling#13' },
    ])
  })

  it('has no answer while the two counts differ', () => {
    const draft = growthDraft(pending, new Set(['p1:oak#1', 'p1:willow#8', 'p1:nymph#12']))
    expect(draft.saving).toHaveLength(2)
    expect(draft.bringing).toHaveLength(1)
    expect(draft.pairs).toBeNull()
  })

  it('ignores a selected die that is in neither half', () => {
    const draft = growthDraft(pending, new Set(['p1:oak#1', 'p1:nymph#12', 'p2:genie#0']))
    expect(draft.pairs).toEqual([{ unitId: 'p1:oak#1', partnerId: 'p1:nymph#12' }])
  })
})

describe('effectsOnPlayer', () => {
  it('draws Accelerated Growth on the DUA it waits on, even an empty one', () => {
    // "Target your DUA" names neither an army nor a terrain, so no army heading could
    // carry it -- and until 9a's follow-up nothing did, so a live spell left no trace.
    const base = fresh()
    const state: GameState = {
      ...base,
      effects: [
        {
          source: 'Accelerated Growth',
          target: { kind: 'player', player: 'p1' },
          modifiers: [],
          trigger: 'accelerated_growth',
          expiresAtStartOfTurnOf: 'p1',
        },
      ],
    }

    expect(effectsOnPlayer(state, 'p1', 'p1')).toEqual([
      {
        source: 'Accelerated Growth',
        what: 'a dying unit of 2+ health swaps with a 1-health unit from this DUA',
        until: 'your next turn',
      },
    ])
    expect(effectsOnPlayer(state, 'p2', 'p1')).toEqual([])
    // Not an army effect, so no army heading claims it.
    expect(effectsOnArmy(state, 'p1', 'p1_home', 'p1')).toEqual([])
  })
})

describe('effectsOnArmy', () => {
  /**
   * An effect with a duration is the one thing on the board that is true between
   * rolls, and the only sign of one used to be a dashed die for Sleep and nothing at
   * all for Galeforce -- an army saving at minus four with the arithmetic visible only
   * in a log line that had already scrolled away.
   */
  it('turns an army effect into the arithmetic it costs you', () => {
    const base = fresh()
    const state: GameState = {
      ...base,
      effects: [
        {
          source: 'Galeforce',
          target: { kind: 'army', player: 'p2', army: 'frontier' },
          modifiers: [
            { kind: 'subtract', resultType: 'save', amount: 4 },
            { kind: 'subtract', resultType: 'maneuver', amount: 4 },
          ],
          expiresAtStartOfTurnOf: 'p1',
        },
      ],
    }

    expect(effectsOnArmy(state, 'p2', 'frontier', 'p1')).toEqual([
      { source: 'Galeforce', what: '−4 save, −4 maneuver', until: 'your next turn' },
    ])
    // It sits on a place, not on the dice: another terrain shows nothing.
    expect(effectsOnArmy(state, 'p2', 'p1_home', 'p1')).toEqual([])
    // And it reads from whoever is looking.
    expect(effectsOnArmy(state, 'p2', 'frontier', 'p2')[0]?.until).toBe("the enemy's next turn")
  })

  it('names a sleeping die on the army it is standing in', () => {
    const base = fresh()
    const [unit] = armyAt(base, 'p2', 'frontier')
    const state: GameState = {
      ...base,
      effects: [
        {
          source: 'Sleep',
          target: { kind: 'unit', unitId: unit!.id },
          modifiers: [],
          asleep: true,
          expiresAtStartOfTurnOf: 'p1',
        },
      ],
    }

    expect(effectsOnArmy(state, 'p2', 'frontier', 'p1')).toEqual([
      {
        source: 'Sleep',
        what: `${unitType(unit!.typeId).name} cannot be rolled or leave`,
        until: 'your next turn',
      },
    ])
  })
})

describe('effectsOnTerrain', () => {
  /**
   * A terrain effect belongs to the place, not to either army, so it is drawn on the
   * terrain card rather than inside an `ArmySide`. Filing Ash Storm under one army
   * would say it hurt only that army, which is the opposite of the rule.
   */
  it('collapses an every-result effect into one clause', () => {
    // Ash Storm subtracts one from *all* results. Five clauses -- "-1 melee, -1
    // missile, -1 magic, -1 save, -1 maneuver" -- read as noise rather than as a rule.
    const state: GameState = {
      ...fresh(),
      effects: [
        {
          source: 'Ash Storm',
          target: { kind: 'terrain', slot: 'frontier', scope: 'all_armies' },
          modifiers: ALL_RESULT_TYPES.map((resultType) => ({
            kind: 'subtract' as const,
            resultType,
            amount: 1,
          })),
          expiresAtStartOfTurnOf: 'p1',
        },
      ],
    }

    expect(effectsOnTerrain(state, 'frontier', 'p1')).toEqual([
      { source: 'Ash Storm', what: '−1 to every result', until: 'your next turn' },
    ])
    expect(effectsOnTerrain(state, 'p1_home', 'p1')).toEqual([])
    // It is not on either army, so neither army header claims it.
    expect(effectsOnArmy(state, 'p1', 'frontier', 'p1')).toEqual([])
  })

  it('says who a ward reaches, because a terrain effect need not reach the people on it', () => {
    const state: GameState = {
      ...fresh(),
      effects: [
        {
          source: 'Wall of Fog',
          target: { kind: 'terrain', slot: 'frontier', scope: 'attackers' },
          modifiers: [{ kind: 'subtract', resultType: 'missile', amount: 6 }],
          expiresAtStartOfTurnOf: 'p2',
        },
      ],
    }

    expect(effectsOnTerrain(state, 'frontier', 'p1')).toEqual([
      {
        source: 'Wall of Fog',
        what: '−6 missile for anyone attacking here',
        until: "the enemy's next turn",
      },
    ])
  })

  it('renders ignore_ids, which had no case at all until Phase 7b', () => {
    // The Death breath. It is unreachable in this plan's scope, so nothing ever drew
    // it -- and without a `case` the callback returned `undefined` and the header
    // printed a source name and an empty half-sentence.
    const state: GameState = {
      ...fresh(),
      effects: [
        {
          source: 'Death breath',
          target: { kind: 'army', player: 'p1', army: 'frontier' },
          modifiers: [{ kind: 'ignore_ids', resultType: 'melee' }],
          expiresAtStartOfTurnOf: 'p1',
        },
      ],
    }

    expect(effectsOnArmy(state, 'p1', 'frontier', 'p1')[0]?.what).toBe('no melee from IDs')
  })
})

describe("the decisions a spell owes part-way through resolving", () => {
  /**
   * Each of these renders through the generic button path rather than a sheet, so what
   * is worth pinning is the sentence and the options -- a pending with no `case` here
   * is a compile error, but a pending with a *wrong* label is not.
   */
  const state = fresh()

  it('names the dragon, the terrain and the units', () => {
    expect(
      promptFor(
        { kind: 'spell_move', player: 'p1', spell: 'Path', unitIds: [], options: ['frontier'] },
        'p1',
        state,
      ).question,
    ).toBe('Path: move  where?')

    const summon = promptFor(
      { kind: 'spell_summon', player: 'p1', slot: 'frontier', options: ['d1'], remaining: 1 },
      'p1',
      state,
    )
    expect(summon.question).toBe('Summon which dragon to Frontier?')
    // An unknown id degrades to a phrase rather than throwing: the log and the prompt
    // both outlive the dragon they name.
    expect(summon.choices[0]?.label).toBe('a dragon')
  })

  it('counts the summons still owed, because combined castings bring more than one', () => {
    expect(
      promptFor(
        { kind: 'spell_summon', player: 'p1', slot: 'frontier', options: ['d1'], remaining: 2 },
        'p1',
        state,
      ).question,
    ).toBe('Summon which dragon to Frontier? (2 to summon)')
  })

  it('offers the marching player the order, and each dragon its own enemies', () => {
    expect(
      promptFor(
        { kind: 'dragon_order', player: 'p1', options: ['p1_home', 'frontier'] },
        'p1',
        state,
      ).choices.map((c) => c.label),
    ).toEqual(['Your home', 'Frontier'])

    // One decision covering every dragon that owes one: the rules have both owners
    // declare and reveal together, so the answer carries all of them at once.
    const declare = promptFor(
      {
        kind: 'dragon_target',
        player: 'p1',
        slot: 'frontier',
        choices: [{ dragonId: 'mine', options: ['a', 'b'] }],
      },
      'p1',
      state,
    )
    expect(declare.choices).toHaveLength(2)
    expect(declare.choices[0]?.action).toEqual({
      kind: 'dragon_target',
      targets: { mine: 'a' },
    })
  })
})

/**
 * The Retreat Step's draft (Phase 8). Air Flight gave the step a second destination,
 * so fly buttons stage and one action still reaches the engine -- and a force with
 * nothing to fly must see exactly the sheet it always did.
 */
describe('retreatPlan', () => {
  const retreatPending = (
    flights?: Extract<Pending, { kind: 'retreat' }>['flights'],
  ): Extract<Pending, { kind: 'retreat' }> => ({
    kind: 'retreat',
    player: 'p1',
    ...(flights === undefined ? {} : { flights }),
  })
  const deployed = (state: GameState) =>
    Object.values(state.units).filter((u) => u.owner === 'p1' && u.location.kind === 'terrain')

  it('is the old retreat sheet when nothing can fly', () => {
    const state = fresh()
    const [a, b] = deployed(state)
    const plan = retreatPlan(state, retreatPending(), new Set([a!.id, b!.id]), [])
    expect(plan.retreats).toEqual([a!.id, b!.id])
    expect(plan.flights).toEqual([])
    expect(plan.flyTo).toEqual([])
  })

  it('offers only the terrains every chosen die could fly to', () => {
    const state = fresh()
    const [a, b] = deployed(state)
    const pending = retreatPending([
      { unitId: a!.id, options: ['frontier', 'p2_home'] },
      { unitId: b!.id, options: ['frontier'] },
    ])
    expect(retreatPlan(state, pending, new Set([a!.id]), []).flyTo).toEqual(['frontier', 'p2_home'])
    expect(retreatPlan(state, pending, new Set([a!.id, b!.id]), []).flyTo).toEqual(['frontier'])
  })

  it('takes a staged flyer out of the retreat, and drops a flight no longer offered', () => {
    const state = fresh()
    const [a, b] = deployed(state)
    const pending = retreatPending([{ unitId: a!.id, options: ['frontier'] }])
    const plan = retreatPlan(state, pending, new Set([a!.id, b!.id]), [
      { unitId: a!.id, slot: 'frontier' },
      { unitId: b!.id, slot: 'frontier' },
    ])
    expect(plan.flights).toEqual([{ unitId: a!.id, slot: 'frontier' }])
    expect(plan.retreats).toEqual([b!.id])
  })
})

describe('the retreat question', () => {
  it('names Air Flight when a flight is on offer, and only then', () => {
    const state = fresh()
    const plain = promptFor({ kind: 'retreat', player: 'p1' }, 'p1', state)
    expect(plain.question).toBe('Pull units back to reserve?')
    const flying = promptFor(
      { kind: 'retreat', player: 'p1', flights: [{ unitId: 'x', options: ['frontier'] }] },
      'p1',
      state,
    )
    expect(flying.question).toMatch(/Air Flight/)
  })
})
