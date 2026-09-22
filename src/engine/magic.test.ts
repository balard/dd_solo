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
import { UNIT_TYPES, unitType } from '../data/load'
import type { Element } from '../data/types'
import { SPELLS, spell, spellAcceptsElement, spellAllowsSpecies } from '../data/spells'

import { legalActions, resolveAttack, type AttackSpec } from './combat'
import { saiEffects, type RollContext } from './sai'
import type { DieRoll } from './roll'
import { marchableArmies } from './turn'
import { armyRoll, flashfireBudget, pruneEffects, thornsAt, type Effect } from './effects'
import { deathEntries, killUnits, killedIds } from './death'
import {
  announcementProblem,
  castableSpells,
  dispelCandidates,
  dispelNegates,
  castingElements,
  magicPool,
  magicRolled,
  type MagicPool,
} from './magic'
import { advance, begin, reduce } from './reduce'
import { BESTIARY_FORCES, STARTER_FORCES, setupGame } from './setup'
import { castSpell, resolvesSpell, spellEffect, summonable, type SpellContext } from './spells'
import { rollOnTheTable } from './turn'
import {
  armyAt,
  army as armyRef,
  deadUnits,
  DRAGON_RULES,
  SPELL_RULES,
  V0_RULES,
  type DragonInPlay,
  type AnnouncedSpell,
  type ArmyRef,
  type GameState,
  type Pending,
  type PlayerId,
  type SpellTarget,
  type TerrainSlot,
} from './types'

/** What an SAI that does nothing at all returns. */
const NOTHING_AT_ALL = { results: {}, effects: [], reroll: false }

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
  // The assertion 7a wrote down, finally inverted: every spell in the book resolves.
  // It stays as a guard -- a spell added to `data/` with no code behind it fails here
  // rather than being quietly uncastable.
  it('resolves all eighteen', () => {
    const unbuilt = SPELLS.filter((s) => !resolvesSpell(s.id, SPELL_RULES)).map((s) => s.id)
    expect(unbuilt).toEqual([])
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
    // Water and earth only, plus Summon Dragon -- an Elemental spell any element may
    // pay for, and the pools are full even though nothing is seeded on the board.
    // Resurrect Dead is absent for the opposite reason: the DUA is empty at setup, and
    // a spell with no target is not offered.
    // Lightning Strike is absent for the same reason Hailstorm is: both are air.
    expect(castable.map((c) => c.spell.id).sort()).toEqual([
      'flash_flood',
      'path',
      'stone_skin',
      'summon_dragon',
      'transmute_rock_to_mud',
      'wall_of_fog',
      'wall_of_thorns',
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

describe('the board spells', () => {
  it('prices a Resurrect Dead target by its health, on the offer rather than in a rule', () => {
    // "Target one health-worth of units in your DUA", multiplied by the castings -- so
    // a 2-health unit needs two castings and six magic. The number rides on the offer
    // so that no client can show a target the engine will then refuse; the fuzz found
    // that within a hundred games when it did not.
    const state = withDua(gameAt('p1'), 'p1', 1, 2)
    const pool = magicPool(state, 'p1', 'p1_home', 99)
    const offer = castableSpells(state, 'p1', pool, SPELL_RULES).find(
      (c) => c.spell.id === 'resurrect_dead',
    )

    expect(offer).toBeDefined()
    const priced = offer!.targets.map((t) => t.minCount).sort()
    // One dead unit of each health the fixture buried.
    expect(priced).toEqual([1, 2])
  })

  it('drops a Resurrect Dead target the pool could never afford', () => {
    // Three magic buys one casting, so only a 1-health unit is reachable. A target
    // that cannot be paid for is not a target, the same rule that drops a targeting
    // SAI whose army holds nothing small enough.
    const state = withDua(gameAt('p1'), 'p1', 1, 2)
    const offer = castableSpells(
      state,
      'p1',
      magicPool(state, 'p1', 'p1_home', 3),
      SPELL_RULES,
    ).find((c) => c.spell.id === 'resurrect_dead')

    expect(offer!.targets.map((t) => t.minCount)).toEqual([1])
  })

  it('will not resurrect with an element the caster\'s species does not carry', () => {
    // "...units in your DUA that contains the element of magic used to cast this
    // spell." Treefolk are water and earth, so a Standing Stones lending them fire
    // lends them nothing they can raise their dead with.
    const state = withDua(gameAt('p1'), 'p1', 1)
    const lent = castableSpells(
      state,
      'p1',
      { points: 99, elements: ['water', 'earth', 'fire'] },
      SPELL_RULES,
    ).find((c) => c.spell.id === 'resurrect_dead')

    expect([...lent!.elements].sort()).toEqual(['earth', 'water'])
  })

  it('asks nobody about a Hailstorm too small to kill anything', () => {
    // One point of damage against an army whose smallest die is bigger is dropped, not
    // asked about -- §6's rule, reached by a spell for the first time.
    const state = gameAt('p1')
    const big = onlyBigUnits(state, 'p2', 'frontier')
    const outcome = castSpell(big, spell('hailstorm'), {
      caster: 'p1',
      army: 'p1_home',
      element: 'air',
      count: 1,
      target: { kind: 'army', player: 'p2', army: 'frontier' },
    })

    expect(outcome.choice).toBeUndefined()
  })

  it('asks the defender who dies when a Hailstorm gets past their saves', () => {
    // Enough castings that no save roll this army can make will stop all of it.
    const state = gameAt('p1')
    const outcome = castSpell(state, spell('hailstorm'), {
      caster: 'p1',
      army: 'p1_home',
      element: 'air',
      count: 40,
      target: { kind: 'army', player: 'p2', army: 'frontier' },
    })

    const saved = outcome.state.log.find((e) => e.kind === 'spell_saves')
    expect(saved).toBeDefined()

    // The victim chooses, not the caster -- it is the ordinary damage decision -- and
    // the number is what their own save roll left of it.
    expect(outcome.choice?.kind).toBe('damage')
    const choice = outcome.choice?.kind === 'damage' ? outcome.choice : null
    expect(choice?.player).toBe('p2')
    expect(choice?.army).toBe('frontier')
    expect(choice?.damage).toBe(40 - (saved?.kind === 'spell_saves' ? saved.saves : 0))
  })

  it('lets the target save against a Hailstorm, because every spell allows that', () => {
    /*
     * "When a unit takes damage it is permitted to make a save roll unless an effect
     * states otherwise", and "attacks or spells that target an army allow the entire
     * army to make a save roll" (p. 29). Hailstorm's own sentence states nothing
     * otherwise -- and this shipped in 7c without it, making a Hailstorm the only
     * damage in the game no save could touch.
     */
    const state = gameAt('p1')
    const outcome = castSpell(state, spell('hailstorm'), {
      caster: 'p1',
      army: 'p1_home',
      element: 'air',
      count: 4,
      target: { kind: 'army', player: 'p2', army: 'frontier' },
    })

    // The roll happened, it consumed randomness, and it is in the log even though it
    // may well have stopped the spell dead.
    const entry = outcome.state.log.find((e) => e.kind === 'spell_saves')
    expect(entry?.kind === 'spell_saves' ? entry.player : null).toBe('p2')
    expect(outcome.state.rng).not.toEqual(state.rng)

    // Saves that cover it leave nothing to assign; anything left is asked about.
    const saves = entry?.kind === 'spell_saves' ? entry.saves : 0
    if (saves >= 4) expect(outcome.choice).toBeUndefined()
    else expect(outcome.choice?.kind).toBe('damage')
  })

  it("adds a Stone Skin to the save roll a Hailstorm's target makes", () => {
    // It is an *army* roll, so everything sitting on that army reaches it. That is
    // what `armyRoll` is for, and the reason the roll is not a bespoke one.
    const state = gameAt('p1')
    const shielded: GameState = {
      ...state,
      effects: [
        ...state.effects,
        spellEffect(spell('stone_skin'), {
          caster: 'p2',
          army: 'frontier',
          element: 'earth',
          count: 3,
          target: { kind: 'army', player: 'p2', army: 'frontier' },
        }),
      ],
    }

    const savesIn = (s: GameState): number => {
      const outcome = castSpell(s, spell('hailstorm'), {
        caster: 'p1',
        army: 'p1_home',
        element: 'air',
        count: 4,
        target: { kind: 'army', player: 'p2', army: 'frontier' },
      })
      const entry = outcome.state.log.find((e) => e.kind === 'spell_saves')
      return entry?.kind === 'spell_saves' ? entry.saves : -1
    }

    // Same seed, same dice, three more saves: the only difference is the effect.
    expect(savesIn(shielded)).toBe(savesIn(state) + 3)
  })

  it('offers Path every terrain but the one the unit is standing on', () => {
    const state = gameAt('p1')
    const mover = armyAt(state, 'p1', 'p1_home')[0]!
    const outcome = castSpell(state, spell('path'), {
      caster: 'p1',
      army: 'p1_home',
      element: 'earth',
      count: 1,
      target: { kind: 'units', unitIds: [mover.id] },
    })

    expect(outcome.choice?.kind).toBe('move')
    const options = outcome.choice?.kind === 'move' ? outcome.choice.options : []
    expect(options).not.toContain('p1_home')
    // "Any other terrain where you have an army" -- so only terrains you hold.
    for (const slot of options) expect(armyAt(state, 'p1', slot).length).toBeGreaterThan(0)
  })

  it('lets Summon Dragon reach any pool and any other terrain, of that element only', () => {
    const state = withDragons(gameAt('p1'), {
      mine: { dieId: 'water_drake', owner: 'p1', at: 'pool' },
      theirs: { dieId: 'water_wyrm', owner: 'p2', at: 'pool' },
      elsewhere: { dieId: 'water_drake', owner: 'p1', at: 'p2_home' },
      wrong: { dieId: 'fire_drake', owner: 'p2', at: 'pool' },
      already: { dieId: 'water_wyrm', owner: 'p1', at: 'frontier' },
    })

    // Any Summoning Pool, the opponent's included, and any *other* terrain.
    expect([...summonable(state, 'water', 'frontier')].sort()).toEqual([
      'elsewhere',
      'mine',
      'theirs',
    ])
    // Not an element the magic did not pay for.
    expect(summonable(state, 'fire', 'frontier')).toEqual(['wrong'])
  })
})

describe('a target that is gone by the time the spell resolves', () => {
  /**
   * "If for any reason the announced target of a spell is no longer present, then you
   * may not select a new target" (p. 13). So it is **dropped**, not re-aimed and not
   * thrown on -- the same shape as damage too small to kill anything.
   *
   * First reachable in 7c, because Hailstorm is the first spell that can empty the
   * army a later cast in the same announcement named.
   */
  it('fizzles rather than throwing', () => {
    const base = gameAt('p1')
    const emptied = evacuate(base, 'p2', 'frontier')

    const state = advance({
      ...emptied,
      // `advance` returns at once on a non-null pending, so the board has to be
      // handed over mid-march with nothing outstanding.
      pending: null,
      turn: {
        ...emptied.turn,
        phase: 'march',
        marchStep: 'resolve_spell',
        marchingArmy: 'p1_home',
        magic: {
          army: 'p1_home',
          pool: { points: 6, elements: ['water', 'earth'] },
          announced: [
            {
              spell: 'stone_skin',
              element: 'earth',
              count: 1,
              target: { kind: 'army', player: 'p2', army: 'frontier' },
            },
          ],
        },
      },
    })

    expect(state.log.some((e) => e.kind === 'spell_fizzled' && e.spell === 'stone_skin')).toBe(true)
    // Nothing was cast on the vanished army, and nothing was cast anywhere else either.
    expect(state.effects).toEqual([])
  })
})

describe('the sub-roll spells', () => {
  it('sends a Mirage failure to Reserves without killing it', () => {
    // Seize's shape: an escapee is not killed, so nothing goes to the DUA and no death
    // trigger fires. Rolled with a seed that fails the save.
    const base = gameAt('p1')
    const victim = armyAt(base, 'p2', 'frontier')[0]!
    const out = cast(base, 'mirage', {
      element: 'air',
      target: { kind: 'units', unitIds: [victim.id] },
    })

    const moved = out.state.units[victim.id]!
    expect(['reserve', 'terrain']).toContain(moved.location.kind)
    // Whatever the die did, it is never dead: Mirage moves, it does not kill.
    expect(moved.location.kind).not.toBe('dua')
    expect(out.state.log.some((e) => e.kind === 'units_killed')).toBe(false)
    expect(out.state.log.some((e) => e.kind === 'sai_sub_roll' && e.source === 'Mirage')).toBe(true)
  })

  it('kills what a Lightning Strike beats, through the death trigger', () => {
    const base = gameAt('p1')
    const victim = armyAt(base, 'p2', 'frontier')[0]!
    const out = cast(base, 'lightning_strike', {
      element: 'air',
      target: { kind: 'units', unitIds: [victim.id] },
    })

    const after = out.state.units[victim.id]!
    // A kill, not a move: it goes to the DUA, or it saved and stayed.
    expect(['dua', 'terrain', 'reserve']).toContain(after.location.kind)
    expect(after.location.kind).not.toBe('reserve')
  })

  it('refuses two Lightning Strikes at one unit in a single magic action', () => {
    // "A unit may not be targeted by more than one Lightning Strike per magic action."
    // A rule *between* casts, which is what proves an announcement has to be validated
    // as a whole rather than cast by cast.
    const victim = 'p2:oak#0'
    const twice = [1, 2].map(() => ({
      spell: 'lightning_strike',
      element: 'air' as const,
      count: 1,
      target: { kind: 'units', unitIds: [victim] } as const,
    }))
    expect(announcementProblem(twice)).toMatch(/more than one Lightning Strike/)
    expect(announcementProblem([twice[0]!])).toBeNull()
  })

  it('lets Flash Flood through only when the army there cannot hold it', () => {
    const base = gameAt('p1')
    const held = cast(evacuate(base, 'p2', 'frontier'), 'flash_flood', {
      element: 'water',
      target: { kind: 'terrain', slot: 'frontier' },
    })
    // Nobody opposing means nobody resists: the flood always lands, and no dice are
    // thrown for an army that is not there.
    expect(held.choice).toEqual({ kind: 'flood', slot: 'frontier' })
    expect(held.state.rng).toEqual(base.rng)
  })

  it('multiplies Flash Flood\'s resistance by the castings, not its step', () => {
    // The red number is the *threshold*, and the step is hard-capped at one: two
    // castings raise the bar to twelve, they do not push the terrain down twice.
    const base = evacuate(gameAt('p1'), 'p2', 'frontier')
    const twice = cast(base, 'flash_flood', {
      element: 'water',
      count: 2,
      target: { kind: 'terrain', slot: 'frontier' },
    })
    const entry = twice.state.log.find((e) => e.kind === 'flash_flood')
    expect(entry).toMatchObject({ needed: 12 })
    expect(twice.choice).toEqual({ kind: 'flood', slot: 'frontier' })
  })
})

describe('Wall of Thorns', () => {
  /**
   * The fuzz barely reaches this -- an army has to maneuver a terrain somebody warded
   * on the previous turn, which two hundred games produced twice. So it is named.
   */
  const ward = (state: GameState, slot: TerrainSlot, damage: number): GameState => ({
    ...state,
    effects: [
      ...state.effects,
      {
        source: 'Wall of Thorns',
        target: { kind: 'terrain', slot, scope: 'maneuverers' },
        modifiers: [],
        thorns: damage,
        expiresAtStartOfTurnOf: 'p2',
      },
    ],
  })

  it('is read by no roll, so it modifies nothing', () => {
    // `armyRoll` names the scope and returns nothing for it: the ward fires on an
    // event, not on dice.
    const state = ward(gameAt('p1'), 'frontier', 6)
    expect(armyRoll(state, 'p1', 'frontier', 'melee').modifiers).toEqual([])
    expect(armyRoll(state, 'p1', 'frontier', 'maneuver').modifiers).toEqual([])
    expect(thornsAt(state, 'frontier')).toBe(6)
    expect(thornsAt(state, 'p1_home')).toBe(0)
  })

  it('sums separate castings, because each is its own spell', () => {
    const twice = ward(ward(gameAt('p1'), 'frontier', 6), 'frontier', 6)
    expect(thornsAt(twice, 'frontier')).toBe(12)
  })

  it('bites an army that maneuvers the terrain, and nobody else', () => {
    const state = maneuverFrontier(ward(gameAt('p1'), 'frontier', 6))
    const entry = state.log.find((e) => e.kind === 'thorns')
    expect(entry).toBeDefined()
    // "The army makes a melee roll instead of a save roll", and the damage is what is
    // left of six after it.
    expect(entry).toMatchObject({ slot: 'frontier' })
    const thorns = entry as Extract<typeof entry, { kind: 'thorns' }>
    expect(thorns.damage).toBe(Math.max(0, 6 - thorns.melee))
  })

  it('does not fire on a terrain nobody warded', () => {
    expect(maneuverFrontier(gameAt('p1')).log.some((e) => e.kind === 'thorns')).toBe(false)
  })

  /** Turns the Frontier up, which is the event the ward waits for. */
  function maneuverFrontier(base: GameState): GameState {
    const ready = advance({
      ...base,
      pending: null,
      turn: {
        ...base.turn,
        phase: 'march',
        marchStep: 'choose_direction',
        marchingArmy: 'frontier',
      },
    })
    return reduce(ready, { kind: 'choose_direction', direction: 'up' })
  }
})

describe('Flashfire', () => {
  const ward = (state: GameState, player: PlayerId, ref: ArmyRef, count: number): GameState => ({
    ...state,
    effects: [
      ...state.effects,
      {
        source: 'Flashfire',
        target: { kind: 'army', player, army: ref },
        modifiers: [],
        flashfire: count,
        expiresAtStartOfTurnOf: 'p2',
      },
    ],
  })

  it('is a budget, so separate castings reach more dice', () => {
    const one = ward(gameAt('p1'), 'p1', 'frontier', 1)
    expect(flashfireBudget(one, 'p1', 'frontier')).toBe(1)
    expect(flashfireBudget(ward(one, 'p1', 'frontier', 1), 'p1', 'frontier')).toBe(2)
    // It is the army's, not the player's: another terrain is untouched.
    expect(flashfireBudget(one, 'p1', 'p1_home')).toBe(0)
  })

  it('modifies no roll, because a reroll is not arithmetic', () => {
    const state = ward(gameAt('p1'), 'p1', 'frontier', 1)
    expect(armyRoll(state, 'p1', 'frontier', 'melee').modifiers).toEqual([])
  })

  it('pauses an attack roll and replaces the die it is given', () => {
    const paused = advance(atExchange(ward(gameAt('p1'), 'p1', 'frontier', 1)))

    expect(paused.pending?.kind).toBe('flashfire')
    const pending = paused.pending as Extract<Pending, { kind: 'flashfire' }>
    const parked = (paused.turn.combat?.attack?.dice ?? []).length
    const target = pending.options[0]!

    const after = reduce(paused, { kind: 'flashfire', unitIds: [target] })
    const resolved = after.log.find((e) => e.kind === 'combat_resolved')

    expect(after.log.some((e) => e.kind === 'flashfire')).toBe(true)
    // **Replaced, not appended.** Step 3's ordinary rerolls add a die and both faces
    // count; this one throws the old face away, so the roll keeps its length -- which
    // is the whole reason `SaiOutcome.reroll` cannot express it.
    expect(resolved).toMatchObject({ attackDice: expect.any(Array) })
    const dice = resolved?.kind === 'combat_resolved' ? resolved.attackDice : []
    expect(dice.filter((d) => !d.reroll)).toHaveLength(parked)
    expect(dice.filter((d) => d.unitId === target && !d.reroll)).toHaveLength(1)
  })

  it('draws nothing when it is declined', () => {
    const paused = advance(atExchange(ward(gameAt('p1'), 'p1', 'frontier', 1)))
    const declined = reduce(paused, { kind: 'flashfire', unitIds: [] })

    // The same exchange with nobody warded: declining has to cost exactly what not
    // being offered costs, or a Flashfire in play would shift every die after it.
    const plain = advance(atExchange(gameAt('p1')))

    expect(declined.rng.counter).toBe(plain.rng.counter)
    expect(declined.log.some((e) => e.kind === 'flashfire')).toBe(false)
  })

  it('is not spent: the effect survives the roll it was used on', () => {
    const paused = advance(atExchange(ward(gameAt('p1'), 'p1', 'frontier', 1)))
    const used = reduce(paused, {
      kind: 'flashfire',
      unitIds: [(paused.pending as Extract<Pending, { kind: 'flashfire' }>).options[0]!],
    })

    // "This effect lasts until the beginning of your next turn" -- the "once" governs
    // the reroll inside a roll, not the lifetime, so the next roll gets one too.
    expect(flashfireBudget(used, 'p1', 'frontier')).toBe(1)
    expect(used.effects.some((e) => e.source === 'Flashfire')).toBe(true)
  })

  it('refuses more dice than the budget, and dice that did not roll', () => {
    const paused = advance(atExchange(ward(gameAt('p1'), 'p1', 'frontier', 1)))
    const options = (paused.pending as Extract<Pending, { kind: 'flashfire' }>).options

    expect(() => reduce(paused, { kind: 'flashfire', unitIds: options.slice(0, 2) })).toThrow(
      /re-rolls 1 dice/,
    )
    expect(() => reduce(paused, { kind: 'flashfire', unitIds: ['nobody'] })).toThrow(/did not roll/)
  })

  it('shows the roll it is asking about', () => {
    // "A decision sheet shows the roll that caused it" -- and this one more than most:
    // being asked which dice to throw away without being shown what they came up as is
    // not a decision at all. `rollOnTheTable` returned null at this step until a read
    // of it caught that, which is the same bug the dragon allocation sheet had.
    const paused = advance(atExchange(ward(gameAt('p1'), 'p1', 'frontier', 1)))
    const shown = rollOnTheTable(paused)

    expect(shown?.kind).toBe('attack')
    expect(shown?.dice.length).toBeGreaterThan(0)
  })

  it('asks nobody when the army has no Flashfire on it', () => {
    const paused = advance(atExchange(gameAt('p1')))
    expect(paused.pending?.kind).not.toBe('flashfire')
  })
})

describe('Accelerated Growth', () => {
  const growing = (state: GameState, player: PlayerId): GameState => ({
    ...state,
    effects: [
      ...state.effects,
      {
        source: 'Accelerated Growth',
        target: { kind: 'player', player },
        modifiers: [],
        trigger: 'accelerated_growth',
        expiresAtStartOfTurnOf: player,
      },
    ],
  })

  it('exchanges a dying die for a small one instead of killing it', () => {
    const base = withDua(gameAt('p1'), 'p1', 1)
    const small = deadUnits(base, 'p1')[0]!
    const doomed = armyAt(base, 'p1', 'p1_home').find((u) => unitType(u.typeId).health >= 2)!

    const outcome = killUnits(growing(base, 'p1'), [doomed.id])

    expect(outcome.regrown).toEqual([{ unitId: doomed.id, partnerId: small.id }])
    // They swapped places: the big one is in the DUA, the small one is on the board.
    expect(outcome.state.units[doomed.id]?.location.kind).toBe('dua')
    expect(outcome.state.units[small.id]?.location).toEqual({ kind: 'terrain', slot: 'p1_home' })
    // **Not a death.** `killedIds` is what keeps it out of the caller's log entry.
    expect(killedIds(outcome, [doomed.id])).toEqual([])
    expect(deathEntries(outcome, 'p1', 'p1_home', [doomed.id]).map((e) => e.kind)).toEqual([
      'units_regrown',
    ])
  })

  it('does nothing without a one-health die in the DUA', () => {
    const base = withDua(gameAt('p1'), 'p1', 2)
    const doomed = armyAt(base, 'p1', 'p1_home').find((u) => unitType(u.typeId).health >= 2)!

    const outcome = killUnits(growing(base, 'p1'), [doomed.id])
    expect(outcome.regrown).toEqual([])
    expect(outcome.state.units[doomed.id]?.location.kind).toBe('dua')
  })

  it('leaves a one-health die to die, having nothing smaller to become', () => {
    const base = withDua(gameAt('p1'), 'p1', 1)
    const doomed = armyAt(base, 'p1', 'p1_home').find((u) => unitType(u.typeId).health === 1)
    if (doomed === undefined) return

    expect(killUnits(growing(base, 'p1'), [doomed.id]).regrown).toEqual([])
  })

  it('spends each partner once, so two deaths cannot claim the same die', () => {
    const base = withDua(gameAt('p1'), 'p1', 1)
    const doomed = armyAt(base, 'p1', 'p1_home')
      .filter((u) => unitType(u.typeId).health >= 2)
      .slice(0, 2)
    if (doomed.length < 2) return

    const outcome = killUnits(growing(base, 'p1'), doomed.map((u) => u.id))
    expect(outcome.regrown).toHaveLength(1)
  })

  it('can never meet Rise from the Ashes, which is a fact about the data', () => {
    // Rise from the Ashes is on the Phoenix and nowhere else, and the Phoenix is a
    // Firewalkers die; Accelerated Growth is Treefolk-only and a force is one species.
    // So the ordering question the plan flagged as open cannot arise.
    const risers = UNIT_TYPES.filter((type) =>
      type.faces.some((face) => face.icon === 'SAI' && face.sai === 'Rise from the Ashes'),
    )
    expect(risers.map((t) => t.species)).toEqual(['firewalkers'])
    expect(spell('accelerated_growth').species).toBe('treefolk')
  })
})

describe('Standing Stones', () => {
  /**
   * "All units in your controlling army may convert any or all of their magic results
   * to an element this terrain contains."
   *
   * It has been live since the day `magic` became `'spells'` -- `resolvesIcon` gated it
   * on that flag rather than on `eighthFace` from Phase 5c on -- but nothing exercised
   * it until there were spells to spend the borrowed element on.
   */
  const holding = (base: GameState, dieId: string): GameState => ({
    ...base,
    terrains: {
      ...base.terrains,
      frontier: { ...base.terrains.frontier, dieId, face: 8, capturedBy: 'p1' },
    },
  })

  it('lends the terrain elements to the army holding it', () => {
    // Wasteland is air and fire; Treefolk are water and earth. Four elements, which is
    // every element either species in this plan can reach.
    const state = holding(gameAt('p1'), 'wasteland_standing_stones')
    expect([...castingElements(state, 'p1', 'frontier')].sort()).toEqual([
      'air',
      'earth',
      'fire',
      'water',
    ])
    // Only where it stands, and only for the army that captured it.
    expect([...castingElements(state, 'p1', 'p1_home')].sort()).toEqual(['earth', 'water'])
    expect([...castingElements(state, 'p2', 'frontier')].sort()).toEqual(['air', 'fire'])
  })

  it('lets a Treefolk army cast an air spell it could never otherwise reach', () => {
    const state = holding(gameAt('p1'), 'wasteland_standing_stones')
    const castable = castableSpells(
      state,
      'p1',
      magicPool(state, 'p1', 'frontier', 99),
      SPELL_RULES,
    ).map((c) => c.spell.id)

    // Hailstorm is air and `Any`, so the borrowed element is the whole of what makes
    // it castable -- and the same army at home cannot.
    expect(castable).toContain('hailstorm')
    expect(
      castableSpells(state, 'p1', magicPool(state, 'p1', 'p1_home', 99), SPELL_RULES).map(
        (c) => c.spell.id,
      ),
    ).not.toContain('hailstorm')
  })

  it('does not lend a species spell, which is a different restriction', () => {
    // Mirage is air *and* Firewalkers. An element the terrain lends does not make the
    // caster a Firewalker.
    const state = holding(gameAt('p1'), 'wasteland_standing_stones')
    const castable = castableSpells(
      state,
      'p1',
      magicPool(state, 'p1', 'frontier', 99),
      SPELL_RULES,
    ).map((c) => c.spell.id)
    expect(castable).not.toContain('mirage')
  })

  it('lends nothing at all while magic is the v0 house rule', () => {
    const state = holding(
      begin(setupGame({ seed: 7, forces: STARTER_FORCES, ruleSet: DRAGON_RULES })),
      'wasteland_standing_stones',
    )
    expect([...castingElements(state, 'p1', 'frontier')].sort()).toEqual(['earth', 'water'])
  })
})

describe('Cantrip', () => {
  const face = (count: number) => ({ count, icon: 'SAI' as const, sai: 'Cantrip' })
  const ctxFor = (over: Partial<RollContext>): RollContext => ({
    purpose: { kind: 'attack', action: 'melee' },
    isCounter: false,
    ...over,
  })

  it('is ordinary magic on a magic action, on every rung', () => {
    for (const rules of [DRAGON_RULES, SPELL_RULES]) {
      expect(
        saiEffects(face(3), ctxFor({ purpose: { kind: 'attack', action: 'magic' } }), rules).results,
      ).toEqual({ magic: 3 })
    }
  })

  it('is a restricted pool on any other non-maneuver roll, once spells exist', () => {
    expect(saiEffects(face(3), ctxFor({}), SPELL_RULES).effects).toEqual([
      { kind: 'cantrip', points: 3 },
    ])
    // And worth nothing at all under the v0 house rule, where there is nothing to buy.
    expect(saiEffects(face(3), ctxFor({}), DRAGON_RULES).effects).toEqual([])
  })

  it('generates nothing on a maneuver roll, a sub-roll or a trigger roll', () => {
    expect(saiEffects(face(3), ctxFor({ purpose: { kind: 'maneuver' } }), SPELL_RULES)).toEqual(
      NOTHING_AT_ALL,
    )
    expect(saiEffects(face(3), ctxFor({ isSubRoll: true }), SPELL_RULES).effects).toEqual([])
    expect(saiEffects(face(3), ctxFor({ isTrigger: true }), SPELL_RULES).effects).toEqual([])
  })

  it('buys only spells marked C', () => {
    const cantrip = castableSpells(
      gameAt('p1'),
      'p1',
      { points: 99, elements: ['water', 'earth'], cantripOnly: true },
      SPELL_RULES,
    ).map((c) => c.spell.id)

    for (const id of cantrip) expect(spell(id).cantrip).toBe(true)
    // Stone Skin is `C`; Path is not, and is affordable and castable otherwise.
    expect(cantrip).toContain('stone_skin')
    expect(cantrip).not.toContain('path')
  })
})

describe('the dragon roll has nowhere to put a side decision', () => {
  /**
   * `resolveArmyRoll` read the totals and ignored `outcome.effects` entirely, so a
   * Wild Growth or a Firewalking on a dragon combination roll was **silently dropped**
   * from Phase 6 until here -- and Wild Growth's `Applies` column is "Non-Maneuver",
   * which a dragon attack is. It is a house rule now, and the guard is what makes it
   * one rather than an accident.
   */
  const ctx: RollContext = { purpose: { kind: 'dragon_attack' }, isCounter: false }

  it('turns Wild Growth into the save results the roll does count', () => {
    const outcome = saiEffects({ count: 4, icon: 'SAI', sai: 'Wild Growth' }, ctx, SPELL_RULES)
    expect(outcome.effects).toEqual([])
    // The saves are still generated -- a dragon roll counts them -- and only the
    // promotion half is lost.
    expect(outcome.results).toEqual({ save: 4 })
  })

  it('silences the free moves and Cantrip there', () => {
    for (const sai of ['Firewalking', 'Teleport', 'Cantrip']) {
      expect(saiEffects({ count: 4, icon: 'SAI', sai }, ctx, SPELL_RULES).effects).toEqual([])
    }
  })
})

describe('Dispel Magic', () => {
  const cast = (target: SpellTarget): AnnouncedSpell => ({
    spell: 'stone_skin',
    element: 'earth',
    count: 1,
    target,
  })

  it('reaches a spell aimed at the unit, its army or its terrain, and nothing else', () => {
    const state = gameAt('p1')
    const mine = armyAt(state, 'p1', 'p1_home')[0]!

    expect(dispelNegates(state, cast({ kind: 'units', unitIds: [mine.id] }), mine.id)).toBe(true)
    expect(
      dispelNegates(state, cast({ kind: 'army', player: 'p1', army: 'p1_home' }), mine.id),
    ).toBe(true)
    expect(dispelNegates(state, cast({ kind: 'terrain', slot: 'p1_home' }), mine.id)).toBe(true)

    // Somebody else's army at the same terrain, and the same army elsewhere.
    expect(
      dispelNegates(state, cast({ kind: 'army', player: 'p2', army: 'p1_home' }), mine.id),
    ).toBe(false)
    expect(dispelNegates(state, cast({ kind: 'terrain', slot: 'frontier' }), mine.id)).toBe(false)
    expect(dispelNegates(state, cast({ kind: 'none' }), mine.id)).toBe(false)
  })

  it('does not reach a spell another roll already stopped', () => {
    const state = gameAt('p1')
    const mine = armyAt(state, 'p1', 'p1_home')[0]!
    const already = { ...cast({ kind: 'terrain', slot: 'p1_home' }), negated: true as const }
    expect(dispelNegates(state, already, mine.id)).toBe(false)
  })

  it('offers the roll to the Unicorn and to nothing else in the box', () => {
    // It is two faces of one die, Treefolk only -- so `treefolk_unicorn` is the only
    // board that can queue several, and Firewalkers can never dispel at all.
    const carriers = UNIT_TYPES.filter((type) =>
      type.faces.some((f) => f.icon === 'SAI' && f.sai === 'Dispel Magic'),
    )
    expect(carriers.map((t) => t.id)).toEqual(['treefolk.unicorn'])

    const unicorns = begin(
      setupGame({
        seed: 3,
        forces: { kind: 'named', forces: { p1: 'treefolk_unicorn', p2: 'treefolk_unicorn' } },
        ruleSet: SPELL_RULES,
      }),
    )
    const target = armyAt(unicorns, 'p1', 'frontier')[0]!
    const candidates = dispelCandidates(unicorns, [
      cast({ kind: 'army', player: 'p1', army: 'frontier' }),
    ])
    // Every Unicorn standing in the army the spell was aimed at, and no other.
    expect(candidates.length).toBeGreaterThan(1)
    expect(candidates).toContain(target.id)
  })

  it('offers nobody a roll when no announced spell reaches them', () => {
    const state = gameAt('p1')
    expect(dispelCandidates(state, [cast({ kind: 'none' })])).toEqual([])
  })
})

describe('Reserve magic', () => {
  it('lets a Reserve Army march once spells exist, and never before', () => {
    const base = gameAt('p1')
    const withReserve = toReserve(base, 'p1', 'p1_home')

    expect(marchableArmies(withReserve, 'p1')).toContain('reserve')
    // The last of RULES-V0.md section 4's house rules: before spells the Reserve Army
    // can neither maneuver nor act, so offering it would be offering nothing.
    expect(
      marchableArmies({ ...withReserve, ruleSet: DRAGON_RULES }, 'p1'),
    ).not.toContain('reserve')
  })

  it('gives it magic and nothing else', () => {
    const state = toReserve(gameAt('p1'), 'p1', 'p1_home')
    expect(legalActions(state, 'p1', 'reserve')).toEqual(['magic'])
    expect(legalActions({ ...state, ruleSet: DRAGON_RULES }, 'p1', 'reserve')).toEqual([])
  })

  it('counts its own ID results, which the Tower rule was eating', () => {
    /*
     * Tower's rule is "if attacking a Reserve Army, only count non-ID missile
     * results". `attackRollSpec` tested that as `defenderSlot === 'reserve'`, which
     * said the same thing while a missile was the only way to aim at Reserves -- and
     * then Reserve magic arrived, whose `targetSlot` is the caster's own ref because
     * magic names no terrain. Every ID result in a Reserve Army's magic roll was
     * silently thrown away, and the die drew as a blank while it was at it.
     */
    const rolled = reserveRoll('magic')
    const ids = rolled.filter((die) => die.face.icon === 'ID')

    expect(ids.length).toBeGreaterThan(0)
    for (const die of ids) expect(die.results).toBeGreaterThan(0)
  })

  it('still lets a Tower missile ignore the ID results of the army it shoots at', () => {
    // The rule the fix above narrowed, still doing its job. Same state, same rng, so
    // the same faces come up and only the action differs.
    const ids = reserveRoll('missile').filter((die) => die.face.icon === 'ID')

    expect(ids.length).toBeGreaterThan(0)
    for (const die of ids) expect(die.results).toBe(0)
  })

  it('offers only spells marked R from there', () => {
    const state = toReserve(gameAt('p1'), 'p1', 'p1_home')
    const pool = magicPool(state, 'p1', 'reserve', 99)

    expect(pool.fromReserves).toBe(true)
    const castable = castableSpells(state, 'p1', pool, SPELL_RULES)
    for (const offer of castable) expect(offer.spell.reserves).toBe(true)
    // Stone Skin is an `R` spell; Wall of Fog is not, and is otherwise castable.
    expect(castable.map((c) => c.spell.id)).toContain('stone_skin')
    expect(castable.map((c) => c.spell.id)).not.toContain('wall_of_fog')
  })
})

describe('the Frontier dragon seed', () => {
  it('is gone once a spell can summon', () => {
    const state = setupGame({ seed: 4, forces: STARTER_FORCES, ruleSet: SPELL_RULES })
    const onBoard = Object.values(state.dragons).filter((d) => d.location.kind === 'terrain')
    expect(onBoard).toEqual([])
    expect(Object.values(state.dragons).length).toBeGreaterThan(0)
  })

  it('is still there for the rung that has no way to summon', () => {
    // `DRAGON_RULES` remains a playable configuration, and without the seed its whole
    // Dragon Attack Phase would be unreachable by any legal sequence of actions.
    const state = setupGame({ seed: 4, forces: STARTER_FORCES, ruleSet: DRAGON_RULES })
    const onBoard = Object.values(state.dragons).filter((d) => d.location.kind === 'terrain')
    expect(onBoard).toHaveLength(2)
  })
})

describe('the fuzz', () => {
  it('plays 200 SPELL_RULES games, casting every spell this build resolves', () => {
    const cast = new Map<string, number>()
    let magicActions = 0
    let announcements = 0
    let stuck = 0
    let summoned = 0
    let resurrected = 0
    let moved = 0
    let flooded = 0
    let floodHeld = 0
    let flashfires = 0
    let cantrips = 0
    let dispelled = 0
    let fromReserves = 0
    let declined = 0
    let regrown = 0

    // Both force sets, because the two species reach different spell lists: Treefolk
    // can never cast an air or fire spell and Firewalkers never a water or earth one,
    // so a one-sided fuzz could only ever fire half the table.
    for (const forces of [STARTER_FORCES, BESTIARY_FORCES]) {
      for (let seed = 1; seed <= 100; seed += 1) {
        const result = runGame({
          setup: { seed, forces, ruleSet: SPELL_RULES },
          players: { p1: randomAi, p2: randomAi },
          aiSeed: seed,
          // Reserve magic (7f) made a game about three times as long in decisions: the
          // Reserve Army can march every turn, and `RandomAI` retreats into it
          // constantly. 20 of 200 games hit `runGame`'s default 5000 and stopped on
          // `cap`, which is not a bug but does make every counter below a lie by
          // omission. The longest game needs 16,353; this is the next round number up.
          maxDecisions: 20_000,
        })
        if (result.stoppedBecause === 'stuck') stuck += 1
        announcements += result.record.actions.filter((a) => a.kind === 'announce_spells').length
        declined += result.record.actions.filter(
          (a) => a.kind === 'flashfire' && a.unitIds.length === 0,
        ).length
        for (const entry of result.state.log) {
          if (entry.kind === 'magic_rolled') magicActions += 1
          if (entry.kind === 'spell_cast') cast.set(entry.spell, (cast.get(entry.spell) ?? 0) + 1)
          if (entry.kind === 'dragon_summoned') summoned += 1
          if (entry.kind === 'units_resurrected') resurrected += 1
          if (entry.kind === 'units_moved' && entry.sai === 'Path') moved += 1
          if (entry.kind === 'flashfire') flashfires += 1
          if (entry.kind === 'cantrip') cantrips += 1
          if (entry.kind === 'dispel_magic' && entry.spells.length > 0) dispelled += 1
          if (entry.kind === 'magic_rolled' && entry.slot === 'reserve') fromReserves += 1
          if (entry.kind === 'units_regrown') regrown += 1
          if (entry.kind === 'flash_flood') {
            if (entry.moved) flooded += 1
            else floodHeld += 1
          }
        }
      }
    }

    expect(stuck).toBe(0)
    // Every magic roll asks for an announcement, and so does every Cantrip window --
    // exactly, which only holds while no game is cut short by the decision cap.
    expect(announcements).toBe(magicActions + cantrips)
    expect(cantrips).toBeGreaterThan(0)

    // The spells that *do* something rather than merely sitting on an army: a dragon
    // left a pool, a unit walked out of the DUA, a unit changed terrain, a terrain went
    // down -- and an army held one, which is the branch a one-sided counter would miss.
    expect(summoned).toBeGreaterThan(0)
    expect(resurrected).toBeGreaterThan(0)
    expect(moved).toBeGreaterThan(0)
    expect(flooded).toBeGreaterThan(0)
    expect(floodHeld).toBeGreaterThan(0)
    // Both triggers, and both of Flashfire's answers: a fuzz that always re-rolled
    // would never reach the path where the faces are left alone.
    expect(flashfires).toBeGreaterThan(0)
    expect(declined).toBeGreaterThan(0)
    expect(regrown).toBeGreaterThan(0)
    // The three things 7f closed: a Cantrip window mid-roll, a Dispel Magic roll that
    // actually stopped something, and a spell cast from the Reserve Area.
    expect(dispelled).toBeGreaterThan(0)
    expect(fromReserves).toBeGreaterThan(0)

    // The counters are what make a clean run mean something: a fuzz over rules nothing
    // reached would be green and prove nothing. **Every spell this build resolves
    // fires**, which is a stronger claim than a list, and it tightens on its own as
    // each later slice moves a name out of the unbuilt set.
    const live = SPELLS.filter((s) => resolvesSpell(s.id, SPELL_RULES)).map((s) => s.id)
    expect(live).toHaveLength(18)
    for (const id of live) expect(cast.get(id) ?? 0).toBeGreaterThan(0)

    // And nothing unbuilt is ever cast: a spell the rung cannot resolve is never
    // offered, so it can never be announced, so it can never reach resolution and
    // throw. That is the `sai: 'results'` lesson, and this is what checks it.
    for (const id of cast.keys()) expect(resolvesSpell(id, SPELL_RULES)).toBe(true)
  })
})

// --- helpers -----------------------------------------------------------------

/** Resolves one spell directly, for the handlers that need no announcement. */
function cast(
  state: GameState,
  id: string,
  over: { element: Element; count?: number; target: SpellTarget },
) {
  return castSpell(state, spell(id), {
    caster: 'p1',
    army: 'p1_home',
    count: 1,
    ...over,
  })
}

/** Pulls a whole army back into Reserves, so the Reserve Army has something in it. */
function toReserve(state: GameState, player: PlayerId, slot: TerrainSlot): GameState {
  const units = { ...state.units }
  for (const unit of armyAt(state, player, slot)) {
    units[unit.id] = { ...unit, location: { kind: 'reserve' } }
  }
  return { ...state, units }
}

/** A state paused at the start of an exchange at the Frontier. */
function atExchange(base: GameState): GameState {
  return {
    ...base,
    pending: null,
    turn: {
      ...base.turn,
      marching: 'p1',
      phase: 'march',
      marchStep: 'resolve_attack',
      marchingArmy: 'frontier',
      combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
    },
  }
}

/** Empties an army, so an announced target can vanish before its spell resolves. */
function evacuate(state: GameState, player: PlayerId, slot: TerrainSlot): GameState {
  const units = { ...state.units }
  for (const unit of armyAt(state, player, slot)) {
    units[unit.id] = { ...unit, location: { kind: 'reserve' } }
  }
  return { ...state, units }
}

/** Buries one unit of each of the named healths, so the DUA prices differently. */
function withDua(state: GameState, player: PlayerId, ...healths: number[]): GameState {
  const units = { ...state.units }
  for (const health of healths) {
    const found = Object.values(units).find(
      (u) =>
        u.owner === player && u.location.kind === 'terrain' && unitType(u.typeId).health === health,
    )
    if (found === undefined) throw new Error(`no ${health}-health unit to bury`)
    units[found.id] = { ...found, location: { kind: 'dua' } }
  }
  return { ...state, units }
}

/** Leaves an army holding nothing a single point of damage could kill. */
function onlyBigUnits(state: GameState, player: PlayerId, slot: TerrainSlot): GameState {
  const units = { ...state.units }
  for (const unit of armyAt(state, player, slot)) {
    if (unitType(unit.typeId).health <= 1) units[unit.id] = { ...unit, location: { kind: 'dua' } }
  }
  return { ...state, units }
}

/** A board with named dragons in named places. */
function withDragons(
  state: GameState,
  spec: Readonly<Record<string, { dieId: string; owner: PlayerId; at: TerrainSlot | 'pool' }>>,
): GameState {
  const dragons: Record<string, DragonInPlay> = {}
  for (const [id, d] of Object.entries(spec)) {
    dragons[id] = {
      id,
      dieId: d.dieId,
      owner: d.owner,
      location: d.at === 'pool' ? { kind: 'pool' } : { kind: 'terrain', slot: d.at },
    }
  }
  return { ...state, dragons }
}

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

/**
 * One Reserve Army's roll, by action, on a board where an ID face is certain to come
 * up. Both callers share the state and the rng, so the faces are identical and the
 * only thing that can differ is whether the ID results were counted.
 */
function reserveRoll(action: 'magic' | 'missile'): readonly DieRoll[] {
  for (let seed = 1; seed <= 200; seed += 1) {
    const base = begin(setupGame({ seed, forces: STARTER_FORCES, ruleSet: SPELL_RULES }))
    const state = toReserve(base, 'p1', 'frontier')
    if (armyRef(state, 'p1', 'reserve').length === 0) continue

    // `defenderSlot: 'reserve'` either way, and that is the whole point: a magic
    // action from Reserves is aimed at the caster's own ref, because magic names no
    // terrain -- so the two rolls are distinguishable *only* by the action, which is
    // exactly what `attackRollSpec` was not looking at.
    const spec: AttackSpec = {
      action,
      attacker: 'p1',
      attackerSlot: 'reserve',
      defender: 'p2',
      defenderSlot: 'reserve',
      isCounter: false,
    }

    const dice = resolveAttack(state, spec).attackRoll.dice
    if (dice.some((die) => die.face.icon === 'ID')) return dice
  }
  throw new Error('no seed put an ID face in a Reserve Army roll')
}

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
