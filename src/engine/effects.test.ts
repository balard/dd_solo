/**
 * Effects with a duration: expiry, pruning, and what they do to a roll.
 *
 * Every effect here is hand-built, because **nothing in the game produces one yet**
 * -- Sleep and Galeforce both pick their target in the middle of an attack roll, and
 * that pause is Phase 4's. So these are the two shapes the rulebook describes, built
 * from their reference text and fed to the machinery that will receive them:
 *
 *   Galeforce  an army effect: "the target army subtracts four save and four
 *              maneuver results from all rolls" until the caster's next turn.
 *   Sleep      a unit effect: "the target unit is asleep and cannot be rolled or
 *              leave the terrain they currently occupy" until the caster's next turn.
 */
import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'

import { exchangeWithDua, type Exchange } from './dua'
import {
  armyRoll,
  doublesIds,
  expireEffects,
  isAsleep,
  pruneEffects,
  type Effect,
} from './effects'
import { applyModifiers, type Modifier } from './pipeline'
import { advance, reduce } from './reduce'
import { rngFrom } from './rng'
import { rollArmy } from './roll'
import { setupGame, STARTER_FORCES } from './setup'
import {
  DUA_RULES,
  IllegalActionError,
  armyAt,
  type GameState,
  type Location,
  type PlayerId,
  type UnitInstance,
} from './types'
import { validateState } from './validate'

const OAKLING = 'treefolk.oakling'
const OAK = 'treefolk.oak'
const OAK_LORD = 'treefolk.oak_lord'
const FIRESHADOW = 'firewalkers.fireshadow'

const home: Location = { kind: 'terrain', slot: 'p1_home' }
const dua: Location = { kind: 'dua' }

interface Spec {
  readonly id: string
  readonly typeId: string
  readonly owner?: PlayerId
  readonly at: Location
}

/** A real setup with its roster replaced, so terrains and turn state stay legal. */
function board(specs: readonly Spec[], effects: readonly Effect[] = []): GameState {
  const base = setupGame({
    seed: 1,
    forces: STARTER_FORCES,
    ruleSet: DUA_RULES,
    terrains: { frontier: 'highland_tower' },
  })

  const units: Record<string, UnitInstance> = {}
  for (const spec of specs) {
    units[spec.id] = { id: spec.id, typeId: spec.typeId, owner: spec.owner ?? 'p1', location: spec.at }
  }
  return { ...base, units, effects }
}

/** "Until the beginning of your next turn, the target army subtracts four save and
 *  four maneuver results from all rolls." */
const galeforce = (
  player: PlayerId,
  army: 'p1_home' | 'frontier' | 'p2_home' | 'reserve',
  caster: PlayerId,
): Effect => ({
  source: 'Galeforce',
  target: { kind: 'army', player, army },
  modifiers: [
    { kind: 'subtract', resultType: 'save', amount: 4 },
    { kind: 'subtract', resultType: 'maneuver', amount: 4 },
  ],
  expiresAtStartOfTurnOf: caster,
})

/** "The target unit is asleep and cannot be rolled or leave the terrain." */
const sleep = (unitId: string, caster: PlayerId): Effect => ({
  source: 'Sleep',
  target: { kind: 'unit', unitId },
  modifiers: [],
  asleep: true,
  expiresAtStartOfTurnOf: caster,
})

describe('expiry', () => {
  it('waits for the caster, so the effect lives through the opponent whole turn', () => {
    const state = board([{ id: 'a', typeId: OAK, at: home }], [galeforce('p2', 'frontier', 'p1')])

    // p2's turn begins: not the caster's, so nothing goes.
    const theirs = expireEffects({ ...state, turn: { ...state.turn, marching: 'p2' } })
    expect(theirs.effects).toHaveLength(1)

    // p1's does.
    const mine = expireEffects({ ...state, turn: { ...state.turn, marching: 'p1' } })
    expect(mine.effects).toEqual([])
    expect(mine.log.at(-1)).toEqual({ kind: 'effects_expired', player: 'p1', sources: ['Galeforce'] })
  })

  it('happens in the Effects Expire Phase of a real turn change', () => {
    // The turn ends when the Retreat Step is answered, and the next player's turn
    // opens on `effects_expire` -- so this is the whole rule on the path a game
    // actually takes, rather than a direct call to `expireEffects`.
    const start = board(
      [
        { id: 'a', typeId: OAK, at: home },
        { id: 'b', typeId: FIRESHADOW, owner: 'p2', at: { kind: 'terrain', slot: 'p2_home' } },
      ],
      [galeforce('p2', 'p2_home', 'p2')],
    )
    const atRetreat: GameState = {
      ...start,
      turn: { ...start.turn, marching: 'p1', phase: 'reserves_retreat' },
      pending: { kind: 'retreat', player: 'p1' },
    }

    const next = reduce(atRetreat, { kind: 'retreat', unitIds: [] })
    expect(next.turn.marching).toBe('p2')
    // p2 cast it, so p2's turn beginning is exactly when it ends.
    expect(next.effects).toEqual([])
    expect(next.log.some((entry) => entry.kind === 'effects_expired')).toBe(true)
  })

  it('returns the same object when there is nothing to drop', () => {
    // Not an optimisation: `advance` loops on `stepGame` until it returns the state it
    // was handed, so an unconditional copy in either of these never settles.
    const state = board([{ id: 'a', typeId: OAK, at: home }], [galeforce('p1', 'p1_home', 'p2')])
    const notTheCastersTurn: GameState = { ...state, turn: { ...state.turn, marching: 'p1' } }

    expect(expireEffects(notTheCastersTurn)).toBe(notTheCastersTurn)
    expect(pruneEffects(state)).toBe(state)
  })
})

describe('pruning', () => {
  it('drops an army effect once the army has no units left', () => {
    const state = board(
      [{ id: 'a', typeId: OAK, at: home }],
      [galeforce('p1', 'p1_home', 'p2'), galeforce('p1', 'frontier', 'p2')],
    )
    // Nothing of p1's stands at the Frontier, so that one is already dead.
    expect(pruneEffects(state).effects.map((e) => e.target)).toEqual([
      { kind: 'army', player: 'p1', army: 'p1_home' },
    ])
  })

  it('drops an effect on a unit that has been killed', () => {
    const state = board([{ id: 'a', typeId: OAK, at: dua }], [sleep('a', 'p2')])
    expect(pruneEffects(state).effects).toEqual([])
  })

  it('keeps an army effect when every unit was replaced in one exchange', () => {
    // "If all the units from the army are replaced with other units as a single
    // action, the army is still considered to be present." It needs no code --
    // `exchangeWithDua` resolves in one pass, so no state with the army empty is ever
    // observed -- which is exactly why it is asserted rather than assumed.
    const state = board(
      [
        { id: 'a', typeId: OAK, at: home },
        { id: 'b', typeId: OAK_LORD, at: dua },
      ],
      [galeforce('p1', 'p1_home', 'p2')],
    )
    const pairs: readonly Exchange[] = [{ unitId: 'a', partnerId: 'b' }]
    const after = pruneEffects(exchangeWithDua(state, pairs))

    expect(armyAt(after, 'p1', 'p1_home').map((u) => u.id)).toEqual(['b'])
    expect(after.effects).toHaveLength(1)
  })

  it('runs on the path every action takes', () => {
    // `stepGame` prunes beside `syncCaptures`, which is the rulebook's "checked at the
    // end of each action" -- `applyAction` never sets `pending`, so `advance` always
    // gets there.
    // Both sides need a unit, or the victory check fires first and `stepGame` never
    // reaches the prune -- which is the right order, and worth knowing.
    const state = board(
      [
        { id: 'a', typeId: OAK, at: home },
        { id: 'b', typeId: FIRESHADOW, owner: 'p2', at: { kind: 'terrain', slot: 'p2_home' } },
      ],
      [galeforce('p1', 'frontier', 'p2')],
    )
    expect(advance(state).effects).toEqual([])
  })

  it('follows a unit into another army rather than being dropped', () => {
    // "A unit effect follows the unit." Keyed on the unit id, so a retreat to Reserves
    // carries it along and the prune has nothing to say.
    const state = board(
      [
        { id: 'a', typeId: OAK, at: home },
        { id: 'b', typeId: OAKLING, at: home },
      ],
      [sleep('b', 'p2')],
    )
    const moved: GameState = {
      ...state,
      units: { ...state.units, a: { ...state.units['a']!, location: { kind: 'reserve' } } },
    }
    const withUnitEffect = { ...moved, effects: [sleep('a', 'p2')] }
    expect(pruneEffects(withUnitEffect).effects).toHaveLength(1)
    expect(isAsleep(withUnitEffect, 'a')).toBe(true)
  })

  it('leaves an army effect behind when the units walk out from under it', () => {
    // "An army effect is fixed to a location, not to the units." The die that retreats
    // escapes it; the Reserve Army is a different army and picks nothing up.
    const state = board(
      [
        { id: 'a', typeId: OAK, at: home },
        { id: 'b', typeId: OAKLING, at: { kind: 'reserve' } },
      ],
      [galeforce('p1', 'p1_home', 'p2')],
    )
    expect(armyRoll(state, 'p1', 'p1_home', 'save').modifiers).toHaveLength(2)
    expect(armyRoll(state, 'p1', 'reserve', 'save').modifiers).toEqual([])
  })
})

describe('modifiers on a roll', () => {
  const units = (): readonly UnitInstance[] => [
    { id: 'a', typeId: OAK, owner: 'p1', location: home },
    { id: 'b', typeId: OAKLING, owner: 'p1', location: home },
  ]

  it('gathers every effect on the army, and the eighth face beside them', () => {
    const state = board(
      [
        { id: 'a', typeId: OAK, at: home },
        { id: 'b', typeId: OAKLING, at: home },
      ],
      [galeforce('p1', 'p1_home', 'p2')],
    )
    const held: GameState = {
      ...state,
      terrains: {
        ...state.terrains,
        p1_home: { ...state.terrains['p1_home'], face: 8, capturedBy: 'p1' },
      },
    }

    expect(doublesIds(held, 'p1', 'p1_home')).toBe(true)
    const { modifiers } = armyRoll(held, 'p1', 'p1_home', 'save')
    // Two subtracts from Galeforce, and the eighth face's one multiplier.
    expect(modifiers.filter((m) => m.kind === 'subtract')).toHaveLength(2)
    expect(modifiers.filter((m) => m.kind === 'multiply')).toEqual([
      { kind: 'multiply', resultType: 'save', by: 2, share: 'id' },
    ])
  })

  it('stacks two castings, because only divide and multiply are capped', () => {
    const two: readonly Modifier[] = [
      { kind: 'subtract', resultType: 'save', amount: 4 },
      { kind: 'subtract', resultType: 'save', amount: 4 },
    ]
    expect(applyModifiers({ id: 0, normal: 10, sai: 0 }, 'save', two)).toBe(2)

    // The one-per-type rules are unchanged by any of this.
    const dividers: readonly Modifier[] = [
      { kind: 'divide', resultType: 'save', by: 2 },
      { kind: 'divide', resultType: 'save', by: 2 },
    ]
    expect(() => applyModifiers({ id: 0, normal: 10, sai: 0 }, 'save', dividers)).toThrow(
      /at most one per result type/,
    )
  })

  it('never takes a total below zero', () => {
    const big: readonly Modifier[] = [{ kind: 'subtract', resultType: 'save', amount: 4 }]
    const [roll] = rollArmy(units(), 'save', rngFrom(4), DUA_RULES, big)
    expect(roll.total).toBeGreaterThanOrEqual(0)
  })
})

describe('a sleeping unit', () => {
  const twoAtHome: readonly Spec[] = [
    { id: 'a', typeId: OAK, at: home },
    { id: 'b', typeId: OAKLING, at: home },
  ]

  it('is not in the army that rolls, and costs no randomness', () => {
    const awake = board(twoAtHome)
    const asleep = board(twoAtHome, [sleep('b', 'p2')])

    expect(armyRoll(awake, 'p1', 'p1_home', 'melee').units.map((u) => u.id)).toEqual(['a', 'b'])
    expect(armyRoll(asleep, 'p1', 'p1_home', 'melee').units.map((u) => u.id)).toEqual(['a'])

    const start = rngFrom(11)
    const [, afterAwake] = rollArmy(armyRoll(awake, 'p1', 'p1_home', 'melee').units, 'melee', start, DUA_RULES)
    const [, afterAsleep] = rollArmy(armyRoll(asleep, 'p1', 'p1_home', 'melee').units, 'melee', start, DUA_RULES)
    expect(afterAwake.counter - start.counter).toBe(2)
    expect(afterAsleep.counter - start.counter).toBe(1)
  })

  it('is still in its army for everything that is not a roll', () => {
    // "It cannot be rolled" -- it is not immune. The die is still there, still counts
    // towards the army being present, and still dies when the damage is assigned.
    const state = board(twoAtHome, [sleep('b', 'p2')])
    expect(armyAt(state, 'p1', 'p1_home').map((u) => u.id)).toEqual(['a', 'b'])

    const total = armyAt(state, 'p1', 'p1_home').reduce(
      (sum, u) => sum + unitType(u.typeId).health,
      0,
    )
    expect(total).toBe(3)

    const killed: GameState = {
      ...state,
      units: { ...state.units, b: { ...state.units['b']!, location: dua } },
    }
    expect(armyAt(killed, 'p1', 'p1_home').map((u) => u.id)).toEqual(['a'])
  })

  it('cannot be retreated', () => {
    const state = board(twoAtHome, [sleep('b', 'p2')])
    const atRetreat: GameState = {
      ...state,
      turn: { ...state.turn, marching: 'p1', phase: 'reserves_retreat' },
      pending: { kind: 'retreat', player: 'p1' },
    }

    expect(() => reduce(atRetreat, { kind: 'retreat', unitIds: ['b'] })).toThrow(IllegalActionError)
    // The awake one beside it still goes.
    expect(reduce(atRetreat, { kind: 'retreat', unitIds: ['a'] }).units['a']?.location).toEqual({
      kind: 'reserve',
    })
  })
})

describe('validateState', () => {
  it('complains about an effect that outlived its target', () => {
    const state = board([{ id: 'a', typeId: OAK, at: home }], [galeforce('p1', 'frontier', 'p2')])
    expect(validateState(state).join('\n')).toMatch(/outlived their target/)
  })

  it('complains about an effect naming a unit that does not exist', () => {
    const state = board([{ id: 'a', typeId: OAK, at: home }], [sleep('ghost', 'p2')])
    expect(validateState(state).join('\n')).toMatch(/names unit ghost/)
  })

  it('is quiet about a board with no effects at all, which is every game so far', () => {
    expect(validateState(board([{ id: 'a', typeId: OAK, at: home }]))).toEqual([])
  })
})
