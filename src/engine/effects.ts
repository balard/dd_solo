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
 * unit do not affect the roll of an army." Phase 4d's sub-rolls are the first unit
 * rolls in the game, and they go through `unitRoll` below -- a sibling of `armyRoll`
 * and deliberately not a call into it.
 *
 * **Sleep and Galeforce are what produce an `Effect`** (Phase 4c), three phases after
 * this file was written -- both cast in the middle of an attack roll, at the pause the
 * 4a seam exists for. They are on the `sai: 'full'` rung, so `state.effects` is still
 * always empty in a `DUA_RULES` game, which is what the app plays.
 */
import { doubleIdsModifier, SAVES_AS_MELEE, type Modifier } from './pipeline'
import { hasAbility, terrainHas } from './species'
import { terrainDie } from '../data/load'
import type { EighthFaceIcon, ResultType } from '../data/types'
import {
  army as armyOf,
  type ArmyRef,
  type GameState,
  type LogEntry,
  type PlayerId,
  type RuleSet,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from './types'

/**
 * Where an effect sits: on an army at a place, on one unit, or on a terrain.
 *
 * The `terrain` member is Phase 7b's, added with the code that reads it -- the rules
 * name five target kinds for a spell (army, unit(s), terrain, DUA, BUA) and three of
 * the eighteen target a terrain. It carries a **scope**, because "targets a terrain"
 * is not one rule: Ash Storm reaches every army standing there and Wall of Fog reaches
 * an army attacking *into* there from somewhere else. Without the scope one kind would
 * wear two unrelated meanings and every gatherer would have to guess which.
 */
export type EffectTarget =
  | { readonly kind: 'army'; readonly player: PlayerId; readonly army: ArmyRef }
  | { readonly kind: 'unit'; readonly unitId: UnitId }
  | { readonly kind: 'terrain'; readonly slot: TerrainSlot; readonly scope: TerrainScope }
  /**
   * Accelerated Growth: "target your DUA". Not a place a roll happens and not an army
   * that can empty -- it follows the *player*, and it is read by `killUnits` rather
   * than by anything that throws dice.
   */
  | { readonly kind: 'player'; readonly player: PlayerId }

/**
 * Who a terrain-scoped effect reaches.
 *
 * `'maneuverers'` is Phase 7d's (Wall of Thorns) and is deliberately absent until
 * something gathers it -- the same rule that kept `terrain` itself out until now.
 */
export type TerrainScope =
  /** Ash Storm: every army at the terrain, both players'. */
  | 'all_armies'
  /** Wall of Fog: a roll aimed *at* this terrain, made from somewhere else. */
  | 'attackers'
  /**
   * Wall of Thorns: an army that successfully maneuvers this terrain.
   *
   * **Gathered by no roll at all**, which is why `armyRoll` names it and returns
   * nothing for it. It is read at the maneuver site, once, after the terrain has
   * turned -- the only effect in the game that fires on an event rather than on a
   * die being thrown.
   */
  | 'maneuverers'

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
   * Wall of Thorns: damage an army takes for successfully maneuvering this terrain.
   *
   * A field rather than a `Modifier`, for `asleep`'s reason: it is not arithmetic on a
   * roll. The army answers it with a **melee** roll in place of a save roll, which no
   * modifier could express either.
   */
  readonly thorns?: number
  /**
   * Flashfire: how many of the target army's dice its owner may re-roll, **once per
   * roll** rather than once in total.
   *
   * "During any non-maneuver army roll, the target's owner may re-roll any one unit in
   * the target army once ... This effect lasts until the beginning of your next turn."
   * The "once" governs the reroll inside a roll; the duration governs how many rolls
   * it reaches. Two separate castings therefore allow two dice, which is what makes
   * this a number rather than a flag.
   */
  readonly flashfire?: number
  /** Accelerated Growth: what `killUnits` does instead of killing a Treefolk die. */
  readonly trigger?: 'accelerated_growth'
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

const targetsPlayer = (effect: Effect, player: PlayerId): boolean =>
  effect.target.kind === 'player' && effect.target.player === player

const targetsTerrain = (effect: Effect, ref: ArmyRef, scope: TerrainScope): boolean =>
  effect.target.kind === 'terrain' &&
  effect.target.scope === scope &&
  ref !== 'reserve' &&
  effect.target.slot === ref

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

/**
 * The eighth-face icon this player may use at this terrain, or `null` (Phase 5c).
 *
 * Non-null exactly when `eighthFace: 'full'`, the terrain sits on face 8, and this
 * player is the one who captured it. Every icon power in Phase 5d and 5e asks this
 * and nothing else, which is what makes "losing the eighth face ends the icon's
 * effect in the same step" free: nothing is stored here, so there is nothing to
 * revoke -- `syncCaptures` and `moveTerrain` already turn face 8 back to 7 the
 * moment a capture is lost, and the next call to `iconAt` simply answers `null`.
 */
export function iconAt(
  state: GameState,
  player: PlayerId,
  slot: TerrainSlot,
): EighthFaceIcon | null {
  if (state.ruleSet.eighthFace !== 'full') return null
  const terrain = state.terrains[slot]
  if (terrain.face !== 8 || terrain.capturedBy !== player) return null
  return terrainDie(terrain.dieId).eighthFace
}

/**
 * Whether this ruleset resolves this icon at all -- the twin of `resolvesSai`, and
 * for the same reason: the answer changes by rung, so a table lookup can only ever
 * be right about one of them. Standing Stones is a rules fact, not unbuilt work: it
 * has nothing to do until magic is `'spells'` (Phase 7), on any `eighthFace` rung.
 */
export function resolvesIcon(icon: EighthFaceIcon, ruleSet: RuleSet): boolean {
  if (icon === 'standing_stones') return ruleSet.magic === 'spells'
  return ruleSet.eighthFace === 'full'
}

/**
 * One line per icon, for a hover label. Lives beside `iconAt` / `resolvesIcon` for
 * the reason `SAI_TEXT` sits beside `sai.ts`'s handlers: the sentence drifts the
 * moment it lives anywhere but next to the rule it describes.
 */
export const ICON_TEXT: Readonly<Record<EighthFaceIcon, string>> = {
  tower: 'may take a missile action against any army, including a Reserve Army',
  city: 'may recruit or promote one unit each Eighth Face Phase',
  temple: 'may force a burial each Eighth Face Phase; your army resists death magic',
  standing_stones: 'a magic bonus at this terrain, once spells land',
}

/**
 * What an eighth-face icon says on hover -- `faceLabel`'s twin. An icon this
 * ruleset cannot resolve reads "does nothing in this game", via `resolvesIcon`;
 * `null` means nobody said which rules these are, and claims nothing at all.
 */
export function eighthFaceLabel(icon: EighthFaceIcon, ruleSet: RuleSet | null): string {
  const name = icon.replace(/_/g, ' ')
  if (ruleSet === null || resolvesIcon(icon, ruleSet)) return `${name} — ${ICON_TEXT[icon]}`
  return `${name} — does nothing in this game`
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
  /**
   * The army this roll is aimed at, when it is aimed at one.
   *
   * Wall of Fog is the only thing that reads it and the reason it exists: "subtract
   * six missile results from any missile attack targeting an army at that terrain"
   * puts a modifier on the *attacker's* roll, keyed by the *defender's* terrain, and
   * the other four arguments describe only the roller.
   *
   * **`attackRollSpec` in `combat.ts` is its only caller.** Gathering it anywhere
   * else would be a second door onto an army roll, which is precisely the bug this
   * function exists to make impossible -- a call site that answers "who rolls" and
   * forgets "what modifies it" has no symptom at all.
   */
  against?: ArmyRef,
): ArmyRollInput {
  const modifiers: Modifier[] = []
  for (const effect of state.effects) {
    if (targetsArmy(effect, player, ref)) modifiers.push(...effect.modifiers)
    else if (targetsTerrain(effect, ref, 'all_armies')) modifiers.push(...effect.modifiers)
    else if (against !== undefined && targetsTerrain(effect, against, 'attackers')) {
      modifiers.push(...effect.modifiers)
    }
    // `'maneuverers'` is deliberately absent: Wall of Thorns fires on an event rather
    // than on a roll, and is read at the maneuver site by `thornsAt`.
  }
  if (doublesIds(state, player, ref)) modifiers.push(doubleIdsModifier(resultType))
  // Flaming Shields (v1 Phase 8): a permission on every melee roll the army makes at a
  // fire terrain -- the attack, Wall of Thorns' roll, the dragon combination roll. It
  // rides the modifier list for the reason the Death breath does: that reaches every
  // one of those without a call site learning about it. `resolveFaces` refuses it on a
  // counter-attack, because only the roll knows what it is for.
  if (
    resultType === 'melee' &&
    hasAbility(state, player, 'Flaming Shields') &&
    terrainHas(state, ref, 'fire')
  ) {
    modifiers.push(SAVES_AS_MELEE)
  }

  return {
    units: armyOf(state, player, ref).filter((unit) => !isAsleep(state, unit.id)),
    modifiers,
  }
}

/** What a *unit* roll needs: the die, whether it may be rolled at all, and everything
 *  modifying it. `armyRoll`'s sibling, and deliberately not its subset. */
export interface UnitRollInput {
  readonly unit: UnitInstance
  /** Sleep: "cannot be rolled". A unit that cannot be rolled generates nothing at all,
   *  which for Phase 4d's sub-rolls means it fails whatever it was asked to roll. */
  readonly rollable: boolean
  readonly modifiers: readonly Modifier[]
}

/**
 * The one door a single unit's roll goes through: Phase 4d's sub-rolls, and whatever
 * later phase rolls one die on its own.
 *
 * It gathers **only unit effects** -- never an army effect, never the eighth face's ID
 * doubling. That is *Roll Modifiers* (full rules p. 28) in code rather than in a
 * comment: "modifiers that affect an army do not affect the roll of an individual unit
 * from that army", which is why the army door is named `armyRoll` and this one is not
 * a call into it. A Galeforced army's minus four must not reach a Smother's maneuver
 * roll, and the only way to be sure of that is for the two gatherers to share nothing.
 *
 * No effect in the game carries a unit modifier yet -- Sleep is a status, not
 * arithmetic -- so `modifiers` comes back empty today. The loop is written anyway,
 * because a literal `[]` becomes a lie the first time a spell modifies one die, and
 * silently.
 *
 * **No `resultType` parameter**, unlike `armyRoll`, which needs one only to build the
 * eighth face's `doubleIdsModifier`. A unit roll never gathers that, so the argument
 * would have had no reader -- the same answer 4a gave to threading a rung through
 * `SaiHandler`.
 */
export function unitRoll(state: GameState, unitId: UnitId): UnitRollInput {
  const unit = state.units[unitId]
  if (unit === undefined) throw new Error(`no such unit ${unitId}`)

  const modifiers: Modifier[] = []
  for (const effect of state.effects) {
    if (targetsUnit(effect, unitId)) modifiers.push(...effect.modifiers)
  }

  return { unit, rollable: !isAsleep(state, unitId), modifiers }
}

/**
 * How many of this army's dice Flashfire lets its owner re-roll in one roll.
 *
 * Summed across separate castings, the same arithmetic `thornsAt` does and for the
 * same reason: two announcements are two spells, and both apply.
 */
export function flashfireBudget(state: GameState, player: PlayerId, ref: ArmyRef): number {
  let total = 0
  for (const effect of state.effects) {
    if (targetsArmy(effect, player, ref)) total += effect.flashfire ?? 0
  }
  return total
}

/** Accelerated Growth: whether this player's dead are exchanging rather than dying. */
export function regrows(state: GameState, player: PlayerId): boolean {
  return state.effects.some(
    (effect) => targetsPlayer(effect, player) && effect.trigger === 'accelerated_growth',
  )
}

/**
 * Wall of Thorns' damage at a terrain, or 0.
 *
 * Summed rather than taken singly: two castings of a cumulative spell on one target
 * are one spell with a bigger number, but two *separate* announcements are two spells
 * and both bite. The same arithmetic `armyRoll` does for two Galeforces.
 */
export function thornsAt(state: GameState, slot: TerrainSlot): number {
  let total = 0
  for (const effect of state.effects) {
    if (targetsTerrain(effect, slot, 'maneuverers')) total += effect.thorns ?? 0
  }
  return total
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
    // Exhaustive on purpose: a fifth `EffectTarget` member is a compile error here
    // rather than a silently immortal effect.
    switch (effect.target.kind) {
      case 'army':
        return armyOf(state, effect.target.player, effect.target.army).length > 0
      // A terrain cannot empty, move or cease to exist, so a terrain effect only ever
      // ends by expiring. "If an army is destroyed ... any spells affecting that army
      // end" is a rule about armies, and this is not one.
      case 'terrain':
        return true
      // A player is never gone: losing every unit ends the game rather than the
      // effect, and `stepGame` prunes before it checks for a winner.
      case 'player':
        return true
      case 'unit': {
        const unit = state.units[effect.target.unitId]
        return (
          unit !== undefined &&
          (unit.location.kind === 'terrain' || unit.location.kind === 'reserve')
        )
      }
    }
  })

  return kept.length === state.effects.length ? state : { ...state, effects: kept }
}
