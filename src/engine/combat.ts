/**
 * Melee, missile and magic: what is legal, and what a single exchange produces.
 *
 * Pure helpers only -- the step machine that sequences attack, saves, damage and
 * counter-attack lives in `turn.ts`.
 */
import { terrainFaceAction } from '../data/load'
import type { TerrainFaceNumber } from '../data/types'

import { combinationSpec, type CombinationAnswer, type CombinationPools } from './combination'
import { armyRoll, iconAt, shielded, spellSaveSources, type ArmyRollInput } from './effects'
import { CHARGE_ROLL_KINDS } from './sai'
import { terrainHas, unitHasAbility } from './species'
import type { Modifier, RollEffect } from './pipeline'
import { unitType } from '../data/load'
import { rollDie } from './rng'
import { delayedTasks, targetTasks, type TargetTask } from './targeting'
import {
  asResult,
  holdsTargetedReroll,
  resolveFaces,
  rerollSweep,
  rollFaces,
  rollPools,
  type RawDie,
  type DieRoll,
  type RollMath,
  type RollResult,
  type RollSpec,
} from './roll'
import type { RngState } from './rng'
import {
  TERRAIN_SLOTS,
  armyAt,
  opponentOf,
  reserveArmy,
  type ActionKind,
  type ArmyRef,
  type GameState,
  type PlayerId,
  type RuleSet,
  type TerrainSlot,
  type UnitInstance,
} from './types'

/** RULES-V0.md section 4: two magic symbols per point of damage. */
const MAGIC_RESULTS_PER_DAMAGE = 2

/** The action a terrain's current face permits, or null on the eighth face. */
export function terrainAction(state: GameState, slot: TerrainSlot): ActionKind | null {
  const terrain = state.terrains[slot]
  if (terrain.face === 8) return null
  return terrainFaceAction(terrain.dieId, terrain.face as TerrainFaceNumber).toLowerCase() as ActionKind
}

/** A Home Terrain, as opposed to the Frontier. */
const isHome = (slot: TerrainSlot): boolean => slot !== 'frontier'

/**
 * Armies a missile action from `fromSlot` may target.
 *
 * "You cannot target the opponent's Reserves Army or attack from one Home Terrain
 * to the other Home Terrain." Reserves fall out for free, since a reserve army is
 * not at a terrain and so cannot be named by a slot -- **unless the attacker holds
 * a Tower right where they stand** (Phase 5d): "your controlling army may use a
 * missile action to attack any opponent's army." A Tower held elsewhere lends
 * nothing, which is why `iconAt` is asked at `fromSlot` and not anywhere the
 * attacker merely captured.
 *
 * An Illusioned army is not a target either (v2 Phase 8b), at a terrain or in Reserves.
 * Every missile reader asks this -- the action list, the prompt, the forecast and both
 * AIs -- so the filter is here and nowhere else.
 */
export function missileTargets(
  state: GameState,
  attacker: PlayerId,
  fromSlot: TerrainSlot,
): readonly ArmyRef[] {
  const defender = opponentOf(attacker)
  const holdsTower = iconAt(state, attacker, fromSlot) === 'tower'

  const targets: ArmyRef[] = TERRAIN_SLOTS.filter((slot) => {
    if (armyAt(state, defender, slot).length === 0) return false
    if (!holdsTower && isHome(fromSlot) && isHome(slot) && slot !== fromSlot) return false
    return true
  })

  if (holdsTower && reserveArmy(state, defender).length > 0) targets.push('reserve')

  return targets.filter((ref) => !shielded(state, attacker, defender, ref, 'missile'))
}

/**
 * What the marching army may actually do at this terrain.
 *
 * The terrain face dictates *which* action, but an action with nothing to hit is
 * not on offer: melee and magic need an opposing army at the same terrain, and
 * missile needs at least one reachable target. Returning an empty list is how the
 * engine says "you may only pass".
 *
 * Kept as an array rather than a single value because the v1 eighth face lets the
 * controlling army choose between all three.
 */
export function legalActions(
  state: GameState,
  player: PlayerId,
  slot: ArmyRef,
): readonly ActionKind[] {
  // "An army in the Reserve Area may only take a magic action" (p. 12). Under the v0
  // house rule magic from Reserves is cut entirely, which is what made a Reserve Army
  // unable to march at all -- it can neither maneuver nor act.
  if (slot === 'reserve') return state.ruleSet.magic === 'spells' ? ['magic'] : []

  const defender = opponentOf(player)

  // What the terrain offers, before checking there is anything to hit.
  const offered = eighthFaceActions(state, player, slot) ?? faceActions(state, slot)

  return offered.filter((action) => {
    if (action === 'missile') return missileTargets(state, player, slot).length > 0
    // Real magic needs nothing to hit. Most spells target your *own* army -- Stone
    // Skin or Wind Walk on an army standing alone is one of the commonest plays --
    // so the v0 filter here, which exists because v0 magic is a melee variant, would
    // quietly refuse a legal action at every terrain with nobody standing opposite.
    if (action === 'magic' && state.ruleSet.magic === 'spells') return true
    return armyAt(state, defender, slot).length > 0
  })
}

/** The single action the terrain's numbered face dictates, or none. */
function faceActions(state: GameState, slot: TerrainSlot): readonly ActionKind[] {
  const action = terrainAction(state, slot)
  return action === null ? [] : [action]
}

/**
 * The eighth face overrides the face-number action entirely: "The army may take a
 * melee, missile, or magic action, but opposing armies at the terrain are restricted
 * to a melee action" (starter rules, Terrain - Eighth Face).
 *
 * Null means "not an eighth face, or the ruleset does not grant this" -- so the
 * caller falls back to the numbered face.
 */
function eighthFaceActions(
  state: GameState,
  player: PlayerId,
  slot: TerrainSlot,
): readonly ActionKind[] | null {
  const terrain = state.terrains[slot]
  if (terrain.face !== 8 || state.ruleSet.eighthFace === 'captureOnly') return null
  return terrain.capturedBy === player ? ['melee', 'missile', 'magic'] : ['melee']
}

/** Damage from a magic action. RULES-V0.md section 4; `floor` is deliberate. */
export function magicDamage(total: number, ruleSet: RuleSet): number {
  if (ruleSet.magic !== 'simplified') {
    throw new Error(`spellcasting is not implemented (ruleSet.magic === '${ruleSet.magic}')`)
  }
  return Math.floor(total / MAGIC_RESULTS_PER_DAMAGE)
}

export interface AttackOutcome {
  readonly attackTotal: number
  /** null when no save roll was made -- magic allows none, and a zero attack earns none. */
  readonly saveTotal: number | null
  /** Everything the defending army is about to lose units to, saves already taken
   *  off: `max(0, attack - saves)` plus `unsavable`. */
  readonly damage: number
  /** Smite: the part of `damage` the save roll never had a chance at. Reported
   *  separately only so the log can explain itself. */
  readonly unsavable: number
  /** Counter and Volley: damage the *save* roll sent back at the attacking army,
   *  which gets no save roll of its own. Assigned in its own step. What is left after
   *  the attacking army's spell saves (v2 Phase 6c). */
  readonly riposte: number
  /** What those spell saves took off the riposte, by spell. Omitted when nothing did. */
  readonly riposteMath?: RollMath
  /** Surprise: this attack denies the defender their counter-attack. */
  readonly counterSuppressed: boolean
  /**
   * Charge (v2 Phase 6e): the defender answered with a combination save and melee roll,
   * and these are its melee -- inside `riposte` now, sent back at the attacker -- with
   * their arithmetic. Omitted when the attack was no charge.
   */
  readonly charge?: { readonly melee: number; readonly math?: RollMath }
  /** The dice themselves, so the UI can show what landed rather than only the sum. */
  readonly attackRoll: RollResult
  readonly saveRoll: RollResult | null
  readonly rng: RngState
}

export interface AttackSpec {
  readonly action: ActionKind
  readonly attacker: PlayerId
  /** `ArmyRef` since Phase 7f: a Reserve Army may take a magic action, which is the
   *  only action it has and the only one that needs no terrain. */
  readonly attackerSlot: ArmyRef
  readonly defender: PlayerId
  /** A Reserve Army after a Tower's missile (Phase 5d): the attacker always stands
   *  at a terrain, but the defender need not. */
  readonly defenderSlot: ArmyRef
  /**
   * Whether this exchange is the counter-attack rather than the opening attack.
   *
   * Required rather than defaulted: it is what tells Surprise not to fire ("Surprise
   * has no effect during a counter-attack"), while Counter on the same exchange
   * still does, and a default would silently pick one side of that.
   */
  readonly isCounter: boolean
}

/**
 * Damage that "only save results generated by spells that would add to a save roll may
 * reduce" (v2 Phase 6c): Counter's and Volley's riposte, and from 6e Charge's melee.
 *
 * The army it lands on rolls nothing, so its spell saves are subtracted directly -- each
 * spell a step, named, taking no more than is left. `math` is omitted when no spell
 * took anything off, which is every riposte against an army with no Stone Skin or
 * Watery Double on it. Until this, `RULES-V0.md` section 8 applied a riposte flat, as a
 * house rule; it was never the rule.
 */
export function spellReduced(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  damage: number,
): { readonly damage: number; readonly math?: RollMath } {
  if (damage <= 0) return { damage: Math.max(0, damage) }
  let left = damage
  const steps: { source: string; delta: number }[] = []
  for (const { source, amount } of spellSaveSources(state, player, ref)) {
    if (left === 0) break
    const taken = Math.min(left, amount)
    left -= taken
    steps.push({ source, delta: -taken })
  }
  return steps.length === 0 ? { damage } : { damage: left, math: { base: damage, steps, notes: [] } }
}

/** Total damage of one effect kind. */
function damageFrom(effects: readonly RollEffect[], kind: 'riposte' | 'unsavable'): number {
  return effects.reduce((sum, e) => (e.kind === kind ? sum + e.damage : sum), 0)
}

/**
 * Refuses an effect this roll has nowhere to put.
 *
 * Every effect a roll produces must be consumed by someone. Phase 4's targeting and
 * free-move effects will arrive on rolls that predate them, and the failure mode --
 * an SAI that computes correctly and is then dropped on the floor, with every test
 * green -- is the one this phase came closest to shipping.
 */
export function expectOnly(
  effects: readonly RollEffect[],
  allowed: readonly RollEffect['kind'][],
  what: string,
): void {
  for (const effect of effects) {
    if (!allowed.includes(effect.kind)) {
      throw new Error(`${what} produced a ${effect.kind} effect (${effect.sai}), which nothing reads`)
    }
  }
}

/**
 * An attack roll that has landed, with its save roll not yet made.
 *
 * Raw dice and nothing computed. Two reasons, and the second is the one that shaped
 * this whole phase: it can be stashed in `CombatState` across a decision without a
 * face object reaching the golden digest, and `resolveFaces` is pure, so the same
 * dice can be resolved again once a mid-roll decision has been answered -- with no
 * second draw.
 */
export interface AttackRollState {
  readonly dice: readonly RawDie[]
}

/**
 * The attacking army's dice and everything modifying them.
 *
 * One helper rather than four copies of the same `armyRoll` call, because it is the
 * only place `against` is ever passed: Wall of Fog subtracts from a missile attack
 * aimed at the terrain it wards, so the roll has to name the army it is aimed at as
 * well as the army throwing the dice. Four call sites each remembering a fifth
 * argument is three chances to forget it, and forgetting has no symptom -- the ward
 * simply does not apply.
 */
function attackerRoll(state: GameState, spec: AttackSpec): ArmyRollInput {
  const roll = armyRoll(state, spec.attacker, spec.attackerSlot, spec.action, spec.defenderSlot)
  // Defensive Volley (v2 Phase 5d): "Coral Elves *units* may counter-attack against a
  // missile action", so in a mixed army only they throw the counter's dice. Filtered
  // here, in the one door every half of an exchange reads, so the roll and every
  // recompute of it agree on who rolled.
  if (spec.isCounter && spec.action === 'missile') {
    return { ...roll, units: roll.units.filter((unit) => unitHasAbility(state.ruleSet, unit, 'Defensive Volley')) }
  }
  return roll
}

/**
 * The dice that may answer a missile attack with Defensive Volley (v2 Phase 5d): the
 * Coral Elves of the army that was shot at, when it stands on a terrain containing air,
 * and only those that may roll. Empty means no volley is offered -- which it always is
 * with species abilities off, at a Reserve Army, or at a terrain with no air.
 *
 * `at` is the army the volley would be aimed at -- the marching army, wherever it fired
 * from. The counter is a missile attack, so an Illusion on that army refuses it (v2
 * Phase 8b). An Illusion on the *defender* stops nothing here: the missile it answers
 * was aimed before the shield could be cast.
 */
export function volleyers(
  state: GameState,
  defender: PlayerId,
  slot: ArmyRef,
  at: ArmyRef,
): readonly UnitInstance[] {
  if (!state.ruleSet.speciesAbilities || slot === 'reserve' || !terrainHas(state, slot, 'air')) return []
  if (shielded(state, defender, opponentOf(defender), at, 'missile')) return []
  return armyRoll(state, defender, slot, 'missile').units.filter((unit) =>
    unitHasAbility(state.ruleSet, unit, 'Defensive Volley'),
  )
}

/** The spec the attack roll is resolved under. Built in one place because
 *  `rollAttack` and `resolveSaves` must agree on it exactly. */
function attackRollSpec(spec: AttackSpec, modifiers: readonly Modifier[]): RollSpec {
  return {
    kinds: [spec.action],
    modifiers,
    context: { purpose: { kind: 'attack', action: spec.action }, isCounter: spec.isCounter },
    /*
     * Tower's "if attacking a Reserve Army, only count non-ID missile results"
     * (Phase 5d).
     *
     * **The action has to be named.** When this was written a missile action was the
     * only one a Tower could aim at Reserves, so `defenderSlot === 'reserve'` said the
     * same thing -- and then Phase 7f let a Reserve Army take a *magic* action, whose
     * `targetSlot` is the caster's own ref because magic names no terrain. The test
     * then read "this roll is aimed at a Reserve Army" as true of a roll the Reserve
     * Army was itself making, and silently threw away every ID result in it.
     */
    ...(spec.action === 'missile' && spec.defenderSlot === 'reserve'
      ? { countIds: false as const }
      : {}),
  }
}

/**
 * The attacker's half: steps 1 and 3, and then stop.
 *
 * Split from the save roll because a targeting SAI is chosen *between* them -- a
 * Sleep takes a die out of the very save roll that follows, and a Galeforce subtracts
 * from it. Neither can be expressed while one function does both.
 *
 * It rolls for melee, missile **and magic** alike. Magic takes no save roll, but it
 * can still carry a Galeforce ("or a magic action at a terrain"), and an action that
 * short-circuits before the targeting step is an SAI computed correctly and then
 * dropped on the floor with every test green.
 */
export function rollAttack(state: GameState, spec: AttackSpec): readonly [AttackRollState, RngState] {
  // Both halves from one call: which dice may be rolled, and what modifies the
  // result. A sleeping die is not in `units` and the eighth face is in `modifiers`.
  const attackers = attackerRoll(state, spec)
  const rollSpec = attackRollSpec(spec, attackers.modifiers)

  const [rolled, afterRoll] = rollFaces(attackers.units, state.rng)
  // Held: a Bullseye or Double Strike die rolls again only once its SAI has resolved.
  const [swept, afterSweep] = rerollSweep(rolled, rollSpec, state.ruleSet, afterRoll, true)

  return [{ dice: swept }, afterSweep] as const
}

/**
 * The attack roll's targeting decisions, sorted into the rulebook's steps.
 *
 * - **step 3**: every die whose face rerolls after targeting -- Bullseye, Double Strike
 *   -- as a task of its own, carrying the die to throw again once it resolves. "Apply
 *   these effects one at a time until all re-rolls have been made", so they are never
 *   combined, and they come before anything else.
 * - **step 4**: every other targeting SAI, combined the ordinary way.
 * - **delayed**: Choke and Confuse, which wait for the save dice.
 *
 * Until this split a Double Strike's die was thrown again in the step-3 sweep, before
 * the Double Strike itself was applied, and the two were then asked about together
 * with whatever the reroll had shown -- so a death the Double Strike caused, and its
 * reactions, came after a reroll the rules put after them.
 */
export function splitAttackTasks(
  state: GameState,
  spec: AttackSpec,
  dice: readonly RawDie[],
): {
  readonly stepThree: readonly TargetTask[]
  readonly stepFour: readonly TargetTask[]
  readonly delayed: readonly TargetTask[]
} {
  const rollSpec = attackRollSpec(spec, attackerRoll(state, spec).modifiers)
  const held = dice.filter((die) => holdsTargetedReroll(die, rollSpec, state.ruleSet))
  const rest = dice.filter((die) => !held.includes(die))

  const stepThree = held.flatMap((die) =>
    targetTasks(resolveFaces([die], rollSpec, state.ruleSet).effects).map((task) =>
      task.kind === 'enemy' ? { ...task, rerollAfter: die.unitId } : task,
    ),
  )
  const effects = rest.length === 0 ? [] : resolveFaces(rest, rollSpec, state.ruleSet).effects
  return { stepThree, stepFour: targetTasks(effects), delayed: delayedTasks(effects) }
}

/**
 * "Roll this unit again and apply the new result as well" -- the second half of a
 * Bullseye or Double Strike, once the first has fully resolved.
 *
 * The new die is swept for Rend like any step-3 reroll, and held again if it shows
 * another Bullseye or Double Strike. What comes back is the dice to append and the
 * decisions they bring, already sorted into steps.
 */
export function rerollHeld(
  state: GameState,
  spec: AttackSpec,
  unitId: string,
): {
  readonly dice: readonly RawDie[]
  readonly rng: RngState
  readonly tasks: ReturnType<typeof splitAttackTasks>
} {
  const unit = state.units[unitId]
  const none = { stepThree: [], stepFour: [], delayed: [] }
  if (unit === undefined) return { dice: [], rng: state.rng, tasks: none }

  const rollSpec = attackRollSpec(spec, attackerRoll(state, spec).modifiers)
  const [faceIndex, afterRoll] = rollDie(state.rng, unitType(unit.typeId).faces.length)
  const again: RawDie = { unitId, typeId: unit.typeId, faceIndex, reroll: true }
  const [dice, rng] = rerollSweep([again], rollSpec, state.ruleSet, afterRoll, true)
  return { dice, rng, tasks: splitAttackTasks(state, spec, dice) }
}

/**
 * What the attack roll produced that is not a number, without resolving anything else.
 *
 * Pure and free of randomness, because `resolveFaces` is -- which is what lets the
 * targeting step read the roll's SAIs before the save roll happens, and lets
 * `resolveSaves` read the very same faces again afterwards for the totals.
 */
export function attackEffects(
  state: GameState,
  spec: AttackSpec,
  attack: AttackRollState,
): readonly RollEffect[] {
  const attackers = attackerRoll(state, spec)
  const rollSpec = attackRollSpec(spec, attackers.modifiers)
  return resolveFaces(attack.dice, rollSpec, state.ruleSet).effects
}

/**
 * An attack roll that has landed, with its save roll not yet made.
 *
 * Raw dice again, for the same two reasons as `AttackRollState` -- and now for a
 * third: Choke kills a die out of this list and Confuse replaces one, both between
 * the roll and the count, which only works while nothing has been counted yet.
 */
export interface SaveRollState {
  readonly dice: readonly RawDie[]
  /**
   * Wild Growth's save share: step-8 results the *player* chose rather than a face.
   * Omitted when nobody chose any, which is every roll but a Wild Growth one.
   */
  readonly bonus?: number
  /** Wave: save results the attack takes off this roll (`PendingSaves.wave`). */
  readonly wave?: number
  /** Screech (v2 Phase 7c): the same, under its own name (`PendingSaves.screech`). */
  readonly screech?: number
  /** Regenerate (v2 Phase 7d): saves its roller took instead of units. */
  readonly regenerate?: number
  /** Bash: save results equal to the melee of the die it hit (`PendingSaves.bash`). */
  readonly bash?: number
  /** Charge (v2 Phase 6e): this is the defender's combination save and melee roll. */
  readonly charge?: true
  /** And how its IDs and choosable results were split (`PendingSaves.allocation`). */
  readonly allocation?: CombinationAnswer
}

/** What the attack roll was worth, before the defender has rolled anything. */
export interface AttackFacts {
  readonly attackRoll: RollResult
  readonly unsavable: number
  readonly counterSuppressed: boolean
  /** Wave: save results this attack takes off the roll that answers it. */
  readonly wave: number
  /** Screech (v2 Phase 7c): the same, named apart. */
  readonly screech: number
  /** Charge (v2 Phase 6e): a melee attack the defender answers with a combination
   *  save and melee roll, and no counter-attack. */
  readonly charged: boolean
  /**
   * Whether a save roll happens at all. False for magic, which allows none, and for a
   * zero-result attack, which earns none -- and in both cases no die is rolled, so no
   * randomness is consumed and the delayed effects have nothing to be applied to.
   */
  readonly savesNeeded: boolean
}

/**
 * What the attack's faces are worth: pure, so the two halves of the defender's roll
 * can both ask and neither has to carry the answer across.
 *
 * The two early returns that used to be inside `resolveSaves` live here as a
 * *question* instead -- `savesNeeded` -- which is what lets the machine take the same
 * path either way and skip only the rolling. An early return in their place is how
 * Phase 4a nearly dropped a Galeforce on a magic action.
 */
export function attackFacts(state: GameState, spec: AttackSpec, attack: AttackRollState): AttackFacts {
  const attackers = attackerRoll(state, spec)
  const rollSpec = attackRollSpec(spec, attackers.modifiers)
  const attackRoll = asResult(resolveFaces(attack.dice, rollSpec, state.ruleSet), spec.action)

  // Every targeting kind is consumed by a step *before* the totals are read, so by the
  // time the faces are resolved they have already done their work -- but they are still
  // on the list, so they still have to be allowed here. Forgetting to widen this is how
  // each of Phase 4's slices announces itself: the effect is computed, and the guard
  // that exists to stop it being dropped refuses it instead.
  expectOnly(
    attackRoll.effects,
    [
      'unsavable',
      'suppress_counter',
      'target_enemy',
      'sleep',
      'galeforce',
      'choke',
      'confuse',
      'wild_growth',
      'regenerate',
      'free_move',
      'cantrip',
      'wave',
      'screech',
      'glare',
      'charge',
    ],
    `a ${spec.action} attack`,
  )
  const charged = spec.action === 'melee' && attackRoll.effects.some((e) => e.kind === 'charge')

  return {
    attackRoll,
    unsavable: damageFrom(attackRoll.effects, 'unsavable'),
    counterSuppressed: attackRoll.effects.some((e) => e.kind === 'suppress_counter'),
    wave: waveIn(attackRoll.effects),
    screech: screechIn(attackRoll.effects),
    charged,
    // A Smite-only attack rolls zero melee, earns the defender no save roll, and still
    // kills: the condition is the attack *total*, not the damage. A Charge always earns
    // the defender its roll (v2 Phase 6e): it replaces the counter-attack as well as the
    // save roll, so the defender's melee goes back at the attacker even against nothing.
    savesNeeded: spec.action !== 'magic' && (attackRoll.total > 0 || charged),
  }
}

/** Wave's total over a roll's effects: several Waves in one roll combine. */
export function waveIn(effects: readonly RollEffect[]): number {
  return effects.reduce((sum, effect) => sum + (effect.kind === 'wave' ? effect.amount : 0), 0)
}

/** Screech's total over a roll's effects: several Screeches combine. */
export function screechIn(effects: readonly RollEffect[]): number {
  return effects.reduce((sum, effect) => sum + (effect.kind === 'screech' ? effect.amount : 0), 0)
}

/** Wave's subtraction as a step-6 modifier, named so the roll can say "− 4 Wave". */
export function waveModifier(resultType: 'save' | 'maneuver', amount: number): Modifier {
  return { kind: 'subtract', resultType, amount, source: 'Wave' }
}

/** Every save result the attack takes off the roll that answers it, each named:
 *  Wave and Screech (v2 Phase 7c). Read by both save-roll specs. */
function attackSaveCuts(saves: Pick<SaveRollState, 'wave' | 'screech'>): readonly Modifier[] {
  return [
    ...((saves.wave ?? 0) > 0 ? [waveModifier('save', saves.wave ?? 0)] : []),
    ...((saves.screech ?? 0) > 0
      ? [{ kind: 'subtract', resultType: 'save', amount: saves.screech ?? 0, source: 'Screech' } as const]
      : []),
  ]
}

/**
 * The defender's answer to a Charge (v2 Phase 6e): one combination roll counting save
 * and melee, built where the dragon's is (`combinationSpec`), so an ID split, a
 * Create Fireminions split and Flaming Shields' trade are asked the same way, and the
 * eighth face doubles IDs in both kinds.
 *
 * The rest of an ordinary save roll rides on it as modifiers: Wave off the saves, Bash's
 * saves, and Wild Growth's unspent budget -- the last as a named step-10 add rather than
 * `RollSpec.saiResults`, which the combination roll already spends on its flexible split.
 *
 * Without an `answer`, IDs and flexible results all sit on save: enough to find the
 * pools and to draw the dice before anybody has allocated them.
 */
export function chargeRollSpec(
  state: GameState,
  spec: AttackSpec,
  saves: SaveRollState,
  answer?: CombinationAnswer,
): RollSpec {
  const context = { purpose: { kind: 'save', against: 'melee', charge: true }, isCounter: spec.isCounter } as const
  const shown = answer ?? displayAnswer(chargePoolsOf(state, spec, saves, context))
  const base = combinationSpec(state, spec.defender, spec.defenderSlot, CHARGE_ROLL_KINDS, context, shown)
  const extra: Modifier[] = [...attackSaveCuts(saves)]
  if ((saves.bash ?? 0) > 0) extra.push({ kind: 'add', resultType: 'save', amount: saves.bash ?? 0, source: 'Bash' })
  if ((saves.bonus ?? 0) > 0) {
    extra.push({ kind: 'add', resultType: 'save', amount: saves.bonus ?? 0, source: 'Wild Growth' })
  }
  if ((saves.regenerate ?? 0) > 0) {
    extra.push({ kind: 'add', resultType: 'save', amount: saves.regenerate ?? 0, source: 'Regenerate' })
  }
  return { ...base, modifiers: [...base.modifiers, ...extra] }
}

/** What the defender's Charge roll leaves to allocate: the pending's three numbers. */
export function chargePools(state: GameState, spec: AttackSpec, saves: SaveRollState): CombinationPools {
  return chargePoolsOf(state, spec, saves, {
    purpose: { kind: 'save', against: 'melee', charge: true },
    isCounter: spec.isCounter,
  })
}

function chargePoolsOf(
  state: GameState,
  spec: AttackSpec,
  saves: SaveRollState,
  context: RollSpec['context'],
): CombinationPools {
  const base = combinationSpec(state, spec.defender, spec.defenderSlot, CHARGE_ROLL_KINDS, context)
  return rollPools(saves.dice, base, state.ruleSet)
}

/** Everything on save: a legal split of any pools, for drawing the dice. */
function displayAnswer(pools: CombinationPools): CombinationAnswer {
  return { ids: { save: pools.ids }, flexible: { save: pools.flexible } }
}

/** The spec the defender's roll resolves under: a save roll, or a Charge's combination
 *  roll. Every reader of the parked save dice goes through this. */
function defenderRollSpec(state: GameState, spec: AttackSpec, saves: SaveRollState): RollSpec {
  return saves.charge === true
    ? chargeRollSpec(state, spec, saves, saves.allocation)
    : saveRollSpec(state, spec, saves)
}

/** The spec the defender's save roll is resolved under, built in one place because
 *  the roll and the recompute must agree on it exactly. */
function saveRollSpec(
  state: GameState,
  spec: AttackSpec,
  saves: Pick<SaveRollState, 'bonus' | 'wave' | 'screech' | 'bash' | 'regenerate'>,
): RollSpec {
  const { bonus } = saves
  const bash = saves.bash ?? 0
  const regenerate = saves.regenerate ?? 0
  const defenders = armyRoll(state, spec.defender, spec.defenderSlot, 'save')
  return {
    kinds: ['save'],
    // Wave last: it is the attack's, not the board's, so it is not one of the
    // modifiers `armyRoll` gathers -- but it is a step-6 subtract like any of them.
    // Bash's saves (v2 Phase 6d) are the defender's own SAI, but their number is the
    // target's melee rather than anything on the Bash face, so they join as a named
    // step-10 add: "+ 4 Bash". Nothing in scope divides or multiplies a whole save
    // total, so step 8 and step 10 give the same answer here.
    modifiers: [
      ...defenders.modifiers,
      ...attackSaveCuts(saves),
      ...(bash > 0 ? [{ kind: 'add', resultType: 'save', amount: bash, source: 'Bash' } as const] : []),
      // Regenerate's saves (v2 Phase 7d), the roller's choice rather than a face: a named
      // step-10 add, as Bash's are.
      ...(regenerate > 0
        ? [{ kind: 'add', resultType: 'save', amount: regenerate, source: 'Regenerate' } as const]
        : []),
    ],
    // It is also where Counter and Volley hit back, which is why it needs to know what
    // it is saving against.
    context: { purpose: { kind: 'save', against: spec.action }, isCounter: spec.isCounter },
    // Not on any die -- the player chose them -- so the arithmetic names them.
    ...(bonus === undefined ? {} : { saiResults: { save: bonus }, saiResultsSource: 'Wild Growth' }),
  }
}

/**
 * What the defender's save dice produced that is not a number.
 *
 * Pure, like `attackEffects`, and read at the same pause: Wild Growth and the free
 * moves are the *defender's* own SAIs, rolled on this roll, and they owe a decision
 * before a single result is counted.
 */
export function saveEffects(
  state: GameState,
  spec: AttackSpec,
  saves: SaveRollState,
): readonly RollEffect[] {
  const effectsOnly: SaveRollState = {
    dice: saves.dice,
    ...(saves.wave !== undefined ? { wave: saves.wave } : {}),
    ...(saves.screech !== undefined ? { screech: saves.screech } : {}),
    ...(saves.charge === true ? { charge: true as const } : {}),
  }
  return resolveFaces(saves.dice, defenderRollSpec(state, spec, effectsOnly), state.ruleSet).effects
}

/**
 * The parked dice of either roll, resolved for display.
 *
 * Pure, and the same `resolveFaces` the totals come from -- so what a player is shown
 * mid-decision is what the arithmetic will use, rather than a second opinion about it.
 * `RollOutcome.dice` carries the per-die results and the SAI attribution the roll strip
 * already knows how to draw.
 */
export function attackRollDice(
  state: GameState,
  spec: AttackSpec,
  attack: AttackRollState,
): readonly DieRoll[] {
  return parkedAttackRoll(state, spec, attack).dice
}

/** The same for the defender's save dice, which sit parked across the delayed pause. */
export function saveRollDice(
  state: GameState,
  spec: AttackSpec,
  saves: SaveRollState,
): readonly DieRoll[] {
  return parkedSaveRoll(state, spec, saves).dice
}

/**
 * The parked attack roll as a whole result -- total and `math` as well as dice -- for a
 * sheet that shows the roll behind a decision (Phase 9d). The total is what the roll
 * comes to *now*; nothing later in the exchange changes an attack roll.
 */
export function parkedAttackRoll(
  state: GameState,
  spec: AttackSpec,
  attack: AttackRollState,
): RollResult {
  const attackers = attackerRoll(state, spec)
  return asResult(
    resolveFaces(attack.dice, attackRollSpec(spec, attackers.modifiers), state.ruleSet),
    spec.action,
  )
}

/** The parked save roll as a whole result. At the delayed pause this is the roll before
 *  Choke or Confuse has touched it -- which is the point of showing it. */
export function parkedSaveRoll(
  state: GameState,
  spec: AttackSpec,
  saves: SaveRollState,
): RollResult {
  return asResult(resolveFaces(saves.dice, defenderRollSpec(state, spec, saves), state.ruleSet), 'save')
}

/**
 * Step 1 of the defender's roll: every die once, and then stop.
 *
 * Split from the count for the same reason the attack roll was split from the save
 * roll in Phase 4a, one step further along: the rulebook's step 2 is "when rolling for
 * saves against an attack, Delayed Effects are applied now", and Choke cannot choose
 * its targets ("units that rolled an ID icon") until this has happened.
 */
export function rollSaveFaces(
  state: GameState,
  spec: AttackSpec,
  rng: RngState,
  /** The attack being answered, for Wave. Every caller in the engine passes it. */
  attack?: AttackRollState,
): readonly [SaveRollState, RngState] {
  const defenders = armyRoll(state, spec.defender, spec.defenderSlot, 'save')
  const [dice, next] = rollFaces(defenders.units, rng)
  // Wave rides with the dice from the moment they land, so every later reader of this
  // roll subtracts it.
  const facts = attack === undefined ? undefined : attackFacts(state, spec, attack)
  const wave = facts?.wave ?? 0
  const screech = facts?.screech ?? 0
  // A Charge turns this into the combination roll from the moment it lands (v2 Phase 6e).
  const charge = facts?.charged === true
  return [
    {
      dice,
      ...(wave > 0 ? { wave } : {}),
      ...(screech > 0 ? { screech } : {}),
      ...(charge ? { charge: true as const } : {}),
    },
    next,
  ] as const
}

/**
 * Steps 2 to 10 of the defender's roll, and the damage that comes out of it.
 *
 * `saves` is null when no save roll was made at all. The attacker's modifiers are
 * gathered again rather than carried across: they are a pure query of the board, and
 * the board is what may have changed in between -- a Flame kills defenders before this
 * runs, which must change the save roll and must not change the attack.
 */
export function finishSaves(
  state: GameState,
  spec: AttackSpec,
  attack: AttackRollState,
  saves: SaveRollState | null,
  rng: RngState,
): AttackOutcome {
  const facts = attackFacts(state, spec, attack)
  const { attackRoll, unsavable, counterSuppressed } = facts

  if (saves === null) {
    return {
      attackTotal: attackRoll.total,
      saveTotal: null,
      // Under `magic: 'spells'` a magic roll inflicts nothing: its total is a pool of
      // casting points, and `finishExchange` hands it to `turn.magic` instead. The
      // v0 house rule is reached only by the rung it belongs to.
      damage:
        (spec.action === 'magic' && state.ruleSet.magic === 'simplified'
          ? magicDamage(attackRoll.total, state.ruleSet)
          : 0) + unsavable,
      unsavable,
      riposte: 0,
      counterSuppressed,
      attackRoll,
      saveRoll: null,
      rng,
    }
  }

  if (saves.charge === true) return finishCharge(state, spec, facts, saves, rng)

  const rollSpec = saveRollSpec(state, spec, saves)
  const [swept, afterSweep] = rerollSweep(saves.dice, rollSpec, state.ruleSet, rng)
  const saveRoll = asResult(resolveFaces(swept, rollSpec, state.ruleSet), 'save')

  // Wild Growth and the free moves are the defender's own, and were answered at the
  // same pause the attacker's Choke was. They stay on the list; they are not dropped.
  expectOnly(
    saveRoll.effects,
    ['riposte', 'wild_growth', 'regenerate', 'free_move', 'cantrip', 'bash'],
    `a save roll against ${spec.action}`,
  )

  // The riposte lands on whoever made this exchange's attack roll, where they stand.
  const back = spellReduced(state, spec.attacker, spec.attackerSlot, damageFrom(saveRoll.effects, 'riposte'))

  return {
    attackTotal: attackRoll.total,
    saveTotal: saveRoll.total,
    damage: Math.max(0, attackRoll.total - saveRoll.total) + unsavable,
    unsavable,
    riposte: back.damage,
    ...(back.math !== undefined ? { riposteMath: back.math } : {}),
    counterSuppressed,
    attackRoll,
    saveRoll,
    rng: afterSweep,
  }
}

/**
 * A Charge's end (v2 Phase 6e): the attack less the combination roll's saves goes to the
 * defender, and its melee -- with any Counter's riposte -- goes back at the attacker,
 * less only the attacker's spell saves. No counter-attack follows.
 *
 * The allocation is the defender's answer at `charge_allocate`; a roll with nothing to
 * allocate never asked, and spends its empty pools on save.
 */
function finishCharge(
  state: GameState,
  spec: AttackSpec,
  facts: AttackFacts,
  saves: SaveRollState,
  rng: RngState,
): AttackOutcome {
  const { attackRoll, unsavable } = facts
  const pools = chargePools(state, spec, saves)
  const owed = pools.ids > 0 || pools.flexible > 0 || pools.shields > 0
  if (owed && saves.allocation === undefined) {
    throw new Error('the Charge roll has IDs to allocate and nobody allocated them')
  }
  const rollSpec = chargeRollSpec(state, spec, saves, saves.allocation ?? displayAnswer(pools))
  const [swept, afterSweep] = rerollSweep(saves.dice, rollSpec, state.ruleSet, rng)
  const outcome = resolveFaces(swept, rollSpec, state.ruleSet)
  const saveRoll = asResult(outcome, 'save')
  expectOnly(saveRoll.effects, ['riposte', 'wild_growth', 'regenerate', 'free_move', 'cantrip', 'bash'], 'a Charge roll')

  const melee = outcome.totals.melee ?? 0
  const meleeMath = outcome.math?.melee
  const back = spellReduced(
    state,
    spec.attacker,
    spec.attackerSlot,
    melee + damageFrom(saveRoll.effects, 'riposte'),
  )

  return {
    attackTotal: attackRoll.total,
    saveTotal: saveRoll.total,
    damage: Math.max(0, attackRoll.total - saveRoll.total) + unsavable,
    unsavable,
    riposte: back.damage,
    ...(back.math !== undefined ? { riposteMath: back.math } : {}),
    counterSuppressed: facts.counterSuppressed,
    charge: { melee, ...(meleeMath !== undefined ? { math: meleeMath } : {}) },
    attackRoll,
    saveRoll,
    rng: afterSweep,
  }
}

/**
 * One whole attack, all three parts back to back.
 *
 * The door for a caller with no decision to take in the middle -- which in the engine
 * is nobody, since `turn.ts` stops twice on purpose. It is kept because it is how every
 * combat test states a scenario, and because "the parts compose back into the old
 * single pass" is exactly the property each of these splits claims.
 */
export function resolveAttack(state: GameState, spec: AttackSpec): AttackOutcome {
  const [attack, afterAttack] = rollAttack(state, spec)
  if (!attackFacts(state, spec, attack).savesNeeded) {
    return finishSaves(state, spec, attack, null, afterAttack)
  }
  const [saves, afterSaves] = rollSaveFaces(state, spec, afterAttack, attack)
  return finishSaves(state, spec, attack, saves, afterSaves)
}
