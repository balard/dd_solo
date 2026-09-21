/**
 * Phase 7a: the spell data, the magic pool, and the seam that replaces the v0 magic
 * house rule with an announcement.
 *
 * Nothing resolves yet -- every spell is transcribed and none is implemented -- so
 * what these pin is the *shape*: which spells exist and what they cost, that a pool
 * is one number plus a set of elements, that the announcement is validated as a
 * whole, and that `magic: 'simplified'` still plays exactly the v0 game.
 */
import { describe, expect, it } from 'vitest'

import { randomAi } from '../ai/random'
import { runGame } from '../ai/run'
import { SPELLS, spell, spellAcceptsElement, spellAllowsSpecies } from '../data/spells'

import { legalActions } from './combat'
import { armyRoll, pruneEffects, type Effect } from './effects'
import { castableSpells, castingElements, magicPool, magicRolled, type MagicPool } from './magic'
import { begin, reduce } from './reduce'
import { BESTIARY_FORCES, STARTER_FORCES, setupGame } from './setup'
import { resolvesSpell, spellEffect, type SpellContext } from './spells'
import {
  DRAGON_RULES,
  SPELL_RULES,
  V0_RULES,
  type GameState,
} from './types'

const pool = (over: Partial<MagicPool> = {}): MagicPool => ({
  points: 10,
  elements: ['water', 'earth'],
  ...over,
})

describe('the spell data', () => {
  it('holds exactly the eighteen spells these two species can cast', () => {
    expect(SPELLS).toHaveLength(18)
    // Four per element plus the two Elemental (full rules pp. 46-51). A nineteenth
    // entry means a spell belonging to a species outside this plan slipped in.
    for (const element of ['air', 'water', 'earth', 'fire'] as const) {
      expect(SPELLS.filter((s) => s.element === element)).toHaveLength(4)
    }
    expect(SPELLS.filter((s) => s.element === 'elemental')).toHaveLength(2)
  })

  it('records the two non-cumulative spells, which no extraction could tell us', () => {
    // The rulebook prints the combinable number in red and text extraction drops the
    // colour, so `cumulative` is transcribed by eye and is the field most likely to
    // be wrong. These two are the whole of the exception.
    const flat = SPELLS.filter((s) => !s.cumulative).map((s) => s.id).sort()
    expect(flat).toEqual(['accelerated_growth', 'lightning_strike'])
  })

  it('records the R and C columns', () => {
    expect(SPELLS.filter((s) => s.reserves).map((s) => s.id).sort()).toEqual([
      'accelerated_growth',
      'fiery_weapon',
      'flashfire',
      'path',
      'resurrect_dead',
      'stone_skin',
      'watery_double',
      'wind_walk',
    ])
    expect(SPELLS.filter((s) => s.cantrip).map((s) => s.id).sort()).toEqual([
      'accelerated_growth',
      'ash_storm',
      'flashfire',
      'hailstorm',
      'stone_skin',
      'watery_double',
    ])
  })

  it('gives every spell rules text, because both clients render it and nothing else does', () => {
    for (const s of SPELLS) expect(s.text.trim().length).toBeGreaterThan(20)
  })

  it('gives the four species spells to the two species in scope', () => {
    const byId = (id: string) => spell(id).species
    expect(byId('mirage')).toBe('firewalkers')
    expect(byId('flashfire')).toBe('firewalkers')
    expect(byId('accelerated_growth')).toBe('treefolk')
    expect(byId('wall_of_thorns')).toBe('treefolk')
    expect(SPELLS.filter((s) => s.species !== 'any')).toHaveLength(4)
  })

  it('lets an Elemental spell take any element and a single-element spell only its own', () => {
    expect(spellAcceptsElement(spell('summon_dragon'), 'fire')).toBe(true)
    expect(spellAcceptsElement(spell('summon_dragon'), 'water')).toBe(true)
    expect(spellAcceptsElement(spell('hailstorm'), 'air')).toBe(true)
    expect(spellAcceptsElement(spell('hailstorm'), 'water')).toBe(false)
  })

  it('lets a species spell through only for that species', () => {
    expect(spellAllowsSpecies(spell('mirage'), 'firewalkers')).toBe(true)
    expect(spellAllowsSpecies(spell('mirage'), 'treefolk')).toBe(false)
    expect(spellAllowsSpecies(spell('wind_walk'), 'treefolk')).toBe(true)
  })
})

describe('resolvesSpell', () => {
  it('is false for every spell under simplified magic, which is what keeps V0_RULES v0', () => {
    for (const s of SPELLS) expect(resolvesSpell(s.id, V0_RULES)).toBe(false)
  })

  // Every slice moves names out of this list; by 7f it is empty and the test inverts.
  // Naming them rather than counting means a spell that quietly stops resolving shows
  // up here instead of passing on a number that happens to match.
  it('resolves exactly the eight declarative spells, and nothing else yet', () => {
    const unbuilt = SPELLS.filter((s) => !resolvesSpell(s.id, SPELL_RULES)).map((s) => s.id).sort()
    expect(unbuilt).toEqual([
      'accelerated_growth',
      'flash_flood',
      'flashfire',
      'hailstorm',
      'lightning_strike',
      'mirage',
      'path',
      'resurrect_dead',
      'summon_dragon',
      'wall_of_thorns',
    ])
  })
})

describe('the magic pool', () => {
  it('is one number plus the elements it may be spent as', () => {
    const p = magicPool(gameAt('p1'), 'p1', 'p1_home', 7)
    expect(p.points).toBe(7)
    // Treefolk are water and earth. The whole army's total splits freely between
    // them, which is the rulebook's own rule and not a simplification of it.
    expect([...p.elements].sort()).toEqual(['earth', 'water'])
    expect(p.cantripOnly).toBeUndefined()
  })

  it('reads the caster species rather than a stored colour', () => {
    const state = gameAt('p1')
    expect([...castingElements(state, 'p2', 'p2_home')].sort()).toEqual(['air', 'fire'])
  })

  it('offers a Treefolk army no air spell, however much magic it rolls', () => {
    // The plan's headline test: "a Treefolk army cannot cast Hailstorm -- it generates
    // no Air magic". Treefolk are water and earth, so every air spell is filtered out
    // by element before species or cost is even consulted.
    const state = gameAt('p1')
    const castable = castableSpells(state, 'p1', magicPool(state, 'p1', 'p1_home', 99), SPELL_RULES)
    expect(castable.map((c) => c.spell.element)).not.toContain('air')
    // Water and earth only: the four declarative spells of those two elements.
    expect(castable.map((c) => c.spell.id).sort()).toEqual([
      'stone_skin',
      'transmute_rock_to_mud',
      'wall_of_fog',
      'watery_double',
    ])
  })

  it('says what it is in one sentence, for both clients', () => {
    expect(magicRolled(pool({ points: 7 }))).toBe('7 magic (water or earth)')
    expect(magicRolled(pool({ points: 0, elements: ['fire'] }))).toBe('0 magic (fire)')
    expect(magicRolled(pool({ elements: ['air', 'fire', 'water'] }))).toBe(
      '10 magic (air, fire or water)',
    )
    expect(magicRolled(pool({ cantripOnly: true }))).toBe(
      '10 magic (water or earth, cantrip spells only)',
    )
  })
})

describe('the magic action', () => {
  it('is offered with no enemy army present, unlike the v0 melee variant', () => {
    // v0 filters magic on "is there something to hit", because v0 magic *is* an
    // attack. Real magic mostly targets your own army, so that filter would refuse a
    // legal action at every terrain with nobody standing opposite.
    const state = magicBoard(SPELL_RULES)
    expect(legalActions(state, 'p1', 'frontier')).toContain('magic')
  })

  it('is not offered with no enemy present under the v0 house rule', () => {
    const state = magicBoard(DRAGON_RULES)
    expect(legalActions(state, 'p1', 'frontier')).toEqual([])
  })

  it('rolls, then asks for an announcement rather than dealing damage', () => {
    const { state } = firstMagicAction()
    expect(state.pending?.kind).toBe('announce_spells')

    const rolled = state.log.filter((e) => e.kind === 'magic_rolled')
    expect(rolled).toHaveLength(1)
    // The v0 line -- "N magic / 2 = D damage" -- must not appear.
    expect(state.log.some((e) => e.kind === 'combat_resolved' && e.action === 'magic')).toBe(false)
  })

  it('ends the march when nothing is announced, and leaves no magic state behind', () => {
    const { state } = firstMagicAction()
    const after = reduce(state, { kind: 'announce_spells', casts: [] })
    expect(after.turn.magic).toBeUndefined()
    // Omitted, not nulled: `digestState` renders `stableJson(state.turn)`.
    expect(Object.keys(after.turn)).not.toContain('magic')
  })

  it('refuses an announcement naming a spell this army cannot cast', () => {
    const { state } = firstMagicAction()
    expect(() =>
      reduce(state, {
        kind: 'announce_spells',
        casts: [{ spell: 'stone_skin', element: 'earth', count: 1, target: { kind: 'none' } }],
      }),
    ).toThrow(/not castable/)
  })
})

describe('the eight declarative spells', () => {
  it('turns a cumulative spell into one effect with its number multiplied', () => {
    // "Combine three castings of Wind Walk and the spell would add twelve results,
    // rather than four." One effect, not three -- which matters beyond tidiness: the
    // pipeline caps dividers and multipliers at one per result type, so three separate
    // effects would throw where one scaled effect does not.
    const effect = spellEffect(spell('wind_walk'), ctx({ count: 3 }))
    expect(effect.modifiers).toEqual([{ kind: 'add', resultType: 'maneuver', amount: 12 }])
  })

  it('leaves a non-cumulative spell alone however many times it is announced', () => {
    // Accelerated Growth and Lightning Strike are the only two, and neither is
    // declarative yet -- so this pins the rule on the flag rather than on a spell,
    // which is what stops it rotting when 7e adds the first one that uses it.
    const flat = { ...spell('wind_walk'), cumulative: false }
    expect(spellEffect(flat, ctx({ count: 3 }))).toEqual(
      expect.objectContaining({
        modifiers: [{ kind: 'add', resultType: 'maneuver', amount: 4 }],
      }),
    )
  })

  it('expands Ash Storm to every result type', () => {
    // "Subtract one result from all army rolls" -- untyped. Five rows in the data
    // would be five places to get it wrong, so `*` expands at cast time.
    const effect = spellEffect(spell('ash_storm'), ctx({ target: { kind: 'terrain', slot: 'frontier' } }))
    expect(effect.modifiers).toHaveLength(5)
    expect(effect.modifiers.map((m) => m.resultType).sort()).toEqual([
      'magic',
      'maneuver',
      'melee',
      'missile',
      'save',
    ])
    expect(effect.target).toEqual({ kind: 'terrain', slot: 'frontier', scope: 'all_armies' })
  })

  it('gives Fiery Weapon both halves of "melee or missile"', () => {
    // Every roll in the game counts one result type, so exactly one of these can ever
    // apply -- except a dragon combination roll, which is the house rule in
    // RULES-V0.md section 15.
    expect(spellEffect(spell('fiery_weapon'), ctx()).modifiers).toEqual([
      { kind: 'add', resultType: 'melee', amount: 2 },
      { kind: 'add', resultType: 'missile', amount: 2 },
    ])
  })
})

describe('where a spell effect reaches', () => {
  it('applies an army spell to that army at that place, and nowhere else', () => {
    const base = gameAt('p1')
    const state = withEffect(base, spellEffect(spell('stone_skin'), ctx({
      target: { kind: 'army', player: 'p1', army: 'p1_home' },
    })))

    expect(armyRoll(state, 'p1', 'p1_home', 'save').modifiers).toEqual([
      { kind: 'add', resultType: 'save', amount: 1 },
    ])
    // Not the same army somewhere else, and not the other player's army here.
    expect(armyRoll(state, 'p1', 'frontier', 'save').modifiers).toEqual([])
    expect(armyRoll(state, 'p2', 'p1_home', 'save').modifiers).toEqual([])
  })

  it('applies Ash Storm to both players at that terrain', () => {
    const state = withEffect(gameAt('p1'), spellEffect(spell('ash_storm'), ctx({
      target: { kind: 'terrain', slot: 'frontier' },
    })))

    for (const player of ['p1', 'p2'] as const) {
      expect(armyRoll(state, player, 'frontier', 'melee').modifiers).toContainEqual({
        kind: 'subtract',
        resultType: 'melee',
        amount: 1,
      })
    }
    expect(armyRoll(state, 'p1', 'p1_home', 'melee').modifiers).toEqual([])
  })

  it('applies Wall of Fog to the attacker, keyed by the terrain it wards', () => {
    // The one effect that reaches a roll made somewhere else: "subtract six missile
    // results from any missile attack targeting an army at that terrain".
    const state = withEffect(gameAt('p1'), spellEffect(spell('wall_of_fog'), ctx({
      target: { kind: 'terrain', slot: 'p2_home' },
    })))
    const ward = { kind: 'subtract', resultType: 'missile', amount: 6 }

    // Shooting *into* the warded terrain from elsewhere: warded.
    expect(armyRoll(state, 'p1', 'frontier', 'missile', 'p2_home').modifiers).toContainEqual(ward)
    // Shooting somewhere else: not.
    expect(armyRoll(state, 'p1', 'frontier', 'missile', 'p1_home').modifiers).toEqual([])
    // Standing *at* the warded terrain and rolling for yourself: not. It wards the
    // place against incoming fire, it does not weaken the army holding it.
    expect(armyRoll(state, 'p2', 'p2_home', 'missile').modifiers).toEqual([])
  })

  it('never prunes a terrain effect, because a terrain cannot empty', () => {
    const state = withEffect(gameAt('p1'), spellEffect(spell('ash_storm'), ctx({
      target: { kind: 'terrain', slot: 'frontier' },
    })))
    // Same object back, or `advance` never settles.
    expect(pruneEffects(state)).toBe(state)
  })
})

describe('the fuzz', () => {
  it('plays 200 SPELL_RULES games, casting every declarative spell at least once', () => {
    const cast = new Map<string, number>()
    let magicActions = 0
    let announcements = 0
    let stuck = 0

    // Both force sets, because the two species reach different spell lists: Treefolk
    // can never cast an air or fire spell and Firewalkers never a water or earth one,
    // so a one-sided fuzz could only ever fire half the table.
    for (const forces of [STARTER_FORCES, BESTIARY_FORCES]) {
      for (let seed = 1; seed <= 100; seed += 1) {
        const result = runGame({
          setup: { seed, forces, ruleSet: SPELL_RULES },
          players: { p1: randomAi, p2: randomAi },
          aiSeed: seed,
        })
        if (result.stoppedBecause === 'stuck') stuck += 1
        announcements += result.record.actions.filter((a) => a.kind === 'announce_spells').length
        for (const entry of result.state.log) {
          if (entry.kind === 'magic_rolled') magicActions += 1
          if (entry.kind === 'spell_cast') cast.set(entry.spell, (cast.get(entry.spell) ?? 0) + 1)
        }
      }
    }

    expect(stuck).toBe(0)
    expect(announcements).toBe(magicActions)

    // The counters are what make a clean run mean something: a fuzz over rules nothing
    // reached would be green and prove nothing. Every declarative spell fires.
    const declarative = SPELLS.filter((s) => s.effect !== undefined).map((s) => s.id)
    expect(declarative).toHaveLength(8)
    for (const id of declarative) expect(cast.get(id) ?? 0).toBeGreaterThan(0)

    // And nothing else does: an unbuilt spell is never offered, so it can never be
    // announced, so it can never reach resolution and throw.
    for (const id of cast.keys()) expect(declarative).toContain(id)
  })
})

// --- helpers -----------------------------------------------------------------

/** A `SpellContext` for the pure effect builder. */
function ctx(over: Partial<SpellContext> = {}): SpellContext {
  return {
    caster: 'p1',
    army: 'p1_home',
    element: 'earth',
    count: 1,
    target: { kind: 'army', player: 'p1', army: 'p1_home' },
    ...over,
  }
}

const withEffect = (state: GameState, effect: Effect): GameState => ({
  ...state,
  effects: [...state.effects, effect],
})

/** A started game under the spell rules, for the pure pool queries. */
function gameAt(_player: 'p1'): GameState {
  return begin(setupGame({ seed: 7, forces: STARTER_FORCES, ruleSet: SPELL_RULES }))
}

/** A board whose Frontier shows a magic face and holds only p1's army. */
function magicBoard(ruleSet: GameState['ruleSet']): GameState {
  const state = setupGame({
    seed: 3,
    forces: STARTER_FORCES,
    firstPlayer: 'p1',
    // Highland's faces 1-3 are magic, so face 1 is a magic face on any Highland die.
    terrains: { frontier: 'highland_tower' },
    ruleSet,
  })

  // Empty p2's Frontier army: the point is a magic action with nothing to hit.
  const units = { ...state.units }
  for (const unit of Object.values(units)) {
    if (unit.owner === 'p2' && unit.location.kind === 'terrain' && unit.location.slot === 'frontier') {
      units[unit.id] = { ...unit, location: { kind: 'reserve' } }
    }
  }

  return {
    ...state,
    units,
    terrains: { ...state.terrains, frontier: { ...state.terrains.frontier, face: 1 } },
  }
}

/**
 * Plays a `SPELL_RULES` game forward until a magic action has been rolled, and
 * returns the state paused on the announcement.
 */
function firstMagicAction(): { readonly state: GameState } {
  for (let seed = 1; seed <= 200; seed += 1) {
    let state = begin(setupGame({ seed, forces: STARTER_FORCES, ruleSet: SPELL_RULES }))

    for (let step = 0; step < 400 && state.pending !== null && state.winner === null; step += 1) {
      const pending = state.pending
      if (pending.kind === 'announce_spells') return { state }

      // Take magic whenever it is offered; otherwise answer passively so the game
      // moves on without resolving combat we do not care about.
      const action =
        pending.kind === 'choose_action' && pending.legal.includes('magic')
          ? ({ kind: 'choose_action', action: 'magic' } as const)
          : randomAi.decide(state, pending, { seed: step + 1, counter: 0 })[0]

      state = reduce(state, action)
    }
  }
  throw new Error('no seed reached a magic action in 200 tries')
}
