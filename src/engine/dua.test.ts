/**
 * Promotion, recruitment, burial and the exchange underneath them.
 *
 * Every state here is hand-built rather than played out, because the point of each
 * case is a specific arrangement of units between an army and the DUA, and no
 * sequence of legal moves reaches most of them yet -- nothing in the game calls
 * `promote` until the City lands in Phase 5.
 */
import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'

import {
  bury,
  exchangeWithDua,
  promote,
  promotionMatching,
  promotionPartners,
  recruit,
  type Exchange,
} from './dua'
import { setupGame, STARTER_FORCES } from './setup'
import {
  DUA_RULES,
  armyAt,
  buriedUnits,
  deadUnits,
  livingUnits,
  reserveArmy,
  type GameState,
  type Location,
  type PlayerId,
  type UnitInstance,
} from './types'
import { validateState } from './validate'

/** The Treefolk heavy-melee ladder: 1, 2, 3, 4 health of one species. */
const OAKLING = 'treefolk.oakling'
const OAK = 'treefolk.oak'
const OAK_LORD = 'treefolk.oak_lord'
const DARKTREE = 'treefolk.darktree'
/** A 3-health Treefolk of a different class, to prove class is not a constraint. */
const NOBLE_WILLOW = 'treefolk.noble_willow'

interface Spec {
  readonly id: string
  readonly typeId: string
  readonly owner?: PlayerId
  readonly at: Location
}

const home: Location = { kind: 'terrain', slot: 'p1_home' }
const dua: Location = { kind: 'dua' }

/**
 * A real setup with its unit roster replaced wholesale, so the terrains and turn
 * state are legal and `validateState` has something to check against.
 */
function board(...specs: readonly Spec[]): GameState {
  const base = setupGame({
    seed: 1,
    forces: STARTER_FORCES,
    ruleSet: DUA_RULES,
    terrains: { frontier: 'highland_tower' },
  })

  const units: Record<string, UnitInstance> = {}
  for (const spec of specs) {
    units[spec.id] = {
      id: spec.id,
      typeId: spec.typeId,
      owner: spec.owner ?? 'p1',
      location: spec.at,
    }
  }
  return { ...base, units }
}

const whereIs = (state: GameState, id: string): Location => {
  const unit = state.units[id]
  if (unit === undefined) throw new Error(`no unit ${id}`)
  return unit.location
}

const idsIn = (units: readonly UnitInstance[]): readonly string[] => units.map((u) => u.id).sort()

describe('promotionPartners', () => {
  it('finds same-species units exactly one health larger, whatever their class', () => {
    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'lord', typeId: OAK_LORD, at: dua },
      { id: 'willow', typeId: NOBLE_WILLOW, at: dua },
      // Two health away, so not a partner: nothing gains two health at once.
      { id: 'darktree', typeId: DARKTREE, at: dua },
      // One health larger but on the board, not in the DUA.
      { id: 'live_lord', typeId: OAK_LORD, at: home },
    )

    expect(idsIn(promotionPartners(state, 'oak'))).toEqual(['lord', 'willow'])
  })

  it('finds nothing across species or across owners', () => {
    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'sentinel', typeId: 'firewalkers.sentinel', owner: 'p2', at: dua },
      { id: 'their_lord', typeId: OAK_LORD, owner: 'p2', at: dua },
    )

    expect(promotionPartners(state, 'oak')).toEqual([])
  })

  it('is empty for a unit that is itself dead or buried', () => {
    const state = board(
      { id: 'oak', typeId: OAK, at: dua },
      { id: 'buried', typeId: OAK, at: { kind: 'bua' } },
      { id: 'lord', typeId: OAK_LORD, at: dua },
    )

    expect(promotionPartners(state, 'oak')).toEqual([])
    expect(promotionPartners(state, 'buried')).toEqual([])
  })
})

describe('promote', () => {
  it('is a no-op with an empty DUA, and does not throw', () => {
    const state = board({ id: 'oak', typeId: OAK, at: home })

    expect(promotionMatching(state, 'p1', ['oak'])).toEqual([])
    expect(promote(state, [])).toBe(state)
  })

  it('exchanges places: each of the pair takes up where the other stood', () => {
    const state = board(

      { id: 'oak', typeId: OAK, at: home },
      { id: 'lord', typeId: OAK_LORD, at: dua },
    )

    const after = promote(state, [{ unitId: 'oak', partnerId: 'lord' }])

    expect(whereIs(after, 'lord')).toEqual(home)
    expect(whereIs(after, 'oak')).toEqual(dua)
    // Neither die changed into the other: promotion moves units, never types.
    expect(after.units['oak']?.typeId).toBe(OAK)
    expect(after.units['lord']?.typeId).toBe(OAK_LORD)
    expect(validateState(after)).toEqual([])
  })

  it('promotes as many as it can when partners run short, choosing before any swap', () => {
    // Three Oaks, two dead Oak Lords. The third must simply not promote -- and no
    // Oak demoted by this very exchange may be used as somebody else's partner.
    const state = board(
      { id: 'oak_a', typeId: OAK, at: home },
      { id: 'oak_b', typeId: OAK, at: home },
      { id: 'oak_c', typeId: OAK, at: home },
      { id: 'lord_a', typeId: OAK_LORD, at: dua },
      { id: 'lord_b', typeId: OAK_LORD, at: dua },
    )

    const pairs = promotionMatching(state, 'p1', ['oak_a', 'oak_b', 'oak_c'])
    expect(pairs).toHaveLength(2)
    expect(pairs.map((p) => p.partnerId).sort()).toEqual(['lord_a', 'lord_b'])

    const after = promote(state, pairs)
    expect(idsIn(armyAt(after, 'p1', 'p1_home'))).toEqual(['lord_a', 'lord_b', 'oak_c'])
    expect(idsIn(deadUnits(after, 'p1'))).toEqual(['oak_a', 'oak_b'])
    // The army is the same size it was: an exchange is not a reinforcement.
    expect(armyAt(after, 'p1', 'p1_home')).toHaveLength(3)
  })

  it('never lets one exchange supply the partner for another', () => {
    // An Oakling could promote into an Oak -- but the only Oak in the DUA is one

    // this very exchange is putting there, and exchanges resolve simultaneously.
    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'oakling', typeId: OAKLING, at: home },
      { id: 'lord', typeId: OAK_LORD, at: dua },
    )

    const pairs = promotionMatching(state, 'p1', ['oak', 'oakling'])
    expect(pairs).toEqual([{ unitId: 'oak', partnerId: 'lord' }])
    expect(whereIs(promote(state, pairs), 'oakling')).toEqual(home)
  })

  it('refuses a partner of the wrong species or the wrong health', () => {
    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'darktree', typeId: DARKTREE, at: dua },
      { id: 'sentinel', typeId: 'firewalkers.sentinel', at: dua },
    )

    expect(() => promote(state, [{ unitId: 'oak', partnerId: 'darktree' }])).toThrow(
      /exactly one health larger/,
    )
    expect(() => promote(state, [{ unitId: 'oak', partnerId: 'sentinel' }])).toThrow(
      /within one species/,
    )
  })
})

describe('exchangeWithDua', () => {
  it('leaves an army standing even when every unit in it is exchanged', () => {
    // "Even if all the units in the army are exchanged, at no time is the entire
    // army considered gone." The single pass is what makes this true; Phase 3's
    // army effects are what will depend on it.
    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'lord', typeId: OAK_LORD, at: dua },
    )

    const after = exchangeWithDua(state, [{ unitId: 'oak', partnerId: 'lord' }])
    expect(armyAt(after, 'p1', 'p1_home')).toHaveLength(1)
  })

  it('is order-independent, because every location is read off the original state', () => {
    const state = board(
      { id: 'oak_a', typeId: OAK, at: home },
      { id: 'oak_b', typeId: OAK, at: { kind: 'terrain', slot: 'frontier' } },
      { id: 'lord_a', typeId: OAK_LORD, at: dua },
      { id: 'lord_b', typeId: OAK_LORD, at: dua },
    )

    const pairs: readonly Exchange[] = [
      { unitId: 'oak_a', partnerId: 'lord_a' },
      { unitId: 'oak_b', partnerId: 'lord_b' },
    ]
    expect(exchangeWithDua(state, pairs).units).toEqual(
      exchangeWithDua(state, [...pairs].reverse()).units,
    )
  })

  it('never kills anything: no log entry written, and no die rolled', () => {

    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'lord', typeId: OAK_LORD, at: dua },
    )

    const after = exchangeWithDua(state, [{ unitId: 'oak', partnerId: 'lord' }])
    expect(after.log).toEqual(state.log)
    expect(after.rng).toEqual(state.rng)
  })

  it('refuses a unit named twice, a partner outside the DUA, and a cross-owner pair', () => {
    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'lord_a', typeId: OAK_LORD, at: dua },
      { id: 'lord_b', typeId: OAK_LORD, at: dua },
      { id: 'live_lord', typeId: OAK_LORD, at: home },
      { id: 'their_lord', typeId: OAK_LORD, owner: 'p2', at: dua },
    )

    expect(() =>
      exchangeWithDua(state, [
        { unitId: 'oak', partnerId: 'lord_a' },
        { unitId: 'oak', partnerId: 'lord_b' },
      ]),
    ).toThrow(/appears in two exchanges/)
    expect(() => exchangeWithDua(state, [{ unitId: 'oak', partnerId: 'live_lord' }])).toThrow(
      /not in the DUA/,
    )
    expect(() => exchangeWithDua(state, [{ unitId: 'oak', partnerId: 'their_lord' }])).toThrow(
      /different owners/,
    )
  })
})

describe('recruit', () => {
  it('moves a one-health unit out of the DUA and puts nothing back', () => {
    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'oakling', typeId: OAKLING, at: dua },
    )

    const after = recruit(state, ['oakling'], 'p1_home')
    expect(idsIn(armyAt(after, 'p1', 'p1_home'))).toEqual(['oak', 'oakling'])
    expect(deadUnits(after, 'p1')).toEqual([])
    expect(validateState(after)).toEqual([])
  })

  it('refuses anything larger than one health, and anything not in the DUA', () => {
    const state = board(
      { id: 'oak', typeId: OAK, at: dua },
      { id: 'oakling', typeId: OAKLING, at: home },
    )

    expect(() => recruit(state, ['oak'], 'p1_home')).toThrow(/only small units/)
    expect(() => recruit(state, ['oakling'], 'p1_home')).toThrow(/not in the DUA/)
  })
})

describe('bury', () => {
  it('takes units out of the DUA, and there is no way back', () => {
    const state = board(
      { id: 'oakling', typeId: OAKLING, at: dua },
      { id: 'lord', typeId: OAK_LORD, at: dua },
    )

    const after = bury(state, ['oakling'])

    expect(idsIn(buriedUnits(after, 'p1'))).toEqual(['oakling'])
    // Gone from the DUA, so nothing can promote into it or recruit it.
    expect(idsIn(deadUnits(after, 'p1'))).toEqual(['lord'])
    expect(promotionPartners(after, 'oakling')).toEqual([])
    expect(() => recruit(after, ['oakling'], 'p1_home')).toThrow(/not in the DUA/)
    expect(() => bury(after, ['oakling'])).toThrow(/already buried/)
    expect(validateState(after)).toEqual([])
  })

  it('refuses a unit that is still in play: burial is DUA to BUA', () => {
    // Everything passes through the DUA on its way to the BUA -- the Dragonkin
    // exception only needs stating because of it. Short-cutting a live unit straight
    // into the BUA would cost a Phoenix one of its two Rise rolls, and nothing but a
    // probability would show it. `killAndBury` is the door for kill-and-bury effects.
    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'reserved', typeId: OAKLING, at: { kind: 'reserve' } },
    )

    expect(() => bury(state, ['oak'])).toThrow(/still in play \(terrain\)/)
    expect(() => bury(state, ['reserved'])).toThrow(/still in play \(reserve\)/)
  })

  it('excludes buried units from livingUnits, so a routed player still loses', () => {
    // The trap this phase was most likely to ship: `livingUnits` used to be
    // `location.kind !== 'dua'`, which would have counted every buried die as alive.
    const state = board(
      { id: 'oak', typeId: OAK, at: dua },
      { id: 'oakling', typeId: OAKLING, at: dua },
    )

    const after = bury(state, ['oak'])
    expect(livingUnits(after, 'p1')).toEqual([])
    expect(reserveArmy(after, 'p1')).toEqual([])
  })

})

describe('validateState', () => {
  it('catches a force that has picked up a die of another species', () => {
    const state = board(
      { id: 'oak', typeId: OAK, at: home },
      { id: 'sentinel', typeId: 'firewalkers.sentinel', at: dua },
    )

    expect(validateState(state).join('\n')).toMatch(/fields more than one species/)
  })
})

describe('the health ladder these tests lean on', () => {
  it('is 1, 2, 3, 4 within one species and one class', () => {
    // If the data ever changed underneath, every promotion case above would still
    // pass while testing nothing.
    expect([OAKLING, OAK, OAK_LORD, DARKTREE].map((id) => unitType(id).health)).toEqual([1, 2, 3, 4])
    expect(unitType(NOBLE_WILLOW).health).toBe(3)
    expect(unitType(NOBLE_WILLOW).unitClass).not.toBe(unitType(OAK_LORD).unitClass)
  })
})
