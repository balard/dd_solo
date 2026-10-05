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
  | {
      readonly kind: 'attack'
      readonly action: ActionKind
      /**
       * Charge (v2 Phase 6e): a Charge face is on this melee attack, and "the attacking
       * army counts all Maneuver results as if they were Melee results". Set by
       * `resolveFaces` once it has seen the faces, so an SAI offering a choice that
       * includes maneuver -- Fly's "X maneuver or X save" -- gives its maneuver, which
       * the roll then counts as melee. Omitted, never `false`.
       */
      readonly charging?: true
    }
  /**
   * `against: null` is any save roll that is not against an attack.
   *
   * `charge` (v2 Phase 6e) is the defender's answer to a Charge: "instead of making a
   * regular save roll or a counter-attack, the defending army makes a combination save
   * and melee roll". It is still the save roll against a melee attack -- Counter, Bash,
   * Wave and the delayed effects all apply to it, `RULES-V0.md` section 18 -- and it
   * counts melee as well. Omitted, never `false`.
   */
  | { readonly kind: 'save'; readonly against: ActionKind | null; readonly charge?: true }
  /**
   * `marching` (v2 Phase 5c) says this is the marching army's roll in a contested
   * maneuver, not a counter-maneuver or the roll-off. Wave is the first SAI that cares:
   * "during a maneuver roll while marching ... Wave does nothing if rolled during a
   * countermaneuver". Omitted, never `false`.
   */
  | { readonly kind: 'maneuver'; readonly marching?: true }
  /**
   * An army answering a dragon attack (Phase 6). The combination roll this file has
   * been promising since Phase 0b: it counts melee, missile and save at once, so it
   * is one purpose over three kinds.
   *
   * It is its own listed roll type in the reference's `Applies` column, not a melee
   * attack that happens to count saves -- which is why seven SAIs name it explicitly
   * and the rest, Flame and Seize included, do nothing here at all.
   */
  | { readonly kind: 'dragon_attack' }

export interface RollContext {
  readonly purpose: RollPurpose
  /** Surprise is the only SAI in Phase 1 that reads this: it "has no effect during
   *  a counter-attack", while Counter -- on the very same exchange -- still does. */
  readonly isCounter: boolean
  /**
   * This is one unit rolling for its own survival (Phase 4d's sub-rolls), not an army
   * rolling for the action.
   *
   * **A house rule, and the narrow reading** (`RULES-V0.md` section 11). Firewalking
   * and Teleport offer their free move on "any non-maneuver roll", which a Bullseye
   * save roll literally is -- so without this a die rolling for its life could march
   * three health-worth of its friends across the board, and the decision would be a
   * pause inside a pause. The effect is not *dropped* here, which is the thing the
   * guards exist to prevent: it is never generated, because a sub-roll is not one of
   * the rolls that SAI is about.
   */
  readonly isSubRoll?: true
  /**
   * A roll an army makes in answer to a standing effect, outside any action.
   *
   * Wall of Thorns is the first and so far only one: "any army that successfully
   * maneuvers that terrain takes six points of damage. The army makes a melee roll
   * instead of a save roll." That happens in the *maneuver step*, with no exchange to
   * hang a decision on -- so a Wild Growth promotion or a Firewalking free move there
   * would be a decision with nowhere to live, and `expectNoEffects` refuses the roll
   * rather than letting it be dropped.
   *
   * A flag of its own rather than reusing `isSubRoll`, which says something different
   * and true: that one die is rolling for its life, with no army behind it. Here an
   * army really is rolling. What the two share is only the consequence.
   *
   * House rule, `RULES-V0.md` section 15 -- by the letter Wild Growth applies to any
   * non-maneuver roll, and this is one.
   */
  readonly isTrigger?: true
}

export interface SaiOutcome {
  /** Step 8 results, by type. Added after the divide and never divided themselves. */
  readonly results: Readonly<Partial<Record<ResultType, number>>>
  readonly effects: readonly RollEffectBody[]
  /** Step 3: "Roll this unit again and apply the new result as well." */
  readonly reroll: boolean
  /**
   * Step 8 results whose *type* is the roller's to choose, when the roll counts more
   * than one and the SAI offers more than one (Create Fireminions, p. 27: "if an SAI
   * generates a choice of different results then the player may split those results
   * between those required by the roll").
   *
   * Only a combination roll can produce this -- with one counted kind there is one
   * legal answer and the handler gives it directly. The roller's split comes back in
   * `RollSpec.saiResults`, which is the seam Wild Growth already uses.
   */
  readonly flexible?: number
}

const NOTHING: SaiOutcome = { results: {}, effects: [], reroll: false }

const gives = (type: ResultType, x: number): SaiOutcome => ({
  results: { [type]: x },
  effects: [],
  reroll: false,
})

/** Ferry's "up to four health-worth" -- a constant for Firewalking's reason. */
const FERRY_HEALTH = 4

/**
 * Firewalking and Teleport, which are the same SAI on two dice.
 *
 * X maneuver results on a maneuver roll -- on every rung, which is why these two stay
 * in `HANDLERS` -- and on any other roll a free move, which only `'full'` can resolve.
 * The move is "itself and up to three health-worth", a flat three that no face agrees
 * with; `x` is read for the maneuver half and nothing else.
 */
const freeMove = (x: number, ctx: RollContext, rung: RuleSet['sai']): SaiOutcome => {
  if (ctx.purpose.kind === 'maneuver') return gives('maneuver', x)
  if (rung !== 'full' || noSideDecision(ctx)) return NOTHING
  return { results: {}, effects: [{ kind: 'free_move', health: 3 }], reroll: false }
}

/**
 * Whether this roll has anywhere to put a decision that is not about the roll itself.
 *
 * Three rolls do not: a **sub-roll** is one die rolling for its life with no army
 * behind it; a **trigger** roll (Wall of Thorns) happens in the maneuver step with no
 * exchange to hang a question on; and the **dragon combination roll** happens in a
 * phase with no targeting queue at all.
 *
 * The third of those is a Phase 6 bug this made visible rather than a new rule.
 * `resolveArmyRoll` read the totals and ignored `outcome.effects` entirely, so a Wild
 * Growth or a Firewalking on a dragon roll was silently dropped -- and Wild Growth's
 * `Applies` column is "Non-Maneuver", which a dragon attack is. It is a house rule
 * now (`RULES-V0.md` section 15) and `resolveArmyRoll` refuses rather than drops.
 */
const noSideDecision = (ctx: RollContext): boolean =>
  ctx.isSubRoll === true || ctx.isTrigger === true || ctx.purpose.kind === 'dragon_attack'

/**
 * Which result types this roll counts.
 *
 * A list rather than the single type this used to return, because Phase 6's dragon
 * roll counts three at once. An SAI that offers a choice ("X maneuver *or* X save")
 * intersects its own set with this one; if exactly one survives there is no decision
 * to make, which is the case for every such SAI in the box but Create Fireminions.
 */
function countedTypes(purpose: RollPurpose): readonly ResultType[] {
  switch (purpose.kind) {
    case 'attack':
      return purpose.charging === true ? [purpose.action, 'maneuver'] : [purpose.action]
    case 'save':
      return purpose.charge === true ? CHARGE_ROLL_KINDS : ['save']
    case 'maneuver':
      return ['maneuver']
    case 'dragon_attack':
      return DRAGON_ROLL_KINDS
  }
}

/**
 * What an army's answer to a dragon attack counts, in the order the rules list it:
 * "the army makes a combination roll, counting any melee, missile, or save results"
 * (full rules p. 18). Exported because the roll's `RollSpec.kinds` must agree with
 * what the SAIs here think is being counted, and two copies of that would drift.
 */
export const DRAGON_ROLL_KINDS: readonly ResultType[] = ['melee', 'missile', 'save']

/**
 * What the defender's answer to a Charge counts (v2 Phase 6e): "a combination save and
 * melee roll", saves first because they are what the roll is mostly for.
 */
export const CHARGE_ROLL_KINDS: readonly ResultType[] = ['save', 'melee']

/** The types this roll counts that the SAI is allowed to generate. */
function offered(purpose: RollPurpose, choices: readonly ResultType[]): readonly ResultType[] {
  return countedTypes(purpose).filter((kind) => choices.includes(kind))
}

/**
 * An SAI offering a choice of result types: one type if only one is counted, the
 * roller's split if more than one is.
 */
function choiceOf(x: number, purpose: RollPurpose, choices: readonly ResultType[]): SaiOutcome {
  const legal = offered(purpose, choices)
  const only = legal[0]
  if (only === undefined) return NOTHING
  if (legal.length === 1) return gives(only, x)
  return { results: {}, effects: [], reroll: false, flexible: x }
}

const isAttack = (ctx: RollContext, action: ActionKind): boolean =>
  ctx.purpose.kind === 'attack' && ctx.purpose.action === action

const isSaveAgainst = (ctx: RollContext, action: ActionKind): boolean =>
  ctx.purpose.kind === 'save' && ctx.purpose.against === action

/**
 * `rung` is `RuleSet['sai']`, and Firewalking and Teleport are what it is for.
 *
 * Phase 4a declared threading it premature and was right: until now the two rungs
 * differed in *which SAIs exist*, which two tables express better than an argument.
 * These two differ in what one SAI **does** -- their maneuver results work on every
 * rung, their free move only on `'full'` -- and that is a question no table can
 * answer, because a name can only be in one of them. Every other handler ignores it.
 */
type SaiHandler = (x: number, ctx: RollContext, ruleSet: RuleSet) => SaiOutcome

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
    // "During a dragon attack, Counter generates X save and X melee results" -- both,
    // and not the p. 27 pick-one rule, because the reference spells this case out.
    if (ctx.purpose.kind === 'dragon_attack') {
      return { results: { save: x, melee: x }, effects: [], reroll: false }
    }
    return NOTHING
  },

  /** The same shape as Counter, one action across: missile rather than melee. */
  Volley: (x, ctx) => {
    if (isSaveAgainst(ctx, 'missile')) {
      return { results: { save: x }, effects: [{ kind: 'riposte', damage: x }], reroll: false }
    }
    if (ctx.purpose.kind === 'save') return gives('save', x)
    if (isAttack(ctx, 'missile')) return gives('missile', x)
    if (ctx.purpose.kind === 'dragon_attack') {
      return { results: { save: x, missile: x }, effects: [], reroll: false }
    }
    return NOTHING
  },

  /**
   * "During any roll, Fly generates X maneuver **or** X save results."
   *
   * An `or`, so only the type this roll counts is generated -- unlike Trample below.
   * The distinction is invisible while every roll counts one type, and becomes real
   * at Phase 6.
   */
  Fly: (x, ctx) => choiceOf(x, ctx.purpose, ['maneuver', 'save']),

  /**
   * "During a maneuver roll, Hoof generates X maneuver results. During a save roll
   * ... X save results. During a dragon attack, Hoof generates X save results."
   *
   * The same two types Fly offers, and the dragon-attack sentence agrees with what
   * `choiceOf` works out on its own: of maneuver and save a dragon roll counts only
   * save, so there is nothing to choose.
   */
  Hoof: (x, ctx) => choiceOf(x, ctx.purpose, ['maneuver', 'save']),

  /**
   * "During any roll, Trample generates X maneuver **and** X melee results."
   *
   * Both, so both are returned and the roll takes whichever it counts. Returning
   * only the counted one is the same number today and the wrong answer for a
   * combination roll.
   */
  Trample: (x) => ({ results: { maneuver: x, melee: x }, effects: [], reroll: false }),

  /**
   * "During any army roll, Create Fireminions generates X magic, maneuver, melee,
   * missile or save results" -- every type, so always the one being counted.
   *
   * The one SAI in the box whose choice survives a dragon roll: all three of that
   * roll's kinds are on its list, so the roller splits X between them (p. 27).
   */
  'Create Fireminions': (x, ctx) =>
    choiceOf(x, ctx.purpose, ['magic', 'maneuver', 'melee', 'missile', 'save']),

  /**
   * "During a melee attack, Smite inflicts X points of damage to the defending army
   * with no save possible. During a dragon attack, Smite generates X melee results."
   *
   * Damage, not melee results -- so a Smite-only attack rolls a zero total and still
   * kills. The dragon-attack half is the other way round: ordinary melee results,
   * because there is no "defending army" to inflict unsavable damage on.
   */
  Smite: (x, ctx) => {
    if (isAttack(ctx, 'melee')) {
      return { results: {}, effects: [{ kind: 'unsavable', damage: x }], reroll: false }
    }
    if (ctx.purpose.kind === 'dragon_attack') return gives('melee', x)
    return NOTHING
  },

  /**
   * "During a melee or missile attack, Stone does X damage to the defending army with no
   * save possible. During a dragon attack, Stone generates X missile results." (v2 Phase
   * 8c.)
   *
   * Smite's handler on two actions, and missile rather than melee against a dragon. So it
   * is the first unsavable damage on a missile exchange -- a Tower's at a Reserve Army
   * included -- which `finishSaves` reads by kind and never by action.
   */
  Stone: (x, ctx) => {
    if (isAttack(ctx, 'melee') || isAttack(ctx, 'missile')) {
      return { results: {}, effects: [{ kind: 'unsavable', damage: x }], reroll: false }
    }
    if (ctx.purpose.kind === 'dragon_attack') return gives('missile', x)
    return NOTHING
  },

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
    if (isAttack(ctx, 'melee') || ctx.purpose.kind === 'dragon_attack') {
      return { results: { melee: x }, effects: [], reroll: true }
    }
    if (ctx.purpose.kind === 'maneuver') return gives('maneuver', x)
    return NOTHING
  },

  /**
   * "During a maneuver roll, Firewalking generates X maneuver results. During any
   * **non-maneuver** roll, this unit may move itself and up to three health-worth of
   * units in its army to any terrain."
   *
   * The one SAI whose two halves live on different rungs, which is what the `rung`
   * argument above exists for. Three, not X: see `free_move` in `pipeline.ts`.
   */
  Firewalking: (x, ctx, rules) => freeMove(x, ctx, rules.sai),

  /** Word for word Firewalking, on a different die. */
  Teleport: (x, ctx, rules) => freeMove(x, ctx, rules.sai),

  /**
   * "During a magic action, Cantrip generates X magic results. During other
   * non-maneuver rolls, Cantrip generates X magic results **that only allow you to
   * cast spells marked as 'Cantrip'**."
   *
   * **Two halves, and only the second one needs spells** -- which is the thing this
   * file had wrong from Phase 1 until Phase 4e. Cantrip sat in `NEEDS_SPELLS` whole,
   * so a Genie rolling it in a magic action generated nothing and, on the `'full'`
   * rung, threw. The first sentence is a plain result generator, no different from
   * Create Fireminions, and it works under `magic: 'simplified'` because magic results
   * are what that house rule counts.
   *
   * The second half is magic results with exactly one thing to spend them on, and
   * under simplified magic there is nothing -- so they are worth zero rather than
   * unimplemented. Phase 7 gives them something to buy.
   */
  Cantrip: (x, ctx, rules) => {
    // First sentence: on a magic action these are ordinary magic results, and they
    // work under the v0 house rule too, because magic results are what it counts.
    if (ctx.purpose.kind === 'attack' && ctx.purpose.action === 'magic') return gives('magic', x)
    if (ctx.purpose.kind === 'maneuver') return NOTHING

    // Second sentence: on any other non-maneuver roll they are magic results with
    // exactly one thing to spend them on. Under `magic: 'simplified'` there is
    // nothing at all, so they are worth zero rather than unimplemented -- and a
    // sub-roll is one die rolling for its life, with no army behind it to cast.
    if (rules.magic !== 'spells' || noSideDecision(ctx)) return NOTHING
    return { results: {}, effects: [{ kind: 'cantrip', points: x }], reroll: false }
  },

  /**
   * "Whenever any magic targets this unit ... you may roll this unit after all spells
   * are announced but before any are resolved."
   *
   * Its `Applies` column is **Special**: it takes no part in any roll in the ordinary
   * sequence, so it contributes nothing here and that is the complete answer, not a
   * placeholder. Under `magic: 'simplified'` no spell is ever announced, so it never
   * fires at all; Phase 7 gives it its own roll, outside this function.
   */
  'Dispel Magic': () => NOTHING,

  /**
   * "During a save roll, Rise from the Ashes generates X save results."
   *
   * Its other half -- roll the unit whenever it is killed *or buried*, and a Rise
   * from the Ashes face sends it to Reserves -- is `death.ts`, because it fires
   * outside any roll and so has nowhere to live here. Note that it is a Rise face
   * and not an ID: this comment said ID until Phase 2 read the reference again.
   */

  'Rise from the Ashes': (x, ctx) => (ctx.purpose.kind === 'save' ? gives('save', x) : NOTHING),

  /**
   * "During a dragon or melee attack, Tail generates **two** melee results. Roll this
   * unit again and apply the new result as well." (v2 Phase 5c, Coral Elves.)
   *
   * Two, flatly, and not X -- the Leviathan's face prints 4 because it is a monster face,
   * Galeforce's case again. The reroll is Rend's: a step-3 reroll of this die, drained
   * by the sweep, and it belongs to both attacks because the reference names them in
   * one sentence.
   */
  Tail: (_x, ctx) =>
    isAttack(ctx, 'melee') || ctx.purpose.kind === 'dragon_attack'
      ? { results: { melee: TAIL_MELEE }, effects: [], reroll: true }
      : NOTHING,
}

/** Tail's "two melee results", stated by the reference rather than printed on a face. */
const TAIL_MELEE = 2

/**
 * The SAIs that only `sai: 'full'` resolves: the ones that pick targets.
 *
 * A second table rather than a flag on the first, because the two rungs differ in
 * *which SAIs exist*, not in what any one of them does. `'results'` never looks in
 * here, so a targeting SAI stays silently inert on that rung exactly as it did before
 * it was built -- which is what keeps `'results'` a playable rung and keeps
 * `SAI_RULES` the thing Phase 1 shipped.
 *
 * (Firewalking and Teleport will eventually differ *by rung* rather than by existence
 * -- their maneuver half works on both, their free move only on `'full'`. That is the
 * case a rung argument is actually for, and it arrives in Phase 4e with them.)
 */
const FULL_HANDLERS: Readonly<Record<string, SaiHandler>> = {
  /**
   * "During a melee attack, target up to two health-worth of units in the defending
   * army. The targets are killed and buried."
   *
   * The reference says *two*, not X -- and both Flame faces in the data are
   * `2 SAI:Flame`, so reading the count off the face agrees with it exactly. The count
   * is read anyway rather than hardcoded, because "the number printed on the face is
   * the answer" is invariant 7, and hardcoding would quietly disagree with the data
   * the day a third Flame face is transcribed.
   *
   * `fate: 'bury'` is what routes this and nothing else to `killAndBury`. Burial is
   * two steps because the rules are two steps, and a Phoenix gets a Rise roll at each.
   */
  Flame: (x, ctx) =>
    isAttack(ctx, 'melee')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'none', fate: 'bury' }],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During a melee attack, target one unit in an opponent's army at this terrain.
   * The target unit is asleep and cannot be rolled or leave the terrain they currently
   * occupy until the beginning of your next turn."
   *
   * One *unit*, not X health-worth -- an Oakling and a monster are each one die. The
   * face's count is read by nothing here, which is the case that shows `X` is a rule
   * about SAIs that say X and not about every face with a number on it.
   */
  Sleep: (_x, ctx) =>
    isAttack(ctx, 'melee')
      ? { results: {}, effects: [{ kind: 'sleep' }], reroll: false }
      : NOTHING,

  /**
   * "During a melee or missile attack, or a magic action at a terrain, target an
   * opposing army at any terrain. Until the beginning of your next turn, the target
   * army subtracts four save and four maneuver results from all rolls."
   *
   * All three attack kinds, which is why the magic branch of an exchange had to stop
   * short-circuiting past the targeting step in Phase 4a. **Any** terrain, not this
   * one -- the only SAI so far that can reach off the board it was rolled on.
   */
  Galeforce: (_x, ctx) =>
    ctx.purpose.kind === 'attack'
      ? { results: {}, effects: [{ kind: 'galeforce' }], reroll: false }
      : NOTHING,

  /**
   * "During a missile attack, target X health-worth of units in the defending army.
   * The targets make a save roll. Those that do not generate a save result are
   * killed. Roll this unit again and apply the new result as well."
   *
   * The reroll is of **this** die -- the roller's own, the way Rend's is -- so it is
   * `reroll: true` and step 3 handles it; a reroll showing Bullseye again adds its
   * budget to the same task, because `targetTasks` combines by name.
   *
   * "During a dragon attack, Bullseye generates X missile results" -- plain results
   * and no targeting, since a dragon is not an army with units to pick out. The
   * reroll goes with the missile-attack sentence only, the way Rend's does.
   */
  Bullseye: (x, ctx) => {
    if (isAttack(ctx, 'missile')) {
      return {
        results: {},
        effects: [{ kind: 'target_enemy', health: x, escape: 'save', fate: 'kill' }],
        reroll: true,
      }
    }
    if (ctx.purpose.kind === 'dragon_attack') return gives('missile', x)
    return NOTHING
  },

  /**
   * "During a melee attack, target four health-worth of units in the defending army.
   * The targets make a save roll. Those that do not generate a save result are
   * killed. Roll this unit again and apply the new result as well."
   *
   * *Four*, not X -- and the one Double Strike face in the data is `4 SAI:Double
   * Strike`, so reading the count off the face agrees with the reference exactly.
   * Flame's "two" is the same arrangement, and the reason is invariant 7: the number
   * printed on the face is the answer, and hardcoding it would disagree with the data
   * the day another face is transcribed.
   */
  'Double Strike': (x, ctx) => {
    if (isAttack(ctx, 'melee')) {
      return {
        results: {},
        effects: [{ kind: 'target_enemy', health: x, escape: 'save', fate: 'kill' }],
        reroll: true,
      }
    }
    // "During a dragon attack, Double Strike generates four melee results." Four is
    // what the face prints, so `x` is that four and invariant 7 holds here too.
    if (ctx.purpose.kind === 'dragon_attack') return gives('melee', x)
    return NOTHING
  },

  /**
   * "During a melee attack, target up to X health-worth of units in the defending
   * army. The targets make a maneuver roll. Those that do not generate a maneuver
   * result are killed."
   *
   * "Up to X" rather than Bullseye's flat "X", which makes no difference here: p. 32
   * forces the roller to the maximum either way, and both go through
   * `damageAssignmentProblem`.
   */
  Smother: (x, ctx) =>
    isAttack(ctx, 'melee')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'maneuver', fate: 'kill' }],
          reroll: false,
        }
      : NOTHING,

  /** Smother's twin, one action wider: "During a melee **or missile** attack, target
   *  up to X health-worth ... The targets make a maneuver roll." */
  Firecloud: (x, ctx) =>
    isAttack(ctx, 'melee') || isAttack(ctx, 'missile')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'maneuver', fate: 'kill' }],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During a missile attack, target up to X health-worth of units in the defending
   * army. Roll the targets. If they roll an ID icon, they are immediately moved to
   * their Reserve Area. Any that do not roll an ID are killed."
   *
   * The only escape in the game that is a question about a *face* rather than a total,
   * and the only one whose survivors go somewhere -- hence `escapeTo`, which is stated
   * rather than inferred from `escape: 'id'`. Inferring it would be the Genie's-4
   * mistake: true of the one ID-escape SAI in this box, and false of Swallow.
   */
  Seize: (x, ctx) =>
    isAttack(ctx, 'missile')
      ? {
          results: {},
          effects: [
            { kind: 'target_enemy', health: x, escape: 'id', fate: 'kill', escapeTo: 'reserve' },
          ],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During a melee attack, this effect is applied when resolving Delayed Effects.
   * Target up to X health-worth of units in that army **that rolled an ID icon**. The
   * targets are killed. None of their results are counted towards the army's save
   * results."
   *
   * Delayed, so it is chosen after the defender's save dice have landed -- the only
   * SAI whose legal targets are a fact about a roll rather than about an army.
   */
  Choke: (x, ctx) =>
    isAttack(ctx, 'melee')
      ? { results: {}, effects: [{ kind: 'choke', health: x }], reroll: false }
      : NOTHING,

  /**
   * "During a melee or missile attack, this effect is applied when resolving Delayed
   * Effects. Target up to X health-worth of units in that army. Re-roll the targeted
   * units, **ignoring all previous results**."
   *
   * Also delayed, and the only reroll in the game that replaces a face rather than
   * adding one -- `SaiOutcome.reroll` is step 3 and cannot express it.
   */
  Confuse: (x, ctx) =>
    isAttack(ctx, 'melee') || isAttack(ctx, 'missile')
      ? { results: {}, effects: [{ kind: 'confuse', health: x }], reroll: false }
      : NOTHING,

  /**
   * "During any **non-maneuver** roll, Wild Growth generates X save results **or**
   * allows you to promote X health-worth of units in this army. Results may be split
   * between saves and promotions in any way you choose. Any promotions happen all at
   * once."
   *
   * Applies by exclusion rather than by a list, which no other SAI here does -- and it
   * means a melee attack roll carries it too, where the save half is worth nothing and
   * the promotions are worth just as much.
   */
  'Wild Growth': (x, ctx) => {
    if (ctx.purpose.kind === 'maneuver') return NOTHING
    // A sub-roll is one die rolling for its own life. It may still *generate* the save
    // results -- the rule plainly says it does, and a die that dies holding a Wild
    // Growth face would be wrong -- but there is no split to decide: no army rolled
    // this, and the promotion half would need a pause inside a pause.
    // The save results are still generated where the roll counts them -- a dragon
    // combination roll does count saves -- and only the promotion half is lost.
    if (noSideDecision(ctx)) return gives('save', x)
    return { results: {}, effects: [{ kind: 'wild_growth', budget: x }], reroll: false }
  },

  /**
   * "During a melee attack, target up to X health-worth of units in the defending army.
   * The targets are killed." (v2 Phase 5c.) Flame without the burial, so the same
   * `target_enemy` with `fate: 'kill'` -- and combined by name like any budget.
   */
  Entangle: (x, ctx) =>
    isAttack(ctx, 'melee')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'none', fate: 'kill' }],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During a melee attack, target one unit in the defending army. Roll the target. If
   * it does not roll its ID icon, it is killed and buried." (v2 Phase 5c.)
   *
   * Seize's test (a look at the face, not a total) on Sleep's count (one die), and
   * Flame's fate. Survivors stay where they stood, which is why Seize's `escapeTo` is
   * stated rather than inferred from `escape: 'id'` -- this is the SAI that comment
   * was written for.
   */
  Swallow: (_x, ctx) =>
    isAttack(ctx, 'melee')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: 0, one: true, escape: 'id', fate: 'bury' }],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During any non-maneuver roll, the Ferrying unit may move itself and up to four
   * health-worth of units in its army to any terrain." (v2 Phase 5c.)
   *
   * Firewalking's free move with a bigger boat and no maneuver half: on a maneuver roll
   * Ferry does nothing at all.
   */
  /**
   * "During a melee attack, the defending army subtracts X save results. During a
   * maneuver roll while marching, subtract X from each counter-maneuvering army's
   * maneuver results. Wave does nothing if rolled during a countermaneuver." (v2 Phase
   * 5c.)
   *
   * X off the *other* army's roll, and no results of its own. A melee attack's Wave
   * applies to the save roll that answers it -- a counter-attack's too, since that is a
   * melee attack -- and a marching maneuver's to the contest's other roll.
   */
  Wave: (x, ctx) => {
    const marching = ctx.purpose.kind === 'maneuver' && ctx.purpose.marching === true
    if (!isAttack(ctx, 'melee') && !marching) return NOTHING
    return { results: {}, effects: [{ kind: 'wave', amount: x }], reroll: false }
  },

  /**
   * "During a melee attack, this effect is applied when resolving Delayed Effects. All
   * units that roll an ID icon are hypnotized and may not be rolled until the beginning
   * of your next turn. None of their results are counted towards the army's save
   * results." (v2 Phase 5c.)
   *
   * No X and no choice: "all". The end conditions and the glaring die sitting out its
   * army's rolls are `effects.ts`'s (5b), and the house rule is `RULES-V0.md` section 17.
   */
  'Hypnotic Glare': (_x, ctx) =>
    isAttack(ctx, 'melee') ? { results: {}, effects: [{ kind: 'glare' }], reroll: false } : NOTHING,

  Ferry: (_x, ctx) => {
    if (ctx.purpose.kind === 'maneuver' || noSideDecision(ctx)) return NOTHING
    return { results: {}, effects: [{ kind: 'free_move', health: FERRY_HEALTH }], reroll: false }
  },

  /**
   * "During a melee attack, target up to X health-worth of units in the defending army.
   * The targets are immediately moved to their Reserve Area before the defending army
   * rolls for saves." (v2 Phase 6d.)
   *
   * Seize's destination without Seize's roll: nobody escapes and nobody dies, so no
   * death trigger fires. A counter-attack is a melee attack, so a Roar on one sends the
   * marching army's dice home.
   */
  Roar: (x, ctx) =>
    isAttack(ctx, 'melee')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'none', fate: 'reserve' }],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During a melee attack, target up to X health-worth of units in the defending army.
   * The targets make a maneuver roll. Those that do not generate a maneuver result are
   * killed and must make a save roll. Those that do not generate a save result are
   * buried. During a dragon attack, Stomp generates X melee results." (v2 Phase 6d.)
   *
   * Smother, and then Fire breath's burial check on the dead.
   */
  /**
   * "During a melee attack, the defending army subtracts X save results." (v2 Phase 7c.)
   * Wave's first sentence and nothing more: no maneuver half.
   */
  Screech: (x, ctx) =>
    isAttack(ctx, 'melee') ? { results: {}, effects: [{ kind: 'screech', amount: x }], reroll: false } : NOTHING,

  /**
   * "During a melee attack, target X health-worth of units in the defending army. Each
   * targeted unit makes a save roll. Those that do not generate a save result are killed
   * and must make another save roll. Those that do not generate a save result on this
   * second roll are buried." (v2 Phase 7c.)
   *
   * Stomp's chain with a save roll first: the same burial check, owed on the turn.
   */
  Poison: (x, ctx) =>
    isAttack(ctx, 'melee')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'save', fate: 'save_or_bury' }],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During a melee or missile attack, target up to X health-worth of units in the
   * defending army. Each targeted unit makes a maneuver roll. Those that do not generate
   * a maneuver result are netted and may not be rolled or leave the terrain they
   * currently occupy until the beginning of your next turn. Net does nothing during a
   * missile attack targeting an opponent's Reserve Army from a Tower on its eighth face.
   * When saving against an individual targeting effect, Net generates X save results."
   * (v2 Phase 7c.)
   *
   * The Tower exception is not decided here, which sees no board: the targeting queue
   * drops a Net aimed at a Reserve Army. "Saving against an individual targeting effect"
   * is every save sub-roll -- a house rule, `RULES-V0.md` section 19: a sub-roll is one
   * unit rolling for itself, whoever aimed.
   */
  Net: (x, ctx) => {
    if (isAttack(ctx, 'melee') || isAttack(ctx, 'missile')) {
      return {
        results: {},
        effects: [{ kind: 'target_enemy', health: x, escape: 'maneuver', fate: 'asleep' }],
        reroll: false,
      }
    }
    if (ctx.isSubRoll === true && ctx.purpose.kind === 'save') return gives('save', x)
    return NOTHING
  },

  /**
   * "During a melee or missile attack, target up to X health-worth of units in the
   * defending army. The targets make a melee roll. Those that do not generate a melee
   * result are webbed and cannot be rolled or leave the terrain they currently occupy
   * until the beginning of your next turn. Web does nothing during a missile action
   * targeting an opponent's Reserve Army from a Tower on its eighth-face." (v2 Phase 8c.)
   *
   * Net with a melee roll for the escape -- 8b's melee sub-roll, whose effects
   * `resultsOnly` drops -- and the same hold, so the Tower drop and every check that
   * keeps a sleeping die in place reach it with no edit. Unlike Net it gives nothing in
   * a sub-roll: Web's sentence has no "when saving" half.
   */
  Web: (x, ctx) =>
    isAttack(ctx, 'melee') || isAttack(ctx, 'missile')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'melee', fate: 'asleep' }],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During a melee attack, target up to X health-worth of units in the defending army;
   * those units don't roll to save during this march. Instead, the owner rolls these
   * units and adds their results to the attacking army's results. Those units may take
   * damage from the melee attack as normal." (v2 Phase 8d.)
   *
   * A targeting task held to p. 32's forced maximum like every other. Answering it rolls
   * the targets through the melee sub-roll (`applyCharm`), whose effects 8b's rule drops,
   * benches them for the save roll, and joins their melee to the attack as step-8
   * results named Charm.
   */
  Charm: (x, ctx) =>
    isAttack(ctx, 'melee')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'none', fate: 'charm' }],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During a magic, melee or missile attack, target any of your armies. Until the
   * beginning of your next turn, the target army cannot be targeted by any missile
   * attacks or spells cast by opposing players." (v2 Phase 8d.)
   *
   * Every attack roll, a counter-attack's and a magic action's included -- the roller is
   * the attacker either way. No X: the face's count is unread.
   */
  Illusion: (_x, ctx) =>
    ctx.purpose.kind === 'attack' ? { results: {}, effects: [{ kind: 'illusion' }], reroll: false } : NOTHING,

  /**
   * "During a save roll or dragon attack, add X non-magical save results to the army
   * containing this unit until the beginning of your next turn. During a magic action,
   * Cloak generates X magic results. During a roll for an individual-targeting effect,
   * Cloak generates X magic, maneuver, melee, missile, or save results." (v2 Phase 8c.)
   *
   * Three rolls, three answers:
   *  - **A sub-roll** is an individual-targeting roll (7c's house rule), and the specific
   *    sentence wins: X of whatever it counts, and no effect.
   *  - **An army's save roll or the dragon roll**: X saves now, and an effect of +X save
   *    for every save roll after it until the roller's next turn (`castCloaks`). Wall of
   *    Thorns' roll and a spell's save roll are save rolls by purpose, so they write it
   *    too; the first counts no saves, so it gets only the effect.
   *  - **A magic action**: X magic, as Cantrip's first sentence.
   * In the 'full' table because the effect has a duration, as Sleep's does.
   */
  Cloak: (x, ctx) => {
    if (ctx.isSubRoll === true) return choiceOf(x, ctx.purpose, ['magic', 'maneuver', 'melee', 'missile', 'save'])
    if (ctx.purpose.kind === 'save' || ctx.purpose.kind === 'dragon_attack') {
      return { results: { save: x }, effects: [{ kind: 'cloak', saves: x }], reroll: false }
    }
    if (isAttack(ctx, 'magic')) return gives('magic', x)
    return NOTHING
  },

  /**
   * "During a melee attack, target up to X health-worth of units in the defending army.
   * The targets make a maneuver roll. Those that do not generate a maneuver result are
   * stunned and cannot be rolled until the beginning of your turn, unless they are the
   * target of an individual-targeting effect which forces them to. Stunned units that
   * leave the terrain through any means are no longer stunned." (v2 Phase 7c.)
   *
   * "Your turn" is the caster's next one: the turn it is cast in has already begun.
   */
  Stun: (x, ctx) =>
    isAttack(ctx, 'melee')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'maneuver', fate: 'stun' }],
          reroll: false,
        }
      : NOTHING,

  /**
   * "During any non-maneuver roll, choose one: Regenerate generates X save results, OR,
   * you may return up to X health-worth of units from your DUA to the army containing
   * this unit." (v2 Phase 7d.)
   *
   * Wild Growth's shape: a friendly decision at the roller's pause, and where there is no
   * room for one -- a sub-roll, Wall of Thorns' roll, the dragon roll -- the saves.
   */
  Regenerate: (x, ctx) => {
    if (ctx.purpose.kind === 'maneuver') return NOTHING
    if (noSideDecision(ctx)) return gives('save', x)
    return { results: {}, effects: [{ kind: 'regenerate', budget: x }], reroll: false }
  },

  Stomp: (x, ctx) => {
    if (isAttack(ctx, 'melee')) {
      return {
        results: {},
        effects: [{ kind: 'target_enemy', health: x, escape: 'maneuver', fate: 'save_or_bury' }],
        reroll: false,
      }
    }
    if (ctx.purpose.kind === 'dragon_attack') return gives('melee', x)
    return NOTHING
  },

  /**
   * "During a save roll against a melee attack, target one unit from the attacking army.
   * The targeted unit takes damage equal to the melee results it generated. The targeted
   * unit must make a save roll against this damage. Bash also generates save results
   * equal to the targeted unit's melee results. During other save rolls, Bash generates
   * X save results. During a dragon attack choose an attacking dragon that has inflicted
   * damage. That dragon takes damage equal to the amount of damage it inflicted. Bash
   * also generates save results equal to the damage the chosen dragon did." (v2 Phase 6d.)
   *
   * Three sentences, three shapes. Against melee its number is the *target's* melee,
   * chosen at the delayed pause; a sub-roll is a save roll against nothing, so it is an
   * "other" save roll and gives X, as does a spell's save roll. The dragon sentence is
   * resolved where the dragons' damage is known.
   */
  /**
   * "During a melee attack, the attacking army counts all Maneuver results as if they
   * were Melee results. Instead of making a regular save roll or a counter-attack, the
   * defending army makes a combination save and melee roll. The attacking army takes
   * damage equal to these melee results. Only save results generated by spells that
   * would add to a save roll may reduce this damage. Charge has no effect during a
   * counter-attack." (v2 Phase 6e.)
   *
   * No X, and no results of its own: it reshapes the exchange. The effect says a Charge
   * is on the roll; `resolveFaces` turns the attacker's maneuver into melee, and the
   * exchange turns the defender's save roll into the combination roll. Several Charges
   * are one Charge.
   */
  Charge: (_x, ctx) =>
    isAttack(ctx, 'melee') && !ctx.isCounter
      ? { results: {}, effects: [{ kind: 'charge' }], reroll: false }
      : NOTHING,

  Bash: (x, ctx) => {
    if (isSaveAgainst(ctx, 'melee') && !noSideDecision(ctx)) {
      return { results: {}, effects: [{ kind: 'bash' }], reroll: false }
    }
    if (ctx.purpose.kind === 'save') return gives('save', x)
    if (ctx.purpose.kind === 'dragon_attack') {
      return { results: {}, effects: [{ kind: 'bash_dragon' }], reroll: false }
    }
    return NOTHING
  },
}

/**
 * What each SAI actually says, for the player being asked to use one.
 *
 * Every decision in this game is a rule most people will not have memorised, and a
 * prompt that says "Seize: target 4 health-worth" tells you the arithmetic while
 * hiding the only thing that matters -- that the dice you pick get a roll, and that an
 * ID sends them home rather than killing them. So the sheet prints the rule.
 *
 * It lives here rather than in either client because both need it and because it
 * belongs beside the handler it describes: a handler that changes and a sentence that
 * does not is exactly the drift this file has been bitten by twice.
 *
 * **`X` is left as `X`.** The sheet's own line says what the number is on this die;
 * substituting it into the prose would make the two disagree the moment a face with a
 * different count is transcribed.
 */
export const SAI_TEXT: Readonly<Record<string, string>> = {
  Flame:
    'During a melee attack, target up to two health-worth of units in the defending ' +
    'army. The targets are killed and buried.',
  Sleep:
    "During a melee attack, target one unit in an opponent's army at this terrain. " +
    'The target unit is asleep and cannot be rolled or leave the terrain they ' +
    'currently occupy until the beginning of your next turn.',
  Galeforce:
    'During a melee or missile attack, or a magic action at a terrain, target an ' +
    'opposing army at any terrain. Until the beginning of your next turn, the target ' +
    'army subtracts four save and four maneuver results from all rolls.',
  Bullseye:
    'During a missile attack, target X health-worth of units in the defending army. ' +
    'The targets make a save roll. Those that do not generate a save result are ' +
    'killed. Roll this unit again and apply the new result as well.',
  'Double Strike':
    'During a melee attack, target four health-worth of units in the defending army. ' +
    'The targets make a save roll. Those that do not generate a save result are ' +
    'killed. Roll this unit again and apply the new result as well.',
  Smother:
    'During a melee attack, target up to X health-worth of units in the defending ' +
    'army. The targets make a maneuver roll. Those that do not generate a maneuver ' +
    'result are killed.',
  Firecloud:
    'During a melee or missile attack, target up to X health-worth of units in the ' +
    'defending army. The targets make a maneuver roll. Those that do not generate a ' +
    'maneuver result are killed.',
  Seize:
    'During a missile attack, target up to X health-worth of units in the defending ' +
    'army. Roll the targets. If they roll an ID icon, they are immediately moved to ' +
    'their Reserve Area. Any that do not roll an ID are killed.',
  Choke:
    'During a melee attack, this effect is applied when resolving Delayed Effects. ' +
    'Target up to X health-worth of units in that army that rolled an ID icon. The ' +
    "targets are killed. None of their results are counted towards the army's save " +
    'results.',
  Confuse:
    'During a melee or missile attack, this effect is applied when resolving Delayed ' +
    'Effects. Target up to X health-worth of units in that army. Re-roll the targeted ' +
    'units, ignoring all previous results.',
  'Wild Growth':
    'During any non-maneuver roll, Wild Growth generates X save results or allows you ' +
    'to promote X health-worth of units in this army. Results may be split between ' +
    'saves and promotions in any way you choose. Any promotions happen all at once.',
  Firewalking:
    'During a maneuver roll, Firewalking generates X maneuver results. During any ' +
    'non-maneuver roll, this unit may move itself and up to three health-worth of ' +
    'units in its army to any terrain.',
  Teleport:
    'During a maneuver roll, Teleport generates X maneuver results. During any ' +
    'non-maneuver roll, this unit may move itself and up to three health-worth of ' +
    'units in its army to any terrain.',
  Entangle:
    'During a melee attack, target up to X health-worth of units in the defending army. ' +
    'The targets are killed.',
  Swallow:
    'During a melee attack, target one unit in the defending army. Roll the target. If it ' +
    'does not roll its ID icon, it is killed and buried.',
  Ferry:
    'During any non-maneuver roll, the Ferrying unit may move itself and up to four ' +
    'health-worth of units in its army to any terrain.',
  Tail:
    'During a dragon or melee attack, Tail generates two melee results. Roll this unit ' +
    'again and apply the new result as well.',
  'Hypnotic Glare':
    'During a melee attack, this effect is applied when resolving Delayed Effects. All ' +
    'units that roll an ID icon are hypnotized and may not be rolled until the beginning ' +
    "of your next turn. None of their results are counted towards the army's save " +
    'results. The effect ends if the glaring unit leaves the terrain, is killed, or is ' +
    'rolled. The glaring unit may be excluded from any roll until the effect expires.',
  Wave:
    'During a melee attack, the defending army subtracts X save results. During a ' +
    "maneuver roll while marching, subtract X from each counter-maneuvering army's " +
    'maneuver results. Wave does nothing if rolled during a countermaneuver.',
  Roar:
    'During a melee attack, target up to X health-worth of units in the defending army. ' +
    'The targets are immediately moved to their Reserve Area before the defending army ' +
    'rolls for saves.',
  Stomp:
    'During a melee attack, target up to X health-worth of units in the defending army. ' +
    'The targets make a maneuver roll. Those that do not generate a maneuver result are ' +
    'killed and must make a save roll. Those that do not generate a save result are ' +
    'buried. During a dragon attack, Stomp generates X melee results.',
  Charge:
    'During a melee attack, the attacking army counts all Maneuver results as if they were ' +
    'Melee results. Instead of making a regular save roll or a counter-attack, the defending ' +
    'army makes a combination save and melee roll. The attacking army takes damage equal to ' +
    'these melee results. Only save results generated by spells that would add to a save roll ' +
    'may reduce this damage. Charge has no effect during a counter-attack.',
  Bash:
    'During a save roll against a melee attack, target one unit from the attacking army. ' +
    'The targeted unit takes damage equal to the melee results it generated. The ' +
    'targeted unit must make a save roll against this damage. Bash also generates save ' +
    "results equal to the targeted unit's melee results. During other save rolls, Bash " +
    'generates X save results.',
  Screech: 'During a melee attack, the defending army subtracts X save results.',
  Regenerate:
    'During any non-maneuver roll, choose one: Regenerate generates X save results, OR, ' +
    'you may return up to X health-worth of units from your DUA to the army containing ' +
    'this unit.',
  Poison:
    'During a melee attack, target X health-worth of units in the defending army. Each ' +
    'targeted unit makes a save roll. Those that do not generate a save result are killed ' +
    'and must make another save roll. Those that do not generate a save result on this ' +
    'second roll are buried.',
  Net:
    'During a melee or missile attack, target up to X health-worth of units in the ' +
    'defending army. Each targeted unit makes a maneuver roll. Those that do not generate ' +
    'a maneuver result are netted and may not be rolled or leave the terrain they ' +
    'currently occupy until the beginning of your next turn. Net does nothing during a ' +
    "missile attack targeting an opponent's Reserve Army from a Tower on its eighth face. " +
    'When saving against an individual targeting effect, Net generates X save results.',
  Stun:
    'During a melee attack, target up to X health-worth of units in the defending army. ' +
    'The targets make a maneuver roll. Those that do not generate a maneuver result are ' +
    'stunned and cannot be rolled until the beginning of your turn, unless they are the ' +
    'target of an individual-targeting effect which forces them to. Stunned units that ' +
    'leave the terrain through any means are no longer stunned.',
  Stone:
    'During a melee or missile attack, Stone does X damage to the defending army with no ' +
    'save possible. During a dragon attack, Stone generates X missile results.',
  Web:
    'During a melee or missile attack, target up to X health-worth of units in the ' +
    'defending army. The targets make a melee roll. Those that do not generate a melee ' +
    'result are webbed and cannot be rolled or leave the terrain they currently occupy ' +
    "until the beginning of your next turn. Web does nothing during a missile action " +
    "targeting an opponent's Reserve Army from a Tower on its eighth face.",
  Charm:
    'During a melee attack, target up to X health-worth of units in the defending army; ' +
    "those units don't roll to save during this march. Instead, the owner rolls these units " +
    "and adds their results to the attacking army's results. Those units may take damage " +
    'from the melee attack as normal.',
  Illusion:
    'During a magic, melee or missile attack, target any of your armies. Until the ' +
    'beginning of your next turn, the target army cannot be targeted by any missile ' +
    'attacks or spells cast by opposing players.',
  Cloak:
    'During a save roll or dragon attack, add X non-magical save results to the army ' +
    'containing this unit until the beginning of your next turn. During a magic action, ' +
    'Cloak generates X magic results. During a roll for an individual-targeting effect, ' +
    'Cloak generates X magic, maneuver, melee, missile, or save results.',
}

/** The SAI names `sai: 'results'` resolves. Anything else on a face is inert. */
export const LIVE_SAIS: readonly string[] = Object.keys(HANDLERS)

/**
 * The word for a die a hold caught (`fate: 'asleep'`), by the SAI that caught it (v2
 * Phase 8b): "must maneuver or be **netted**". The fate is one status under several
 * names, so the name is what the sentence needs. Beside `SAI_TEXT` for its reason, and
 * `sai.test.ts` holds every SAI whose fate is `'asleep'` to a word here.
 */
const HELD: Readonly<Record<string, string>> = {
  Net: 'netted',
  Web: 'webbed',
}

export function heldWord(sai: string): string {
  return HELD[sai] ?? 'held'
}

/**
 * Whether this ruleset resolves this SAI at all.
 *
 * The question both clients actually want to ask -- "does this face do anything in
 * the game being played?" -- and the reason it takes a `RuleSet` rather than reading
 * `LIVE_SAIS`: the answer changes by rung, and a table lookup can only ever be right
 * about one of them. `faceLabel` in the browser asked `LIVE_SAIS` and so called every
 * targeting SAI unimplemented, which is true while the app plays `'results'` and
 * becomes a lie the moment it plays `'full'`.
 *
 * Note what a `false` means on the `'full'` rung: not "inert" but **refused** --
 * `saiEffects` throws. No game the app can start reaches that, and Phase 4e removes
 * the last of them.
 */
export function resolvesSai(sai: string, ruleSet: RuleSet): boolean {
  if (ruleSet.sai === 'inert') return false
  return handlerFor(sai, ruleSet) !== undefined
}

/** The SAI names `sai: 'full'` adds on top of those. */
export const TARGETING_SAIS: readonly string[] = Object.keys(FULL_HANDLERS)

/**
 * Whether any rung implements this SAI at all -- the question `sai: 'full'` refuses on.
 * Ruleset-free on purpose: it is what decides whether a species can be offered
 * (`playable.ts`), and "can the engine play this die" is a fact about the engine, not
 * about the rules one game happens to use.
 */
export function saiBuilt(sai: string): boolean {
  return HANDLERS[sai] !== undefined || FULL_HANDLERS[sai] !== undefined
}

/** The handler this ruleset uses for this name, if it has one at all. */
function handlerFor(sai: string, ruleSet: RuleSet): SaiHandler | undefined {
  return HANDLERS[sai] ?? (ruleSet.sai === 'full' ? FULL_HANDLERS[sai] : undefined)
}

/**
 * What one SAI face contributes to this roll.
 *
 * **The rungs differ in what they do with a name no handler claims.** `'results'`
 * returns nothing, which is what makes it a playable rung rather than a half-built
 * `'full'`; `'full'` refuses, which is what stops a half-built `'full'` quietly
 * playing a wrong game.
 *
 * As of Phase 4e **every SAI in the starter box is claimed**. A species whose dice carry
 * an unbuilt SAI is in `data/` but not playable (`playable.ts`, v2 Phase 5a), so no game
 * reaches the throw below: it is the guard against one of those faces going quietly
 * inert if something ever does roll it. Cantrip and Dispel Magic used
 * to have a message of their own here; they do not need one, because neither is
 * unimplemented. See their handlers.
 */
export function saiEffects(face: SaiFace, context: RollContext, ruleSet: RuleSet): SaiOutcome {
  if (ruleSet.sai === 'inert') return NOTHING

  const handler = handlerFor(face.sai, ruleSet)
  if (handler !== undefined) return resultsOnly(handler(face.count, context, ruleSet), context)

  if (ruleSet.sai === 'full') {
    throw new Error(
      `SAI ${face.sai} is not implemented (ruleSet.sai === 'full', face ${face.count} ${face.sai})`,
    )
  }

  return NOTHING
}

/**
 * A **melee sub-roll** gives results and nothing else (v2 Phase 8b): every effect its
 * faces produce is dropped, here, by one rule.
 *
 * Web's targets and Charm's (8c, 8d) roll melee one die at a time, which is the first
 * sub-roll whose purpose is an *attack*. Its SAIs' results apply as the reference says
 * -- Counter's X melee, Rend's melee and its reroll, which is not an effect -- but every
 * effect is aimed at "the defending army", and a die rolling for its own life, or for
 * the enemy's total, has none: a charmed die's Smite would strike its own army, its
 * Charm would charm nobody. It is 4d's sub-roll rule ("a save roll against nothing")
 * for a roll that does have an enemy in its sentence, stated once rather than as a
 * guard in every handler that ever names an attack -- and it drops a Charge's effect
 * before `resolveFaces` can see it, so a charmed Dwarf never charges.
 *
 * Only an attack purpose: a save or maneuver sub-roll's effects are refused by the
 * caller's `expectNoEffects`, which is still where a new one should be found.
 */
function resultsOnly(outcome: SaiOutcome, ctx: RollContext): SaiOutcome {
  if (ctx.isSubRoll !== true || ctx.purpose.kind !== 'attack' || outcome.effects.length === 0) return outcome
  return { ...outcome, effects: [] }
}

/** Every roll an SAI could be asked about, for the static bound below. */
const ALL_PURPOSES: readonly RollPurpose[] = [
  { kind: 'maneuver' },
  { kind: 'attack', action: 'melee' },
  { kind: 'attack', action: 'missile' },
  { kind: 'attack', action: 'magic' },
  { kind: 'save', against: 'melee' },
  { kind: 'save', against: 'missile' },
  { kind: 'save', against: null },
  { kind: 'save', against: 'magic' },
]

/**
 * The same list, plus the dragon roll when the rules have dragons.
 *
 * Gated rather than unconditional, because the dragon-attack sentences are where
 * Smite and Bullseye stop being result-free: asking about a roll that cannot happen
 * would raise the ceiling of every game that has no dragons in it. An over-bound is
 * survivable where an under-bound is not -- `maxArmyResults` is a ceiling -- but a
 * ceiling that moves for rules nobody is playing is a worse answer than the true one.
 */
function purposesFor(ruleSet: RuleSet): readonly RollPurpose[] {
  return ruleSet.dragons ? [...ALL_PURPOSES, { kind: 'dragon_attack' }] : ALL_PURPOSES
}

/**
 * The most this SAI face could ever generate of a result type, over every roll it
 * could appear in.
 *
 * Derived by asking the handlers rather than kept as a second table, so it cannot
 * drift away from what they actually do. Smite comes out 0 here, which is the check
 * that its damage was not written as melee results.
 *
 * The two guards are both load-bearing. `'inert'` generates nothing, so the bound is
 * 0 -- but `'full'` generates *more* than `'results'` does, and the old test here was
 * `sai !== 'results'`, which would have silently under-bounded every roll the moment
 * a targeting SAI generated a result. And an unclaimed name is asked about rather
 * than resolved, so it has to be answered before `saiEffects` gets the chance to
 * refuse it.
 */
export function saiMaxResults(face: SaiFace, resultType: ResultType, ruleSet: RuleSet): number {
  if (ruleSet.sai === 'inert') return 0
  if (handlerFor(face.sai, ruleSet) === undefined) return 0

  // Sub-rolls too (v2 Phase 7c): Net's saves exist only in one, and Wild Growth's save
  // share did on every rung without dragons -- both were under the ceiling before.
  let best = 0
  for (const purpose of purposesFor(ruleSet)) {
    for (const isCounter of [false, true]) {
      for (const isSubRoll of [false, true]) {
        const context: RollContext = isSubRoll ? { purpose, isCounter, isSubRoll } : { purpose, isCounter }
        const outcome = saiEffects(face, context, ruleSet)
        best = Math.max(best, outcome.results[resultType] ?? 0)
      }
    }
  }
  return best
}
