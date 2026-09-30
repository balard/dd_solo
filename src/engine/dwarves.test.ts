/**
 * The Dwarves (v2 Phase 6), and the seams their rules stand on.
 *
 * 6b built the machinery before anything used it, so its tests drive each piece
 * directly: the "counts as" table with rows the Dwarves will add (Mountain Mastery,
 * Dwarven Might) written by hand, the damage sub-roll that Bash and Firebolt will share,
 * and the spell-save gather that Counter's riposte and Charge will read.
 *
 * Boards are hand-built, because the Dwarves are not playable until 6f and `setupGame`
 * would refuse them.
 */
import { describe, expect, it } from 'vitest'

import { UNIT_TYPES, unitType } from '../data/load'
import { SPELLS, spell } from '../data/spells'

import { combinationAnswerProblem, combinationSpec } from './combination'
import { spellSaves, type Effect } from './effects'
import { maneuverAsSaves, savesAsMelee, type Modifier } from './pipeline'
import { advance } from './reduce'
import { conversionsIn, resolveFaces, type RawDie, type RollSpec } from './roll'
import { rollDice, type RngState } from './rng'
import { DRAGON_ROLL_KINDS, type RollContext } from './sai'
import { spellEffect, type SpellContext } from './spells'
import { damageSubRoll } from './subroll'
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

const RULES: RuleSet = { ...V0_RULES, sai: 'full', dua: 'active', speciesAbilities: true }

/** Oak: face 0 `2 ID`, 1-4 `2 MELEE`, 5 `4 SAVE`. Two health. */
const OAK = 'treefolk.oak'
const OAK_ID = 0
const OAK_MELEE = 1
const OAK_SAVE = 5
/** Watcher: a `3 MELEE` face and a `2 SAVE` one. */
const WATCHER = 'firewalkers.watcher'

const faceWith = (typeId: string, icon: string): number => {
  const index = unitType(typeId).faces.findIndex((f) => f.icon === icon)
  if (index < 0) throw new Error(`${typeId} has no ${icon} face`)
  return index
}
const raw = (unitId: string, typeId: string, icon: string): RawDie => ({
  unitId,
  typeId,
  faceIndex: faceWith(typeId, icon),
})

/** The RNG counter at which these dice, in this order, show these faces. */
function rngShowing(typeIds: readonly string[], faces: readonly number[]): RngState {
  const counts = typeIds.map((id) => unitType(id).faces.length)
  for (let counter = 0; counter < 200_000; counter += 1) {
    const [indices] = rollDice({ seed: 1, counter }, counts)
    if (faces.every((face, i) => indices[i] === face)) return { seed: 1, counter }
  }
  throw new Error(`no counter shows ${typeIds.join(', ')} on faces ${faces.join(', ')}`)
}

/** p1's dice and p2's dice at the Frontier, p1 to march, nothing in progress unless
 *  the turn says otherwise. */
function board(
  p1: readonly string[],
  p2: readonly string[],
  rng: RngState,
  turn: Partial<TurnState> = {},
): GameState {
  const units: Record<string, UnitInstance> = {}
  for (const [owner, typeIds] of [['p1', p1], ['p2', p2]] as const) {
    typeIds.forEach((typeId, i) => {
      const id = `${owner}:${i}`
      units[id] = { id, typeId, owner, location: { kind: 'terrain', slot: 'frontier' } }
    })
  }
  const terrain = (slot: TerrainSlot) => ({ slot, dieId: 'highland_tower', face: 6 as const, capturedBy: null })
  return {
    ruleSet: RULES,
    rng,
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
      ...turn,
    },
    pending: null,
    log: [],
    winner: null,
  }
}

const entries = <K extends LogEntry['kind']>(state: GameState, kind: K) =>
  state.log.filter((e): e is Extract<LogEntry, { kind: K }> => e.kind === kind)

// --- the "counts as" table (6b) ------------------------------------------------

/** The rows 6f will gather, written by hand so the table can be tested before them. */
const meleeAsManeuver = (species: readonly string[]): Modifier => ({
  kind: 'counts_as',
  from: 'melee',
  resultType: 'maneuver',
  counter: 'either',
  species,
  source: 'Mountain Mastery',
})
const savesAsMeleeOnCounter = (species: readonly string[]): Modifier => ({
  kind: 'counts_as',
  from: 'save',
  resultType: 'melee',
  counter: 'only',
  species,
  source: 'Dwarven Might',
})

const context = (isCounter: boolean): RollContext => ({
  purpose: { kind: 'attack', action: 'melee' },
  isCounter,
})

describe('the counts-as table', () => {
  it('holds Flaming Shields to rolls that are not counter-attacks, and a counter-only row to the rest', () => {
    const rows = [savesAsMelee(['firewalkers']), savesAsMeleeOnCounter(['dwarves'])]
    expect(conversionsIn(['melee'], context(false), rows).map((c) => c.source)).toEqual(['Flaming Shields'])
    expect(conversionsIn(['melee'], context(true), rows).map((c) => c.source)).toEqual(['Dwarven Might'])
  })

  it('applies only where the roll counts the type it converts to', () => {
    const rows = [savesAsMelee(['firewalkers']), maneuverAsSaves(['coral_elves'])]
    expect(conversionsIn(['missile'], context(false), rows)).toEqual([])
    expect(conversionsIn(['save'], { purpose: { kind: 'save', against: 'melee' }, isCounter: false }, rows).map((c) => c.source))
      .toEqual(['Coastal Dodge'])
  })

  it('asks about a trade only for saves as melee, and leaves any other pair off', () => {
    const dragon: RollContext = { purpose: { kind: 'dragon_attack' }, isCounter: false }
    const shields = conversionsIn(DRAGON_ROLL_KINDS, dragon, [savesAsMelee(['firewalkers'])])
    expect(shields).toMatchObject([{ from: 'save', to: 'melee', chosen: true }])
    // A roll counting maneuver and saves together: Coastal Dodge is "a roll that counts
    // saves and not maneuver", which is what it was before the table.
    expect(conversionsIn(['save', 'maneuver'], dragon, [maneuverAsSaves(['coral_elves'])])).toEqual([])
  })

  it('merges two gathers of one permission into one conversion over both species', () => {
    const [only] = conversionsIn(['melee'], context(false), [savesAsMelee(['firewalkers']), savesAsMelee(['lava_elves'])])
    expect([...(only?.species ?? [])]).toEqual(['firewalkers', 'lava_elves'])
  })

  it('turns a new row into results on the dice and a note, with no code of its own', () => {
    // Mountain Mastery's row, before Mountain Mastery exists: melee counted as maneuver.
    const spec: RollSpec = {
      kinds: ['maneuver'],
      modifiers: [meleeAsManeuver(['firewalkers'])],
      context: { purpose: { kind: 'maneuver' }, isCounter: false },
    }
    const dice = [raw('a', WATCHER, 'MELEE'), raw('b', OAK, 'MELEE')]
    const outcome = resolveFaces(dice, spec, RULES)
    // The Firewalker's three melee count; the Treefolk's two do not.
    expect(outcome.totals.maneuver).toBe(3)
    expect(outcome.dice.map((d) => d.results)).toEqual([3, 0])
    expect(outcome.math?.maneuver?.notes).toEqual(['3 melee counted as maneuver (Mountain Mastery)'])
    // And it is not Flaming Shields, so the log's `flamingShields` stays out of it.
    expect(outcome.countedAs).toBeUndefined()
  })

  it('keeps Dwarven Might out of `countedAs`, which the golden digest reads as Flaming Shields', () => {
    const spec: RollSpec = { kinds: ['melee'], modifiers: [savesAsMeleeOnCounter(['firewalkers'])], context: context(true) }
    const outcome = resolveFaces([raw('a', WATCHER, 'SAVE')], spec, RULES)
    expect(outcome.totals.melee).toBe(2)
    expect(outcome.countedAs).toBeUndefined()
    expect(outcome.math?.melee?.notes).toEqual(['2 save counted as melee (Dwarven Might)'])
  })
})

// --- the damage sub-roll (6b) --------------------------------------------------

describe('a unit taking damage and rolling saves against it', () => {
  it('kills when what the saves leave reaches the health', () => {
    const state = board([], [OAK], rngShowing([OAK], [OAK_MELEE]))
    const out = damageSubRoll(state, 'p2:0', 2, 'Bash')
    expect(out).toMatchObject({ saves: 0, killed: true })
    expect(out.state.units['p2:0']?.location).toEqual({ kind: 'dua' })
    expect(entries(out.state, 'sai_sub_roll')).toMatchObject([
      { player: 'p2', source: 'Bash', slot: 'frontier', test: 'save', damage: 2, escaped: [] },
    ])
    expect(entries(out.state, 'units_killed')).toMatchObject([{ player: 'p2', unitIds: ['p2:0'] }])
    expect(validateState(out.state)).toEqual([])
  })

  it('is arithmetic, not "any save escapes": two saves against five damage still die', () => {
    // The Oak's ID is two saves in a save roll. Lightning Strike would let it live.
    const state = board([], [OAK], rngShowing([OAK], [OAK_ID]))
    expect(damageSubRoll(state, 'p2:0', 5, 'Firebolt')).toMatchObject({ saves: 2, killed: true })
    expect(damageSubRoll(state, 'p2:0', 3, 'Firebolt')).toMatchObject({ saves: 2, killed: false })
  })

  it('rolls even when the damage could never kill, and kills nothing', () => {
    const state = board([], [OAK], rngShowing([OAK], [OAK_MELEE]))
    const out = damageSubRoll(state, 'p2:0', 1, 'Firebolt')
    expect(out).toMatchObject({ saves: 0, killed: false })
    expect(out.state.rng).not.toEqual(state.rng)
    expect(entries(out.state, 'sai_sub_roll')).toMatchObject([{ damage: 1, escaped: ['p2:0'] }])
    expect(out.state.units['p2:0']?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
  })

  it('saves a die whose save face covers the damage', () => {
    const state = board([], [OAK], rngShowing([OAK], [OAK_SAVE]))
    expect(damageSubRoll(state, 'p2:0', 5, 'Bash')).toMatchObject({ saves: 4, killed: false })
  })

  it('gives a die that cannot be rolled no saves, and draws nothing for it', () => {
    const asleep: Effect = {
      source: 'Sleep',
      target: { kind: 'unit', unitId: 'p2:0' },
      modifiers: [],
      asleep: true,
      expiresAtStartOfTurnOf: 'p1',
    }
    const state = { ...board([], [OAK], { seed: 1, counter: 0 }), effects: [asleep] }
    const out = damageSubRoll(state, 'p2:0', 2, 'Bash')
    expect(out).toMatchObject({ dice: [], saves: 0, killed: true })
    expect(out.state.rng).toEqual(state.rng)
  })

  it('ends the glare of a glaring die that rolls, as every unit roll does', () => {
    const glare: Effect = {
      source: 'Hypnotic Glare',
      target: { kind: 'unit', unitId: 'p2:0' },
      modifiers: [],
      glaring: true,
      anchor: { unitId: 'p2:0', slot: 'frontier', untilRolled: true },
      expiresAtStartOfTurnOf: 'p2',
    }
    const state = { ...board([], [OAK], rngShowing([OAK], [OAK_SAVE])), effects: [glare] }
    expect(damageSubRoll(state, 'p2:0', 1, 'Firebolt').state.effects).toEqual([])
  })

  it('does nothing to a unit that is not in play', () => {
    const state = board([], [OAK], { seed: 1, counter: 0 })
    const dead = { ...state, units: { ...state.units, 'p2:0': { ...state.units['p2:0']!, location: { kind: 'dua' as const } } } }
    expect(damageSubRoll(dead, 'p2:0', 2, 'Bash').state).toBe(dead)
  })
})

// --- spell saves (6b) ----------------------------------------------------------

const cast = (id: string, count: number, target: SpellContext['target']): Effect =>
  spellEffect(spell(id), { caster: 'p1', army: 'frontier', element: 'earth', count, target })

describe('the save results spells add to an army', () => {
  it('sums every spell that adds saves there, castings included', () => {
    const state: GameState = {
      ...board([OAK], [OAK], { seed: 1, counter: 0 }),
      effects: [
        cast('stone_skin', 2, { kind: 'army', player: 'p1', army: 'frontier' }),
        cast('watery_double', 1, { kind: 'army', player: 'p1', army: 'frontier' }),
        // Takes a result away rather than adding one, so it reduces nothing.
        cast('ash_storm', 1, { kind: 'terrain', slot: 'frontier' }),
      ],
    }
    expect(spellSaves(state, 'p1', 'frontier')).toBe(3)
    expect(spellSaves(state, 'p2', 'frontier')).toBe(0)
    expect(spellSaves(state, 'p1', 'p1_home')).toBe(0)
  })

  it('never counts an SAI effect, because no SAI shares a name with a spell', () => {
    // The mark is read off the effect's name, so a collision would let an SAI's effect
    // pass for a spell's.
    const sais = new Set(UNIT_TYPES.flatMap((u) => u.faces.flatMap((f) => (f.icon === 'SAI' ? [f.sai] : []))))
    expect(SPELLS.filter((s) => sais.has(s.name)).map((s) => s.name)).toEqual([])

    const galeforce: Effect = {
      source: 'Galeforce',
      target: { kind: 'army', player: 'p1', army: 'frontier' },
      modifiers: [{ kind: 'add', resultType: 'save', amount: 4 }],
      expiresAtStartOfTurnOf: 'p2',
    }
    expect(spellSaves({ ...board([OAK], [], { seed: 1, counter: 0 }), effects: [galeforce] }, 'p1', 'frontier')).toBe(0)
  })
})

// --- the combination roll, apart from the dragon (6b) -------------------------

describe('a combination roll over any kinds', () => {
  const spec = (kinds: RollSpec['kinds']) =>
    combinationSpec(
      board([OAK], [], { seed: 1, counter: 0 }),
      'p1',
      'frontier',
      kinds,
      { purpose: { kind: 'save', against: 'melee' }, isCounter: false },
    )

  it('starts every counted kind at zero IDs, and nothing else', () => {
    expect(spec(['save', 'melee']).idAllocation).toEqual({ save: 0, melee: 0 })
    expect(spec(['save', 'melee']).savesAsMelee).toBeUndefined()
  })

  it('doubles IDs in every counted kind at a held eighth face', () => {
    const base = board([OAK], [], { seed: 1, counter: 0 })
    const held: GameState = {
      ...base,
      terrains: { ...base.terrains, frontier: { ...base.terrains.frontier, face: 8, capturedBy: 'p1' } },
    }
    const doubled = combinationSpec(held, 'p1', 'frontier', ['save', 'melee'], {
      purpose: { kind: 'save', against: 'melee' },
      isCounter: false,
    }).modifiers.filter((m) => m.kind === 'multiply')
    expect(doubled.map((m) => m.resultType).sort()).toEqual(['melee', 'save'])
  })

  it('checks the flexible split and the Flaming Shields count against the pools', () => {
    const pools = { ids: 2, flexible: 3, shields: 1 }
    expect(combinationAnswerProblem(['save', 'melee'], pools, { ids: {}, flexible: { save: 1, melee: 2 } })).toBeNull()
    expect(combinationAnswerProblem(['save', 'melee'], pools, { ids: {}, flexible: { save: 1 } })).toBe(
      'the split spends 1 of 3 flexible results',
    )
    expect(
      combinationAnswerProblem(['save', 'melee'], pools, { ids: {}, flexible: { melee: 3 }, savesAsMelee: 2 }),
    ).toBe('Flaming Shields can count 1 saves as melee here, not 2')
  })
})

// --- old rules corrected (6c) --------------------------------------------------

/** Unicorn: face 6 is `4 SAI:Counter` -- four saves, and four straight back. */
const UNICORN = 'treefolk.unicorn'
const UNICORN_COUNTER = 6

/** p1's two Oaks melee p2's Unicorn at the Frontier: 4 melee against a Counter. */
const counterBoard = (effects: readonly Effect[]): GameState => ({
  ...board([OAK, OAK], [UNICORN], rngShowing([OAK, OAK, UNICORN], [OAK_MELEE, OAK_MELEE, UNICORN_COUNTER]), {
    marchStep: 'resolve_attack',
    marchingArmy: 'frontier',
    armiesMarched: ['frontier'],
    combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
  }),
  effects,
})

describe("a riposte, which only the attacker's spell saves reduce", () => {
  const wateryDouble = (count: number) =>
    cast('watery_double', count, { kind: 'army', player: 'p1', army: 'frontier' })

  it('comes back whole at an army with no spell on it', () => {
    const state = advance(counterBoard([]))
    const exchange = entries(state, 'combat_resolved')[0]
    expect(exchange).toMatchObject({ attackTotal: 4, saveTotal: 4, damage: 0, riposte: 4 })
    expect(exchange?.riposteMath).toBeUndefined()
    expect(state.pending).toMatchObject({ kind: 'assign_damage', player: 'p1' })
  })

  it('is reduced by Watery Double, named, and the attacker assigns only what is left', () => {
    const state = advance(counterBoard([wateryDouble(2)]))
    const exchange = entries(state, 'combat_resolved')[0]
    expect(exchange).toMatchObject({ riposte: 2 })
    expect(exchange?.riposteMath).toEqual({
      base: 4,
      steps: [{ source: 'Watery Double', delta: -2 }],
      notes: [],
    })
    // Two damage kills one Oak, not both.
    expect(state.pending).toMatchObject({ kind: 'assign_damage', player: 'p1' })
    expect(validateState(state)).toEqual([])
  })

  it('can be stopped entirely, and then there is nothing to assign', () => {
    const state = advance(counterBoard([wateryDouble(4)]))
    const exchange = entries(state, 'combat_resolved')[0]
    expect(exchange?.riposte).toBeUndefined()
    expect(exchange?.riposteMath).toEqual({ base: 4, steps: [{ source: 'Watery Double', delta: -4 }], notes: [] })
    expect(state.pending?.kind).not.toBe('assign_damage')
  })

  it("is not reduced by the defender's spells, only the attacker's", () => {
    const theirs = cast('watery_double', 2, { kind: 'army', player: 'p2', army: 'frontier' })
    const exchange = entries(advance(counterBoard([theirs])), 'combat_resolved')[0]
    // Their Watery Double adds to their own save roll -- two more saves -- and the
    // riposte comes back whole.
    expect(exchange).toMatchObject({ saveTotal: 6, riposte: 4 })
  })
})
