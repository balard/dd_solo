import { describe, expect, it } from 'vitest'

import { UNIT_TYPES, unitType } from '../data/load'
import type { Face } from '../data/types'

import { resolveAttack } from './combat'
import { advance } from './reduce'
import { rngFrom, rollDice, type RngState } from './rng'
import { maxResults, resolveRoll, rollArmy, type DieRoll } from './roll'
import {
  LIVE_SAIS,
  saiEffects,
  saiMaxResults,
  type RollPurpose,
  type SaiFace,
} from './sai'
import { stepGame } from './turn'
import {
  SAI_RULES,
  V0_RULES,
  type ActionKind,
  type CombatState,
  type GameState,
  type MarchStep,
  type PlayerId,
  type RuleSet,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from './types'

const FULL_RULES: RuleSet = { ...V0_RULES, sai: 'full' }

const sai = (name: string, count = 4): SaiFace => ({ count, icon: 'SAI', sai: name })

const melee: RollPurpose = { kind: 'attack', action: 'melee' }
const missile: RollPurpose = { kind: 'attack', action: 'missile' }
const magic: RollPurpose = { kind: 'attack', action: 'magic' }
const maneuver: RollPurpose = { kind: 'maneuver' }
const saveVs = (against: ActionKind | null): RollPurpose => ({ kind: 'save', against })

/** What this face does in that kind of roll. */
const fires = (name: string, purpose: RollPurpose, count = 4, isCounter = false) =>
  saiEffects(sai(name, count), { purpose, isCounter }, SAI_RULES)

// --- the twelve handlers, against the reference text -------------------------

describe('SAIs that generate results', () => {
  it('Counter saves and hits back, but only against melee', () => {
    expect(fires('Counter', saveVs('melee'))).toEqual({
      results: { save: 4 },
      effects: [{ kind: 'riposte', damage: 4 }],
      reroll: false,
    })
    // "During any other save roll, Counter generates X save results" -- and nothing
    // goes back the other way.
    expect(fires('Counter', saveVs('missile'))).toEqual({
      results: { save: 4 },
      effects: [],
      reroll: false,
    })
    expect(fires('Counter', saveVs(null)).effects).toEqual([])
    expect(fires('Counter', melee).results).toEqual({ melee: 4 })
  })

  it('Volley is the same shape one action across', () => {
    expect(fires('Volley', saveVs('missile')).effects).toEqual([{ kind: 'riposte', damage: 4 }])
    expect(fires('Volley', saveVs('melee')).effects).toEqual([])
    expect(fires('Volley', saveVs('melee')).results).toEqual({ save: 4 })
    expect(fires('Volley', missile).results).toEqual({ missile: 4 })
  })

  it('Fly and Hoof do nothing at all in an attack roll', () => {
    // Four icons on a monster face, and worth exactly nothing here: neither SAI
    // lists melee, missile or magic in its `Applies` column.
    for (const purpose of [melee, missile, magic]) {
      expect(fires('Fly', purpose).results).toEqual({})
      expect(fires('Hoof', purpose).results).toEqual({})
    }
    expect(fires('Fly', maneuver).results).toEqual({ maneuver: 4 })
    expect(fires('Fly', saveVs('melee')).results).toEqual({ save: 4 })
    expect(fires('Hoof', maneuver).results).toEqual({ maneuver: 4 })
    expect(fires('Hoof', saveVs('melee')).results).toEqual({ save: 4 })
  })

  it('Trample generates both of its types, where Fly generates one of its two', () => {
    // "X maneuver **and** X melee" against "X maneuver **or** X save". The two read
    // alike until a roll counts more than one type.
    expect(fires('Trample', melee).results).toEqual({ maneuver: 4, melee: 4 })
    expect(fires('Trample', maneuver).results).toEqual({ maneuver: 4, melee: 4 })
    expect(fires('Trample', saveVs('melee')).results).toEqual({ maneuver: 4, melee: 4 })
  })

  it('Create Fireminions generates whatever the roll is counting', () => {
    expect(fires('Create Fireminions', melee).results).toEqual({ melee: 4 })
    expect(fires('Create Fireminions', missile).results).toEqual({ missile: 4 })
    expect(fires('Create Fireminions', magic).results).toEqual({ magic: 4 })
    expect(fires('Create Fireminions', maneuver).results).toEqual({ maneuver: 4 })
    expect(fires('Create Fireminions', saveVs(null)).results).toEqual({ save: 4 })
  })

  it('Smite deals damage and generates no melee results', () => {
    const outcome = fires('Smite', melee)
    expect(outcome.results).toEqual({})
    expect(outcome.effects).toEqual([{ kind: 'unsavable', damage: 4 }])
    expect(fires('Smite', missile).effects).toEqual([])
  })

  it('Surprise fires on a melee attack but not on a counter-attack', () => {
    expect(fires('Surprise', melee).effects).toEqual([{ kind: 'suppress_counter' }])
    // "Surprise has no effect during a counter-attack."
    expect(fires('Surprise', melee, 4, true).effects).toEqual([])
    expect(fires('Surprise', missile).effects).toEqual([])
  })

  it('Rend rerolls on a melee attack and not on a maneuver roll', () => {
    expect(fires('Rend', melee)).toEqual({ results: { melee: 4 }, effects: [], reroll: true })
    // The maneuver sentence does not carry "roll this unit again", and reading it as
    // if it did would consume a die roll the rules do not.
    expect(fires('Rend', maneuver)).toEqual({
      results: { maneuver: 4 },
      effects: [],
      reroll: false,
    })
  })

  it('Firewalking, Teleport and Rise from the Ashes deliver their Phase 1 halves', () => {
    expect(fires('Firewalking', maneuver).results).toEqual({ maneuver: 4 })
    expect(fires('Teleport', maneuver).results).toEqual({ maneuver: 4 })
    // Their free-move halves, on a non-maneuver roll, are Phase 4.
    expect(fires('Firewalking', melee)).toEqual({ results: {}, effects: [], reroll: false })
    expect(fires('Teleport', melee)).toEqual({ results: {}, effects: [], reroll: false })

    expect(fires('Rise from the Ashes', saveVs('melee')).results).toEqual({ save: 4 })
    expect(fires('Rise from the Ashes', melee).results).toEqual({})
  })

  it('reads X off the face rather than assuming a monster', () => {
    // `3 SAI:Smite` is a real face -- treefolk.oak_lord carries two of them -- so a
    // hardcoded 4 would pass every other test in this file and fail here.
    expect(fires('Smite', melee, 3).effects).toEqual([{ kind: 'unsavable', damage: 3 }])
    expect(fires('Counter', saveVs('melee'), 2).results).toEqual({ save: 2 })
  })
})

describe('the rungs of ruleSet.sai', () => {
  it('is silently inert for an SAI this rung does not implement', () => {
    // Deliberate: `'results'` has to be playable, and the other thirteen land in
    // Phases 2, 3, 4 and 7.
    for (const name of ['Choke', 'Flame', 'Wild Growth', 'Cantrip', 'Bullseye']) {
      expect(fires(name, melee), name).toEqual({ results: {}, effects: [], reroll: false })
    }
  })

  it('is inert for every SAI under V0_RULES', () => {
    for (const name of LIVE_SAIS) {
      expect(saiEffects(sai(name), { purpose: melee, isCounter: false }, V0_RULES).results).toEqual(
        {},
      )
    }
  })

  it('refuses to play under sai: full, which is Phase 4', () => {
    expect(() => saiEffects(sai('Smite'), { purpose: melee, isCounter: false }, FULL_RULES)).toThrow(
      /targeting SAIs are not implemented/,
    )
  })

  it('names every SAI in the data, so none can fall through to inert unnoticed', () => {
    // Phase 4's thirteen, listed rather than derived: a name appearing in neither
    // list means `npm run data` added an SAI and nothing resolves it.
    const deferred = new Set([
      'Bullseye',
      'Cantrip',
      'Choke',
      'Confuse',
      'Dispel Magic',
      'Double Strike',
      'Firecloud',
      'Flame',
      'Galeforce',
      'Seize',
      'Sleep',
      'Smother',
      'Wild Growth',
    ])
    const live = new Set(LIVE_SAIS)

    const names = new Set<string>()
    for (const type of UNIT_TYPES) {
      for (const face of type.faces) if (face.icon === 'SAI') names.add(face.sai)
    }

    expect(names.size).toBe(25)
    // The split is pinned because the prose in CLAUDE.md, RULES-V0.md and PLAN-V1.md
    // all quote it, and nothing else would notice it going stale.
    expect(live.size, 'SAIs live under sai: results').toBe(12)
    expect(deferred.size, 'SAIs still inert under sai: results').toBe(13)
    for (const name of names) {
      expect(live.has(name) || deferred.has(name), `${name} is resolved by neither rung`).toBe(true)
    }
    // And nothing is claimed twice, which is how a Phase 4 SAI would quietly ship.
    for (const name of live) expect(deferred.has(name), name).toBe(false)
  })
})

describe('saiMaxResults', () => {
  it('bounds a face by the most it could ever generate', () => {
    expect(saiMaxResults(sai('Counter'), 'save', SAI_RULES)).toBe(4)
    expect(saiMaxResults(sai('Counter'), 'melee', SAI_RULES)).toBe(4)
    expect(saiMaxResults(sai('Counter'), 'magic', SAI_RULES)).toBe(0)
  })

  it('bounds Smite at zero, because its damage is not melee results', () => {
    expect(saiMaxResults(sai('Smite'), 'melee', SAI_RULES)).toBe(0)
  })

  it('is zero for every face under V0_RULES', () => {
    for (const name of LIVE_SAIS) expect(saiMaxResults(sai(name), 'melee', V0_RULES)).toBe(0)
  })
})

// --- rolling ------------------------------------------------------------------

/** A throwaway army from unit type ids, in the order they will be rolled. */
const armyOf = (...typeIds: string[]): UnitInstance[] =>
  typeIds.map((typeId, i) => ({
    id: `t${i}`,
    typeId,
    owner: 'p1' as const,
    location: { kind: 'terrain' as const, slot: 'frontier' as const },
  }))

/**
 * An RNG state whose next draws land on exactly these faces.
 *
 * Found by scanning counters rather than hunting for a magic seed, so a test can say
 * "a Strangle Vine rolling Rend and then its ID face" and have that be readable.
 */
function rngShowing(typeIds: readonly string[], faces: readonly number[]): RngState {
  const counts = typeIds.map((id) => unitType(id).faces.length)
  for (let counter = 0; counter < 2_000_000; counter += 1) {
    const [indices] = rollDice({ seed: 1, counter }, counts)
    if (faces.every((face, i) => indices[i] === face)) return { seed: 1, counter }
  }
  throw new Error(`no counter shows ${typeIds.join(', ')} on faces ${faces.join(', ')}`)
}

const faceOf = (typeId: string, index: number): Face => {
  const face = unitType(typeId).faces[index]
  if (face === undefined) throw new Error(`${typeId} has no face ${index}`)
  return face
}

/** Face indices used below, named so the tests read as dice rather than numbers. */
const VINE_REND = 8
const VINE_ID = 0
const OAK_LORD_SMITE = 2
const FIRESHADOW_COUNTER = 8
const FIRESHADOW_MELEE = 4
const SATYR_VOLLEY = 2
const DARKTREE_SURPRISE = 2
const GUARDIAN_MELEE = 1
const OAKLING_MELEE = 1

describe('SAI results reach the roll', () => {
  it('confirms the faces these tests lean on', () => {
    expect(faceOf('treefolk.strangle_vine', VINE_REND)).toEqual(sai('Rend'))
    expect(faceOf('treefolk.strangle_vine', VINE_ID)).toEqual({ count: 4, icon: 'ID' })
    expect(faceOf('treefolk.oak_lord', OAK_LORD_SMITE)).toEqual(sai('Smite', 3))
    expect(faceOf('firewalkers.fireshadow', FIRESHADOW_COUNTER)).toEqual(sai('Counter'))
    expect(faceOf('treefolk.satyr', SATYR_VOLLEY)).toEqual(sai('Volley'))
    expect(faceOf('treefolk.darktree', DARKTREE_SURPRISE)).toEqual(sai('Surprise'))
  })

  it('adds SAI results at step 8, after the divide', () => {
    const units = armyOf('treefolk.redwood')
    const rng = rngShowing(['treefolk.redwood'], [4]) // 4 SAI:Trample
    const [outcome] = resolveRoll(
      units,
      {
        kinds: ['melee'],
        // Halving a roll that is nothing but SAI results changes nothing: step 7
        // runs before step 8.
        modifiers: [{ kind: 'divide', resultType: 'melee', by: 2 }],
        context: { purpose: melee, isCounter: false },
      },
      rng,
      SAI_RULES,
    )
    expect(outcome.totals['melee']).toBe(4)
  })

  it('leaves the same face worth nothing under V0_RULES', () => {
    const units = armyOf('treefolk.redwood')
    const rng = rngShowing(['treefolk.redwood'], [4])
    const [roll] = rollArmy(units, 'melee', rng, V0_RULES)
    expect(roll.total).toBe(0)
    expect(roll.effects).toEqual([])
  })

  it('shows the SAI on the die itself, so the roll strip still adds up', () => {
    const units = armyOf('treefolk.redwood')
    const rng = rngShowing(['treefolk.redwood'], [4])
    const [roll] = rollArmy(units, 'melee', rng, SAI_RULES)
    expect(roll.dice.map((d) => d.results)).toEqual([4])
    expect(roll.dice.reduce((sum, d) => sum + d.results, 0)).toBe(roll.total)
  })
})

describe('Rend', () => {
  const vine = 'treefolk.strangle_vine'

  it('rolls the die again and counts both faces', () => {
    const rng = rngShowing([vine, vine], [VINE_REND, 3]) // Rend, then 4 MANEUVER
    const [roll, after] = rollArmy(armyOf(vine), 'melee', rng, SAI_RULES)

    // Two dice in the strip for one unit, and the second is marked as the reroll.
    expect(roll.dice.map((d: DieRoll) => [d.unitId, d.faceIndex, d.reroll])).toEqual([
      ['t0', VINE_REND, undefined],
      ['t0', 3, true],
    ])
    // 4 melee from Rend; the maneuver face adds nothing to a melee roll.
    expect(roll.total).toBe(4)
    // Exactly two draws for the one unit.
    expect(after.counter - rng.counter).toBe(2)
  })

  it('does not reroll on a maneuver roll', () => {
    const rng = rngShowing([vine], [VINE_REND])
    const [roll, after] = rollArmy(armyOf(vine), 'maneuver', rng, SAI_RULES)
    expect(roll.dice).toHaveLength(1)
    expect(roll.total).toBe(4)
    expect(after.counter - rng.counter).toBe(1)
  })

  it('doubles a rerolled ID face at a captured terrain, like any other', () => {
    const rng = rngShowing([vine, vine], [VINE_REND, VINE_ID])
    const [plain] = rollArmy(armyOf(vine), 'melee', rng, SAI_RULES, false)
    const [doubled] = rollArmy(armyOf(vine), 'melee', rng, SAI_RULES, true)

    // 4 from Rend, plus a 4-health ID face; the eighth face doubles the ID share
    // alone, and never the SAI results that joined at step 8.
    expect(plain.total).toBe(8)
    expect(doubled.total).toBe(12)
  })

  it('rolls one die per unit first, and only then the rerolls', () => {
    // Step 1 is *all* the dice and step 3 is a separate sweep, so a two-unit army
    // with a Rend on the first die still rolls the second die second.
    const rng = rngShowing([vine, 'treefolk.oakling', vine], [VINE_REND, OAKLING_MELEE, 3])
    const [roll] = rollArmy(armyOf(vine, 'treefolk.oakling'), 'melee', rng, SAI_RULES)
    expect(roll.dice.map((d) => [d.unitId, d.reroll === true])).toEqual([
      ['t0', false],
      ['t1', false],
      ['t0', true],
    ])
  })
})

// --- one exchange --------------------------------------------------------------

/**
 * A board with exactly these armies on it.
 *
 * Built by hand rather than from `setupGame`, because these tests are about one
 * exchange and want to name the dice in it.
 */
function stage(options: {
  readonly p1: Partial<Record<TerrainSlot, readonly string[]>>
  readonly p2: Partial<Record<TerrainSlot, readonly string[]>>
  readonly rng: RngState
  readonly ruleSet?: RuleSet
}): GameState {
  const units: Record<UnitId, UnitInstance> = {}
  for (const owner of ['p1', 'p2'] as const) {
    for (const [slot, typeIds] of Object.entries(options[owner])) {
      ;(typeIds as readonly string[]).forEach((typeId, i) => {
        const id = `${owner}:${slot}:${i}`
        units[id] = { id, typeId, owner, location: { kind: 'terrain', slot: slot as TerrainSlot } }
      })
    }
  }

  const terrain = (slot: TerrainSlot) =>
    ({ slot, dieId: 'highland_tower', face: 6 as const, capturedBy: null })

  return {
    ruleSet: options.ruleSet ?? SAI_RULES,
    rng: options.rng,
    units,
    terrains: {
      p1_home: terrain('p1_home'),
      frontier: terrain('frontier'),
      p2_home: terrain('p2_home'),
    },
    turn: {
      marching: 'p1',
      phase: 'march',
      marchIndex: 0,
      marchStep: 'action',
      marchingArmy: 'frontier',
      armiesMarched: ['frontier'],
      combat: null,
    },
    pending: null,
    log: [],
    winner: null,
  }
}

const attackAt = (state: GameState, action: ActionKind, defenderSlot: TerrainSlot = 'frontier') =>
  resolveAttack(state, {
    action,
    attacker: 'p1',
    attackerSlot: 'frontier',
    defender: 'p2',
    defenderSlot,
    isCounter: false,
  })

describe('Smite in an exchange', () => {
  const oakLord = 'treefolk.oak_lord'

  it('kills with no melee results at all, and earns the defender no save roll', () => {
    const rng = rngShowing([oakLord], [OAK_LORD_SMITE])
    const state = stage({ p1: { frontier: [oakLord] }, p2: { frontier: ['treefolk.oakling'] }, rng })
    const outcome = attackAt(state, 'melee')

    expect(outcome.attackTotal).toBe(0)
    // "A zero attack earns no save roll" keys off the melee total, not the damage.
    expect(outcome.saveTotal).toBeNull()
    expect(outcome.saveRoll).toBeNull()
    // 3, not 4: `3 SAI:Smite` is the face oak_lord actually carries.
    expect(outcome.unsavable).toBe(3)
    expect(outcome.damage).toBe(3)
    // One draw, for the one attacking die. The save roll consumed nothing.
    expect(outcome.rng.counter - rng.counter).toBe(1)
  })

  it('marks the die that smote, so the roll strip does not draw it as a blank', () => {
    // The die contributes 0 results and 3 damage. Without this the strip greyed it
    // out and printed nothing on it, beside a log line reporting damage from nowhere.
    const rng = rngShowing([oakLord], [OAK_LORD_SMITE])
    const state = stage({ p1: { frontier: [oakLord] }, p2: { frontier: ['treefolk.oakling'] }, rng })
    const [die] = attackAt(state, 'melee').attackRoll.dice

    expect(die?.results).toBe(0)
    expect(die?.effects).toEqual([{ kind: 'unsavable', damage: 3 }])
  })

  it('leaves the field off a die that produced no effect', () => {
    // Omitted, never `[]`: a die is rendered into every golden log entry.
    const rng = rngShowing([oakLord], [0])
    const state = stage({ p1: { frontier: [oakLord] }, p2: { frontier: ['treefolk.oakling'] }, rng })
    const [die] = attackAt(state, 'melee').attackRoll.dice

    expect(die === undefined ? null : 'effects' in die).toBe(false)
  })


  it('adds on top of a save total rather than being reduced by it', () => {
    // oak_lord rolls Smite; the defender saves everything it can and still takes 3.
    const rng = rngShowing([oakLord, 'treefolk.oakling'], [OAK_LORD_SMITE, 0])
    const state = stage({ p1: { frontier: [oakLord] }, p2: { frontier: ['treefolk.oakling'] }, rng })
    expect(attackAt(state, 'melee').damage).toBe(3)
  })
})

describe('Counter and Volley hit back', () => {
  it('sends damage back at a melee attacker, which gets no save roll of its own', () => {
    const rng = rngShowing(
      ['firewalkers.guardian', 'firewalkers.fireshadow'],
      [GUARDIAN_MELEE, FIRESHADOW_COUNTER],
    )
    const state = stage({
      p1: { frontier: ['firewalkers.guardian'] },
      p2: { frontier: ['firewalkers.fireshadow'] },
      rng,
    })
    const outcome = attackAt(state, 'melee')

    expect(outcome.attackTotal).toBe(1)
    expect(outcome.saveTotal).toBe(4)
    expect(outcome.damage).toBe(0)
    expect(outcome.riposte).toBe(4)
    // Two draws: the attack and the save. The riposte allows no save roll, so it
    // costs no randomness.
    expect(outcome.rng.counter - rng.counter).toBe(2)
  })

  it('does not hit back at a missile attacker -- that is Volley', () => {
    const rng = rngShowing(
      ['firewalkers.guardian', 'firewalkers.fireshadow'],
      [3, FIRESHADOW_COUNTER], // guardian face 3 is 1 MISSILE
    )
    const state = stage({
      p1: { frontier: ['firewalkers.guardian'] },
      p2: { p2_home: ['firewalkers.fireshadow'] },
      rng,
    })
    const outcome = attackAt(state, 'missile', 'p2_home')
    expect(outcome.saveTotal).toBe(4)
    expect(outcome.riposte).toBe(0)
  })

  it('sends Volley back across the board at a missile attacker', () => {
    // The one riposte that crosses terrains: the shot comes from the Frontier, the
    // damage lands on the Frontier, and the target army never moves.
    const rng = rngShowing(['firewalkers.guardian', 'treefolk.satyr'], [3, SATYR_VOLLEY])
    const state = stage({
      p1: { frontier: ['firewalkers.guardian'] },
      p2: { p2_home: ['treefolk.satyr'] },
      rng,
    })
    const outcome = attackAt(state, 'missile', 'p2_home')
    expect(outcome.attackTotal).toBe(1)
    expect(outcome.saveTotal).toBe(4)
    expect(outcome.riposte).toBe(4)
  })
})

describe('Surprise', () => {
  const darktree = 'treefolk.darktree'

  it('is reported by the attack roll that produced it', () => {
    const rng = rngShowing([darktree, 'treefolk.oakling'], [DARKTREE_SURPRISE, 0])
    const state = stage({
      p1: { frontier: [darktree] },
      p2: { frontier: ['treefolk.oakling'] },
      rng,
    })
    expect(attackAt(state, 'melee').counterSuppressed).toBe(true)
  })

  it('is still reported when the attack rolls nothing', () => {
    // Surprise applies "during a melee attack", not "during a melee attack that
    // landed", and a zero total is exactly where the early return could lose it.
    const rng = rngShowing([darktree], [DARKTREE_SURPRISE])
    const state = stage({
      p1: { frontier: [darktree] },
      p2: { frontier: ['treefolk.oakling'] },
      rng,
    })
    const outcome = attackAt(state, 'melee')
    expect(outcome.attackTotal).toBe(0)
    expect(outcome.saveTotal).toBeNull()
    expect(outcome.counterSuppressed).toBe(true)
  })

  it('has no effect during a counter-attack', () => {
    const rng = rngShowing([darktree, 'treefolk.oakling'], [DARKTREE_SURPRISE, 0])
    const state = stage({
      p1: { frontier: [darktree] },
      p2: { frontier: ['treefolk.oakling'] },
      rng,
    })
    const outcome = resolveAttack(state, {
      action: 'melee',
      attacker: 'p1',
      attackerSlot: 'frontier',
      defender: 'p2',
      defenderSlot: 'frontier',
      isCounter: true,
    })
    expect(outcome.counterSuppressed).toBe(false)
  })
})

// --- the four damage assignments -------------------------------------------------

/**
 * The combat sequence, driven directly.
 *
 * An exchange that produces all four assignments needs about thirteen named dice in
 * a row, which no seed is going to hand over. So the dice are tested above and the
 * *sequencing* is tested here, by putting the machine on a step and asking what it
 * does next -- which is where the risk actually lives.
 */
function onStep(step: MarchStep, combat: CombatState, armies?: Partial<Parameters<typeof stage>[0]>) {
  const state = stage({
    p1: { frontier: ['treefolk.oak_lord'] },
    p2: { frontier: ['firewalkers.sentinel'] },
    rng: rngFrom(1),
    ...armies,
  })
  return { ...state, turn: { ...state.turn, marchStep: step, combat } }
}

const meleeCombat = (extra: Partial<CombatState> = {}): CombatState => ({
  action: 'melee',
  targetSlot: 'frontier',
  damage: 0,
  ...extra,
})

describe('the combat sequence', () => {
  it('asks the right player, at the right terrain, for each of the four assignments', () => {
    const cases: readonly [MarchStep, PlayerId, number][] = [
      ['assign_attack_damage', 'p2', 3],
      ['assign_attack_riposte', 'p1', 2],
      ['assign_counter_damage', 'p1', 3],
      ['assign_counter_riposte', 'p2', 2],
    ]
    for (const [step, player, damage] of cases) {
      const asked = stepGame(onStep(step, meleeCombat({ damage: 3, riposte: 2 })))
      expect(asked.pending, step).toEqual({
        kind: 'assign_damage',
        player,
        slot: 'frontier',
        damage,
      })
    }
  })

  it('offers the counter-attack after the attack, and skips it when Surprise fired', () => {
    const offered = advance(onStep('offer_counter', meleeCombat()))
    expect(offered.pending?.kind).toBe('choose_counter_attack')

    const suppressed = advance(onStep('offer_counter', meleeCombat({ counterSuppressed: true })))
    // The march ends instead: no offer, and no `counter_declined` either.
    expect(suppressed.turn.marchStep).not.toBe('offer_counter')
    expect(suppressed.pending?.kind).not.toBe('choose_counter_attack')
  })

  it('does not offer a counter-attack to an army with nothing left to counter with', () => {
    // Newly reachable: a riposte or a Smite can empty the *attacking* army before
    // the offer is made.
    const emptied = onStep('offer_counter', meleeCombat(), {
      p1: {},
      p2: { frontier: ['firewalkers.sentinel'] },
    })
    expect(advance(emptied).pending?.kind).not.toBe('choose_counter_attack')
  })

  it('never walks from the opening attack into the counter-attack steps', () => {
    // `assign_counter_damage` reads `combat.damage`, which until the counter has
    // rolled still holds the *attack's* damage. Walking through would assign it a
    // second time, to the wrong army.
    const missileAttack = onStep('assign_attack_damage', {
      action: 'missile',
      targetSlot: 'frontier',
      damage: 3,
    })
    const after = advance({
      ...missileAttack,
      turn: { ...missileAttack.turn, marchStep: 'resolve_attack' },
      // Nothing to assign: the defender is a 4-health die and 3 damage kills nothing.
    })
    expect(after.turn.combat).toBeNull()
  })
})

// --- the guard on the goldens ---------------------------------------------------

describe('state shape under V0_RULES', () => {
  it('writes no new CombatState field when nothing fires', () => {
    // `digestState` puts `stableJson(state.turn)` in every golden digest, and four
    // of the twenty-five end mid-combat. A `riposte: 0` or `counterSuppressed: false`
    // written here rewrites those four -- this catches it as one line rather than as
    // a wall of log diff.
    const rng = rngShowing(['treefolk.oakling', 'treefolk.oakling'], [OAKLING_MELEE, 0])
    const state = stage({
      p1: { frontier: ['treefolk.oakling'] },
      p2: { frontier: ['treefolk.oakling'] },
      rng,
      ruleSet: V0_RULES,
    })
    const resolved = advance({
      ...state,
      turn: {
        ...state.turn,
        marchStep: 'resolve_attack',
        combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
      },
    })
    if (resolved.turn.combat !== null) {
      expect(Object.keys(resolved.turn.combat).sort()).toEqual(['action', 'damage', 'targetSlot'])
    }
    for (const entry of resolved.log) {
      if (entry.kind === 'combat_resolved') {
        expect(Object.keys(entry)).not.toContain('unsavable')
        expect(Object.keys(entry)).not.toContain('riposte')
      }
      expect(entry.kind).not.toBe('counter_suppressed')
    }
  })
})

describe('maxResults', () => {
  it('counts an SAI face once SAIs generate results', () => {
    const redwood = unitType('treefolk.redwood')
    // Its best melee face is `4 MELEE` either way; Trample matches it rather than
    // being ignored.
    expect(maxResults(redwood, 'maneuver', V0_RULES)).toBe(4)
    expect(maxResults(redwood, 'maneuver', SAI_RULES)).toBe(4)

    const fireshadow = unitType('firewalkers.fireshadow')
    // Under V0 a Fireshadow can save only with its ID face; Counter and Fly add to
    // that once they are live.
    expect(maxResults(fireshadow, 'save', V0_RULES)).toBe(4)
    expect(maxResults(fireshadow, 'save', SAI_RULES)).toBe(4)
  })

  it('bounds a roll by the dice it actually rolled, rerolls included', () => {
    const vine = 'treefolk.strangle_vine'
    const rng = rngShowing([vine, vine], [VINE_REND, VINE_ID])
    const [roll] = rollArmy(armyOf(vine), 'melee', rng, SAI_RULES)

    // Not by the army: Rend puts a die in the roll that the army does not contain.
    expect(roll.dice.length).toBeGreaterThan(1)
    const ceiling = roll.dice.reduce(
      (sum, die) => sum + maxResults(unitType(die.typeId), 'melee', SAI_RULES),
      0,
    )
    expect(roll.total).toBeLessThanOrEqual(ceiling)
  })
})

describe('rolls with nowhere to put an effect', () => {
  it('refuses rather than dropping one', () => {
    // Phase 1 has no maneuver-roll SAI that produces an effect, so this cannot fire
    // yet -- it is here for Phase 4's Firewalking and Teleport, whose free move
    // arrives on exactly these rolls.
    const rng = rngShowing(['firewalkers.fireshadow'], [FIRESHADOW_MELEE])
    const [roll] = rollArmy(armyOf('firewalkers.fireshadow'), 'maneuver', rng, SAI_RULES)
    expect(roll.effects).toEqual([])
  })
})
