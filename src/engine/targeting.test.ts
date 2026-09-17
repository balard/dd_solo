import { describe, expect, it } from 'vitest'

import { unitType } from '../data/load'

import { armyRoll, expireEffects, isAsleep, pruneEffects, type Effect } from './effects'
import type { RollEffect } from './pipeline'
import { advance } from './reduce'
import { rollDice, type RngState } from './rng'
import { targetTasks } from './targeting'
import { applyAction } from './turn'
import {
  IllegalActionError,
  V0_RULES,
  armyAt,
  type ActionKind,
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
  /** Bullseye, Firecloud and Seize are missile SAIs, so the exchange has to be one. */
  readonly action?: ActionKind
  /** A board that already has something on it -- a Sleep, a Galeforce -- which is how
   *  the two rules a sub-roll must *not* obey get tested at all. */
  readonly effects?: readonly Effect[]
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
    effects: options.effects ?? [],
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
      combat: { action: options.action ?? 'melee', targetSlot: 'frontier', damage: 0 },
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

  /** Bullseye rerolls its own die, so one Bullseye face can land twice in a roll --
   *  and two of them are one budget of eight, not two budgets of four. */
  it('sums two Bullseyes the way it sums two Flames', () => {
    const bullseye = (unitId: string): RollEffect => ({
      kind: 'target_enemy',
      health: 4,
      escape: 'save',
      fate: 'kill',
      unitId,
      sai: 'Bullseye',
    })
    expect(targetTasks([bullseye('a'), bullseye('b')])).toEqual([
      { kind: 'enemy', sai: 'Bullseye', health: 8, escape: 'save', fate: 'kill' },
    ])
  })

  /** Grouping is by *name*, not by shape: both of these are `target_enemy`, and they
   *  are two separate decisions. */
  it('keeps a Smother and a Firecloud apart although both target health-worth', () => {
    const firecloud: RollEffect = {
      kind: 'target_enemy',
      health: 4,
      escape: 'maneuver',
      fate: 'kill',
      unitId: 'b',
      sai: 'Firecloud',
    }
    expect(targetTasks([smother('a', 4), firecloud]).map((t) => t.sai)).toEqual([
      'Smother',
      'Firecloud',
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

// --- the sub-rolls: Bullseye, Double Strike, Smother, Firecloud, Seize ---------

/**
 * Phase 4d. Five SAIs whose targets roll dice of their own -- a save roll, a maneuver
 * roll, or a look at the face for an ID icon.
 *
 * The face indices below are read off `data/starter/units.json`; `rngShowing` then
 * finds a counter at which the whole sequence lands, which for these is *attack dice
 * first, then the targets in board order*.
 */
describe('the sub-rolls', () => {
  /** Darktree faces 4 and 9 are `4 SAI:Smother`. */
  const SMOTHER_FACE = 4
  /** Firestormer face 4 is `4 SAI:Bullseye` -- on a **3-health** die. */
  const BULLSEYE_FACE = 4
  /** Firestormer face 0 is its ID: a reroll that is not another Bullseye. */
  const FIRESTORMER_ID = 0
  /** Phoenix face 4 is `4 SAI:Seize`; 1 is `4 SAI:Fly`; 2 is Rise from the Ashes;
   *  5 is `4 SAVE`; 0 is its ID. */
  const SEIZE_FACE = 4
  const PHOENIX_FLY = 1
  const PHOENIX_RISE = 2
  const PHOENIX_SAVE = 5
  /** Willow faces 2 and 3 are `2 MANEUVER`; face 1 is `3 SAVE`, which is no maneuver
   *  at all. Oak face 5 is `4 SAVE`, face 1 is `2 MELEE`, face 0 its ID. */
  const WILLOW_MANEUVER = 2
  const WILLOW_SAVE = 1
  const OAK_SAVE = 5
  const OAK_MELEE = 1
  const OAK_ID = 0

  const idsOf = (state: GameState, typeId: string) =>
    Object.values(state.units)
      .filter((u) => u.typeId === typeId)
      .map((u) => u.id)

  const subRollEntry = (state: GameState) =>
    state.log.find((e) => e.kind === 'sai_sub_roll') as
      | Extract<(typeof state.log)[number], { kind: 'sai_sub_roll' }>
      | undefined

  /** A Smother against two Willows: budget four, so both are taken, and then each
   *  rolls for itself. */
  const smotherBoard = (rng: RngState, effects?: readonly Effect[]) =>
    stage({
      attackers: ['treefolk.darktree'],
      defenders: ['treefolk.willow', 'treefolk.willow'],
      rng,
      ...(effects === undefined ? {} : { effects }),
    })

  it('kills the targets that fail their roll and leaves the ones that make it', () => {
    const start = advance(
      smotherBoard(
        rngShowing(
          ['treefolk.darktree', 'treefolk.willow', 'treefolk.willow'],
          [SMOTHER_FACE, WILLOW_MANEUVER, WILLOW_SAVE],
        ),
      ),
    )

    // X is the count printed on the face -- four, off a monster.
    expect(start.pending).toMatchObject({
      kind: 'sai_target',
      sai: 'Smother',
      limit: { kind: 'health', budget: 4 },
    })

    const [lucky, doomed] = idsOf(start, 'treefolk.willow') as [UnitId, UnitId]
    const done = applyAction(start, { kind: 'sai_target', unitIds: [lucky, doomed] })

    expect(done.units[lucky]?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
    expect(done.units[doomed]?.location).toEqual({ kind: 'dua' })
    expect(subRollEntry(done)).toMatchObject({
      sai: 'Smother',
      test: 'maneuver',
      escaped: [lucky],
    })
    // Cause, then the roll, then the effect -- and no `units_buried`: Smother kills.
    expect(
      done.log.map((e) => e.kind).filter((k) => k.startsWith('sai_') || k.startsWith('units_')),
    ).toEqual(['sai_resolved', 'sai_sub_roll', 'units_killed'])
    expect(validateState(done)).toEqual([])
  })

  /**
   * Bullseye is a **missile** SAI, its X is the 4 printed on the face of a 3-health
   * large die, and "roll this unit again" is the roller's own die at step 3 -- Rend's
   * sentence word for word, so `rerollSweep` already does it. The reroll is what the
   * second Firestormer draw below is.
   */
  it('asks for a save roll on a missile attack, budget off the face and not the die', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.firestormer'],
        defenders: ['treefolk.oak', 'treefolk.oak'],
        action: 'missile',
        rng: rngShowing(
          ['firewalkers.firestormer', 'firewalkers.firestormer', 'treefolk.oak', 'treefolk.oak'],
          [BULLSEYE_FACE, FIRESTORMER_ID, OAK_SAVE, OAK_MELEE],
        ),
      }),
    )

    expect(start.pending).toMatchObject({
      kind: 'sai_target',
      sai: 'Bullseye',
      limit: { kind: 'health', budget: 4 },
    })

    const [saved, killed] = idsOf(start, 'treefolk.oak') as [UnitId, UnitId]
    const done = applyAction(start, { kind: 'sai_target', unitIds: [saved, killed] })

    expect(subRollEntry(done)).toMatchObject({ test: 'save', escaped: [saved] })
    expect(done.units[killed]?.location).toEqual({ kind: 'dua' })
  })

  /**
   * The step-8 stamp, which is the one a sub-roll gets wrong by default: a die showing
   * Fly, Hoof, Counter or Rise from the Ashes *did* generate a save result, it just did
   * it at step 8 rather than step 5. Kill it and every SAI-faced target dies to a
   * Bullseye it should have survived.
   */
  it('spares a target whose save came from an SAI face rather than a save icon', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.firestormer'],
        defenders: ['firewalkers.phoenix'],
        action: 'missile',
        rng: rngShowing(
          ['firewalkers.firestormer', 'firewalkers.firestormer', 'firewalkers.phoenix'],
          [BULLSEYE_FACE, FIRESTORMER_ID, PHOENIX_FLY],
        ),
      }),
    )

    const [phoenix] = idsOf(start, 'firewalkers.phoenix') as [UnitId]
    const done = applyAction(start, { kind: 'sai_target', unitIds: [phoenix] })

    expect(done.units[phoenix]?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
    const entry = subRollEntry(done)
    expect(entry?.escaped).toEqual([phoenix])
    // And the strip shows where the save came from, rather than a blank die beside a
    // survival nobody can account for.
    expect(entry?.dice[0]?.results).toBe(4)
  })

  /** "Roll the targets. If they roll an ID icon, they are immediately moved to their
   *  Reserve Area. Any that do not roll an ID are killed." */
  it('sends a Seized ID to Reserves and kills the rest', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.phoenix'],
        defenders: ['treefolk.oak', 'treefolk.oak'],
        action: 'missile',
        rng: rngShowing(
          ['firewalkers.phoenix', 'treefolk.oak', 'treefolk.oak'],
          [SEIZE_FACE, OAK_ID, OAK_MELEE],
        ),
      }),
    )

    const [seized, killed] = idsOf(start, 'treefolk.oak') as [UnitId, UnitId]
    const done = applyAction(start, { kind: 'sai_target', unitIds: [seized, killed] })

    expect(done.units[seized]?.location).toEqual({ kind: 'reserve' })
    expect(done.units[killed]?.location).toEqual({ kind: 'dua' })
    expect(subRollEntry(done)).toMatchObject({ test: 'id', escaped: [seized], toReserve: true })
    // Moved, not killed: no death trigger fires on an escapee, so the Oak that got out
    // is in no `units_killed` entry.
    expect(
      done.log.flatMap((e) => (e.kind === 'units_killed' ? [...e.unitIds] : [])),
    ).toEqual([killed])
    expect(validateState(done)).toEqual([])
  })

  /** A Seize that fails is an ordinary kill, so `killUnits` fires the death trigger --
   *  two draws in all: the ID roll, and then the Rise roll. */
  it('still gives a Seized Phoenix its Rise from the Ashes roll', () => {
    const start = advance(
      stage({
        attackers: ['firewalkers.phoenix'],
        defenders: ['firewalkers.phoenix'],
        action: 'missile',
        rng: rngShowing(
          ['firewalkers.phoenix', 'firewalkers.phoenix', 'firewalkers.phoenix'],
          [SEIZE_FACE, PHOENIX_SAVE, PHOENIX_RISE],
        ),
      }),
    )

    const [target] = idsOf(start, 'firewalkers.phoenix').filter(
      (id) => start.units[id]?.owner === 'p2',
    ) as [UnitId]
    const before = start.rng.counter
    const done = applyAction(start, { kind: 'sai_target', unitIds: [target] })

    expect(done.rng.counter - before, 'the ID roll, then the Rise roll').toBe(2)
    expect(done.units[target]?.location).toEqual({ kind: 'reserve' })
    expect(done.log.some((e) => e.kind === 'units_risen')).toBe(true)
  })

  /**
   * "The target unit is asleep and cannot be rolled" -- so it makes no save, generates
   * no maneuver result, and dies to whatever asked for one. It also draws nothing on
   * the way, which is the half of the rule a passing test could miss.
   */
  it('kills a sleeping target without rolling it', () => {
    const rng = rngShowing(['treefolk.darktree', 'treefolk.willow'], [SMOTHER_FACE, WILLOW_MANEUVER])
    const board = smotherBoard(rng)
    const [asleepId, awake] = idsOf(board, 'treefolk.willow') as [UnitId, UnitId]
    const start = advance({
      ...board,
      effects: [
        {
          source: 'Sleep',
          target: { kind: 'unit', unitId: asleepId },
          modifiers: [],
          asleep: true,
          expiresAtStartOfTurnOf: 'p1',
        },
      ],
    })

    const before = start.rng.counter
    const done = applyAction(start, { kind: 'sai_target', unitIds: [asleepId, awake] })

    expect(done.rng.counter - before, 'only the awake die was rolled').toBe(1)
    expect(subRollEntry(done)?.dice).toHaveLength(1)
    expect(done.units[asleepId]?.location).toEqual({ kind: 'dua' })
    expect(done.units[awake]?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
  })

  /**
   * "Modifiers that affect an army do not affect the roll of an individual unit from
   * that army" (full rules p. 28). This is the first test that rule can have, and 4c's
   * Galeforce is what makes it writable: minus four maneuver would turn the Willow's
   * two into nothing, and it must not reach this roll at all.
   */
  it('does not let an army modifier reach a unit roll', () => {
    const galeforce: Effect = {
      source: 'Galeforce',
      target: { kind: 'army', player: 'p2', army: 'frontier' },
      modifiers: [
        { kind: 'subtract', resultType: 'save', amount: 4 },
        { kind: 'subtract', resultType: 'maneuver', amount: 4 },
      ],
      expiresAtStartOfTurnOf: 'p1',
    }
    const start = advance(
      stage({
        attackers: ['treefolk.darktree'],
        defenders: ['treefolk.willow'],
        effects: [galeforce],
        rng: rngShowing(['treefolk.darktree', 'treefolk.willow'], [SMOTHER_FACE, WILLOW_MANEUVER]),
      }),
    )

    // The control: the army roll really is carrying the minus four.
    expect(armyRoll(start, 'p2', 'frontier', 'maneuver').modifiers).toHaveLength(2)

    const [willow] = idsOf(start, 'treefolk.willow') as [UnitId]
    const done = applyAction(start, { kind: 'sai_target', unitIds: [willow] })

    expect(done.units[willow]?.location).toEqual({ kind: 'terrain', slot: 'frontier' })
  })

  /** The roll order is the board's, not the order the player happened to type, for the
   *  same reason `death.ts` picks one: two players naming the same dice differently
   *  must get the same game. */
  it('rolls the targets in board order whatever order they were named in', () => {
    const rng = rngShowing(
      ['treefolk.darktree', 'treefolk.willow', 'treefolk.willow'],
      [SMOTHER_FACE, WILLOW_MANEUVER, WILLOW_SAVE],
    )
    const start = advance(smotherBoard(rng))
    const [a, b] = idsOf(start, 'treefolk.willow') as [UnitId, UnitId]

    const forwards = applyAction(start, { kind: 'sai_target', unitIds: [a, b] })
    const backwards = applyAction(start, { kind: 'sai_target', unitIds: [b, a] })

    const dead = (state: GameState) =>
      Object.values(state.units)
        .filter((u) => u.location.kind === 'dua')
        .map((u) => u.id)

    expect(dead(backwards)).toEqual(dead(forwards))
    expect(backwards.rng.counter).toBe(forwards.rng.counter)
  })

  /** The rung that is still a game: a Smother face under `sai: 'results'` is an inert
   *  face, exactly as it was before this slice. */
  it('does nothing at all under sai: results', () => {
    const base = smotherBoard(
      rngShowing(
        ['treefolk.darktree', 'treefolk.willow', 'treefolk.willow'],
        [SMOTHER_FACE, WILLOW_MANEUVER, WILLOW_SAVE],
      ),
    )
    const state = advance({ ...base, ruleSet: { ...base.ruleSet, sai: 'results' } })

    expect(state.pending?.kind).not.toBe('sai_target')
    expect(state.log.some((e) => e.kind === 'sai_sub_roll')).toBe(false)
  })
})
