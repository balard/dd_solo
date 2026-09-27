/**
 * Records a golden corpus: `npm run goldens -- v0` or `npm run goldens -- v1`.
 *
 * Each corpus is a list of recorded games, stored as their records -- the only thing
 * that needs storing, since `{ setup, actions }` replays die for die -- plus a digest
 * of the final state each produced. `golden.test.ts` replays them and compares. A
 * phase that changes no outcome leaves both files untouched; a phase that changes one
 * has to say so in the diff.
 *
 * **Regenerating a corpus is the one move that can hide a bug**, so a commit that
 * does it explains why. It is not a snapshot to be refreshed when it goes red. That is
 * also why the corpus is a required argument rather than "both": the two answer
 * different questions, and nothing in v2 has a reason to touch the v0 one.
 *
 * - **`v0`** -- 25 random self-play games under `V0_RULES` (v1 Phase G). Which 25: the
 *   first seeds that reach an ending inside `V0_MAX_DECISIONS`. Random self-play
 *   usually does not -- about two thirds of seeds are still going at 800 decisions --
 *   and taking seeds 1-25 as they came produced a corpus that was two thirds
 *   unfinished games and six megabytes. Selecting for endings means every game
 *   exercises capture, the win check and `game_over`.
 *
 * - **`v1`** -- 20 games under `V1_RULES` (v2 Phase 0a), the guard for v2 Phase 1's
 *   claim that a single-species game does not move. Ten pairings, each played once by
 *   `GreedyAI` against `RandomAI` and once by `GreedyAI` against itself. Greedy
 *   finishes its games, so no selection is needed, and a game that fails to end is an
 *   error here rather than a skipped seed.
 *
 *   **Why both opponents**, where `PLAN-V2.md` asked only for random: against random
 *   greedy wins every game by capture in under a hundred decisions, and eighteen such
 *   games never summoned a dragon, rolled Dispel Magic or eliminated an army. Against
 *   itself the armies stand and fight: dragons are summoned and attack, Dispel Magic
 *   is rolled, and some games end by elimination. Greedy draws nothing from its rng,
 *   so a self-play game varies by its seed alone, which is all it needs to.
 *
 *   Named forces only, and **every terrain pinned**: a rolled force and a drawn
 *   terrain are both things v2 Phase 2 may change the draws of, and a game that moved
 *   for that reason would be indistinguishable from one that moved because a rule did.
 *   A pinned Frontier leaves the roll-off winner one prize, so the roll-off *choice*
 *   never appears in this corpus; `rolloff.test.ts` and the live-rules fuzz cover it.
 *
 * Breadth is neither file's job -- the fuzzes do that, unselected, every run.
 */
import { writeFileSync } from 'node:fs'

import { homeTerrainType } from '../data/load'
import { preset } from '../data/presets'
import { greedyAi } from '../ai/greedy'
import { randomAi } from '../ai/random'
import { runGame } from '../ai/run'
import type { AiPlayer } from '../ai/types'
import { digestState, type StateDigest } from '../engine/digest'
import type { GameRecord } from '../engine/replay'
import { STARTER_FORCES, BESTIARY_FORCES, type ForceSpec, type SetupOptions } from '../engine/setup'
import { V1_RULES, type PlayerId, type TerrainSlot } from '../engine/types'

export interface GoldenGame {
  readonly seed: number
  readonly aiSeed: number
  readonly decisions: number
  readonly stoppedBecause: 'winner' | 'stuck' | 'cap'
  readonly record: GameRecord
  readonly digest: StateDigest
}

function play(
  setup: SetupOptions,
  players: Readonly<Record<PlayerId, AiPlayer>>,
  maxDecisions: number,
): GoldenGame {
  const aiSeed = setup.seed * 7
  const result = runGame({ setup, players, aiSeed, maxDecisions })

  if (result.stoppedBecause === 'stuck') {
    throw new Error(`seed ${setup.seed} ran out of moves without ending -- that is a bug, not a golden`)
  }

  return {
    seed: setup.seed,
    aiSeed,
    decisions: result.decisions,
    stoppedBecause: result.stoppedBecause,
    record: result.record,
    digest: digestState(result.state),
  }
}

// --- v0 --------------------------------------------------------------------------

const V0_GAMES = 25
const V0_MAX_DECISIONS = 800
/** Give up rather than scan forever if a rules change makes short games rare. */
const V0_MAX_SEED = 1000

function recordV0(): readonly GoldenGame[] {
  const games: GoldenGame[] = []
  let seed = 0

  while (games.length < V0_GAMES) {
    seed += 1
    if (seed > V0_MAX_SEED) {
      throw new Error(
        `scanned ${V0_MAX_SEED} seeds and found only ${games.length} games ending inside ` +
          `${V0_MAX_DECISIONS} decisions; raise the cap, or find out why games got longer`,
      )
    }
    const game = play(
      { seed, forces: STARTER_FORCES },
      { p1: randomAi, p2: randomAi },
      V0_MAX_DECISIONS,
    )
    if (game.stoppedBecause === 'winner') games.push(game)
  }
  return games
}

// --- v1 --------------------------------------------------------------------------

/**
 * Generous: greedy finishes a game in a few hundred decisions (the greedy fuzz
 * measures its longest against random at 225). A game that reaches this is a stall,
 * and the recorder refuses it rather than storing it.
 */
const V1_MAX_DECISIONS = 5000

const named = (p1: string, p2: string): ForceSpec => ({ kind: 'named', forces: { p1, p2 } })

/**
 * The starter pair is what the app opens on and the bestiary puts all 25 SAIs on the
 * board; four monster mirrors read one die against itself, and four cross pairings put
 * a Treefolk monster against a Firewalkers one. All ten monster dice appear.
 */
const V1_PAIRINGS: readonly ForceSpec[] = [
  STARTER_FORCES,
  BESTIARY_FORCES,
  named('treefolk_darktree', 'treefolk_darktree'),
  named('treefolk_satyr', 'treefolk_satyr'),
  named('firewalkers_gorgon', 'firewalkers_gorgon'),
  named('firewalkers_phoenix', 'firewalkers_phoenix'),
  named('treefolk_strangle_vine', 'firewalkers_genie'),
  named('treefolk_unicorn', 'firewalkers_salamander'),
  named('treefolk_redwood', 'firewalkers_fireshadow'),
  named('firewalkers_gorgon', 'treefolk_satyr'),
]

/** The four eighth faces, rotated per slot so every icon lands on every slot. */
const ICONS = ['tower', 'city', 'temple', 'standing_stones'] as const
/** The four basic types that are neither species' home; each shares an element with both. */
const FRONTIER_TYPES = ['highland', 'coastland', 'feyland', 'flatland'] as const

/**
 * Every slot pinned, and each Home a die of its own species' type -- what the live
 * draw gives -- so only the eighth faces and the Frontier's type vary between games.
 */
function pinnedTerrains(forces: ForceSpec, i: number): Readonly<Record<TerrainSlot, string>> {
  if (forces.kind !== 'named') throw new Error('v1 goldens use named forces only')
  const home = (player: PlayerId): string => homeTerrainType(preset(forces.forces[player]).species).id
  const icon = (offset: number): string => ICONS[(i + offset) % ICONS.length] as string
  const frontierType = FRONTIER_TYPES[i % FRONTIER_TYPES.length] as string
  return {
    p1_home: `${home('p1')}_${icon(0)}`,
    frontier: `${frontierType}_${icon(2)}`,
    p2_home: `${home('p2')}_${icon(1)}`,
  }
}

/** Every pairing against random first, then every pairing against greedy itself. */
function v1Players(i: number, seed: number): Readonly<Record<PlayerId, AiPlayer>> {
  if (i >= V1_PAIRINGS.length) return { p1: greedyAi, p2: greedyAi }
  // Greedy takes each side in turn, so neither seat is only ever the random one.
  return seed % 2 === 0 ? { p1: greedyAi, p2: randomAi } : { p1: randomAi, p2: greedyAi }
}

function recordV1(): readonly GoldenGame[] {
  return Array.from({ length: V1_PAIRINGS.length * 2 }, (_, i) => {
    const seed = i + 1
    const forces = V1_PAIRINGS[i % V1_PAIRINGS.length] as ForceSpec
    const game = play(
      { seed, forces, ruleSet: V1_RULES, terrains: pinnedTerrains(forces, i) },
      v1Players(i, seed),
      V1_MAX_DECISIONS,
    )
    if (game.stoppedBecause !== 'winner') {
      throw new Error(
        `v1 seed ${seed} did not finish inside ${V1_MAX_DECISIONS} decisions -- greedy ` +
          `stalled, which is a bug to find rather than a game to drop`,
      )
    }
    return game
  })
}

// --- main ------------------------------------------------------------------------

const CORPORA = {
  v0: { record: recordV0, phase: 'docs/PLAN-V1.md, Phase G' },
  v1: { record: recordV1, phase: 'docs/PLAN-V2.md, Phase 0a' },
} as const

function main(): void {
  const name = process.argv[2]
  if (name !== 'v0' && name !== 'v1') {
    throw new Error(
      `name the corpus to regenerate: npm run goldens -- v0, or -- v1. ` +
        `Regenerating is a decision, and so is which file.`,
    )
  }
  const corpus = CORPORA[name]
  const games = corpus.record()

  // Hand-assembled rather than `JSON.stringify(corpus, null, 2)`: one game per
  // line means a diff names the games that moved, which is the whole question you
  // ask of this file. Minified it would be one unreadable line; pretty-printed it
  // would be a hundred thousand.
  const body = games.map((game) => JSON.stringify(game)).join(',\n')
  const text =
    '{\n' +
    `"_comment": "Generated by npm run goldens -- ${name}. Do not hand-edit. Regenerating is the one move that can hide a bug -- see ${corpus.phase}.",\n` +
    `"version": 1,\n` +
    `"games": [\n${body}\n]\n}\n`

  writeFileSync(new URL(`../engine/__golden__/${name}-games.json`, import.meta.url), text)

  const decisions = games.reduce((sum, g) => sum + g.decisions, 0)
  const seeds = games.map((g) => g.seed)
  console.log(
    `${name}: wrote ${games.length} decided games from seeds ${Math.min(...seeds)}-${Math.max(...seeds)}, ` +
      `${decisions} decisions, ${(text.length / 1024).toFixed(0)} KB`,
  )
}

main()
