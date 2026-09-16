/**
 * Effects with a duration: what the board says about a roll beyond the dice in it.
 *
 * v0 had exactly one thing to say -- the eighth-face holder doubles their ID results
 * -- and it rode into `rollArmy` as a boolean. Everything from here on says more:
 * Galeforce takes four save and four maneuver results off an army until the caster's
 * next turn, Sleep stops a unit being rolled at all, dragon breath and every spell
 * with a duration land in the same list. So the boolean becomes a `Modifier[]`, and
 * this file is the one place that answers "what modifies this army's roll" -- because
 * a call site that remembers the eighth face and forgets Galeforce is the failure
 * mode, and it is silent.
 *
 * Three rules from *Army Modifiers* (full rules p. 28) give the shape:
 *
 *  - An army effect is fixed to a **location**, not to the units. March away and the
 *    effect does not follow; arrive later and it applies to you anyway. That is why
 *    `target` names an `ArmyRef` and a player rather than a unit list.
 *  - An army effect **ends when the army has no units left**, checked at the end of
 *    each action -- but not when every unit was replaced in a single exchange, since
 *    then the army is never observed empty at all.
 *  - A unit effect **follows the unit** into another army, which it does for free by
 *    naming a `UnitId`.
 *
 * And one from *Roll Modifiers*, same page, which is why the entry point is named
 * `armyRoll` and not `rollModifiers`: "Modifiers that affect an army do not affect
 * the roll of an individual unit from that army. Modifiers that affect an individual
 * unit do not affect the roll of an army." Phase 4's sub-rolls are the first unit
 * rolls in the game; they must not come through here.
 *
 * **Nothing produces an `Effect` yet.** Sleep and Galeforce -- the two SAIs that
 * would -- both pick their target in the middle of an attack roll, which is the pause
 * Phase 4 builds for Wild Growth, Bullseye, Choke and Confuse; they land there. This
 * file is machinery waiting for a caller, exactly as `promote` and `recruit` have
 * been since Phase 2.
 */
import { doubleIdsModifier, type Modifier } from './pipeline'
import type { ResultType } from '../data/types'
import {
  army as armyOf,
  type ArmyRef,
  type GameState,
  type LogEntry,
  type PlayerId,
  type UnitId,
  type UnitInstance,
} from './types'

/**
 * What an effect is attached to.
 *
 * Two members, not the three `PLAN-V1.md` sketched: the p. 28 rule above has an army
 * side and a unit side, and a `terrain` member would be a branch nothing gathers.
 * The phase that needs one adds it along with the code that reads it.
 */
export type EffectTarget =
  | { readonly kind: 'army'; readonly player: PlayerId; readonly army: ArmyRef }
  | { readonly kind: 'unit'; readonly unitId: UnitId }

export interface Effect {
  /** Spell name, SAI name, breath element -- what the log names it by. */
  readonly source: string
  readonly target: EffectTarget
  /** Steps 6, 7, 9 and 10. Galeforce is two of these: subtract 4 save, subtract 4
   *  maneuver. Empty for a status like Sleep, which is not arithmetic. */
  readonly modifiers: readonly Modifier[]
  /** Sleep: the unit cannot be rolled, and cannot leave the terrain it occupies. */
  readonly asleep?: true
  /**
   * "Until the beginning of your next turn" -- *your* being whoever made the roll,
   * which on a counter-attack is the defending player, not the marching one.
   *
   * Not nullable, though the plan's sketch was: an instantaneous effect never enters
   * this list, and nothing in scope is permanent, so the null branch would be one
   * nothing could reach. Phase 7 widens it if a spell needs it.
   */
  readonly expiresAtStartOfTurnOf: PlayerId
}

const targetsArmy = (effect: Effect, player: PlayerId, ref: ArmyRef): boolean =>
  effect.target.kind === 'army' && effect.target.player === player && effect.target.army === ref

const targetsUnit = (effect: Effect, unitId: UnitId): boolean =>
  effect.target.kind === 'unit' && effect.target.unitId === unitId

/** Sleep, and anything later that stops a die being rolled. */
export function isAsleep(state: GameState, unitId: UnitId): boolean {
  return state.effects.some((effect) => targetsUnit(effect, unitId) && effect.asleep === true)
}

/**
 * Whether this player's rolls with this army double their ID results.
 *
 * The eighth-face holder's bonus, and a fact about the board rather than about any
 * face -- the same die doubles or not depending on where it is standing. Gated on the
 * ruleset so `captureOnly` still plays the alpha game, where a capture won and did
 * nothing else. The Reserve Army holds no terrain and so never doubles.
 *
 * It lives here rather than in `combat.ts` because it is a step-9 modifier like any
 * other, and gathering it anywhere but beside the effects is how a roll ends up with
 * one of the two and not the other.
 */
export function doublesIds(state: GameState, player: PlayerId, ref: ArmyRef): boolean {
  if (ref === 'reserve') return false
  return state.ruleSet.eighthFace !== 'captureOnly' && state.terrains[ref].capturedBy === player
}

/** What `rollArmy` needs to roll one army: which of its dice may be rolled, and
 *  everything modifying the result. */
export interface ArmyRollInput {
  readonly units: readonly UnitInstance[]
  readonly modifiers: readonly Modifier[]
}

/**
 * The one door every army roll goes through.
 *
 * Returns both halves together on purpose. They are two questions -- who rolls, and
 * what modifies it -- and a call site that answers one and forgets the other is a bug
 * with no symptom: a sleeping die quietly rolling, or a Galeforce quietly not
 * applying. One call cannot half-happen.
 */
export function armyRoll(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  resultType: ResultType,
): ArmyRollInput {
  const modifiers: Modifier[] = []
  for (const effect of state.effects) {
    if (targetsArmy(effect, player, ref)) modifiers.push(...effect.modifiers)
  }
  if (doublesIds(state, player, ref)) modifiers.push(doubleIdsModifier(resultType))

  return {
    units: armyOf(state, player, ref).filter((unit) => !isAsleep(state, unit.id)),
    modifiers,
  }
}

/**
 * Drops the effects that end at the start of this player's turn.
 *
 * **Returns the same object when it drops nothing.** `advance` loops on `stepGame`
 * until it returns the state it was handed, so an unconditional copy here is an
 * infinite loop -- a loud one, since `advance` throws after 1000 steps, but a loop.
 */
export function expireEffects(state: GameState): GameState {
  const marching = state.turn.marching
  const kept = state.effects.filter((effect) => effect.expiresAtStartOfTurnOf !== marching)
  if (kept.length === state.effects.length) return state

  const sources: string[] = []
  for (const effect of state.effects) {
    if (effect.expiresAtStartOfTurnOf === marching && !sources.includes(effect.source)) {
      sources.push(effect.source)
    }
  }
  const entry: LogEntry = { kind: 'effects_expired', player: marching, sources }

  return { ...state, effects: kept, log: [...state.log, entry] }
}

/**
 * Drops effects whose target has ceased to exist: an army with no units left, or a
 * unit that is no longer in play.
 *
 * "The effect ends if there are no units remaining in the army. This is checked at
 * the end of each action." `stepGame` runs after every action -- `applyAction` never
 * sets `pending` -- so calling it from there is that rule exactly.
 *
 * "If all the units from the army are replaced with other units as a single action,
 * the army is still considered to be present." That needs no code: `exchangeWithDua`
 * resolves in one pass, so no state in which the army is empty is ever observed.
 *
 * Same-object rule as `expireEffects`, and for the same reason.
 */
export function pruneEffects(state: GameState): GameState {
  const kept = state.effects.filter((effect) => {
    if (effect.target.kind === 'army') {
      return armyOf(state, effect.target.player, effect.target.army).length > 0
    }
    const unit = state.units[effect.target.unitId]
    return unit !== undefined && (unit.location.kind === 'terrain' || unit.location.kind === 'reserve')
  })

  return kept.length === state.effects.length ? state : { ...state, effects: kept }
}
