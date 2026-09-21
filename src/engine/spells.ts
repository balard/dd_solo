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
import { spell, type Spell } from '../data/spells'

import type { Element } from '../data/types'

import type { ArmyRef, GameState, PlayerId, RuleSet, SpellTarget } from './types'

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

type SpellHandler = (state: GameState, ctx: SpellContext) => GameState

/**
 * The handled spells.
 *
 * Empty in 7a by design: the slice builds the seam and resolves nothing, so
 * `resolvesSpell` answers false for all eighteen and no announcement can be made.
 * Each later slice moves its spells in here, or gives them an `effect` block in
 * `data/spells.json`.
 */
const HANDLERS: Readonly<Record<string, SpellHandler>> = {}

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
export function castSpell(state: GameState, s: Spell, ctx: SpellContext): GameState {
  const handler = HANDLERS[s.handler ?? '']
  if (handler !== undefined) return handler(state, ctx)

  throw new Error(`spell ${s.id} has no effect and no handler, and cannot be resolved`)
}
