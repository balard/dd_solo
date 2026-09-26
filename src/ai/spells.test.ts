import { describe, expect, it } from 'vitest'

import { SPELLS } from '../data/spells'
import { castableSpells, magicPool } from '../engine/magic'
import { rngFrom } from '../engine/rng'
import { setupGame, STARTER_FORCES } from '../engine/setup'
import {
  SPECIES_RULES,
  type ArmyRef,
  type GameState,
  type Location,
  type Pending,
  type PlayerId,
  type TerrainSlot,
  type UnitInstance,
} from '../engine/types'

import { greedyAi } from './greedy'
import { chooseAnnouncement, SCORED_HANDLERS } from './spells'

const at = (slot: TerrainSlot): Location => ({ kind: 'terrain', slot })

interface Spec {
  readonly id: string
  readonly typeId: string
  readonly owner?: PlayerId
  readonly at: Location
}

/** A real `SPECIES_RULES` setup -- dragons in both pools -- with its roster replaced. */
function board(specs: readonly Spec[]): GameState {
  const base = setupGame({
    seed: 3,
    forces: STARTER_FORCES,
    ruleSet: SPECIES_RULES,
    terrains: { p1_home: 'swampland_tower', frontier: 'swampland_tower', p2_home: 'swampland_tower' },
  })
  const units: Record<string, UnitInstance> = {}
  for (const spec of specs) {
    units[spec.id] = { id: spec.id, typeId: spec.typeId, owner: spec.owner ?? 'p1', location: spec.at }
  }
  return { ...base, units, effects: [] }
}

/** What greedy announces from `ref` with `points` magic, through the real pending. */
function announce(state: GameState, player: PlayerId, ref: ArmyRef, points: number) {
  const pool = magicPool(state, player, ref, points)
  const castable = castableSpells(state, player, pool, state.ruleSet)
  const pending: Pending = { kind: 'announce_spells', player, slot: ref, pool, castable }
  const [action] = greedyAi.decide(state, pending, rngFrom(1))
  if (action.kind !== 'announce_spells') throw new Error(`expected an announcement, got ${action.kind}`)
  return { casts: action.casts, castable, pool }
}

describe('the spell scorer', () => {
  it('can score every spell in the data: an effect block, or a handler it knows', () => {
    // `resolvesSpell`'s guard, mirrored. A spell greedy cannot score is a spell it
    // silently never casts, and a new one arriving in `data/` should fail here.
    for (const s of SPELLS) {
      if (s.handler !== undefined) {
        expect(SCORED_HANDLERS, s.id).toContain(s.handler)
      } else {
        expect(s.effect, `${s.id} has neither an effect nor a handler`).toBeDefined()
        const scored = (s.effect?.modifiers ?? []).some((m) => m.kind === 'add' || m.kind === 'subtract')
        expect(scored, `${s.id}'s effect has no add or subtract to weigh`).toBe(true)
      }
    }
  })

  it('buffs its own army facing the enemy, not the enemy', () => {
    // Treefolk casting from home; their army at the Frontier faces Firewalkers and has
    // not marched yet this turn.
    const state = board([
      { id: 'caster', typeId: 'treefolk.eldar_dryad', at: at('p1_home') },
      { id: 'f1', typeId: 'treefolk.oak', at: at('frontier') },
      { id: 'f2', typeId: 'treefolk.oak', at: at('frontier') },
      { id: 'e1', typeId: 'firewalkers.watcher', owner: 'p2', at: at('frontier') },
      { id: 'e2', typeId: 'firewalkers.watcher', owner: 'p2', at: at('frontier') },
    ])
    const { casts } = announce(state, 'p1', 'p1_home', 6)
    expect(casts.length).toBeGreaterThan(0)
    const buffs = casts.filter((c) => c.target.kind === 'army' && c.target.player === 'p1')
    expect(buffs.some((c) => c.target.kind === 'army' && c.target.army === 'frontier')).toBe(true)
  })

  it('strikes the enemy monster with Lightning Strike, never its own die', () => {
    // An air spell, so a Firewalker casts it -- the first draft of this test gave it to
    // a Treefolk, whose water and earth can never pay for it.
    const state = board([
      { id: 'caster', typeId: 'firewalkers.ashbringer', at: at('p1_home') },
      { id: 'e', typeId: 'treefolk.darktree', owner: 'p2', at: at('p2_home') },
    ])
    const { casts } = announce(state, 'p1', 'p1_home', 6)
    const strike = casts.find((c) => c.spell === 'lightning_strike')
    expect(strike?.target).toEqual({ kind: 'units', unitIds: ['e'] })
  })

  it('summons a dragon onto an enemy army standing where none of ours does', () => {
    const state = board([
      { id: 'caster', typeId: 'treefolk.eldar_dryad', at: at('p1_home') },
      { id: 'e1', typeId: 'firewalkers.salamander', owner: 'p2', at: at('p2_home') },
      { id: 'e2', typeId: 'firewalkers.watcher', owner: 'p2', at: at('p2_home') },
    ])
    const { casts, castable } = announce(state, 'p1', 'p1_home', 7)
    // Only meaningful if some dragon of a colour this pool pays for is in a pool.
    expect(castable.some((c) => c.spell.id === 'summon_dragon')).toBe(true)
    expect(casts).toContainEqual(
      expect.objectContaining({ spell: 'summon_dragon', target: { kind: 'terrain', slot: 'p2_home' } }),
    )
  })

  it('never summons onto its own army, where the dragon would attack it', () => {
    const state = board([
      { id: 'caster', typeId: 'treefolk.eldar_dryad', at: at('p1_home') },
      { id: 'mine', typeId: 'treefolk.oak', at: at('p2_home') },
      { id: 'e1', typeId: 'firewalkers.salamander', owner: 'p2', at: at('p2_home') },
    ])
    const { casts } = announce(state, 'p1', 'p1_home', 7)
    expect(casts.some((c) => c.spell === 'summon_dragon')).toBe(false)
  })

  it('announces nothing when nothing is worth casting', () => {
    // Alone on the board: no enemy to hit, nobody to shield against.
    const state = board([
      { id: 'caster', typeId: 'treefolk.eldar_dryad', at: at('p1_home') },
      { id: 'e', typeId: 'firewalkers.guardian', owner: 'p2', at: { kind: 'dua' } },
    ])
    const pool = magicPool(state, 'p1', 'p1_home', 2)
    const castable = castableSpells(state, 'p1', pool, state.ruleSet)
    expect(chooseAnnouncement(state, 'p1', 'p1_home', castable, pool).casts).toEqual([])
  })

  it('never spends more than the pool, over many boards', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = setupGame({ seed, forces: { kind: 'random' }, ruleSet: SPECIES_RULES })
      for (const player of ['p1', 'p2'] as const) {
        for (const points of [2, 5, 9, 14]) {
          const { casts, castable } = announce(state, player, 'frontier', points)
          const spent = casts.reduce(
            (total, c) => total + (castable.find((o) => o.spell.id === c.spell)?.spell.cost ?? Infinity) * c.count,
            0,
          )
          expect(spent, `seed ${seed} ${player} ${points}`).toBeLessThanOrEqual(points)
        }
      }
    }
  })
})

describe('Dispel Magic', () => {
  const state = board([{ id: 'u', typeId: 'treefolk.unicorn', at: at('frontier') }])
  const pending: Pending = { kind: 'dispel_magic', player: 'p1', unitId: 'u', spells: ['Stone Skin'], remaining: 1 }

  it("rolls against the opponent's announcement", () => {
    const theirs = { ...state, turn: { ...state.turn, marching: 'p2' as const } }
    expect(greedyAi.decide(theirs, pending, rngFrom(1))[0]).toEqual({ kind: 'dispel_magic', roll: true })
  })

  it('never against its own', () => {
    const mine = { ...state, turn: { ...state.turn, marching: 'p1' as const } }
    expect(greedyAi.decide(mine, pending, rngFrom(1))[0]).toEqual({ kind: 'dispel_magic', roll: false })
  })
})
