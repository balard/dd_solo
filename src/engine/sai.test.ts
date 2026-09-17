import { describe, expect, it } from 'vitest'

import { UNIT_TYPES, unitType } from '../data/load'
import type { Face } from '../data/types'

import { resolveAttack } from './combat'
import { doubleIdsModifier } from './pipeline'
import { advance } from './reduce'
import { rngFrom, rollDice, type RngState } from './rng'
import { maxResults, resolveRoll, rollArmy, saiPhrase, saisBehind, type DieRoll } from './roll'


import {
  LIVE_SAIS,
  TARGETING_SAIS,
  saiEffects,
  saiMaxResults,
  type RollPurpose,
  type SaiFace,
} from './sai'
import { stepGame } from './turn'
import { validateState } from './validate'
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
    for (const name of ['Choke', 'Confuse', 'Wild Growth', 'Cantrip', 'Smother', 'Seize']) {
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

  /**
   * The refusal is per *name*, not blanket.
   *
   * It used to throw for every SAI face alike, which was right while none of the
   * targeting SAIs existed and becomes wrong with the first one: `'full'` is meant to
   * refuse a half-built ruleset, not to refuse the twelve SAIs that already work.
   */
  it('resolves an implemented SAI under sai: full', () => {
    expect(saiEffects(sai('Counter'), { purpose: melee, isCounter: false }, FULL_RULES).results)
      .toEqual({ melee: 4 })
  })

  it('refuses an unimplemented targeting SAI under sai: full', () => {
    expect(() =>
      saiEffects(sai('Choke'), { purpose: melee, isCounter: false }, FULL_RULES),
    ).toThrow(/targeting SAIs are not implemented/)
  })

  /**
   * A targeting SAI exists on `'full'` and **does not exist at all** on `'results'` --
   * which is why the two rungs are two tables rather than one table and a flag. Get
   * this wrong and `SAI_RULES`, the configuration Phase 1 shipped, quietly starts
   * burying dice.
   */
  it('resolves Flame under full and leaves it inert under results', () => {
    expect(saiEffects(sai('Flame', 2), { purpose: melee, isCounter: false }, FULL_RULES)).toEqual({
      results: {},
      effects: [{ kind: 'target_enemy', health: 2, escape: 'none', fate: 'bury' }],
      reroll: false,
    })
    expect(saiEffects(sai('Flame', 2), { purpose: melee, isCounter: false }, SAI_RULES)).toEqual({
      results: {},
      effects: [],
      reroll: false,
    })
  })

  it('fires Flame only on a melee attack, per its Applies column', () => {
    for (const purpose of [missile, magic, maneuver, saveVs('melee')]) {
      expect(
        saiEffects(sai('Flame', 2), { purpose, isCounter: false }, FULL_RULES).effects,
      ).toEqual([])
    }
  })

  /**
   * The five sub-roll SAIs of Phase 4d, read straight off their `Applies` columns.
   *
   * Worth one table rather than five tests, because the way these go wrong is a copied
   * handler keeping the action it was copied from -- a Bullseye that fires on melee
   * looks right in every other test in this file.
   */
  it('fires each sub-roll SAI only where its Applies column says', () => {
    const cases: readonly [string, readonly RollPurpose[]][] = [
      ['Bullseye', [missile]],
      ['Double Strike', [melee]],
      ['Smother', [melee]],
      ['Firecloud', [melee, missile]],
      ['Seize', [missile]],
    ]

    for (const [name, allowed] of cases) {
      for (const purpose of [melee, missile, magic, maneuver, saveVs('melee'), saveVs(null)]) {
        const effects = saiEffects(sai(name), { purpose, isCounter: false }, FULL_RULES).effects
        expect(effects.length > 0, `${name} on ${JSON.stringify(purpose)}`).toBe(
          allowed.includes(purpose),
        )
      }
    }
  })

  /**
   * What each one asks its targets for, and what becomes of the ones that fail.
   *
   * `escapeTo` is Seize's alone and is *stated* rather than inferred from
   * `escape: 'id'` -- the Genie's-4 mistake, which would be true of the one ID-escape
   * SAI in this box and false of Swallow.
   */
  it('gives each sub-roll SAI its own escape, budget and fate', () => {
    const effect = (name: string, purpose: RollPurpose, count = 4) =>
      saiEffects(sai(name, count), { purpose, isCounter: false }, FULL_RULES).effects[0]

    expect(effect('Bullseye', missile)).toEqual({
      kind: 'target_enemy',
      health: 4,
      escape: 'save',
      fate: 'kill',
    })
    // "Target four health-worth", flat -- and the one face in the data says 4, so
    // reading the count agrees with the reference exactly. Flame's "two" is the same
    // arrangement, and this is the test that a 3 on the face would be honoured.
    expect(effect('Double Strike', melee, 3)).toMatchObject({ health: 3, escape: 'save' })
    expect(effect('Smother', melee)).toEqual({
      kind: 'target_enemy',
      health: 4,
      escape: 'maneuver',
      fate: 'kill',
    })
    expect(effect('Firecloud', missile)).toMatchObject({ escape: 'maneuver', fate: 'kill' })
    expect(effect('Seize', missile)).toEqual({
      kind: 'target_enemy',
      health: 4,
      escape: 'id',
      fate: 'kill',
      escapeTo: 'reserve',
    })
  })

  /** "Roll this unit again and apply the new result as well" -- Rend's sentence, so
   *  it is step 3 and the roller's own die, not the target's. The other three do not
   *  carry it, and reading it onto them would consume a die roll the rules do not. */
  it('rerolls for Bullseye and Double Strike, and for nothing else in 4d', () => {
    expect(saiEffects(sai('Bullseye'), { purpose: missile, isCounter: false }, FULL_RULES).reroll)
      .toBe(true)
    expect(
      saiEffects(sai('Double Strike'), { purpose: melee, isCounter: false }, FULL_RULES).reroll,
    ).toBe(true)
    for (const name of ['Smother', 'Firecloud', 'Seize']) {
      expect(
        saiEffects(sai(name), { purpose: melee, isCounter: false }, FULL_RULES).reroll,
        name,
      ).toBe(false)
    }
  })

  /** None of the five generates a *result*, so the static bound is unmoved by them --
   *  the check that a targeting effect was not written as melee results, the way
   *  Smite's zero is. */
  it('adds nothing to the result bound', () => {
    for (const name of ['Bullseye', 'Double Strike', 'Smother', 'Firecloud', 'Seize']) {
      for (const type of ['melee', 'missile', 'save', 'maneuver'] as const) {
        expect(saiMaxResults(sai(name), type, FULL_RULES), `${name} ${type}`).toBe(0)
      }
    }
  })

  it('says spells, not Phase 4, for the two SAIs that cast one', () => {
    for (const name of ['Cantrip', 'Dispel Magic']) {
      expect(() =>
        saiEffects(sai(name), { purpose: melee, isCounter: false }, FULL_RULES),
      ).toThrow(/casts a spell, which needs magic: 'spells'/)
    }
  })

  it('is silently inert for an unbuilt SAI under sai: results', () => {
    expect(saiEffects(sai('Choke'), { purpose: melee, isCounter: false }, SAI_RULES)).toEqual({
      results: {},
      effects: [],
      reroll: false,
    })
  })

  it('names every SAI in the data, so none can fall through to inert unnoticed', () => {
    // The three-way partition Phase 4 walks across: a slice moves a name out of
    // `deferred` and into `LIVE_SAIS`, and this test is what makes that a deliberate
    // edit rather than something that happens quietly. `needsSpells` never moves --
    // Cantrip and Dispel Magic wait on Phase 7, not on any rung of this flag.
    const needsSpells = new Set(['Cantrip', 'Dispel Magic'])
    const deferred = new Set(['Choke', 'Confuse', 'Wild Growth'])
    const live = new Set(LIVE_SAIS)
    const targeting = new Set(TARGETING_SAIS)

    const names = new Set<string>()
    for (const type of UNIT_TYPES) {
      for (const face of type.faces) if (face.icon === 'SAI') names.add(face.sai)
    }

    expect(names.size).toBe(25)
    // The split is pinned because the prose in CLAUDE.md, RULES-V0.md and PLAN-V1.md
    // all quote it, and nothing else would notice it going stale. Each Phase 4 slice
    // moves names from `deferred` into `TARGETING_SAIS` and edits these two numbers.
    expect(live.size, 'SAIs live under sai: results').toBe(12)
    expect(targeting.size, 'targeting SAIs built so far').toBe(8)
    expect(deferred.size, 'targeting SAIs still unbuilt').toBe(3)
    expect(needsSpells.size, 'SAIs waiting on Phase 7').toBe(2)

    for (const name of names) {
      const claimed =
        live.has(name) || targeting.has(name) || deferred.has(name) || needsSpells.has(name)
      expect(claimed, `${name} is resolved by no rung`).toBe(true)
    }
    // And nothing is claimed twice, which is how a Phase 4 SAI would quietly ship.
    for (const name of live) {
      expect(targeting.has(name) || deferred.has(name) || needsSpells.has(name), name).toBe(false)
    }
    for (const name of targeting) {
      expect(deferred.has(name) || needsSpells.has(name), name).toBe(false)
    }

    // The partition is not a list here and a different list in the engine: every
    // deferred name must actually refuse under 'full', every built one must resolve,
    // and every targeting one must stay inert under 'results'.
    for (const name of deferred) {
      expect(() =>
        saiEffects(sai(name), { purpose: melee, isCounter: false }, FULL_RULES),
      ).toThrow(/targeting SAIs are not implemented/)
    }
    for (const name of [...live, ...targeting]) {
      expect(() =>
        saiEffects(sai(name), { purpose: melee, isCounter: false }, FULL_RULES),
      ).not.toThrow()
    }
    for (const name of targeting) {
      expect(
        saiEffects(sai(name), { purpose: melee, isCounter: false }, SAI_RULES).effects,
        `${name} must stay inert on the results rung`,
      ).toEqual([])
    }
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

  /**
   * The guard read `sai !== 'results'`, which answered 0 for `'full'` as well as for
   * `'inert'` -- so `maxArmyResults` would have under-bounded every roll the moment a
   * targeting SAI generated a result, and the symptom would have been a roll ceiling
   * quietly below what the dice can do.
   */
  it('bounds a face under sai: full, not only under results', () => {
    expect(saiMaxResults(sai('Counter'), 'save', FULL_RULES)).toBe(4)
    expect(saiMaxResults(sai('Smite'), 'melee', FULL_RULES)).toBe(0)
  })

  /** An unclaimed name is asked about here before `saiEffects` gets to refuse it, so
   *  the bound has to answer rather than throw. */
  it('answers zero for an unimplemented SAI instead of throwing', () => {
    for (const name of ['Flame', 'Cantrip', 'Wild Growth']) {
      expect(() => saiMaxResults(sai(name), 'save', FULL_RULES), name).not.toThrow()
      expect(saiMaxResults(sai(name), 'save', FULL_RULES), name).toBe(0)
    }
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
    const [plain] = rollArmy(armyOf(vine), 'melee', rng, SAI_RULES, [])
    const [doubled] = rollArmy(armyOf(vine), 'melee', rng, SAI_RULES, [doubleIdsModifier('melee')])

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
    effects: [],
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

  it('names the SAI behind the damage, so the log can attribute it', () => {
    const rng = rngShowing([oakLord], [OAK_LORD_SMITE])
    const state = stage({ p1: { frontier: [oakLord] }, p2: { frontier: ['treefolk.oakling'] }, rng })
    const { attackRoll } = attackAt(state, 'melee')

    expect(saisBehind(attackRoll.dice, 'unsavable')).toEqual(['Smite'])
    expect(saisBehind(attackRoll.dice, 'riposte')).toEqual([])
    expect(saiPhrase(attackRoll.dice, 'unsavable')).toBe('Smite')
    // Null, not '', so the caller writes a different sentence rather than one with
    // a hole in it.
    expect(saiPhrase(attackRoll.dice, 'riposte')).toBeNull()
  })

  it('joins several names into one phrase', () => {
    // Counter and Volley can both fire on one save roll, from different dice.
    const dice: DieRoll[] = [
      {
        unitId: 'a',
        typeId: oakLord,
        faceIndex: 0,
        face: { count: 4, icon: 'SAI', sai: 'Counter' },
        results: 4,
        effects: [{ kind: 'riposte', damage: 4 }],
      },
      {
        unitId: 'b',
        typeId: oakLord,
        faceIndex: 0,
        face: { count: 3, icon: 'SAI', sai: 'Volley' },
        results: 3,
        effects: [{ kind: 'riposte', damage: 3 }],
      },
      // Same SAI again: named once, not twice.
      {
        unitId: 'c',
        typeId: oakLord,
        faceIndex: 0,
        face: { count: 2, icon: 'SAI', sai: 'Counter' },
        results: 2,
        effects: [{ kind: 'riposte', damage: 2 }],
      },
      // No effect, so it contributes no name even though it is an SAI face.
      {
        unitId: 'd',
        typeId: oakLord,
        faceIndex: 0,
        face: { count: 4, icon: 'SAI', sai: 'Fly' },
        results: 4,
      },
    ]

    expect(saisBehind(dice, 'riposte')).toEqual(['Counter', 'Volley'])
    expect(saiPhrase(dice, 'riposte')).toBe('Counter and Volley')
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
    expect(resolved.turn.combat).not.toBeNull()
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

/**
 * An exchange is two march steps, so that a targeting SAI can be chosen between the
 * attack roll and the save roll.
 *
 * Nothing chooses anything yet -- these are the guards that the seam exists, that it
 * carries the attack across, and above all that it *drops* it again. A stashed roll
 * that survived into a resting step would put a list of raw dice into
 * `stableJson(state.turn)`, which is in all 25 golden digests.
 */
describe('the two halves of an exchange', () => {
  const twoOaklings = () =>
    stage({
      p1: { frontier: ['treefolk.oakling'] },
      p2: { frontier: ['treefolk.oakling'] },
      rng: rngShowing(['treefolk.oakling', 'treefolk.oakling'], [OAKLING_MELEE, 0]),
      ruleSet: SAI_RULES,
    })

  const atResolveAttack = (state: GameState): GameState => ({
    ...state,
    turn: {
      ...state.turn,
      marchStep: 'resolve_attack',
      combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
    },
  })

  it('stops between the two rolls, holding the attack dice', () => {
    const mid = stepGame(atResolveAttack(twoOaklings()))

    expect(mid.turn.marchStep).toBe('sai_target_attack')
    expect(mid.turn.combat?.attack?.dice).toHaveLength(1)
    // The attack roll has happened; the save roll has not.
    expect(mid.log.some((e) => e.kind === 'combat_resolved')).toBe(false)
  })

  it('drops the stashed roll again once the saves are rolled', () => {
    const done = advance(atResolveAttack(twoOaklings()))

    expect(done.turn.combat?.attack).toBeUndefined()
    expect(done.log.filter((e) => e.kind === 'combat_resolved')).toHaveLength(1)
    expect(validateState(done)).toEqual([])
  })

  /** The guard that stops the previous test being the only thing standing between a
   *  stashed roll and 25 rewritten digests. */
  it('is a validateState complaint if a stashed roll outlives its exchange', () => {
    const state = twoOaklings()
    const stranded: GameState = {
      ...state,
      turn: {
        ...state.turn,
        marchStep: 'offer_counter',
        combat: {
          action: 'melee',
          targetSlot: 'frontier',
          damage: 0,
          attack: { dice: [{ unitId: 'x', typeId: 'treefolk.oakling', faceIndex: 0 }] },
        },
      },
    }

    expect(validateState(stranded)).toEqual([
      expect.stringContaining('an attack roll is still stashed at march step offer_counter'),
    ])
  })

  /**
   * Magic takes no save roll, and used to return before the save roll was reached at
   * all. It now goes through both halves like everything else, because Galeforce
   * applies to "a magic action at a terrain" and an action that short-circuits past
   * the seam is an SAI computed and then dropped.
   */
  it('routes a magic attack through both steps even though it takes no saves', () => {
    const state = twoOaklings()
    const magicAttack = advance({
      ...state,
      turn: {
        ...state.turn,
        marchStep: 'resolve_attack',
        combat: { action: 'magic', targetSlot: 'frontier', damage: 0 },
      },
    })

    const resolved = magicAttack.log.find((e) => e.kind === 'combat_resolved')
    expect(resolved).toBeDefined()
    if (resolved?.kind === 'combat_resolved') {
      expect(resolved.saveTotal, 'magic allows no save roll').toBeNull()
      expect(resolved.action).toBe('magic')
    }
    expect(magicAttack.turn.combat?.attack).toBeUndefined()
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
