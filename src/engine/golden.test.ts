/**
 * The golden corpus: 25 recorded v0 games that must replay to the same states.
 *
 * This is the guard the v1 refactors are measured against. Phase 0b changes how a
 * roll is computed and Phase 0a changes how a board is set up; both claim to leave
 * outcomes alone, and this is the only thing in the project able to call that
 * claim.
 *
 * The file is read rather than imported so `tsc` does not have to infer a type for
 * a megabyte of literal, and so the shape is asserted here, once, deliberately.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { digestState, type StateDigest } from './digest'
import { replay, type GameRecord } from './replay'

interface GoldenGame {
  readonly seed: number
  readonly aiSeed: number
  readonly decisions: number
  readonly stoppedBecause: string
  readonly record: GameRecord
  readonly digest: StateDigest
}

const corpus = JSON.parse(
  readFileSync(new URL('./__golden__/v0-games.json', import.meta.url), 'utf8'),
) as { readonly version: number; readonly games: readonly GoldenGame[] }

describe('golden games', () => {
  it('holds 25 games, every one of which reached an ending', () => {
    expect(corpus.games).toHaveLength(25)
    // An unfinished game replays fine and proves less: it never reaches capture,
    // the win check or `game_over`. The recorder selects for endings; this is the
    // assertion that keeps it honest.
    expect(corpus.games.map((g) => g.stoppedBecause)).toEqual(Array<string>(25).fill('winner'))
    expect(corpus.games.every((g) => g.record.actions.length === g.decisions)).toBe(true)
  })

  it('replays every one to the state it was recorded from', () => {
    for (const game of corpus.games) {
      const actual = digestState(replay(game.record))
      const label = `seed ${game.seed}`

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
      expect(actual.pending, `${label} pending`).toEqual(game.digest.pending)
      expect(actual.units, `${label} units`).toEqual(game.digest.units)
      expect(actual.log, `${label} log`).toEqual(game.digest.log)
    }
  })
})
