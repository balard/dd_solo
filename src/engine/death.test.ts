/**
 * Rise from the Ashes' death trigger, and the guarantee that none of it runs under
 * `dua: 'inert'`.
 */
import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'

import { buryUnits, killAndBury, killUnits, RISE_FROM_THE_ASHES } from './death'
import { reduce } from './reduce'

import { rngFrom, rollDie, type RngState } from './rng'
import { LIVE_SAIS } from './sai'
import { setupGame, STARTER_FORCES } from './setup'
import {
  DUA_RULES,
  V0_RULES,
  buriedUnits,
  deadUnits,
  reserveArmy,
  type GameState,
  type Location,
  type LogEntry,
  type PlayerId,
  type RuleSet,
  type UnitInstance,
} from './types'
import { validateState } from './validate'

const PHOENIX = 'firewalkers.phoenix'
/** A 4-health Firewalker with no Rise face, for the "no SAI, no draw" case. */
const FIRESHADOW = 'firewalkers.fireshadow'

const frontier: Location = { kind: 'terrain', slot: 'frontier' }

interface Spec {
  readonly id: string
  readonly typeId: string
  readonly owner?: PlayerId
  readonly at: Location
}

function board(ruleSet: RuleSet, rng: RngState, ...specs: readonly Spec[]): GameState {
  const base = setupGame({
    seed: 1,
    forces: STARTER_FORCES,
    ruleSet,
    terrains: { frontier: 'highland_tower' },
  })

  const units: Record<string, UnitInstance> = {}
  for (const spec of specs) {
    units[spec.id] = {
      id: spec.id,
      typeId: spec.typeId,
      owner: spec.owner ?? 'p2',
      location: spec.at,
    }
  }
  return { ...base, units, rng }
}

/** The indices of a unit type's faces that would rescue it. */
const riseFaces = (typeId: string): readonly number[] =>
  unitType(typeId)
    .faces.map((face, index) => (face.icon === 'SAI' && face.sai === RISE_FROM_THE_ASHES ? index : -1))
    .filter((index) => index >= 0)

/**
 * A seed whose very first draw on this die lands where the test needs it.
 *
 * Searched rather than written down, so the test says "seeded onto a Rise face"
 * instead of "seed 12, trust me" -- and so it survives any future change to the
 * hash without needing a new magic number.
 */
function seedRolling(typeId: string, wanted: (faceIndex: number) => boolean): RngState {
  const faceCount = unitType(typeId).faces.length
  for (let seed = 1; seed < 1000; seed += 1) {
    const rng = rngFrom(seed)
    const [faceIndex] = rollDie(rng, faceCount)
    if (wanted(faceIndex)) return rng
  }
  throw new Error(`no seed in 1..1000 rolls the wanted face of ${typeId}`)
}

const rises = (typeId: string) => seedRolling(typeId, (i) => riseFaces(typeId).includes(i))
const staysDead = (typeId: string) => seedRolling(typeId, (i) => !riseFaces(typeId).includes(i))

describe('the data these tests lean on', () => {
  it('spells the SAI the same way sai.ts does', () => {
    // The one string shared across two files. A typo here would make the trigger
    // silently never fire, with every other test in this file still passing.
    expect(LIVE_SAIS).toContain(RISE_FROM_THE_ASHES)
  })

  it('puts two Rise faces on the Phoenix and none on the Fireshadow', () => {
    expect(riseFaces(PHOENIX)).toHaveLength(2)
    expect(unitType(PHOENIX).faces).toHaveLength(10)
    expect(riseFaces(FIRESHADOW)).toEqual([])
  })
})

describe('killUnits under dua: inert', () => {
  it('is applyDamage and nothing else -- no die is rolled', () => {
    // The guard on the golden corpus, stated as a test rather than left to the
    // twenty-five recorded games to notice: one extra draw here would shift
    // rng.counter and every die after it in all of them.
    const rng = rises(PHOENIX)
    const state = board(V0_RULES, rng, { id: 'phoenix', typeId: PHOENIX, at: frontier })

    const { state: after, risen } = killUnits(state, ['phoenix'])

    expect(risen).toEqual([])
    expect(after.rng).toEqual(rng)
    expect(deadUnits(after, 'p2').map((u) => u.id)).toEqual(['phoenix'])
  })
})

describe('killUnits under dua: active', () => {
  it('sends a Phoenix that rolls a Rise face to Reserves, not the DUA', () => {
    const rng = rises(PHOENIX)
    const state = board(DUA_RULES, rng, { id: 'phoenix', typeId: PHOENIX, at: frontier })

    const { state: after, risen } = killUnits(state, ['phoenix'])

    expect(risen).toEqual(['phoenix'])
    expect(reserveArmy(after, 'p2').map((u) => u.id)).toEqual(['phoenix'])
    expect(deadUnits(after, 'p2')).toEqual([])
    expect(after.rng.counter).toBe(rng.counter + 1)
    expect(validateState(after)).toEqual([])
  })

  it('leaves it dead on any other face -- the condition is a Rise face, not an ID', () => {
    // Face 0 of the Phoenix is its ID. Reading the trigger as "rolls an ID" would
    // pass a test that only ever checked the successful case.
    const rng = staysDead(PHOENIX)
    const state = board(DUA_RULES, rng, { id: 'phoenix', typeId: PHOENIX, at: frontier })

    const { state: after, risen } = killUnits(state, ['phoenix'])

    expect(risen).toEqual([])
    expect(deadUnits(after, 'p2').map((u) => u.id)).toEqual(['phoenix'])
    expect(after.rng.counter).toBe(rng.counter + 1)
  })

  it('rolls nothing for a unit that does not carry the SAI', () => {
    const rng = rises(PHOENIX)
    const state = board(DUA_RULES, rng, { id: 'shadow', typeId: FIRESHADOW, at: frontier })

    const { state: after, risen } = killUnits(state, ['shadow'])

    expect(risen).toEqual([])
    expect(after.rng).toEqual(rng)
  })

  it('rolls in board order, so naming the same units in another order changes nothing', () => {
    const rng = rises(PHOENIX)
    const state = board(
      DUA_RULES,
      rng,
      { id: 'phoenix_a', typeId: PHOENIX, at: frontier },
      { id: 'shadow', typeId: FIRESHADOW, at: frontier },
      { id: 'phoenix_b', typeId: PHOENIX, at: frontier },
    )

    const forward = killUnits(state, ['phoenix_a', 'shadow', 'phoenix_b'])
    const backward = killUnits(state, ['phoenix_b', 'shadow', 'phoenix_a'])

    // Two draws, not three: the Fireshadow never rolls.
    expect(forward.state.rng.counter).toBe(rng.counter + 2)
    expect(forward.state.units).toEqual(backward.state.units)
    expect(forward.risen).toEqual(backward.risen)
  })
})

describe('buryUnits', () => {
  it('gives the same roll on a burial, out of the DUA', () => {
    const rng = rises(PHOENIX)
    const state = board(DUA_RULES, rng, { id: 'phoenix', typeId: PHOENIX, at: { kind: 'dua' } })

    const { state: after, risen } = buryUnits(state, ['phoenix'])

    expect(risen).toEqual(['phoenix'])
    expect(reserveArmy(after, 'p2').map((u) => u.id)).toEqual(['phoenix'])
    expect(buriedUnits(after, 'p2')).toEqual([])
  })

  it('buries without a roll under dua: inert', () => {
    const rng = rises(PHOENIX)
    const state = board(V0_RULES, rng, { id: 'phoenix', typeId: PHOENIX, at: { kind: 'dua' } })

    const { state: after, risen } = buryUnits(state, ['phoenix'])

    expect(risen).toEqual([])
    expect(after.rng).toEqual(rng)
    expect(buriedUnits(after, 'p2').map((u) => u.id)).toEqual(['phoenix'])
  })

  it('refuses a unit that is still in play, because burial is DUA to BUA', () => {
    const rng = rises(PHOENIX)
    const state = board(DUA_RULES, rng, { id: 'phoenix', typeId: PHOENIX, at: frontier })

    expect(() => buryUnits(state, ['phoenix'])).toThrow(/still in play/)
  })
})

describe('killAndBury', () => {
  it('rescues on the first roll, and then there is no second', () => {
    // "If an effect both kills and buries this unit, it may roll once when killed
    // and again when buried. If the first roll is successful, the unit is not
    // buried."
    const rng = rises(PHOENIX)
    const state = board(DUA_RULES, rng, { id: 'phoenix', typeId: PHOENIX, at: frontier })

    const { state: after, risen } = killAndBury(state, ['phoenix'])

    expect(risen).toEqual(['phoenix'])
    expect(after.rng.counter).toBe(rng.counter + 1)
    expect(reserveArmy(after, 'p2').map((u) => u.id)).toEqual(['phoenix'])
    expect(buriedUnits(after, 'p2')).toEqual([])
  })

  it('rolls a second time when the kill did not rescue it', () => {
    // The whole reason this is two steps and not one move to the BUA: a single move
    // would silently cost the Phoenix one of its two chances.
    const rng = staysDead(PHOENIX)
    const state = board(DUA_RULES, rng, { id: 'phoenix', typeId: PHOENIX, at: frontier })

    const { state: after } = killAndBury(state, ['phoenix'])

    expect(after.rng.counter).toBe(rng.counter + 2)
  })

  it('takes a live unit all the way to the BUA under dua: active', () => {
    const rng = staysDead(FIRESHADOW)
    const state = board(DUA_RULES, rng, { id: 'shadow', typeId: FIRESHADOW, at: frontier })

    const { state: after, risen } = killAndBury(state, ['shadow'])

    expect(risen).toEqual([])
    expect(buriedUnits(after, 'p2').map((u) => u.id)).toEqual(['shadow'])
    // No Rise face, so neither step rolled anything.
    expect(after.rng).toEqual(rng)
    expect(validateState(after)).toEqual([])
  })

  it('under dua: inert is two plain moves and no roll at all', () => {
    const rng = rises(PHOENIX)
    const state = board(V0_RULES, rng, { id: 'phoenix', typeId: PHOENIX, at: frontier })

    const { state: after, risen } = killAndBury(state, ['phoenix'])

    expect(risen).toEqual([])
    expect(after.rng).toEqual(rng)
    expect(buriedUnits(after, 'p2').map((u) => u.id)).toEqual(['phoenix'])
  })
})


describe('the reducer', () => {
  /**
   * A state parked on the damage assignment of a melee attack, which is the one
   * place in the game that kills anything.
   */
  function awaitingDamage(rng: RngState): GameState {
    const state = board(
      DUA_RULES,
      rng,
      { id: 'phoenix', typeId: PHOENIX, owner: 'p2', at: frontier },
      { id: 'oak', typeId: 'treefolk.oak', owner: 'p1', at: frontier },
    )

    return {
      ...state,
      turn: {
        marching: 'p1',
        phase: 'march',
        marchIndex: 0,
        marchStep: 'assign_attack_damage',
        marchingArmy: 'frontier',
        armiesMarched: ['frontier'],
        combat: { action: 'melee', targetSlot: 'frontier', damage: 4 },
      },
      pending: { kind: 'assign_damage', player: 'p2', slot: 'frontier', damage: 4 },
    }
  }

  const entries = (state: GameState, kind: LogEntry['kind']) =>
    state.log.filter((entry) => entry.kind === kind)

  it('logs the kill and then the rise, and the unit ends in Reserves', () => {
    const after = reduce(awaitingDamage(rises(PHOENIX)), {
      kind: 'assign_damage',
      unitIds: ['phoenix'],
    })

    expect(entries(after, 'units_killed')).toEqual([
      { kind: 'units_killed', player: 'p2', slot: 'frontier', unitIds: ['phoenix'] },
    ])
    expect(entries(after, 'units_risen')).toEqual([
      { kind: 'units_risen', player: 'p2', unitIds: ['phoenix'] },
    ])
    expect(reserveArmy(after, 'p2').map((u) => u.id)).toEqual(['phoenix'])
    expect(validateState(after)).toEqual([])
  })

  it('writes no units_risen entry at all when nothing rises', () => {
    // Omitted rather than logged empty, for the same reason `CombatState`'s optional
    // fields are: every golden digest carries every log entry verbatim.
    const after = reduce(awaitingDamage(staysDead(PHOENIX)), {
      kind: 'assign_damage',
      unitIds: ['phoenix'],
    })

    expect(entries(after, 'units_risen')).toEqual([])
    expect(deadUnits(after, 'p2').map((u) => u.id)).toEqual(['phoenix'])
  })
})
