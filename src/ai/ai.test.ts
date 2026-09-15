import { describe, expect, it } from 'vitest'

import { replay, replayTo } from '../engine/replay'
import { setupGame, STARTER_FORCES, type SetupOptions } from '../engine/setup'
import { livingUnits, type PlayerId } from '../engine/types'
import { validateState } from '../engine/validate'

import { passiveAi } from './passive'
import { randomAi } from './random'
import { runGame } from './run'

const setup = (seed: number, firstPlayer?: PlayerId): SetupOptions => ({
  seed,
  forces: STARTER_FORCES,
  ...(firstPlayer ? { firstPlayer } : {}),
})

describe('PassiveAI', () => {
  it('starts nothing: no marches, no maneuvers, no reserve moves', () => {
    const { state, record } = runGame({
      setup: setup(1, 'p1'),
      players: { p1: passiveAi, p2: passiveAi },
      maxDecisions: 400,
    })

    expect(state.log.some((e) => e.kind === 'march_begin')).toBe(false)
    expect(state.log.some((e) => e.kind === 'maneuver_declared')).toBe(false)
    expect(state.log.some((e) => e.kind === 'terrain_moved')).toBe(false)
    expect(state.log.some((e) => e.kind === 'reinforced')).toBe(false)
    expect(state.log.some((e) => e.kind === 'retreated')).toBe(false)
    expect(record.actions.length).toBeGreaterThan(0)
  })

  it('leaves the board untouched, so two passive players never finish', () => {
    const { state, stoppedBecause } = runGame({
      setup: setup(2, 'p1'),
      players: { p1: passiveAi, p2: passiveAi },
      maxDecisions: 300,
    })

    expect(stoppedBecause).toBe('cap')
    expect(state.winner).toBeNull()
    expect(livingUnits(state, 'p1')).toHaveLength(14)
    expect(livingUnits(state, 'p2')).toHaveLength(14)
  })

  /**
   * "Passive" means "starts nothing", not "never acts". A genuinely inert opponent
   * would leave the whole save/damage/counter path untested, which is exactly the
   * code most worth exercising.
   */
  it('still answers forced decisions, and does counter-attack', () => {
    let countered = false
    let tookDamage = false

    for (let seed = 1; seed <= 40 && !(countered && tookDamage); seed++) {
      const { state } = runGame({
        setup: setup(seed),
        players: { p1: randomAi, p2: passiveAi },
        aiSeed: seed,
        maxDecisions: 1500,
      })
      for (const entry of state.log) {
        if (entry.kind === 'combat_resolved' && entry.isCounter && entry.attacker === 'p2') {
          countered = true
        }
        if (entry.kind === 'units_killed' && entry.player === 'p2') tookDamage = true
      }
    }

    expect(countered, 'PassiveAI should counter-attack when struck').toBe(true)
    expect(tookDamage, 'PassiveAI should assign damage when it loses units').toBe(true)
  })

  it('is deterministic and ignores the ai seed', () => {
    const a = runGame({ setup: setup(9, 'p1'), players: { p1: passiveAi, p2: passiveAi }, aiSeed: 1, maxDecisions: 200 })
    const b = runGame({ setup: setup(9, 'p1'), players: { p1: passiveAi, p2: passiveAi }, aiSeed: 77, maxDecisions: 200 })
    expect(a.record.actions).toEqual(b.record.actions)
  })
})

describe('RandomAI', () => {
  it('is reproducible from its own seed', () => {
    const run = (aiSeed: number) =>
      runGame({ setup: setup(5), players: { p1: randomAi, p2: randomAi }, aiSeed, maxDecisions: 800 })

    expect(run(42).record.actions).toEqual(run(42).record.actions)
    expect(run(42).record.actions).not.toEqual(run(43).record.actions)
  })

  it('reaches decisions PassiveAI never would', () => {
    const { state } = runGame({
      setup: setup(11),
      players: { p1: randomAi, p2: randomAi },
      aiSeed: 11,
      maxDecisions: 2000,
    })
    expect(state.log.some((e) => e.kind === 'march_begin')).toBe(true)
    expect(state.log.some((e) => e.kind === 'terrain_moved')).toBe(true)
    expect(state.log.some((e) => e.kind === 'combat_resolved')).toBe(true)
  })
})

describe('replay', () => {
  /**
   * The determinism guarantee everything downstream rests on -- save/load, undo, and
   * reproducible bug reports. A record is two integers and a list of decisions.
   */
  it('reproduces a game exactly from its record', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { state, record } = runGame({
        setup: setup(seed),
        players: { p1: randomAi, p2: randomAi },
        aiSeed: seed * 7,
        maxDecisions: 1500,
      })
      expect(replay(record), `seed ${seed}`).toEqual(state)
    }
  })

  it('replays a prefix, which is what undo needs', () => {
    const { record } = runGame({
      setup: setup(3),
      players: { p1: randomAi, p2: randomAi },
      aiSeed: 3,
      maxDecisions: 600,
    })
    const half = Math.floor(record.actions.length / 2)
    const partial = replayTo(record, half)

    expect(validateState(partial)).toEqual([])
    expect(replayTo(record, half)).toEqual(partial)
    expect(partial).not.toEqual(replay(record))
  })

  it('records nothing but the setup and the decisions', () => {
    const { record } = runGame({
      setup: setup(4),
      players: { p1: passiveAi, p2: passiveAi },
      maxDecisions: 50,
    })
    expect(Object.keys(record).sort()).toEqual(['actions', 'setup'])
    // Small enough to be a save file or a bug report.
    expect(JSON.stringify(record).length).toBeLessThan(20_000)
  })

  it('agrees with a freshly set-up game when no decisions were taken', () => {
    const record = { setup: setup(6, 'p1'), actions: [] }
    expect(replay(record).units).toEqual(setupGame(setup(6, 'p1')).units)
  })
})

describe('self-play fuzz', () => {
  /**
   * The phase's headline exit criterion. Every intermediate state is checked, so a
   * failure names the seed pair and the decision that broke it.
   *
   * **Rolled forces, not the starter lists.** The two hand-authored forces field one
   * monster each and always the same dice, so a thousand games of them exercised the
   * same 28 dice a thousand times. A rolled force draws from all 20 types of its
   * species and comes in two sizes, which is what makes this worth running again
   * once SAIs are live -- and the seed still reproduces the whole game, setup
   * included, so a failure is still two integers.
   */
  it('survives 1000 random self-play games', { timeout: 180_000 }, () => {
    let decided = 0
    let capped = 0
    let stuck = 0
    let decisions = 0

    for (let i = 0; i < 1000; i++) {
      const result = runGame({
        setup: { seed: i + 1, forces: { kind: 'random' } },
        players: { p1: randomAi, p2: randomAi },
        aiSeed: 500_000 + i,
        maxDecisions: 1200,
        validate: true,
      })
      decisions += result.decisions

      if (result.stoppedBecause === 'winner') decided += 1
      else if (result.stoppedBecause === 'cap') capped += 1
      else stuck += 1
    }

    // A "stuck" game is the real bug signal: no winner and nothing pending means
    // the machine ran out of moves without ending, which should never happen.
    expect(stuck, 'a game ended with no winner and nothing pending').toBe(0)
    expect(decided + capped).toBe(1000)
    expect(decisions).toBeGreaterThan(100_000)
  })
})
