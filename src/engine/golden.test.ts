/**
 * The golden corpora: recorded games that must replay to the same states.
 *
 * - `v0-games.json`, 25 random self-play games under `V0_RULES` (v1 Phase G). The
 *   guard the v1 refactors were measured against, and it stays byte-identical and
 *   unregenerated through v2: nothing there touches `V0_RULES`.
 * - `v1-games.json`, 20 games under `V1_RULES` (v2 Phase 0a), greedy against random
 *   and against itself. The guard for v2 Phase 1's claim that moving species from the
 *   player to the unit changes no single-species game.
 *
 * Each is the only thing in the project able to call a "changes no outcome" claim.
 *
 * The files are read rather than imported so `tsc` does not have to infer a type for
 * a megabyte of literal, and so the shape is asserted here, once, deliberately.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { digestState, type StateDigest } from './digest'
import { replay, type GameRecord } from './replay'
import { V0_RULES, V1_RULES } from './types'

/** Fields the digest gained after the v0 corpus was cut, which that corpus lacks. */
type LaterFields = 'effects' | 'dragons' | 'rollOff'

interface GoldenGame {
  readonly seed: number
  readonly aiSeed: number
  readonly decisions: number
  readonly stoppedBecause: string
  readonly record: GameRecord
  readonly digest: Omit<StateDigest, LaterFields> & Partial<Pick<StateDigest, LaterFields>>
}

interface Corpus {
  readonly version: number
  readonly games: readonly GoldenGame[]
}

function load(file: string): Corpus {
  return JSON.parse(readFileSync(new URL(`./__golden__/${file}`, import.meta.url), 'utf8')) as Corpus
}

const CORPORA = [
  { file: 'v0-games.json', games: 25, rules: V0_RULES },
  { file: 'v1-games.json', games: 20, rules: V1_RULES },
] as const

describe.each(CORPORA)('golden games: $file', ({ file, games, rules }) => {
  const corpus = load(file)

  it(`holds ${games} games, every one of which reached an ending`, () => {
    expect(corpus.games).toHaveLength(games)
    // An unfinished game replays fine and proves less: it never reaches capture,
    // the win check or `game_over`. The recorder selects for endings; this is the
    // assertion that keeps it honest.
    expect(corpus.games.map((g) => g.stoppedBecause)).toEqual(Array<string>(games).fill('winner'))
    expect(corpus.games.every((g) => g.record.actions.length === g.decisions)).toBe(true)
  })

  /**
   * A record stores its `ruleSet` as JSON, and `setupGame` takes it as given -- so a key
   * the live rules gain after recording replays as `undefined`: its off value by
   * accident rather than by decision (the `SAVE_VERSION` 5 hazard, `CLAUDE.md`
   * *Saving*). The v0 corpus predates the field entirely and `setupGame` pins an
   * absent one to `V0_RULES`, which is why it is exempt.
   *
   * If this fails, a key was added to `V1_RULES`: decide what the recorded games mean
   * without it, and write that down, before regenerating anything.
   */
  it('was recorded under every key its ruleset has today', () => {
    for (const game of corpus.games) {
      const recorded = game.record.setup.ruleSet
      if (rules === V0_RULES) {
        expect(recorded, `seed ${game.seed}`).toBeUndefined()
        continue
      }
      expect(Object.keys(recorded ?? {}).sort(), `seed ${game.seed}`).toEqual(Object.keys(rules).sort())
    }
  })

  it('replays every one to the state it was recorded from', () => {
    for (const game of corpus.games) {
      const actual = digestState(replay(game.record))
      const label = `${file} seed ${game.seed}`

      // Cheapest signal first, whole log last. Comparing the digests wholesale
      // works, but it answers "something moved" with a truncated dump of both;
      // this way the failure names the field, and you only meet the log diff --
      // hundreds of entries -- once the summary fields agree.
      //
      // The log is not redundant with them. A roll can change and the game still
      // reach the same end: more melee results than were needed, or a save that
      // was already enough. Those are exactly the changes a refactor is claiming
      // not to make, and the per-die results in the log are the only record of
      // them.
      expect(actual.winner, `${label} winner`).toEqual(game.digest.winner)
      expect(actual.rngCounter, `${label} rngCounter`).toEqual(game.digest.rngCounter)
      expect(actual.terrains, `${label} terrains`).toEqual(game.digest.terrains)
      expect(actual.turn, `${label} turn`).toEqual(game.digest.turn)
      // The v0 corpus predates `effects`, `dragons` and `rollOff`, and an absent one
      // means none -- which is what every `V0_RULES` game has. Read that way rather
      // than regenerating 25 games for fields that are empty in all of them. The v1
      // corpus carries all three.
      expect(actual.effects, `${label} effects`).toEqual(game.digest.effects ?? [])
      expect(actual.dragons, `${label} dragons`).toEqual(game.digest.dragons ?? [])
      expect(actual.rollOff, `${label} rollOff`).toEqual(game.digest.rollOff ?? 'none')
      expect(actual.pending, `${label} pending`).toEqual(game.digest.pending)
      expect(actual.units, `${label} units`).toEqual(game.digest.units)
      expect(actual.log, `${label} log`).toEqual(game.digest.log)
    }
  })
})
