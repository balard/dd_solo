/**
 * Die Roll Resolution, steps 5 to 10 (full rules p. 27).
 *
 * v0 computed a roll as a sum. The rules compute it as an ordered pipeline, and the
 * order is the whole point -- subtract before divide gives a different answer than
 * divide before subtract -- and every v1 feature attaches to a numbered step of it:
 *
 *   5  subtotal all non-SAI results
 *   6  subtract        (never below 0; ID results are removed last)
 *   7  divide          (round down; at most one divider per result type)
 *   8  add SAI results (they are never divided)
 *   9  multiply        (at most one multiplier per result type)
 *   10 add             (including every "counts as" conversion)
 *
 * **The running value is a triple per result type, not a number**, and that is
 * forced by two lines of the rules rather than chosen: "ID results are the last
 * results to be removed" by steps 6 and 7, and SAI results join only at step 8,
 * after the divide. Collapse the triple into a subtotal and neither can be
 * expressed. It collapses at step 10 and not before.
 *
 * Steps 1, 3 and 4 -- rolling, rerolls and applying SAIs -- live in `roll.ts` and
 * `sai.ts`; step 2's delayed effects are Phase 4. Nothing produces a `Modifier` yet
 * except the eighth face; the steps still run, and the tests drive them with
 * hand-built lists, so the ordering is settled before anything depends on it.
 */
import type { ResultType } from '../data/types'

/**
 * What a multiplier at step 9 applies to.
 *
 * `all` is the ordinary case. `id` is the eighth face -- "when rolling the army,
 * all ID results are doubled, for any roll" -- which multiplies the ID share alone,
 * so it needs the split the pipeline is already keeping for step 6.
 */
export type ModifierShare = 'all' | 'id'

/** A roll modifier, named by the step that applies it. */
export type Modifier =
  | { readonly kind: 'subtract'; readonly resultType: ResultType; readonly amount: number }
  | { readonly kind: 'divide'; readonly resultType: ResultType; readonly by: number }
  | {
      readonly kind: 'multiply'
      readonly resultType: ResultType
      readonly by: number
      readonly share: ModifierShare
    }
  | { readonly kind: 'add'; readonly resultType: ResultType; readonly amount: number }

/** The eighth-face holder's doubled ID results, as the step-9 modifier it is. */
export function doubleIdsModifier(resultType: ResultType): Modifier {
  return { kind: 'multiply', resultType, by: 2, share: 'id' }
}

/**
 * Everything a roll produces that is not a number -- damage owed in the other
 * direction, damage no save can stop, a counter-attack refused. Phase 4 adds
 * targeting and free moves.
 *
 * Rerolls are deliberately *not* here. They happen at step 3, inside the roll, and
 * an effect handed back to the caller could not be applied before the totals the
 * caller is being given were computed. `SaiOutcome.reroll` carries them instead.
 */
export type RollEffectBody =
  /** Counter and Volley: damage straight back at the attacking army, which gets no
   *  save roll of its own. */
  | { readonly kind: 'riposte'; readonly damage: number }
  /** Smite: damage the defender's save total does not reduce. */
  | { readonly kind: 'unsavable'; readonly damage: number }
  /** Surprise: the defending army may not counter-attack. */
  | { readonly kind: 'suppress_counter' }
  /**
   * Bullseye, Double Strike, Smother, Firecloud, Seize, Flame: pick health-worth of
   * units out of the army this roll is aimed at, and do something to them.
   *
   * One member for six SAIs, because what separates them is three orthogonal axes and
   * not a name. The name rides on `RollEffect.sai` for the log; nothing in the engine
   * branches on it, which is what stops this becoming a second dispatch table beside
   * `sai.ts`'s.
   */
  | {
      readonly kind: 'target_enemy'
      /**
       * Health-worth to pick. A *budget*, not a result count -- `2 SAI:Flame` targets
       * two health-worth -- which is the same rule as everywhere else in `sai.ts`:
       * the number printed on the face is the answer, and each SAI says what its own
       * number means.
       */
      readonly health: number
      /**
       * How a target gets out of it: by its own roll, or not at all.
       *
       * `'save'` and `'maneuver'` are questions about a *total* -- "those that do not
       * generate a save result are killed" -- and `'id'` is a question about a face,
       * which is why Seize rolls its targets without resolving them.
       */
      readonly escape: 'none' | 'save' | 'maneuver' | 'id'
      readonly fate: 'kill' | 'bury'
      /**
       * Where a target that escaped ends up. Omitted means "where it was standing",
       * which is every escape but Seize's.
       *
       * Stated rather than inferred from `escape: 'id'`. That inference is true of the
       * one ID-escape SAI in this box and false of Swallow, which kills and buries on
       * the same test -- the Genie's-4 mistake again. Optional-and-omitted because a
       * `TargetTask` built from this lands in `combat.attack`, and so in the golden
       * digest.
       */
      readonly escapeTo?: 'reserve'
    }
  /**
   * Sleep: one *unit* in an opposing army at this terrain, asleep until the roller's
   * next turn.
   *
   * No parameters at all -- not even a count. "Target one unit" means one die whatever
   * its health, which is why it cannot ride on `target_enemy`'s health budget, and p.
   * 32 names individual-unit SAIs among the ones that are never combined.
   */
  | { readonly kind: 'sleep' }
  /**
   * Galeforce: one opposing *army*, at any terrain, minus four save and four maneuver
   * until the roller's next turn.
   *
   * Also parameterless: the reference says four, flatly, and not X. The `4` on the
   * Genie's face is a coincidence of it being a monster face, which is exactly why
   * reading it would be wrong.
   */
  | { readonly kind: 'galeforce' }

/** A `RollEffectBody` once `resolveRoll` has stamped it with the die that made it,
 *  so the log can say *which* Fireshadow smote you. */
export type RollEffect = RollEffectBody & {
  /** A plain `string` rather than `UnitId`: this file stays clear of `GameState`. */
  readonly unitId: string
  readonly sai: string
}

/** How many ID results each result type receives. See `allocateIds`. */
export type IdAllocation = Readonly<Partial<Record<ResultType, number>>>

/**
 * One result type mid-pipeline.
 *
 * `sai` is separate from `normal` rather than merged into it because step 8 adds it
 * after step 7 has divided. Once step 8 has run the two are the same thing, and it
 * is folded in.
 */
export interface Share {
  readonly id: number
  readonly normal: number
  readonly sai: number
}

const totalOf = (share: Share): number => share.id + share.normal + share.sai

/**
 * Step 6. Results can never go below 0, and ID results are the last to be removed,
 * so the subtraction eats the normal share first.
 */
function subtract(share: Share, amount: number): Share {
  const fromNormal = Math.min(share.normal, amount)
  return {
    id: Math.max(0, share.id - (amount - fromNormal)),
    normal: share.normal - fromNormal,
    sai: share.sai,
  }
}

/**
 * Step 7. Round down, and again remove the normal share first -- what survives a
 * halving is as much ID as possible, which matters when step 9 then doubles the ID
 * share alone.
 */
function divide(share: Share, by: number): Share {
  if (by <= 0) throw new Error(`a divide modifier needs a positive divisor, got ${by}`)
  const before = share.id + share.normal
  const after = Math.floor(before / by)
  const normal = Math.max(0, share.normal - (before - after))
  return { id: after - normal, normal, sai: share.sai }
}

function atMostOne(modifiers: readonly Modifier[], what: string): void {
  if (modifiers.length > 1) {
    const first = modifiers[0]
    throw new Error(
      `${modifiers.length} ${what} modifiers on ${first?.resultType ?? '?'} results; ` +
        `the rules allow at most one per result type`,
    )
  }
}

/**
 * Steps 6 to 10 for one result type, in that order.
 *
 * Takes the whole modifier list and picks out its own type rather than trusting the
 * caller to have filtered: the one-per-type rules below are only meaningful if this
 * function is the thing deciding what "per type" means.
 *
 * Exported because the order is the thing worth testing, and testing it through a
 * roll would mean testing it through the dice.
 */
export function applyModifiers(
  share: Share,
  resultType: ResultType,
  all: readonly Modifier[],
): number {
  const modifiers = all.filter((m) => m.resultType === resultType)
  let value = share

  for (const modifier of modifiers) {
    if (modifier.kind === 'subtract') value = subtract(value, modifier.amount)
  }

  const dividers = modifiers.filter((m) => m.kind === 'divide')
  atMostOne(dividers, 'divide')
  for (const modifier of dividers) value = divide(value, modifier.by)

  // Step 8: SAI results join here, undivided, and are ordinary non-ID results from
  // now on.
  value = { id: value.id, normal: value.normal + value.sai, sai: 0 }

  // "There may never be more than one modifier that multiplies applied to each type
  // of result" (p. 28), counted per type and not per share: the eighth face's ID
  // doubling *is* that type's one multiplier. Nothing in v1 can produce a second
  // one until spells arrive in Phase 7, so the strict reading costs nothing now and
  // refuses to invent arithmetic the rulebook does not describe.
  const multipliers = modifiers.filter((m) => m.kind === 'multiply')
  atMostOne(multipliers, 'multiply')
  for (const modifier of multipliers) {
    value =
      modifier.share === 'id'
        ? { ...value, id: value.id * modifier.by }
        : { id: value.id * modifier.by, normal: value.normal * modifier.by, sai: 0 }
  }

  for (const modifier of modifiers) {
    if (modifier.kind === 'add') value = { ...value, normal: value.normal + modifier.amount }
  }

  return Math.max(0, totalOf(value))
}

/**
 * Step 5's other half: which type each ID result counts as.
 *
 * With one kind there is nothing to decide. With several -- a dragon's combination
 * roll -- the owner chooses, and the pool has to be spent exactly, or an ID is
 * either counted twice or dropped.
 */
export function allocateIds(
  pool: number,
  kinds: readonly ResultType[],
  allocation: IdAllocation | undefined,
): ReadonlyMap<ResultType, number> {
  const primary = kinds[0]
  if (primary === undefined) throw new Error('a roll needs at least one result type')

  if (kinds.length === 1) {
    if (allocation !== undefined) {
      throw new Error('a single-type roll has no ID allocation to make')
    }
    return new Map([[primary, pool]])
  }

  if (allocation === undefined) {
    throw new Error(
      `a combination roll (${kinds.join('+')}) needs an ID allocation: ` +
        `the owner chooses what each ID counts as`,
    )
  }

  for (const kind of Object.keys(allocation)) {
    if (!kinds.includes(kind as ResultType)) {
      throw new Error(`the ID allocation names ${kind}, which this roll does not count`)
    }
  }

  const spent = new Map<ResultType, number>()
  let total = 0
  for (const kind of kinds) {
    const share = allocation[kind] ?? 0
    if (!Number.isInteger(share) || share < 0) {
      throw new Error(`the ID allocation gives ${kind} ${share}, which is not a count of results`)
    }
    spent.set(kind, share)
    total += share
  }
  if (total !== pool) {
    throw new Error(
      `the ID allocation spends ${total} of ${pool} ID results; it has to spend them all`,
    )
  }
  return spent
}
