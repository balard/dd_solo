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
 * Firewalking and Teleport, which are the same SAI on two dice.
 *
 * X maneuver results on a maneuver roll -- on every rung, which is why these two stay
 * in `HANDLERS` -- and on any other roll a free move, which only `'full'` can resolve.
 * The move is "itself and up to three health-worth", a flat three that no face agrees
 * with; `x` is read for the maneuver half and nothing else.
 */
const freeMove = (x: number, ctx: RollContext, rung: RuleSet['sai']): SaiOutcome => {
  if (ctx.purpose.kind === 'maneuver') return gives('maneuver', x)
  if (rung !== 'full' || ctx.isSubRoll === true) return NOTHING
  return { results: {}, effects: [{ kind: 'free_move', health: 3 }], reroll: false }
}

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

/**
 * `rung` is `RuleSet['sai']`, and Firewalking and Teleport are what it is for.
 *
 * Phase 4a declared threading it premature and was right: until now the two rungs
 * differed in *which SAIs exist*, which two tables express better than an argument.
 * These two differ in what one SAI **does** -- their maneuver results work on every
 * rung, their free move only on `'full'` -- and that is a question no table can
 * answer, because a name can only be in one of them. Every other handler ignores it.
 */
type SaiHandler = (x: number, ctx: RollContext, rung: RuleSet['sai']) => SaiOutcome

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

  /**
   * "During a maneuver roll, Firewalking generates X maneuver results. During any
   * **non-maneuver** roll, this unit may move itself and up to three health-worth of
   * units in its army to any terrain."
   *
   * The one SAI whose two halves live on different rungs, which is what the `rung`
   * argument above exists for. Three, not X: see `free_move` in `pipeline.ts`.
   */
  Firewalking: (x, ctx, rung) => freeMove(x, ctx, rung),

  /** Word for word Firewalking, on a different die. */
  Teleport: (x, ctx, rung) => freeMove(x, ctx, rung),

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
  Cantrip: (x, ctx) =>
    ctx.purpose.kind === 'attack' && ctx.purpose.action === 'magic' ? gives('magic', x) : NOTHING,

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
}

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
   * budget to the same task, because `targetTasks` combines by name. Its dragon-attack
   * half ("generates X missile results") is Phase 6, like every other dragon sentence
   * in this file.
   */
  Bullseye: (x, ctx) =>
    isAttack(ctx, 'missile')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'save', fate: 'kill' }],
          reroll: true,
        }
      : NOTHING,

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
  'Double Strike': (x, ctx) =>
    isAttack(ctx, 'melee')
      ? {
          results: {},
          effects: [{ kind: 'target_enemy', health: x, escape: 'save', fate: 'kill' }],
          reroll: true,
        }
      : NOTHING,

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
    if (ctx.isSubRoll === true) return gives('save', x)
    return { results: {}, effects: [{ kind: 'wild_growth', budget: x }], reroll: false }
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
}

/** The SAI names `sai: 'results'` resolves. Anything else on a face is inert. */
export const LIVE_SAIS: readonly string[] = Object.keys(HANDLERS)

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
 * As of Phase 4e **every SAI in the box is claimed**, so the throw below is no longer
 * reachable by anything in `data/` -- it is the guard against a *new* one arriving
 * with a new species and going quietly inert instead. Cantrip and Dispel Magic used
 * to have a message of their own here; they do not need one, because neither is
 * unimplemented. See their handlers.
 */
export function saiEffects(face: SaiFace, context: RollContext, ruleSet: RuleSet): SaiOutcome {
  if (ruleSet.sai === 'inert') return NOTHING

  const handler = handlerFor(face.sai, ruleSet)
  if (handler !== undefined) return handler(face.count, context, ruleSet.sai)

  if (ruleSet.sai === 'full') {
    throw new Error(
      `targeting SAIs are not implemented (ruleSet.sai === 'full', face ${face.count} ${face.sai})`,
    )
  }

  return NOTHING
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

  let best = 0
  for (const purpose of ALL_PURPOSES) {
    for (const isCounter of [false, true]) {
      const outcome = saiEffects(face, { purpose, isCounter }, ruleSet)
      best = Math.max(best, outcome.results[resultType] ?? 0)
    }
  }
  return best
}
