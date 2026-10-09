/**
 * From a run to a game (v3 Phase 1): the `SetupOptions` for the battle in hand.
 *
 * **A battle's randomness is its own.** Its seed is derived from the run's seed, the act
 * and the encounter number, and from nothing the run's stream has drawn. So restarting
 * an encounter -- the agreed quit rule -- meets the same enemy on the same board with
 * the same dice, however many draws the run made getting there, and a battle can be set
 * up again from a saved run without replaying anything.
 *
 * The enemy is rolled before setup, the way `newGame.ts` rolls a random opponent, and
 * handed to it as a built force: from the battle's seed, but salted onto its own stream,
 * so the roll-off never reads the numbers the enemy was drawn from.
 *
 * **The enemy comes whole** (Phase 5): its Home, its Frontier proposal and its dragons are
 * drawn on that same stream, after its dice (`completeForce`, setup's own draws), so the
 * screen before the battle can show them. Setup draws none of them, since the force names
 * all three. They used to be drawn by setup after the roll-off, which rolls the player's
 * Horde, so the enemy's Home moved whenever the player rearranged their force.
 */
import { V1_RULES } from '../engine/types'
import { rollForce, type BuiltForce } from '../engine/force'
import { nextInt, rngFrom } from '../engine/rng'
import { completeForce, type SetupOptions } from '../engine/setup'

import { RUN_CONTENT } from './encounters'
import { ACT_SIZE, ENCOUNTERS_PER_ACT, type Act, type BattleEncounter, type RunContent, type RunState } from './types'

/** Salts the run's seed into the battle seeds' stream. Any constant; changing it moves
 *  every run's every battle. */
const BATTLE_SALT = 0xba77_1e5e

/** Salts a battle's seed into its enemy's force draw. */
const ENEMY_SALT = 0x0e4e_5eed

/**
 * The seed of the battle at this act and encounter of this run. The RNG is a pure
 * function of `{ seed, counter }`, so the counter names the battle directly: no draw
 * before it is needed to reach it, which is what makes it independent of the run's
 * own stream.
 */
export function battleSeed(runSeed: number, act: Act, encounter: number): number {
  const index = (act - 1) * ENCOUNTERS_PER_ACT + encounter
  const [seed] = nextInt({ seed: (runSeed ^ BATTLE_SALT) >>> 0, counter: index }, 2 ** 31)
  return seed
}

/** The battle in hand, or a throw: a setup for an event is a caller's mistake. */
function battleInHand(run: RunState): BattleEncounter {
  const encounter = run.current
  if (encounter?.kind !== 'battle') throw new Error(`there is no battle in hand (${run.pending.kind})`)
  return encounter
}

/**
 * The enemy the battle in hand is fought against: the built force it names, or one rolled
 * at the act's size from its pool, with its Home, Frontier proposal and dragons filled in
 * where it does not name them. Ready from the moment the encounter is drawn, so a screen
 * can show it whole while the player arranges their own force.
 */
export function enemyForce(run: RunState, content: RunContent = RUN_CONTENT): BuiltForce {
  const encounter = battleInHand(run)
  const enemy = encounter.enemy
  const seed = battleSeed(run.seed, run.act, run.encounter)
  const stream = rngFrom((seed ^ ENEMY_SALT) >>> 0)
  if ('built' in enemy) {
    const force = content.forces[enemy.built]
    if (force === undefined) throw new Error(`there is no enemy force ${enemy.built}`)
    return completeForce(force, stream)[0]
  }
  const [force, afterDice] = rollForce(ACT_SIZE[run.act], enemy.pool, stream)
  return completeForce(force, afterDice)[0]
}

/**
 * The game for the battle in hand: `V1_RULES` written out, as `useGame` does, so the
 * record says which rules it was played under; the player's force as p1 (`RUN_PLAYER`)
 * and the enemy's as p2, both built. The player's force may be under the act's size -- unequal sides
 * have been legal in the engine since v2 Phase 2, and in a run they are always meant,
 * so nothing asks.
 */
export function battleSetup(run: RunState, content: RunContent = RUN_CONTENT): SetupOptions {
  return {
    seed: battleSeed(run.seed, run.act, run.encounter),
    ruleSet: V1_RULES,
    forces: { kind: 'built', forces: { p1: run.force, p2: enemyForce(run, content) } },
  }
}
