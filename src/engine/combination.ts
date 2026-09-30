/**
 * A combination roll: one army roll counting several result types at once (p. 28).
 *
 * The dragon attack's army roll was the only one until the Dwarves (v1 Phase 6), so this
 * lived inside the Dragon Attack Phase as `dragonRollSpec` and `applyDragonAllocate`.
 * Charge (v2 Phase 6e) gives the defender a second -- "a combination save and melee
 * roll" -- and the two ask exactly the same question over different kinds: where the
 * ID results go, how any step-8 results whose type the roller picks are split, and how
 * many saves Flaming Shields trades for melee. So the question is here, parameterised by
 * the kinds, and each roll brings only what is its own: the army, and what it is for.
 * (v2 Phase 6b: moved, not changed -- the dragon roll resolves as it did.)
 */
import type { ResultType } from '../data/types'

import { armyRoll, doublesIds } from './effects'
import { doubleIdsModifier, type IdAllocation } from './pipeline'
import type { RollSpec } from './roll'
import type { RollContext } from './sai'
import type { ArmyRef, GameState, PlayerId } from './types'

/** What the roller of a combination roll decides once the dice are down. */
export interface CombinationAnswer {
  /** How many ID results each counted kind receives; the pool is spent exactly. */
  readonly ids: IdAllocation
  /** Step-8 results whose type the roller picks (Create Fireminions), spent exactly. */
  readonly flexible: Readonly<Partial<Record<ResultType, number>>>
  /** Flaming Shields: how many rolled saves become melee. Omitted is none. */
  readonly savesAsMelee?: number
}

/** What there is to decide: `rollPools` of the dice, under the spec below. */
export interface CombinationPools {
  readonly ids: number
  readonly flexible: number
  /** Saves Flaming Shields may trade for melee; 0 when the roll has none to trade. */
  readonly shields: number
}

/**
 * The spec one army's combination roll is resolved with.
 *
 * An army roll like any other, so its modifiers come through `armyRoll` -- gathered as
 * a *melee* roll when the roll counts melee, which is what brings Flaming Shields'
 * permission (and Coastal Dodge's, gathered whatever the roll). `armyRoll` doubles IDs
 * in the one type it is asked about, and the eighth face doubles them "when rolling
 * anything there", so every other counted kind is doubled here too -- without that a
 * held terrain doubled the melee share and quietly not the others, the bug the dragon
 * roll shipped once.
 *
 * Without an `answer` the IDs all sit at zero: enough to find the pools, and to draw
 * the dice before anyone has allocated them.
 */
export function combinationSpec(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  kinds: readonly ResultType[],
  context: RollContext,
  answer?: CombinationAnswer,
): RollSpec {
  const gathered: ResultType = kinds.includes('melee') ? 'melee' : (kinds[0] ?? 'melee')
  const { modifiers } = armyRoll(state, player, ref, gathered)
  const alsoDoubled = doublesIds(state, player, ref)
    ? kinds.filter((kind) => kind !== gathered).map(doubleIdsModifier)
    : []

  const none: Partial<Record<ResultType, number>> = {}
  for (const kind of kinds) none[kind] = 0

  return {
    kinds,
    modifiers: [...modifiers, ...alsoDoubled],
    context,
    idAllocation: answer?.ids ?? none,
    ...(answer?.flexible !== undefined ? { saiResults: answer.flexible } : {}),
    ...(answer?.savesAsMelee !== undefined && answer.savesAsMelee > 0
      ? { savesAsMelee: answer.savesAsMelee }
      : {}),
  }
}

/**
 * Why this answer does not fit the pools, or null.
 *
 * The flexible results and the Flaming Shields count are checked here; the ID pool is
 * checked by `allocateIds` when the roll resolves, which says so better.
 */
export function combinationAnswerProblem(
  kinds: readonly ResultType[],
  pools: CombinationPools,
  answer: CombinationAnswer,
): string | null {
  const spent = kinds.reduce((sum, kind) => sum + (answer.flexible[kind] ?? 0), 0)
  if (spent !== pools.flexible) {
    return `the split spends ${spent} of ${pools.flexible} flexible results`
  }
  const converted = answer.savesAsMelee ?? 0
  if (!Number.isInteger(converted) || converted < 0 || converted > pools.shields) {
    return `Flaming Shields can count ${pools.shields} saves as melee here, not ${converted}`
  }
  return null
}
