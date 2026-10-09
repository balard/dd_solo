/**
 * The run's encounters and its battles (v3 Phase 1): the data loads and is legal, every
 * opponent is one the clients can resolve, and every battle in the data sets up for
 * every race -- the phase's exit criterion.
 */
import { describe, expect, it } from 'vitest'

import { OPPONENT_NAMES } from '../ai/opponents'
import { unitType } from '../data/load'
import { PRESET_ARMY_NAMES } from '../data/presets'
import { builtForceHealth, dragonCount, type BuiltForce } from '../engine/force'
import { PLAYABLE_SPECIES } from '../engine/playable'
import { setupGame } from '../engine/setup'
import { V1_RULES, forceSize } from '../engine/types'
import { validateState } from '../engine/validate'

import { battleSeed, battleSetup, enemyForce } from './battle'
import { RUN_CONTENT, readEncounters, readEnemyForces } from './encounters'
import { newRun, reduceRun } from './reduce'
import { ACTS, ACT_SIZE, ENCOUNTERS_PER_ACT, type BattleEncounter, type RunState } from './types'

const battles: readonly BattleEncounter[] = ACTS.flatMap((act) =>
  RUN_CONTENT.acts[act].filter((e): e is BattleEncounter => e.kind === 'battle'),
)

/** A run of this race standing on this battle, at its act and encounter number. */
function standingOn(encounter: BattleEncounter, race: string, seed = 1, number = 0): RunState {
  const run = reduceRun(newRun(seed), { kind: 'pick_race', race })
  return { ...run, act: encounter.act, encounter: number, current: encounter, pending: { kind: 'battle', encounter } }
}

const speciesOf = (force: BuiltForce): readonly string[] => [
  ...new Set(PRESET_ARMY_NAMES.flatMap((a) => force.armies[a]).map((id) => unitType(id).species)),
]

describe('the encounters in the data', () => {
  it('hold more than twelve an act, both kinds in each, every enemy force met', () => {
    for (const act of ACTS) {
      const list = RUN_CONTENT.acts[act]
      expect(list.length).toBeGreaterThan(ENCOUNTERS_PER_ACT)
      expect(list.some((e) => e.kind === 'battle')).toBe(true)
      expect(list.some((e) => e.kind === 'event')).toBe(true)
      for (const e of list) expect(e.act).toBe(act)
    }
    const built = battles.flatMap((b) => ('built' in b.enemy ? [b.enemy.built] : []))
    expect([...built].sort()).toEqual(Object.keys(RUN_CONTENT.forces).sort())
  })

  // src/run/ may not import src/ai/, so the loader cannot ask this. The test can.
  it('names only opponents the clients can resolve, and never random', () => {
    for (const battle of battles) {
      expect(OPPONENT_NAMES, battle.id).toContain(battle.opponent)
      expect(battle.opponent).not.toBe('random')
    }
  })

  it('meets every playable species somewhere', () => {
    const met = new Set(
      battles.flatMap((b) => {
        if ('built' in b.enemy) return speciesOf(RUN_CONTENT.forces[b.enemy.built] as BuiltForce)
        return b.enemy.pool.kind === 'species' ? [b.enemy.pool.species] : []
      }),
    )
    expect([...met].sort()).toEqual(PLAYABLE_SPECIES.map((s) => s.id).sort())
  })
})

describe('battleSetup', () => {
  // The exit criterion: every battle in the data sets up, for every race.
  it.each(PLAYABLE_SPECIES.map((s) => s.id))('sets up every battle in the data for %s', (race) => {
    for (const battle of battles) {
      const options = battleSetup(standingOn(battle, race))
      expect(options.ruleSet).toEqual(V1_RULES)
      const state = setupGame(options)
      expect(validateState(state), battle.id).toEqual([])
      expect(forceSize(state, 'p1')).toBe(12)
      expect(forceSize(state, 'p2'), battle.id).toBe(ACT_SIZE[battle.act])
    }
  })

  it('rolls a pool enemy at the act size from the pool it names', () => {
    for (const battle of battles) {
      const force = enemyForce(standingOn(battle, 'treefolk'))
      expect(builtForceHealth(force), battle.id).toBe(ACT_SIZE[battle.act])
      if ('pool' in battle.enemy && battle.enemy.pool.kind === 'species') {
        expect(speciesOf(force)).toEqual([battle.enemy.pool.species])
      }
    }
  })

  it('fixes the enemy whole before the battle, and setup plays exactly that', () => {
    for (const battle of battles) {
      const run = standingOn(battle, 'treefolk')
      const enemy = enemyForce(run)
      expect(enemy.homeTerrain, battle.id).toBeDefined()
      expect(enemy.frontierProposal, battle.id).toBeDefined()
      expect(enemy.dragons, battle.id).toHaveLength(dragonCount(builtForceHealth(enemy)))

      const state = setupGame(battleSetup(run))
      expect(state.terrains.p2_home.dieId, battle.id).toBe(enemy.homeTerrain)
      // A run's battle names no first player and pins no Frontier, so both propose.
      const rollOff = state.log.find((e) => e.kind === 'roll_off')
      expect(rollOff?.kind === 'roll_off' ? rollOff.proposals?.p2 : null, battle.id).toBe(enemy.frontierProposal)
      const theirDragons = Object.values(state.dragons).filter((d) => d.owner === 'p2').map((d) => d.dieId)
      expect([...theirDragons].sort(), battle.id).toEqual([...(enemy.dragons ?? [])].sort())
    }
  })

  it("does not move the enemy when the player rearranges their own force", () => {
    const battle = battles[0] as BattleEncounter
    const run = standingOn(battle, 'treefolk')
    const { home, campaign, horde } = run.force.armies
    const swapped = { ...run, force: { ...run.force, armies: { home: horde, campaign, horde: home } } }
    expect(enemyForce(swapped)).toEqual(enemyForce(run))
    expect(setupGame(battleSetup(swapped)).terrains.p2_home.dieId).toBe(enemyForce(run).homeTerrain)
  })

  it("is the same game on a restart, however far the run's own stream has gone", () => {
    const battle = battles[0] as BattleEncounter
    const run = standingOn(battle, 'goblins', 77, 5)
    const later = { ...run, rng: { ...run.rng, counter: run.rng.counter + 1234 } }
    expect(battleSetup(later)).toEqual(battleSetup(run))
    expect(setupGame(battleSetup(later))).toEqual(setupGame(battleSetup(run)))
  })

  it('gives every battle of a run its own seed, and another run other seeds', () => {
    const seeds = ACTS.flatMap((act) => Array.from({ length: ENCOUNTERS_PER_ACT }, (_, n) => battleSeed(9, act, n)))
    expect(new Set(seeds).size).toBe(seeds.length)
    expect(battleSeed(10, 1, 0)).not.toBe(battleSeed(9, 1, 0))
  })

  it('refuses an event: there is no battle in hand', () => {
    const run = reduceRun(newRun(1), { kind: 'pick_race', race: 'treefolk' })
    const event = { ...run, current: RUN_CONTENT.acts[1].find((e) => e.kind === 'event') ?? null }
    expect(() => battleSetup(event)).toThrow(/no battle in hand/)
  })
})

describe('readEncounters', () => {
  const ok: BuiltForce = {
    armies: {
      home: ['treefolk.oak_lord', 'treefolk.oakling'],
      campaign: ['treefolk.oak', 'treefolk.pineling', 'treefolk.nymph'],
      horde: ['treefolk.pine', 'treefolk.willowling', 'treefolk.hamadryad'],
    },
  }
  const battle = (id: string, extra: object = {}) => ({
    id,
    kind: 'battle',
    name: id,
    enemy: { pool: { kind: 'mixed' } },
    opponent: 'greedy',
    ...extra,
  })
  const event = (id: string) => ({ id, kind: 'event', name: id })
  const act = (n: number) => [...Array.from({ length: 12 }, (_, i) => battle(`a${n}.b${i}`)), event(`a${n}.e`)]
  const problemsOf = (value: unknown, forces: Readonly<Record<string, BuiltForce>> = {}) => {
    const read = readEncounters(value, forces)
    return 'problems' in read ? read.problems : []
  }

  it('accepts a minimal content: thirteen an act, both kinds', () => {
    expect(problemsOf({ acts: { 1: act(1), 2: act(2), 3: act(3) } })).toEqual([])
  })

  it('names every problem at once', () => {
    const bad = {
      acts: {
        1: [...act(1), battle('a1.b0')],
        2: act(2).slice(0, 12),
        3: [
          ...act(3).slice(0, 12),
          battle('a3.x', { enemy: { pool: { kind: 'species', species: 'elves' } } }),
          battle('a3.y', { opponent: 'random' }),
          battle('a3.z', { enemy: { built: 'treefolk-12' } }),
          battle('a3.w', { enemy: { built: 'nowhere' } }),
          battle('a3.v', { enemy: { pool: { kind: 'mixed' }, built: 'treefolk-12' } }),
          { id: 'a3.u', kind: 'shop', name: 'Shop' },
        ],
      },
    }
    expect(problemsOf(bad, { 'treefolk-12': ok, unused: ok })).toEqual([
      'a1.b0 is used twice',
      'act 2 holds 12 encounters; a run draws 12, so it needs more',
      'act 2 has no event',
      'a3.x (act 3, encounter 13): there is no species elves',
      'a3.y (act 3, encounter 14): random is the fuzz opponent, not an opponent',
      'a3.z (act 3, encounter 15): treefolk-12 is 12 health, and Act 3 meets 36',
      'a3.w (act 3, encounter 16): there is no enemy force nowhere in data/forces/enemies/',
      'a3.v (act 3, encounter 17): an enemy is a pool or a built force, exactly one',
      'a3.u (act 3, encounter 18): its kind is "battle" or "event"',
      'act 3 has no event',
      'no encounter meets the enemy force treefolk-12',
      'no encounter meets the enemy force unused',
    ])
  })

  it("reads an enemy force file, and refuses an illegal one by the engine's sentence", () => {
    const read = readEnemyForces({
      '../../data/forces/enemies/good.json': { _comment: 'fine', ...ok },
      '../../data/forces/enemies/bad.json': { armies: { ...ok.armies, horde: [] } },
      '../../data/forces/enemies/junk.json': [],
    })
    expect(Object.keys(read.forces)).toEqual(['good'])
    expect(read.problems).toEqual([
      'enemy bad: its horde army is empty; each army needs at least one unit',
      'enemy junk: missing, or not an object',
    ])
  })
})
