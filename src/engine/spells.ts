/**
 * What a spell does, once it has been announced and it is its turn to resolve.
 *
 * Two kinds, and the split is in the data rather than here. A **declarative** spell
 * carries an `effect` block -- modifiers on a target for a duration -- and becomes a
 * Phase 3 `Effect` with no code of its own. A **handled** spell names a function
 * below, which means it does something at resolution time that an `Effect` cannot
 * express: damage, a sub-roll, a move, a trigger.
 *
 * Unlike an SAI, a spell handler **takes `GameState`**. An SAI is a pure function of
 * its face and what the roll is for; a spell moves units, terrains and dragons, and
 * pretending otherwise would put a second dispatch table in `turn.ts` for the half
 * that touches the board. What a handler must *not* do is set `pending`: a spell that
 * owes a decision parks it on `turn.magic`, and `stepMarch` asks -- the same shape a
 * targeting SAI uses.
 *
 * `resolvesSpell` is `resolvesSai`'s and `resolvesIcon`'s twin, for the reason both
 * of those exist: the answer changes by rung, and a table is only ever right about
 * one rung. A spell the rules being played cannot resolve is simply never offered,
 * which is the `sai: 'results'` lesson rather than the `'full'` one -- the throw in
 * `castSpell` guards against a spell reaching resolution anyway, not against
 * half-built work.
 */
import { dragonDie } from '../data/load'
import { spell, type Spell, type SpellEffectSpec, type SpellModifierSpec } from '../data/spells'

import type { Element, ResultType } from '../data/types'

import { healthsOf, maxAbsorbable } from './damage'
import { returnFromDua } from './dua'
import type { Effect, EffectTarget } from './effects'
import { ALL_RESULT_TYPES, type Modifier } from './pipeline'

import {
  army as armyOf,
  TERRAIN_SLOTS,
  type ArmyRef,
  type DragonId,
  type GameState,
  type PlayerId,
  type RuleSet,
  type SpellChoice,
  type SpellTarget,
  type TerrainSlot,
  type UnitInstance,
} from './types'

/** What a handler is told about the cast it is resolving. */
export interface SpellContext {
  readonly caster: PlayerId
  /** Where the casting army stands. `'reserve'` once Reserve magic returns (7f). */
  readonly army: ArmyRef
  /** Which element paid. Fixed by the spell unless it is Elemental -- Resurrect Dead
   *  and Summon Dragon are the two that read it. */
  readonly element: Element
  /** Combined castings, folded at announcement. A cumulative spell multiplies its
   *  own highlighted number by this; a non-cumulative one ignores it. */
  readonly count: number
  /** What the caster named at announcement, already checked to still exist. */
  readonly target: SpellTarget
}

/**
 * What a handler did, and what it still needs to be told.
 *
 * A handler cannot raise a `Pending` -- `applyAction` clears `pending` and only
 * `stepGame` sets one -- so a spell that owes a decision hands one back here and the
 * march step asks. `SaiOutcome`'s shape, for `SaiOutcome`'s reason.
 */
export interface SpellOutcome {
  readonly state: GameState
  readonly choice?: SpellChoice
}

type SpellHandler = (state: GameState, ctx: SpellContext) => SpellOutcome

/**
 * One data modifier as the pipeline's, scaled by the number of combined castings.
 *
 * "Multiply the highlighted effect(s) by the number of combined castings" -- three
 * Wind Walks add twelve maneuver results, as **one** effect rather than three. That
 * distinction is not cosmetic: the pipeline caps dividers and multipliers at one per
 * result type, and three separate `divide` effects would throw where one scaled effect
 * would not. No spell in scope divides or multiplies, so nothing exercises that today
 * -- but folding at cast time is the shape that stays right when one does.
 *
 * `'*'` expands to every result type: Ash Storm subtracts from *all* results, and five
 * rows in the data would be five places to get it wrong.
 */
function scaleModifier(m: SpellModifierSpec, count: number): readonly Modifier[] {
  const types: readonly ResultType[] =
    m.resultType === '*' ? ALL_RESULT_TYPES : [m.resultType]

  return types.map((resultType): Modifier => {
    switch (m.kind) {
      case 'add':
        return { kind: 'add', resultType, amount: (m.amount ?? 0) * count }
      case 'subtract':
        return { kind: 'subtract', resultType, amount: (m.amount ?? 0) * count }
      // A cumulative divider or multiplier would scale its *factor*, which is what
      // "multiply the highlighted effect" says. Neither is reachable from the eighteen
      // spells in scope; both are written out rather than thrown on, because the
      // throw would be the interesting case and it belongs in the data check.
      case 'divide':
        return { kind: 'divide', resultType, by: (m.by ?? 1) * count }
      case 'multiply':
        return { kind: 'multiply', resultType, by: (m.by ?? 1) * count, share: m.share ?? 'all' }
      case 'ignore_ids':
        return { kind: 'ignore_ids', resultType }
    }
  })
}

/**
 * Where a declarative spell's effect sits, from its scope and what the caster named.
 *
 * The two questions are deliberately separate: `target` is what the *player* chose at
 * announcement and `scope` is what the *spell* does with it. Ash Storm and Wall of Fog
 * are both "target any terrain" and reach entirely different armies.
 */
function effectTargetFor(scope: SpellEffectSpec['scope'], target: SpellTarget): EffectTarget {
  switch (scope) {
    case 'army':
      if (target.kind !== 'army') throw new Error(`an army spell was aimed at a ${target.kind}`)
      return { kind: 'army', player: target.player, army: target.army }
    case 'unit':
      if (target.kind !== 'units' || target.unitIds[0] === undefined) {
        throw new Error(`a unit spell was aimed at a ${target.kind}`)
      }
      return { kind: 'unit', unitId: target.unitIds[0] }
    case 'all_armies':
    case 'attackers':
      if (target.kind !== 'terrain') throw new Error(`a terrain spell was aimed at a ${target.kind}`)
      return { kind: 'terrain', slot: target.slot, scope }
    case 'maneuverers':
      // Wall of Thorns, Phase 7d. It has no `effect` block yet, so `resolvesSpell` is
      // false for it and nothing can reach this.
      throw new Error(`the ${scope} scope is not implemented yet`)
  }
}

/** The `Effect` a declarative spell becomes. Pure: no board, no randomness. */
export function spellEffect(s: Spell, ctx: SpellContext): Effect {
  const spec = s.effect
  if (spec === undefined) throw new Error(`${s.id} is not a declarative spell`)

  return {
    source: s.name,
    target: effectTargetFor(spec.scope, ctx.target),
    modifiers: spec.modifiers.flatMap((m) => scaleModifier(m, s.cumulative ? ctx.count : 1)),
    // Every spell in scope that lasts at all lasts until the beginning of the caster's
    // next turn, so `duration` has exactly one value and this needs no branch.
    expiresAtStartOfTurnOf: ctx.caster,
  }
}

/**
 * The handled spells.
 *
 * Empty in 7a by design: the slice builds the seam and resolves nothing, so
 * `resolvesSpell` answers false for all eighteen and no announcement can be made.
 * Each later slice moves its spells in here, or gives them an `effect` block in
 * `data/spells.json`.
 */
/**
 * Hailstorm: "inflict one point of damage on the target", multiplied by the castings.
 *
 * Damage, not an effect -- so it goes through the ordinary assignment the defender
 * makes, maximal-subset rule and all. One point usually kills nothing, which is not a
 * special case: damage too small to kill anything is dropped, exactly as it is after
 * a melee exchange.
 */
const hailstorm: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'army') throw new Error('Hailstorm targets an army')
  const army = armyOf(state, ctx.target.player, ctx.target.army)
  const damage = ctx.count

  if (maxAbsorbable(healthsOf(army), damage) === 0) return { state }

  return {
    state,
    choice: { kind: 'damage', player: ctx.target.player, army: ctx.target.army, damage },
  }
}

/**
 * Path: "move the target to any other terrain where you have an army."
 *
 * The unit is named at announcement and the destination is chosen now, because the
 * destination is the spell's *effect* rather than its target -- the rules announce
 * targets, not outcomes.
 */
const path: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'units') throw new Error('Path targets units')

  const movers = ctx.target.unitIds
    .map((id) => state.units[id])
    .filter((u): u is UnitInstance => u !== undefined && u.location.kind === 'terrain')
  if (movers.length === 0) return { state }

  const here = new Set(
    movers.map((u) => (u.location.kind === 'terrain' ? u.location.slot : null)),
  )
  const options = TERRAIN_SLOTS.filter(
    (slot) => !here.has(slot) && armyOf(state, ctx.caster, slot).length > 0,
  )
  // "Any *other* terrain where you have an army" -- with nowhere to go the spell does
  // nothing, and a decision with no answers is not asked.
  if (options.length === 0) return { state }

  return { state, choice: { kind: 'move', unitIds: movers.map((u) => u.id), options } }
}

/**
 * Resurrect Dead: "target one health-worth of units in your DUA that contains the
 * element of magic used to cast this spell. Return the targets to the casting army."
 *
 * The health budget and the element were both checked at announcement, where the
 * number of castings is known. This moves them.
 */
const resurrectDead: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'units') throw new Error('Resurrect Dead targets units')

  const alive = ctx.target.unitIds.filter((id) => state.units[id]?.location.kind === 'dua')
  if (alive.length === 0) return { state }

  return { state: returnFromDua(state, alive, ctx.army) }
}

/**
 * Summon Dragon: "summon one dragon that contains the element used to cast this spell
 * from any Summoning Pool or terrain to the target terrain."
 *
 * **Any** pool, including the opponent's, and any terrain -- the spell pulls a dragon
 * off the board as readily as out of a pool. What it may not do is fetch an element
 * the magic did not pay for, which is the one thing `ctx.element` is read for.
 */
const summonDragon: SpellHandler = (state, ctx) => {
  if (ctx.target.kind !== 'terrain') throw new Error('Summon Dragon targets a terrain')

  const options = summonable(state, ctx.element, ctx.target.slot)
  if (options.length === 0) return { state }

  return {
    state,
    choice: {
      kind: 'summon',
      slot: ctx.target.slot,
      options,
      remaining: Math.min(ctx.count, options.length),
    },
  }
}

/** Every dragon this element could fetch: the right colour, and not already there. */
export function summonable(
  state: GameState,
  element: Element,
  slot: TerrainSlot,
): readonly DragonId[] {
  return Object.values(state.dragons)
    .filter((d) => dragonDie(d.dieId).element === element)
    .filter((d) => !(d.location.kind === 'terrain' && d.location.slot === slot))
    .map((d) => d.id)
}

const HANDLERS: Readonly<Record<string, SpellHandler>> = {
  hailstorm,
  path,
  resurrect_dead: resurrectDead,
  summon_dragon: summonDragon,
}

/** The spell ids this build can actually resolve, for tests and for the clients. */
export function resolvableSpells(ruleSet: RuleSet): readonly string[] {
  return Object.keys(HANDLERS).filter((id) => resolvesSpell(id, ruleSet))
}

/**
 * Whether this build can resolve this spell under these rules.
 *
 * False for every spell under `magic: 'simplified'`, which is what keeps `V0_RULES`
 * exactly the v0 game. Under `'spells'` it is "the data gave it an effect, or code
 * gave it a handler" -- and a spell with neither is transcribed but not implemented,
 * a real and temporary state that `spells.test.ts` pins the membership of.
 */
export function resolvesSpell(id: string, ruleSet: RuleSet): boolean {
  if (ruleSet.magic !== 'spells') return false
  const s = spell(id)
  return s.effect !== undefined || HANDLERS[s.handler ?? ''] !== undefined
}

/**
 * Resolves one announced cast.
 *
 * Throws for a spell that reached resolution with nothing behind it. That is not the
 * `sai: 'full'` refusal in disguise: `castableSpells` filters on `resolvesSpell`, so
 * an unimplemented spell can never be announced, and this can only fire if something
 * bypassed the offer.
 */
export function castSpell(state: GameState, s: Spell, ctx: SpellContext): SpellOutcome {
  const handler = HANDLERS[s.handler ?? '']
  if (handler !== undefined) return handler(state, ctx)

  throw new Error(`spell ${s.id} has no effect and no handler, and cannot be resolved`)
}
