/**
 * Special Action Icons: what each one does, as a pure function of the face and what
 * the roll is for.
 *
 * SAIs are steps 3, 4 and 8 of the roll pipeline (full rules p. 27): they may reroll
 * the die, they generate results that join *after* step 7's divide, and they produce
 * effects that are not numbers at all. `pipeline.ts` owns the arithmetic; this file
 * owns the vocabulary.
 *
 * **`X` is the count printed on the face** (full rules p. 31): "On a six-sided die,
 * X is equal to the number of icons rolled ... On a monster ... die side showing a
 * single icon, X is equal to four results." Which is invariant 7 restated -- the
 * data already carries the answer, so nothing here looks up a unit's size. For the
 * targeting SAIs of Phase 4 the same number is an X *parameter* rather than a result
 * count (`2 SAI:Flame` targets two health-worth), which is why each SAI interprets
 * its own number instead of the roller doing it for them.
 *
 * **Every SAI states which rolls it applies to** (the reference's `Applies` column):
 * "If a type of roll is not listed ... that SAI has no effect in that type of roll."
 * That is what `RollContext` carries, and it is why a Fly on a monster face -- four
 * icons, unmissable on the table -- contributes exactly nothing to a melee attack.
 *
 * Nothing here takes a `GameState`, a unit or an RNG. A handler is testable from a
 * face literal, the same way `faceResults` is.
 */
import type { Face, ResultType } from '../data/types'

import type { RollEffectBody } from './pipeline'
import type { ActionKind, RuleSet } from './types'

/** An `SAI:` face, narrowed out of the face union. */
export type SaiFace = Extract<Face, { icon: 'SAI' }>

/**
 * What a roll is *for*, in the words the SAI reference uses: "during a melee
 * attack", "during a save roll against a missile action", "during a maneuver roll".
 *
 * Deliberately not derived from `RollSpec.kinds`, which is what the roll *counts*.
 * The two agree for every roll in Phase 1 and stop agreeing at Phase 6's dragon
 * combination roll, which counts melee, missile and save at once while being one
 * kind of roll. So this gains a member there rather than being inferred.
 */
export type RollPurpose =
  | { readonly kind: 'attack'; readonly action: ActionKind }
  /** `against: null` is any save roll that is not against an attack. */
  | { readonly kind: 'save'; readonly against: ActionKind | null }
  | { readonly kind: 'maneuver' }

export interface RollContext {
  readonly purpose: RollPurpose
  /** Surprise is the only SAI in Phase 1 that reads this: it "has no effect during
   *  a counter-attack", while Counter -- on the very same exchange -- still does. */
  readonly isCounter: boolean
}

export interface SaiOutcome {
  /** Step 8 results, by type. Added after the divide and never divided themselves. */
  readonly results: Readonly<Partial<Record<ResultType, number>>>
  readonly effects: readonly RollEffectBody[]
  /** Step 3: "Roll this unit again and apply the new result as well." */
  readonly reroll: boolean
}

const NOTHING: SaiOutcome = { results: {}, effects: [], reroll: false }

const gives = (type: ResultType, x: number): SaiOutcome => ({
  results: { [type]: x },
  effects: [],
  reroll: false,
})

/**
 * The single result type this roll counts.
 *
 * Phase 6's combination roll has no single answer, which is why `RollPurpose` gains
 * a member for it there rather than this gaining a fallback.
 */
function countedType(purpose: RollPurpose): ResultType {
  switch (purpose.kind) {
    case 'attack':
      return purpose.action
    case 'save':
      return 'save'
    case 'maneuver':
      return 'maneuver'
  }
}

const isAttack = (ctx: RollContext, action: ActionKind): boolean =>
  ctx.purpose.kind === 'attack' && ctx.purpose.action === action

const isSaveAgainst = (ctx: RollContext, action: ActionKind): boolean =>
  ctx.purpose.kind === 'save' && ctx.purpose.against === action

type SaiHandler = (x: number, ctx: RollContext) => SaiOutcome

/**
 * The twelve SAIs `sai: 'results'` implements, and nothing else.
 *
 * An SAI absent from this table is **silently inert**, which is the deliberate
 * meaning of the `'results'` rung: the other thirteen need targeting, a sub-roll, a
 * duration or the DUA, and each lands in its own phase (`PLAN-V1.md`, "Where each of
 * the 25 SAIs lands"). `'full'` is the rung that refuses to play with them missing.
 */
const HANDLERS: Readonly<Record<string, SaiHandler>> = {
  /**
   * "During a save roll against a melee attack, Counter generates X save results and
   * inflicts X damage upon the attacking army, which may not roll for saves ...
   * During any other save roll, Counter generates X save results. During a melee
   * attack, Counter generates X melee results."
   */
  Counter: (x, ctx) => {
    if (isSaveAgainst(ctx, 'melee')) {
      return { results: { save: x }, effects: [{ kind: 'riposte', damage: x }], reroll: false }
    }
    if (ctx.purpose.kind === 'save') return gives('save', x)
    if (isAttack(ctx, 'melee')) return gives('melee', x)
    return NOTHING
  },

  /** The same shape as Counter, one action across: missile rather than melee. */
  Volley: (x, ctx) => {
    if (isSaveAgainst(ctx, 'missile')) {
      return { results: { save: x }, effects: [{ kind: 'riposte', damage: x }], reroll: false }
    }
    if (ctx.purpose.kind === 'save') return gives('save', x)
    if (isAttack(ctx, 'missile')) return gives('missile', x)
    return NOTHING
  },

  /**
   * "During any roll, Fly generates X maneuver **or** X save results."
   *
   * An `or`, so only the type this roll counts is generated -- unlike Trample below.
   * The distinction is invisible while every roll counts one type, and becomes real
   * at Phase 6.
   */
  Fly: (x, ctx) => {
    const type = countedType(ctx.purpose)
    return type === 'maneuver' || type === 'save' ? gives(type, x) : NOTHING
  },

  /** "During a maneuver roll, Hoof generates X maneuver results. During a save roll
   *  ... X save results." */
  Hoof: (x, ctx) => {
    const type = countedType(ctx.purpose)
    return type === 'maneuver' || type === 'save' ? gives(type, x) : NOTHING
  },

  /**
   * "During any roll, Trample generates X maneuver **and** X melee results."
   *
   * Both, so both are returned and the roll takes whichever it counts. Returning
   * only the counted one is the same number today and the wrong answer for a
   * combination roll.
   */
  Trample: (x) => ({ results: { maneuver: x, melee: x }, effects: [], reroll: false }),

  /** "During any army roll, Create Fireminions generates X magic, maneuver, melee,
   *  missile or save results" -- every type, so always the one being counted. */
  'Create Fireminions': (x, ctx) => gives(countedType(ctx.purpose), x),

  /**
   * "During a melee attack, Smite inflicts X points of damage to the defending army
   * with no save possible."
   *
   * Damage, not melee results -- so a Smite-only attack rolls a zero total and still
   * kills. Its dragon-attack half does generate melee results, and arrives in Phase 6.
   */
  Smite: (x, ctx) =>
    isAttack(ctx, 'melee')
      ? { results: {}, effects: [{ kind: 'unsavable', damage: x }], reroll: false }
      : NOTHING,

  /** "During a melee attack, the defending army cannot counter-attack ... Surprise
   *  has no effect during a counter-attack." */
  Surprise: (_x, ctx) =>
    isAttack(ctx, 'melee') && !ctx.isCounter
      ? { results: {}, effects: [{ kind: 'suppress_counter' }], reroll: false }
      : NOTHING,

  /**
   * "During a melee or dragon attack, Rend generates X melee results. Roll this unit
   * again and apply the new result as well. During a maneuver roll, Rend generates X
   * maneuver results."
   *
   * The reroll belongs to the melee half only -- the maneuver sentence does not carry
   * it, and reading it as though it did would consume a die roll the rules do not.
   */
  Rend: (x, ctx) => {
    if (isAttack(ctx, 'melee')) return { results: { melee: x }, effects: [], reroll: true }
    if (ctx.purpose.kind === 'maneuver') return gives('maneuver', x)
    return NOTHING
  },

  /** "During a maneuver roll, Firewalking generates X maneuver results." Its free-move
   *  half on a non-maneuver roll is Phase 4. */
  Firewalking: (x, ctx) => (ctx.purpose.kind === 'maneuver' ? gives('maneuver', x) : NOTHING),

  /** Identical to Firewalking, and likewise half-implemented until Phase 4. */
  Teleport: (x, ctx) => (ctx.purpose.kind === 'maneuver' ? gives('maneuver', x) : NOTHING),

  /** "During a save roll, Rise from the Ashes generates X save results." Its death
   *  trigger -- roll the unit when killed, an ID sends it to Reserves -- is Phase 2. */
  'Rise from the Ashes': (x, ctx) => (ctx.purpose.kind === 'save' ? gives('save', x) : NOTHING),
}

/** The SAI names `sai: 'results'` resolves. Anything else on a face is inert. */
export const LIVE_SAIS: readonly string[] = Object.keys(HANDLERS)

/**
 * What one SAI face contributes to this roll.
 *
 * Returns nothing for an SAI this rung does not implement, rather than throwing:
 * that is what makes `'results'` a playable rung rather than a half-built `'full'`.
 * `'full'` is the one that refuses.
 */
export function saiEffects(face: SaiFace, context: RollContext, ruleSet: RuleSet): SaiOutcome {
  if (ruleSet.sai === 'inert') return NOTHING
  if (ruleSet.sai === 'full') {
    throw new Error(
      `targeting SAIs are not implemented (ruleSet.sai === 'full', face ${face.count} ${face.sai})`,
    )
  }

  const handler = HANDLERS[face.sai]
  return handler === undefined ? NOTHING : handler(face.count, context)
}

/** Every roll an SAI could be asked about, for the static bound below. */
const ALL_PURPOSES: readonly RollPurpose[] = [
  { kind: 'maneuver' },
  { kind: 'attack', action: 'melee' },
  { kind: 'attack', action: 'missile' },
  { kind: 'attack', action: 'magic' },
  { kind: 'save', against: 'melee' },
  { kind: 'save', against: 'missile' },
  { kind: 'save', against: 'magic' },
  { kind: 'save', against: null },
]

/**
 * The most this SAI face could ever generate of a result type, over every roll it
 * could appear in.
 *
 * Derived by asking the handlers rather than kept as a second table, so it cannot
 * drift away from what they actually do. Smite comes out 0 here, which is the check
 * that its damage was not written as melee results.
 */
export function saiMaxResults(face: SaiFace, resultType: ResultType, ruleSet: RuleSet): number {
  if (ruleSet.sai !== 'results') return 0

  let best = 0
  for (const purpose of ALL_PURPOSES) {
    for (const isCounter of [false, true]) {
      const outcome = saiEffects(face, { purpose, isCounter }, ruleSet)
      best = Math.max(best, outcome.results[resultType] ?? 0)
    }
  }
  return best
}
