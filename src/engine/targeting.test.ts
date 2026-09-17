import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'

import { armyRoll, expireEffects, isAsleep, pruneEffects } from './effects'
import type { RollEffect } from './pipeline'
import { advance } from './reduce'
import { rollDice, type RngState } from './rng'
import { targetTasks } from './targeting'
import { applyAction } from './turn'
import {
  IllegalActionError,
  V0_RULES,
  armyAt,
  type GameState,
  type RuleSet,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from './types'
import { validateState } from './validate'

const FULL_RULES: RuleSet = { ...V0_RULES, sai: 'full' }

/** Gorgon faces 1 and 7 are both `2 SAI:Flame`; the die is 4 health. */
const FLAME_FACES = [1, 7]

const flame = (unitId: string, health = 2): RollEffect => ({
  kind: 'target_enemy',
  health,
  escape: 'none',
  fate: 'bury',
  unitId,
  sai: 'Flame',
})

const smother = (unitId: string, health = 2): RollEffect => ({
  kind: 'target_enemy',
  health,
  escape: 'maneuver',
  fate: 'kill',
  unitId,
  sai: 'Smother',
})

/** The RNG counter at which these dice show these faces. */
function rngShowing(typeIds: readonly string[], faces: readonly number[]): RngState {
  const counts = typeIds.map((id) => unitType(id).faces.length)
  for (let counter = 0; counter < 2_000_000; counter += 1) {
    const [indices] = rollDice({ seed: 1, counter }, counts)
    if (faces.every((face, i) => indices[i] === face)) return { seed: 1, counter }
  }
  throw new Error(`no counter shows ${typeIds.join(', ')} on faces ${faces.join(', ')}`)
}

/** A board with the named dice standing where they are put, mid-melee at the Frontier. */
function stage(options: {
  readonly attackers: readonly string[]
  readonly defenders: readonly string[]
  readonly rng: RngState
  /** Enemy dice standing somewhere else, for Galeforce's "an army at *any* terrain". */
  readonly elsewhere?: { readonly slot: TerrainSlot; readonly units: readonly string[] }
}): GameState {
  const units: Record<UnitId, UnitInstance> = {}
  const place = (
    owner: 'p1' | 'p2',
    typeIds: readonly string[],
    slot: TerrainSlot = 'frontier',
  ) =>
    typeIds.forEach((typeId, i) => {
      const id = `${owner}:${slot}:${i}`
      units[id] = { id, typeId, owner, location: { kind: 'terrain', slot } }
    })
  place('p1', options.attackers)
  place('p2', options.defenders)
  if (options.elsewhere) place('p2', options.elsewhere.units, options.elsewhere.slot)

  const terrain = (slot: TerrainSlot) =>
    ({ slot, dieId: 'highland_tower', face: 6 as const, capturedBy: null })

  return {
    ruleSet: { ...FULL_RULES, dua: 'active' },
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
      marchStep: 'resolve_attack',
      marchingArmy: 'frontier',
      armiesMarched: ['frontier'],
      combat: { action: 'melee', targetSlot: 'frontier', damage: 0 },
    },
    pending: null,
    log: [],
    winner: null,
  }
}

// --- the order and combination rules -----------------------------------------

describe('targetTasks', () => {
  it('ignores every effect that is not a targeting one', () => {
    const effects: readonly RollEffect[] = [
      { kind: 'unsavable', damage: 4, unitId: 'a', sai: 'Smite' },
      { kind: 'riposte', damage: 4, unitId: 'b', sai: 'Counter' },
      { kind: 'suppress_counter', unitId: 'c', sai: 'Surprise' },
    ]
    expect(targetTasks(effects)).toEqual([])
  })

  /**
   * "Multiples of the same SAI may be combined to create a single larger effect"
   * (p. 27), and v1 always does -- see the house rule in `targeting.ts`. This is the
   * case that shows why it matters rather than being tidier: two Flames of two
   * health-worth can take nothing from a 3-health die, and one Flame of four takes it.
   */
  it('sums two dice of the same SAI into one larger effect', () => {
    expect(targetTasks([flame('a'), flame('b')])).toEqual([
      { kind: 'enemy', sai: 'Flame', health: 4, escape: 'none', fate: 'bury' },
    ])
  })

  it('keeps different SAIs apart, in roll order', () => {
    const other = smother('b')
    const tasks = targetTasks([flame('a'), other, flame('c')])
    expect(tasks.map((t) => [t.sai, t.kind === 'enemy' ? t.health : null])).toEqual([
      ['Flame', 4],
      ['Smother', 2],
    ])
  })

  it('orders by first appearance, which is the order the dice were rolled', () => {
    const other = smother('a')
    expect(targetTasks([other, flame('b')]).map((t) => t.sai)).toEqual(['Smother', 'Flame'])
  })
})

// --- Flame, end to end --------------------------------------------------------

describe('Flame', () => {
  /**
   * `2 SAI:Flame` is a *budget*, not a result count, and against an army of monsters
   * two health-worth can take nothing at all -- no die is small enough. So no decision
   * is raised, the same way damage too small to kill is dropped rather than asked
   * about (`RULES-V0.md` section 6).
   *
   * This is the test that fails if the face count is ever read as "four results,
   * because it is a monster face": a budget of 4 would take a Gorgon.
   */
  it('raises no decision when nothing is small enough to take', () => {
    const state = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['firewalkers.gorgon', 'firewalkers.gorgon'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )

    expect(state.pending?.kind).not.toBe('sai_target')
    expect(state.log.some((e) => e.kind === 'sai_resolved')).toBe(false)
    // Every defender is still standing: nothing was taken, and nothing was buried.
    expect(Object.values(state.units).filter((u) => u.location.kind === 'bua')).toEqual([])
  })

  it('asks the attacker, about the defending army', () => {
    const state = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['treefolk.oak', 'treefolk.oakling'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )

    expect(state.pending).toEqual({
      kind: 'sai_target',
      // The roller chooses -- the first pending in the game addressed to someone
      // other than the owner of the dice at stake.
      player: 'p1',
      sai: 'Flame',
      target: 'p2',
      slot: 'frontier',
      limit: { kind: 'health', budget: 2 },
      remaining: 1,
    })
  })

  it('kills and buries what it takes, and says so in that order', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['treefolk.oak', 'treefolk.oakling'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )
    // Two health-worth, maximally: the Oak exactly, never the 1-health Oakling.
    const oak = Object.values(start.units).find((u) => u.typeId === 'treefolk.oak')!
    const done = applyAction(start, { kind: 'sai_target', unitIds: [oak.id] })

    expect(done.units[oak.id]?.location).toEqual({ kind: 'bua' })
    expect(done.log.map((e) => e.kind).filter((k) => k.startsWith('sai_') || k.startsWith('units_')))
      .toEqual(['sai_resolved', 'units_killed', 'units_buried'])
    expect(validateState(done)).toEqual([])
  })

  it('refuses a selection that is not maximal', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['treefolk.oak', 'treefolk.oakling'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )
    const oakling = Object.values(start.units).find((u) => u.typeId === 'treefolk.oakling')!

    // One health-worth when two is available: p. 32 forces the maximum.
    expect(() => applyAction(start, { kind: 'sai_target', unitIds: [oakling.id] })).toThrow(
      IllegalActionError,
    )
  })

  /**
   * Two Flame dice make one budget of four, which is the only way a Flame reaches a
   * monster -- and the monster it reaches here is the one die in the game that can
   * answer back.
   *
   * **This is the `killAndBury` test.** "The targets are killed and buried" is two
   * steps because a live unit passes through the DUA on its way to the BUA, and a
   * Phoenix "may roll once when killed and again when buried". So the draw count is
   * the evidence: two draws and it is buried, one draw and it rose before the burial
   * could happen. A short-cut straight to the BUA would take one draw and always
   * bury, and nothing but this would notice.
   */
  it('gives a Flamed Phoenix both of its rolls', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.gorgon', 'firewalkers.gorgon'],
        defenders: ['firewalkers.phoenix'],
        rng: rngShowing(['firewalkers.gorgon', 'firewalkers.gorgon'], FLAME_FACES),
      }),
    )

    expect(start.pending).toMatchObject({
      kind: 'sai_target',
      sai: 'Flame',
      limit: { kind: 'health', budget: 4 },
    })

    const phoenix = Object.values(start.units).find((u) => u.typeId === 'firewalkers.phoenix')!
    const before = start.rng.counter
    const done = applyAction(start, { kind: 'sai_target', unitIds: [phoenix.id] })
    const draws = done.rng.counter - before

    if (done.units[phoenix.id]?.location.kind === 'bua') {
      expect(draws, 'buried: it failed to rise on death and again on burial').toBe(2)
      expect(done.log.some((e) => e.kind === 'units_buried')).toBe(true)
    } else {
      expect(done.units[phoenix.id]?.location).toEqual({ kind: 'reserve' })
      expect(draws, 'risen: the first roll saved it, so there was no burial').toBe(1)
      expect(done.log.some((e) => e.kind === 'units_buried')).toBe(false)
    }
  })

  it('wins the game outright when it takes the last defender', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.gorgon'],
        defenders: ['treefolk.oak'],
        rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
      }),
    )
    const oak = Object.values(start.units).find((u) => u.typeId === 'treefolk.oak')!
    const done = advance(applyAction(start, { kind: 'sai_target', unitIds: [oak.id] }))

    expect(done.winner).toBe('p1')
    // The save roll never happened: there was nobody left to make it.
    expect(done.log.some((e) => e.kind === 'combat_resolved')).toBe(false)
  })

  /** Under the rung Phase 1 shipped, Flame is still just an inert face. */
  it('does nothing at all under sai: results', () => {
    const base = stage({
      attackers: ['firewalkers.gorgon'],
      defenders: ['treefolk.oak', 'treefolk.oakling'],
      rng: rngShowing(['firewalkers.gorgon'], [FLAME_FACES[0]!]),
    })
    const state = advance({ ...base, ruleSet: { ...base.ruleSet, sai: 'results' } })

    expect(state.pending?.kind).not.toBe('sai_target')
    expect(Object.values(state.units).filter((u) => u.location.kind === 'bua')).toEqual([])
  })
})

// --- Sleep and Galeforce: the first effects with a duration -------------------

/**
 * Phase 3 built `Effect`, `armyRoll`, `expireEffects`, `pruneEffects` and the `asleep`
 * status, and left them with no caller. These two are the caller.
 *
 * Both are cast during the *attacker's* roll and must bite in that same exchange --
 * which is what the Phase 4a seam was for. A Sleep that only took hold next turn would
 * pass a test that checked `state.effects` and still be wrong about the rule.
 */
describe('Sleep', () => {
  /** Satyr face 1 is `4 SAI:Sleep`; face 0 is its ID, worth 4 melee in an attack. */
  const SLEEP_FACE = 1
  const SATYR_ID_FACE = 0
  /** Oak face 5 is `4 SAVE`. */
  const OAK_SAVE_FACE = 5

  const twoSatyrs = () =>
    stage({
      attackers: ['treefolk.satyr', 'treefolk.satyr'],
      defenders: ['treefolk.oak', 'treefolk.oak'],
      rng: rngShowing(
        ['treefolk.satyr', 'treefolk.satyr', 'treefolk.oak'],
        [SLEEP_FACE, SATYR_ID_FACE, OAK_SAVE_FACE],
      ),
    })

  it('asks for one die, not health-worth', () => {
    expect(advance(twoSatyrs()).pending).toMatchObject({
      kind: 'sai_target',
      sai: 'Sleep',
      player: 'p1',
      target: 'p2',
      // One die is one die whatever it weighs -- an Oakling and a monster alike.
      limit: { kind: 'one' },
    })
  })

  /**
   * The whole reason Sleep waited for Phase 4a.
   *
   * The die is taken out of the save roll of the very exchange that put it to sleep,
   * so that roll uses one die instead of two -- and consumes one draw instead of two,
   * which is the half a test of `state.effects` alone would miss.
   */
  it('takes the slept die out of the save roll that follows, in the same exchange', () => {
    const start = advance(twoSatyrs())
    const victim = armyAt(start, 'p2', 'frontier')[0]!

    const before = start.rng.counter
    const done = advance(applyAction(start, { kind: 'sai_target', unitIds: [victim.id] }))

    const resolved = done.log.find((e) => e.kind === 'combat_resolved')
    expect(resolved?.kind === 'combat_resolved' && resolved.saveDice?.length).toBe(1)
    expect(
      resolved?.kind === 'combat_resolved' &&
        resolved.saveDice?.some((d) => d.unitId === victim.id),
    ).toBe(false)
    // One draw for the save roll, not two: a sleeping die is not rolled at all.
    expect(done.rng.counter - before).toBe(1)
  })

  it('leaves the die in its army, and still killable', () => {
    const start = advance(twoSatyrs())
    const victim = armyAt(start, 'p2', 'frontier')[0]!
    const done = applyAction(start, { kind: 'sai_target', unitIds: [victim.id] })

    expect(armyAt(done, 'p2', 'frontier').map((u) => u.id)).toContain(victim.id)
    expect(isAsleep(done, victim.id)).toBe(true)
    expect(validateState(done)).toEqual([])
  })

  it('names the caster in the log, because that is whose turn ends it', () => {
    const start = advance(twoSatyrs())
    const victim = armyAt(start, 'p2', 'frontier')[0]!
    const done = applyAction(start, { kind: 'sai_target', unitIds: [victim.id] })

    expect(done.log.find((e) => e.kind === 'effect_cast')).toMatchObject({
      kind: 'effect_cast',
      source: 'Sleep',
      player: 'p1',
      target: 'p2',
      unitId: victim.id,
    })
  })

  it('ends at the start of the caster’s next turn, not the victim’s', () => {
    const start = advance(twoSatyrs())
    const victim = armyAt(start, 'p2', 'frontier')[0]!
    const cast = applyAction(start, { kind: 'sai_target', unitIds: [victim.id] })

    const atTurnOf = (marching: 'p1' | 'p2') =>
      expireEffects({ ...cast, turn: { ...cast.turn, marching } })

    // p1 cast it, so p2's whole turn passes with the die still asleep.
    expect(isAsleep(atTurnOf('p2'), victim.id)).toBe(true)
    expect(isAsleep(atTurnOf('p1'), victim.id)).toBe(false)
  })

  /**
   * Sleep is one of the SAIs p. 32 names as never combined, so two Satyrs rolling it
   * ask twice. That is also the case that breaks `App`'s draft key -- which is why
   * `remaining` exists, and why it counts *down*.
   */
  it('asks once per die, and counts down so the two questions differ', () => {
    const state = advance(
      stage({
        attackers: ['treefolk.satyr', 'treefolk.satyr'],
        defenders: ['treefolk.oak', 'treefolk.oak'],
        rng: rngShowing(['treefolk.satyr', 'treefolk.satyr'], [SLEEP_FACE, SLEEP_FACE]),
      }),
    )
    expect(state.pending).toMatchObject({ kind: 'sai_target', sai: 'Sleep', remaining: 2 })

    const first = armyAt(state, 'p2', 'frontier')[0]!
    const next = advance(applyAction(state, { kind: 'sai_target', unitIds: [first.id] }))
    expect(next.pending).toMatchObject({ kind: 'sai_target', sai: 'Sleep', remaining: 1 })

    // Both dice end up asleep, and they are different dice: the second question is a
    // real second question, not the first one asked again.
    const second = armyAt(next, 'p2', 'frontier').find((u) => u.id !== first.id)!
    const done = applyAction(next, { kind: 'sai_target', unitIds: [second.id] })
    expect(done.effects.map((e) => e.target)).toEqual([
      { kind: 'unit', unitId: first.id },
      { kind: 'unit', unitId: second.id },
    ])
    // That the *clients* can tell the two apart is `pendingKey`, in prompts.test.ts.
  })

  it('refuses two dice, or a die from the wrong army', () => {
    const start = advance(twoSatyrs())
    const army = armyAt(start, 'p2', 'frontier')
    const mine = armyAt(start, 'p1', 'frontier')[0]!

    expect(() => applyAction(start, { kind: 'sai_target', unitIds: army.map((u) => u.id) })).toThrow(
      IllegalActionError,
    )
    expect(() => applyAction(start, { kind: 'sai_target', unitIds: [mine.id] })).toThrow(
      IllegalActionError,
    )
  })
})

describe('Galeforce', () => {
  /** Genie face 1 is `4 SAI:Galeforce`; face 6 is `4 MELEE`. */
  const GALEFORCE_FACE = 1
  const GENIE_MELEE_FACE = 6
  const OAK_SAVE_FACE = 5

  /**
   * Two Genies: one casts, one supplies the four melee results.
   *
   * The second is not decoration. A Galeforce face generates no results at all, so a
   * Genie rolling it alone makes a zero-total attack -- which earns no save roll, and
   * the save roll is the only place a -4 save could be seen.
   */
  const genieVsOak = (elsewhere?: { slot: TerrainSlot; units: readonly string[] }) =>
    stage({
      attackers: ['firewalkers.genie', 'firewalkers.genie'],
      defenders: ['treefolk.oak'],
      rng: rngShowing(
        ['firewalkers.genie', 'firewalkers.genie', 'treefolk.oak'],
        [GALEFORCE_FACE, GENIE_MELEE_FACE, OAK_SAVE_FACE],
      ),
      ...(elsewhere ? { elsewhere } : {}),
    })

  it('offers every terrain the opponent holds, not just the one under attack', () => {
    expect(advance(genieVsOak({ slot: 'p2_home', units: ['treefolk.oak'] })).pending).toMatchObject({
      kind: 'sai_target_army',
      sai: 'Galeforce',
      player: 'p1',
      options: ['frontier', 'p2_home'],
    })
  })

  /**
   * The -4 lands in the exchange that cast it: the Oak rolls `4 SAVE`, Galeforce takes
   * that to 0, and the four melee gets through whole. The same dice aimed elsewhere
   * are 4 melee against 4 saves for nothing -- which is the control, below.
   */
  it('subtracts four saves from the very exchange that cast it', () => {
    const start = advance(genieVsOak())
    const done = advance(applyAction(start, { kind: 'sai_target_army', slot: 'frontier' }))

    const resolved = done.log.find((e) => e.kind === 'combat_resolved')
    expect(resolved?.kind === 'combat_resolved' && resolved.attackTotal).toBe(4)
    expect(resolved?.kind === 'combat_resolved' && resolved.saveTotal).toBe(0)
    expect(resolved?.kind === 'combat_resolved' && resolved.damage).toBe(4)
  })

  it('leaves the attacked army alone when it is aimed somewhere else', () => {
    const start = advance(genieVsOak({ slot: 'p2_home', units: ['treefolk.oak'] }))
    const done = advance(applyAction(start, { kind: 'sai_target_army', slot: 'p2_home' }))

    const resolved = done.log.find((e) => e.kind === 'combat_resolved')
    expect(resolved?.kind === 'combat_resolved' && resolved.saveTotal).toBe(4)
    expect(resolved?.kind === 'combat_resolved' && resolved.damage).toBe(0)
    expect(done.effects[0]?.target).toEqual({ kind: 'army', player: 'p2', army: 'p2_home' })
  })

  it('subtracts from maneuver too, which is why an effect carries a list', () => {
    const start = advance(genieVsOak())
    const done = applyAction(start, { kind: 'sai_target_army', slot: 'frontier' })

    expect(done.effects[0]?.modifiers).toEqual([
      { kind: 'subtract', resultType: 'save', amount: 4 },
      { kind: 'subtract', resultType: 'maneuver', amount: 4 },
    ])
    expect(armyRoll(done, 'p2', 'frontier', 'maneuver').modifiers).toContainEqual({
      kind: 'subtract',
      resultType: 'maneuver',
      amount: 4,
    })
  })

  it('refuses a terrain where the opponent has nothing', () => {
    const start = advance(genieVsOak())
    expect(() => applyAction(start, { kind: 'sai_target_army', slot: 'p2_home' })).toThrow(
      IllegalActionError,
    )
  })

  it('is dropped once the army it sits on is gone', () => {
    const start = advance(genieVsOak())
    const cast = applyAction(start, { kind: 'sai_target_army', slot: 'frontier' })
    expect(cast.effects).toHaveLength(1)

    const emptied: GameState = {
      ...cast,
      units: Object.fromEntries(
        Object.entries(cast.units).map(([id, unit]) => [
          id,
          unit.owner === 'p2' ? { ...unit, location: { kind: 'dua' as const } } : unit,
        ]),
      ),
    }
    expect(pruneEffects(emptied).effects).toEqual([])
  })
})
