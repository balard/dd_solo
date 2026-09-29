/**
 * The turn machine: phases, marches, maneuvering, captures and victory.
 *
 * Two halves, with a strict division of labour:
 *
 *   `applyAction` -- folds a player's decision into the state and *always clears
 *                    `pending`*. It never sets a new one.
 *   `stepGame`    -- the only thing that sets `pending`. Advances one step and
 *                    returns the same object when there is nothing left to do.
 *
 * That split is load-bearing. Because `applyAction` leaves `pending` null, the
 * advance loop in `reduce.ts` always runs `stepGame` at least once after every
 * action, which is what guarantees the victory check runs after every state change
 * rather than only at end of turn.
 */
import {
  attackFacts,
  attackRollDice,
  parkedAttackRoll,
  rerollHeld,
  splitAttackTasks,
  parkedSaveRoll,
  finishSaves,
  legalActions,
  missileTargets,
  rollAttack,
  rollSaveFaces,
  saveEffects,
  saveRollDice,
  terrainAction,
  waveIn,
  waveModifier,
  type AttackOutcome,
  type AttackSpec,
} from './combat'
import { damageAssignmentProblem, damageOptions, healthsOf, maxAbsorbable } from './damage'
import {
  BREATH_EFFECT,
  BREATH_KILL_HEALTH,
  BREATH_NAME,
  dragonAttackSlots,
  dragonTargets,
  type DragonTarget,
  dragonTotals,
  elementOf,
  killThreshold,
  rollDragon,
  rolledIcon,
  type DragonRoll,
} from './dragons'
import {
  exchangeWithDua,
  growthPartners,
  promote,
  promotionBudgetProblem,
  promotionGain,
  promotionMatching,
  promotionPartners,
  recruit,
} from './dua'
import { buryEntries, buryUnits, deathEntries, killAndBury, killedIds, killUnits } from './death'
import {
  armyRoll,
  flashfireBudget,
  thornsAt,
  doublesIds,
  expireEffects,
  iconAt,
  endGlaresOf,
  isAsleep,
  pruneEffects,
  unitRoll,
  type Effect,
} from './effects'

import {
  asResult,
  defaultContextFor,
  expectNoEffects,
  faceOf,
  resolveFaces,
  rollArmy,
  rollFaces,
  rollPools,
  rollUnits,
  rerollSweep,
  type DieRoll,
  type RollMath,
  type RollResult,
  type RawDie,
  type RollSpec,
} from './roll'
import { doubleIdsModifier, ignoreIdsModifiers, type Modifier } from './pipeline'
import { DRAGON_ROLL_KINDS, type RollContext } from './sai'
import { terrainHas, unitHasAbility } from './species'
import { targetTasks, type TargetTask } from './targeting'
import { unitType } from '../data/load'
import { spell } from '../data/spells'
import {
  announcementProblem,
  cantripPool,
  castableSpells,
  dispelCandidates,
  dispelNegates,
  DISPEL_MAGIC,
  magicBySpecies,
  magicPool,
  sameSpellTarget,
  spellTargetProblem,
} from './magic'
import { castSpell, spellEffect } from './spells'
import { applyChooseFrontier, applyRollOffChoice, rollOffPending } from './setup'
import type { DragonElement, ResultType } from '../data/types'
import {
  IllegalActionError,
  TERRAIN_SLOTS,
  armyAt,
  army as armyRef,
  capturedCount,
  deadUnits,
  dragonsAt,
  livingUnits,
  opponentOf,
  type ActionKind,
  type AirFlightOffer,
  type AnnouncedSpell,
  type ArmyRef,
  type CombatState,
  type Direction,
  type DragonAttackState,
  type DragonDamageTarget,
  type DragonId,
  type GameAction,
  type GameState,
  type LogEntry,
  type MagicState,
  type MarchStep,
  type Pending,
  type PendingAttack,
  type PendingSaves,
  type PromotionPair,
  type DragonAnswer,
  type GrowthOffer,
  type PlayerId,
  type SpellChoice,
  type SpellTarget,
  type TerrainFace,
  type TerrainSlot,
  type TurnState,
  type UnitId,
  type UnitInstance,
} from './types'

const PLAYERS: readonly PlayerId[] = ['p1', 'p2']

// --- small helpers -----------------------------------------------------------

function withLog(state: GameState, ...entries: LogEntry[]): GameState {
  return entries.length === 0 ? state : { ...state, log: [...state.log, ...entries] }
}

function withTurn(state: GameState, turn: Partial<TurnState>): GameState {
  return { ...state, turn: { ...state.turn, ...turn } }
}

/** The marching army's terrain. Throws if the Reserve Army is somehow marching,
 *  which v0 never offers (RULES-V0.md section 3). */
function marchingSlot(state: GameState): TerrainSlot {
  const army = marchingRef(state)
  if (army === 'reserve') {
    throw new Error('the Reserve Army is not at a terrain, so it cannot do this')
  }
  return army
}

/**
 * The marching army, wherever it is.
 *
 * Split from `marchingSlot` in Phase 7f, when a Reserve Army became able to march.
 * The two are not interchangeable: the steps that turn a terrain die or contest a
 * maneuver genuinely need a terrain and keep the throwing version, while the ones that
 * only name the army -- the action, the magic roll, the log -- take this one.
 */
function marchingRef(state: GameState): ArmyRef {
  const army = state.turn.marchingArmy
  if (army === null) throw new Error('no army is marching')
  return army
}

/**
 * `combat.targetSlot` as a terrain, for the steps that can only ever see one.
 *
 * A Tower's missile is the one way `targetSlot` becomes a Reserve Army (Phase 5d),
 * and melee is the only action a counter-attack ever answers -- `stepHasWork`
 * offers one only after a melee exchange, which a Tower cannot aim at Reserves.
 * So this throws rather than narrows: reaching `'reserve'` here means that
 * invariant broke, not that this step has a Reserve Army to handle.
 */
function requireTerrainTarget(ref: ArmyRef): TerrainSlot {
  if (ref === 'reserve') throw new Error('a counter-attack cannot target a Reserve Army')
  return ref
}

/**
 * Armies this player could march: terrains where they have units, minus any army
 * already marched this turn. The Reserve Army is excluded -- it cannot maneuver and
 * has no legal action in v0, so offering it would be offering nothing.
 */
export function marchableArmies(state: GameState, player: PlayerId): readonly ArmyRef[] {
  const refs: readonly ArmyRef[] =
    // "An army in the Reserve Area may only take a magic action", so before spells it
    // has nothing to do and offering it would be offering nothing. This is the last of
    // RULES-V0.md section 4's house rules to go.
    state.ruleSet.magic === 'spells' ? [...TERRAIN_SLOTS, 'reserve'] : TERRAIN_SLOTS

  return refs.filter(
    (ref) => armyRef(state, player, ref).length > 0 && !state.turn.armiesMarched.includes(ref),
  )
}

export function legalDirections(face: TerrainFace): readonly Direction[] {
  const options: Direction[] = []
  if (face < 8) options.push('up')
  if (face > 1) options.push('down')
  return options
}

// --- victory and capture -----------------------------------------------------

export function findVictory(
  state: GameState,
): { player: PlayerId; reason: 'captures' | 'elimination' } | null {
  for (const player of PLAYERS) {
    if (capturedCount(state, player) >= 2) return { player, reason: 'captures' }
  }
  for (const player of PLAYERS) {
    const enemy = opponentOf(player)
    if (livingUnits(state, enemy).length === 0 && livingUnits(state, player).length > 0) {
      return { player, reason: 'elimination' }
    }
  }
  return null
}

/**
 * Drops a capture whose holder no longer has an army there.
 *
 * "A terrain at its eighth face turns back to its seventh face whenever the
 * controlling army abandons the terrain ... or all its units are killed or removed."
 * Being out-maneuvered is handled by the maneuver itself, which moves the face off 8.
 */
function syncCaptures(state: GameState): GameState {
  let terrains = state.terrains
  const entries: LogEntry[] = []

  for (const slot of TERRAIN_SLOTS) {
    const terrain = terrains[slot]
    if (terrain.face !== 8 || terrain.capturedBy === null) continue
    if (armyAt(state, terrain.capturedBy, slot).length > 0) continue

    entries.push({ kind: 'terrain_lost', slot, from: terrain.capturedBy, reason: 'abandoned' })
    terrains = { ...terrains, [slot]: { ...terrain, face: 7, capturedBy: null } }
  }

  return entries.length === 0 ? state : withLog({ ...state, terrains }, ...entries)
}

// --- the phase machine -------------------------------------------------------

/** Ends the current march, moving to the second march or on to the Reserves Phase. */
function endMarch(state: GameState): GameState {
  const base = withTurn(state, { marchingArmy: null, marchStep: 'select_army', combat: null })
  return state.turn.marchIndex === 0
    ? withTurn(base, { marchIndex: 1 })
    : withTurn(base, { phase: 'reserves_reinforce' })
}

/**
 * Hands the turn over.
 *
 * The next turn's state is **built, not spread**: every transient field -- the
 * exchange, the magic action, the eighth-face step, which terrains' dragons have
 * already attacked -- belongs to the turn that is ending, and a spread carries them
 * into the next one. `dragonsDone` is what made that concrete: left behind, it told
 * turn two that every terrain's dragons had already attacked, and they never attacked
 * again for the rest of the game. Two fuzz counters caught it; nothing else would
 * have, because a dragon attack that does not happen is not an invalid state.
 */
function endTurn(state: GameState): GameState {
  const next = opponentOf(state.turn.marching)
  return withLog(
    {
      ...state,
      turn: {
        marching: next,
        phase: 'effects_expire',
        marchIndex: 0,
        marchStep: 'select_army',
        marchingArmy: null,
        armiesMarched: [],
        combat: null,
      },
    },
    { kind: 'turn_end', player: state.turn.marching },
  )
}

function stepMarch(state: GameState): GameState {
  const player = state.turn.marching

  switch (state.turn.marchStep) {
    case 'select_army': {
      const options = marchableArmies(state, player)
      // Nothing to march: skip rather than asking a question with one answer.
      if (options.length === 0) {
        return endMarch(
          withLog(state, { kind: 'march_skipped', player, index: state.turn.marchIndex }),
        )
      }
      return { ...state, pending: { kind: 'choose_march_army', player, options } }
    }

    case 'declare_maneuver':
      // "This step is optional. **If the army is in the Reserve Area, skip this
      // step**" (p. 12). Not a decision with one answer -- no decision at all.
      if (marchingRef(state) === 'reserve') return withTurn(state, { marchStep: 'action' })
      return {
        ...state,
        pending: { kind: 'choose_maneuver', player, slot: marchingSlot(state) },
      }

    case 'contest_maneuver':
      return {
        ...state,
        pending: {
          kind: 'contest_maneuver',
          player: opponentOf(player),
          slot: marchingSlot(state),
        },
      }

    // Rapid Growth (Phase 8). The dice are already on the table; `applyContest` only
    // stops here when there is something worth asking, so this always asks.
    case 'rapid_growth': {
      const contest = requireContest(state)
      const slot = marchingSlot(state)
      const totals = contestTotals(state, contest.marcher, contest.defender)
      return {
        ...state,
        pending: {
          kind: 'rapid_growth',
          player: opponentOf(player),
          slot,
          options: rapidGrowthOptions(state, contest.defender),
          marcher: totals.marcher.total,
          defender: totals.defender.total,
        },
      }
    }

    case 'choose_direction': {
      const slot = marchingSlot(state)
      return {
        ...state,
        pending: {
          kind: 'choose_direction',
          player,
          slot,
          options: legalDirections(state.terrains[slot].face),
        },
      }
    }

    case 'action': {
      const slot = marchingRef(state)
      const legal = legalActions(state, player, slot)
      return { ...state, pending: { kind: 'choose_action', player, slot, legal } }
    }

    case 'choose_target': {
      const slot = marchingSlot(state)
      return {
        ...state,
        pending: {
          kind: 'choose_missile_target',
          player,
          options: missileTargets(state, player, slot),
        },
      }
    }

    // Auto steps: they roll and compute rather than asking anything, but are real
    // states so the advance loop has somewhere to stand between the dice landing
    // and the damage being assigned.
    case 'resolve_attack':
      return beginExchange(state, false)
    case 'flashfire_attack':
      return stepFlashfire(state, false, false)
    case 'flashfire_attack_saves':
      return stepFlashfire(state, false, true)
    case 'flashfire_counter':
      return stepFlashfire(state, true, false)
    case 'flashfire_counter_saves':
      return stepFlashfire(state, true, true)
    case 'sai_target_attack':
      return stepTargeting(state, false)
    case 'resolve_attack_saves':
      return rollSaves(state, false)
    case 'sai_delayed_attack':
      return stepDelayed(state, false)
    case 'resolve_attack_damage':
      return finishExchange(state, false)
    case 'resolve_counter':
      return beginExchange(state, true)
    case 'sai_target_counter':
      return stepTargeting(state, true)
    case 'resolve_counter_saves':
      return rollSaves(state, true)
    case 'sai_delayed_counter':
      return stepDelayed(state, true)
    case 'resolve_counter_damage':
      return finishExchange(state, true)

    case 'thorns_damage': {
      const owed = state.turn.thorns
      if (owed === undefined) return stepThorns(state)
      return {
        ...state,
        pending: {
          kind: 'assign_damage',
          player,
          slot: owed.slot,
          damage: owed.damage,
        },
      }
    }

    case 'assign_attack_damage':
    case 'assign_attack_riposte':
    case 'assign_counter_damage':
    case 'assign_counter_riposte': {
      const step = state.turn.marchStep
      const target = damageTarget(state, step)
      return {
        ...state,
        pending: {
          kind: 'assign_damage',
          player: target.player,
          slot: target.slot,
          damage: damageAt(state, step),
        },
      }
    }

    case 'announce_spells': {
      const magic = magicOf(state)
      const caster = magic.caster ?? player
      return {
        ...state,
        pending: {
          kind: 'announce_spells',
          player: caster,
          slot: magic.army,
          pool: magic.pool,
          castable: castableSpells(state, caster, magic.pool, state.ruleSet),
        },
      }
    }

    case 'dispel_magic':
      return stepDispel(state)

    case 'resolve_spell':
      return resolveNextSpell(state)

    case 'resolve_spell_choice': {
      const choice = magicOf(state).choice
      if (choice === undefined) return withTurn(state, { marchStep: 'resolve_spell' })
      // Flash Flood owes no decision -- the roll that could have stopped it has
      // already happened -- but it resolves *after* a roll, so it comes back through
      // the same door and is applied here rather than inside the handler.
      if (choice.kind === 'flood') return applyFlood(state, choice.slot)
      return { ...state, pending: spellChoicePending(state, choice) }
    }


    case 'offer_counter': {
      const combat = requireCombat(state)
      const defender = opponentOf(player)
      // Three reasons there may be no offer to make: Surprise; "a defending army
      // reduced to zero units does not counter-attack"; and nothing left to counter
      // *with*, which is newly reachable now that a riposte or a Smite can empty the
      // attacking army first.
      //
      // All three live here rather than in `stepHasWork` deliberately. The march
      // reaches this step and only then finds nothing to do, which is what v0 did:
      // when the attack wipes out the defender the game is already won, `stepGame`
      // returns on the victory check before this runs, and the recorded final state
      // is left standing on `offer_counter`. Deciding it one step earlier would end
      // the march first and change the state every golden was recorded in.
      if (combat.counterSuppressed === true) return endMarch(state)
      const targetSlot = requireTerrainTarget(combat.targetSlot)
      if (armyAt(state, defender, targetSlot).length === 0) return endMarch(state)
      if (armyAt(state, player, marchingSlot(state)).length === 0) return endMarch(state)
      return {
        ...state,
        pending: { kind: 'choose_counter_attack', player: defender, slot: targetSlot },
      }
    }
  }
}

// --- the combat sequence -----------------------------------------------------
// One exchange is up to seven steps, and most of them are skipped most of the time.
// Which one comes next used to be decided independently in `resolveExchange` and in
// `applyAssignDamage`; with two damage assignments per exchange rather than one,
// two copies of that would drift, and the way they would drift is damage being
// assigned twice or not at all.

const COMBAT_SEQUENCE = [
  'resolve_attack',
  'flashfire_attack',
  'sai_target_attack',
  'resolve_attack_saves',
  'flashfire_attack_saves',
  'sai_delayed_attack',
  'resolve_attack_damage',
  'assign_attack_damage',
  'assign_attack_riposte',
  'offer_counter',
  'resolve_counter',
  'flashfire_counter',
  'sai_target_counter',
  'resolve_counter_saves',
  'flashfire_counter_saves',
  'sai_delayed_counter',
  'resolve_counter_damage',
  'assign_counter_damage',
  'assign_counter_riposte',
] as const satisfies readonly MarchStep[]

type CombatStep = (typeof COMBAT_SEQUENCE)[number]

/** The steps an exchange is *inside*: between the attack roll and the damage it
 *  deals. `CombatState.attack` may exist at these and nowhere else. */
export const MID_EXCHANGE_STEPS: readonly MarchStep[] = [
  'resolve_attack',
  'flashfire_attack',
  'sai_target_attack',
  'resolve_attack_saves',
  'flashfire_attack_saves',
  'sai_delayed_attack',
  'resolve_attack_damage',
  'resolve_counter',
  'flashfire_counter',
  'sai_target_counter',
  'resolve_counter_saves',
  'flashfire_counter_saves',
  'sai_delayed_counter',
  'resolve_counter_damage',
]

type AssignStep = Extract<CombatStep, `assign_${string}`>

const isAssignStep = (step: MarchStep): step is AssignStep => step.startsWith('assign_')

/**
 * Who loses units at an assignment step, and where they are standing.
 *
 * The four mirror each other: an exchange's damage goes to whoever it was aimed at,
 * and a Counter or Volley riposte goes straight back at whoever rolled the attack.
 * The counter-attack swaps the two ends, which is why its pair is the reverse of
 * the opening attack's.
 */
function damageTarget(
  state: GameState,
  step: AssignStep,
): { readonly player: PlayerId; readonly slot: ArmyRef } {
  const combat = requireCombat(state)
  const marcher = state.turn.marching
  const atTarget = { player: opponentOf(marcher), slot: combat.targetSlot } as const
  const atMarch = { player: marcher, slot: marchingRef(state) } as const

  switch (step) {
    case 'assign_attack_damage':
      return atTarget
    case 'assign_attack_riposte':
      return atMarch
    case 'assign_counter_damage':
      return atMarch
    case 'assign_counter_riposte':
      return atTarget
  }
}

/** How much that step is assigning. */
function damageAt(state: GameState, step: AssignStep): number {
  const combat = requireCombat(state)
  return step === 'assign_attack_riposte' || step === 'assign_counter_riposte'
    ? (combat.riposte ?? 0)
    : combat.damage
}

/**
 * Whether a step has anything to do, and so whether the walk below should stop on it.
 *
 * The four mid-exchange steps answer false. `resolve_attack` and `resolve_counter`
 * are entered deliberately -- by choosing an action, and by accepting the
 * counter-attack offer. The two `_saves` steps are entered by the half of the
 * exchange before them, which sets the step directly rather than walking, because an
 * exchange that has rolled its attack always owes a save roll.
 */
function stepHasWork(state: GameState, step: CombatStep): boolean {
  if (isAssignStep(step)) {
    const target = damageTarget(state, step)
    const targetArmy = armyRef(state, target.player, target.slot)
    // Damage too small to kill anything is dropped rather than asked about.
    return damageOptions(targetArmy, damageAt(state, step)).required > 0
  }

  // Only melee is countered, and a counter is never itself countered. Whether the
  // offer is actually made -- Surprise, and whether either army still exists -- is
  // decided in `stepMarch`, not here; see the note there.
  if (step === 'offer_counter') return requireCombat(state).action === 'melee'

  return false
}

/** Moves to the next combat step with work in it, or ends the march. */
function afterCombatStep(state: GameState, done: CombatStep): GameState {
  for (let i = COMBAT_SEQUENCE.indexOf(done) + 1; i < COMBAT_SEQUENCE.length; i += 1) {
    const step = COMBAT_SEQUENCE[i]
    if (step === undefined) break
    // `resolve_counter` is a gate rather than a step to skip past. Everything after
    // it belongs to an exchange that happens only if the defender accepts the offer,
    // and its two assignments read a `combat.damage` that the counter has not
    // written yet -- so walking through would assign the opening attack's damage a
    // second time, to the wrong army.
    if (step === 'resolve_counter') break
    if (stepHasWork(state, step)) return withTurn(state, { marchStep: step })
  }
  return endMarch(state)
}

function requireCombat(state: GameState) {
  const combat = state.turn.combat
  if (combat === null) throw new Error('no combat is being resolved')
  return combat
}

/**
 * Who is attacking whom, and from where.
 *
 * The counter-attack swaps both ends, which is why it is derived in one place rather
 * than at each half of the exchange: the two halves must agree exactly, and the way
 * they would disagree is a save roll made by the wrong army.
 */
function exchangeSpec(state: GameState, isCounter: boolean): AttackSpec {
  const combat = requireCombat(state)
  const marcher = state.turn.marching
  const enemy = opponentOf(marcher)
  const marchSlot = marchingRef(state)

  return {
    action: combat.action,
    attacker: isCounter ? enemy : marcher,
    attackerSlot: isCounter ? requireTerrainTarget(combat.targetSlot) : marchSlot,
    defender: isCounter ? marcher : enemy,
    defenderSlot: isCounter ? marchSlot : combat.targetSlot,
    isCounter,
  }
}

/**
 * The first half of an exchange: the attacker rolls, and the dice are stashed.
 *
 * Nothing is computed from them here. A targeting SAI chosen between the two halves
 * can change what the save roll is -- which dice are in it, what modifies it, even
 * which units are still alive to make it -- so the arithmetic belongs on the far
 * side of the pause, not this one.
 */
function beginExchange(state: GameState, isCounter: boolean): GameState {
  const combat = requireCombat(state)
  const spec = exchangeSpec(state, isCounter)
  const [attack, rng] = rollAttack(state, spec)

  // **The targeting queue is not built here.** Flashfire re-rolls a die at step 3,
  // before SAIs are applied at step 4, and a queue worked out from faces that then
  // change is a queue about dice nobody threw. So the dice are parked and the queue is
  // built on the far side of the Flashfire pause, by `afterFlashfire`.
  //
  // A spread, unlike the rebuild in `finishExchange`, and safe for the opposite
  // reason: this is the *same* exchange one step later, not the next one.
  return withTurn(
    { ...state, rng },
    {
      marchStep: isCounter ? 'flashfire_counter' : 'flashfire_attack',
      combat: { ...combat, attack },
    },
  )
}

/** The attack roll, with the tasks it still owes stripped back to what is left. */
function withTargets(
  combat: CombatState,
  attack: PendingAttack,
  targets: readonly TargetTask[],
  rerollDue?: UnitId,
): CombatState {
  return {
    ...combat,
    attack: {
      dice: attack.dice,
      ...(targets.length > 0 ? { targets } : {}),
      ...(attack.delayed !== undefined ? { delayed: attack.delayed } : {}),
      ...(rerollDue !== undefined ? { rerollDue } : {}),
    },
  }
}

/** The save roll, with its own queue stripped back and anything else it carries kept. */
function withSaves(combat: CombatState, saves: PendingSaves, next: Partial<PendingSaves>): CombatState {
  const merged = { ...saves, ...next }
  return {
    ...combat,
    saves: {
      dice: merged.dice,
      ...(merged.tasks !== undefined && merged.tasks.length > 0 ? { tasks: merged.tasks } : {}),
      ...(merged.bonus !== undefined && merged.bonus > 0 ? { bonus: merged.bonus } : {}),
      ...(merged.wave !== undefined && merged.wave > 0 ? { wave: merged.wave } : {}),
    },
  }
}

function requireSaves(state: GameState, combat: CombatState): PendingSaves {
  const saves = combat.saves
  if (saves === undefined) {
    throw new Error(`reached ${state.turn.marchStep} with no save roll waiting to be resolved`)
  }
  return saves
}

/**
 * Which queue the current step is draining.
 *
 * Two pauses, two queues, one set of appliers: an answer arrives at `applyAction`
 * knowing only its own shape, so this is what tells it where the question came from.
 */
function taskQueue(state: GameState): readonly TargetTask[] {
  const combat = state.turn.combat
  if (combat === null) return []
  const step = state.turn.marchStep
  if (step === 'sai_target_attack' || step === 'sai_target_counter') {
    return combat.attack?.targets ?? []
  }
  if (step === 'sai_delayed_attack' || step === 'sai_delayed_counter') {
    return combat.saves?.tasks ?? []
  }
  return []
}

/** The same two queues, with the head dropped once it has been answered. */
function dropHeadTask(state: GameState): GameState {
  const combat = requireCombat(state)
  const rest = taskQueue(state).slice(1)
  const step = state.turn.marchStep

  if (step === 'sai_target_attack' || step === 'sai_target_counter') {
    // A Bullseye or Double Strike leaves its die owed a second throw, which the next
    // machine step makes -- after anything its deaths triggered has been asked.
    const head = taskQueue(state)[0]
    const due = head?.kind === 'enemy' ? head.rerollAfter : undefined
    return withTurn(state, { combat: withTargets(combat, requireAttack(state, combat), rest, due) })
  }
  return withTurn(state, { combat: withSaves(combat, requireSaves(state, combat), { tasks: rest }) })
}

function requireAttack(state: GameState, combat: CombatState): PendingAttack {
  const attack = combat.attack
  if (attack === undefined) {
    throw new Error(`reached ${state.turn.marchStep} with no attack roll waiting to be resolved`)
  }
  return attack
}

/**
 * Asks the roller about the next targeting SAI, or moves on to the save roll.
 *
 * Between the two rolls on purpose: a Sleep takes a die out of the save roll that
 * follows and a Galeforce subtracts from it, so the decision has to be made while the
 * save roll is still ahead. Flame is the one that lands first, and it is the one that
 * needs the *least* of that -- which is why it goes first.
 *
 * A task with nothing it could take is dropped rather than asked about: "up to X
 * health-worth" against an army whose smallest die is bigger than X can absorb
 * nothing at all. That is the same rule as damage too small to kill (`RULES-V0.md`
 * section 6), and it is the case a `2 SAI:Flame` meets against an army of monsters.
 */
/** Terrains where the roller's opponent has an army. Galeforce reaches any of them. */
function opposingArmies(state: GameState, roller: PlayerId): readonly TerrainSlot[] {
  const enemy = opponentOf(roller)
  return TERRAIN_SLOTS.filter((slot) => armyAt(state, enemy, slot).length > 0)
}

/**
 * Which player answers a task, and about whose army.
 *
 * Every task before Phase 4e was the attacker's, about the defender. Wild Growth and
 * the free moves are the first *friendly* ones, and at the delayed pause they belong
 * to whoever made the roll that produced them -- which is the defender, because the
 * roll is the save roll. Choke and Confuse are at the same pause and still the
 * attacker's, because they came off the attack roll two steps earlier.
 */
interface TaskOwner {
  readonly player: PlayerId
  readonly army: PlayerId
  /** A Reserve Army when a targeting SAI rides a Tower's missile there (Phase 5d);
   *  a terrain otherwise. */
  readonly slot: ArmyRef
}

function taskOwner(task: TargetTask, spec: AttackSpec, delayed: boolean): TaskOwner {
  // A Cantrip face is on a die in the rolling army, so its pool belongs to whoever
  // threw it -- the attacker on an attack roll, the defender on a save roll. Exactly
  // the split Wild Growth and the free moves make, and for the same reason.
  const friendly = task.kind === 'promote' || task.kind === 'move' || task.kind === 'cantrip'
  if (delayed && friendly) {
    return { player: spec.defender, army: spec.defender, slot: spec.defenderSlot }
  }
  if (friendly) {
    return { player: spec.attacker, army: spec.attacker, slot: spec.attackerSlot }
  }
  return { player: spec.attacker, army: spec.defender, slot: spec.defenderSlot }
}

/**
 * Choke's legal targets: the defenders whose save die came up an ID icon.
 *
 * The only targeting rule in the game that is a fact about a *roll* rather than about
 * an army, which is why it has to be computed here, from the parked dice, and handed
 * to the client on the pending: the tally, the confirm gate and the reducer all have
 * to agree about which dice are even on offer.
 */
function chokeEligible(state: GameState, spec: AttackSpec, saves: PendingSaves): readonly UnitId[] {
  const army = armyRef(state, spec.defender, spec.defenderSlot)
  const ids: UnitId[] = []
  for (const die of saves.dice) {
    if (faceOf(die).icon !== 'ID') continue
    if (!army.some((unit) => unit.id === die.unitId)) continue
    if (!ids.includes(die.unitId)) ids.push(die.unitId)
  }
  return ids
}

/** The units a task may pick from, which is its owner's army for a friendly one. */
function taskArmy(state: GameState, owner: TaskOwner): readonly UnitInstance[] {
  return armyRef(state, owner.army, owner.slot)
}

/** Whether this task has anything it could land on. */
function taskHasWork(
  state: GameState,
  spec: AttackSpec,
  task: TargetTask,
  delayed: boolean,
): boolean {
  const owner = taskOwner(task, spec, delayed)
  const army = taskArmy(state, owner)

  switch (task.kind) {
    case 'enemy':
      if (task.one === true) return army.length > 0
      return damageOptions(army, task.health).required > 0
    case 'sleep':
      return army.length > 0
    case 'galeforce':
      return opposingArmies(state, spec.attacker).length > 0
    case 'confuse':
      return damageOptions(army, task.health).required > 0
    case 'choke': {
      // Nothing rolled an ID, nothing to choke -- and the army may be picked from only
      // within that set, so the budget is measured over it too.
      const saves = state.turn.combat?.saves
      if (saves === undefined) return false
      const eligible = chokeEligible(state, spec, saves)
      const units = army.filter((unit) => eligible.includes(unit.id))
      return damageOptions(units, task.health).required > 0
    }
    case 'promote':
      // No partner in the DUA and there is no decision: the whole budget is save
      // results, and `stepTasks` applies that rather than asking about it.
      return army.some((unit) => growthPartners(state, unit.id, task.budget).length > 0)
    case 'move': {
      const mover = state.units[task.unitId]
      return mover !== undefined && mover.location.kind === 'terrain'
    }
    // Glare owes no decision at all: `stepTasks` applies it before asking this.
    case 'glare':
      return true
    case 'cantrip':
      // A pool that can buy nothing is not a decision. Under `magic: 'simplified'`
      // the SAI never produces one at all, so this is about a pool too small or a
      // species with no `C` spell in reach.
      return (
        castableSpells(
          state,
          owner.player,
          cantripPool(state, owner.player, owner.slot, task.points),
          state.ruleSet,
        ).length > 0
      )
  }
}

/** The question this task asks. */
function taskPending(
  state: GameState,
  spec: AttackSpec,
  task: TargetTask,
  remaining: number,
  delayed: boolean,
): Pending {
  const owner = taskOwner(task, spec, delayed)
  const common = { player: owner.player, sai: task.sai, remaining } as const
  const aimed = { target: owner.army, slot: owner.slot } as const

  switch (task.kind) {
    case 'enemy':
      if (task.one === true) return { kind: 'sai_target', ...common, ...aimed, limit: { kind: 'one' } }
      return { kind: 'sai_target', ...common, ...aimed, limit: { kind: 'health', budget: task.health } }
    case 'sleep':
      return { kind: 'sai_target', ...common, ...aimed, limit: { kind: 'one' } }
    case 'confuse':
      return { kind: 'sai_target', ...common, ...aimed, limit: { kind: 'health', budget: task.health } }
    case 'choke': {
      const saves = requireSaves(state, requireCombat(state))
      return {
        kind: 'sai_target',
        ...common,
        ...aimed,
        limit: { kind: 'health', budget: task.health },
        eligible: chokeEligible(state, spec, saves),
      }
    }
    case 'galeforce':
      return { kind: 'sai_target_army', ...common, options: opposingArmies(state, spec.attacker) }
    case 'promote':
      return {
        kind: 'sai_promote',
        ...common,
        budget: task.budget,
        // A Reserve Army rolling saves against a Tower's missile (Phase 5d) can
        // roll Wild Growth on its own dice same as any other; promotion cares
        // about the DUA, not the terrain, so `owner.slot` needs no narrowing.
        slot: owner.slot,
        // Only the defender's own save roll counts save results. An attack roll
        // generates them in a type it does not count.
        saveResultsCount: delayed && owner.player === spec.defender,
      }
    // Cantrip does not raise one of these: it opens a casting window instead, which
    // `stepTasks` does before it ever gets here.
    case 'cantrip':
      throw new Error('a Cantrip pool opens a casting window rather than a targeting pending')
    case 'glare':
      throw new Error('Hypnotic Glare picks nobody, so it never raises a pending')
    case 'move':
      return {
        kind: 'sai_move',
        ...common,
        unitId: task.unitId,
        slot: owner.slot,
        health: task.health,
        // "To any terrain" -- but not the one it is already standing on, which is
        // never true when the mover is a Reserve Army, so a free move out of
        // Reserves offers every terrain.
        options: TERRAIN_SLOTS.filter((slot) => slot !== owner.slot),
      }
  }
}

/**
 * Drains a queue of tasks, one decision at a time.
 *
 * Shared by both pauses, because the only things that differ are where the queue is
 * parked and who is asked -- and both of those are answers this file already has.
 *
 * Three ways a task leaves the queue without a decision:
 *
 *  - it can take nothing ("up to X health-worth" against an army whose smallest die is
 *    bigger than X), which is `RULES-V0.md` section 6's rule about damage too small to
 *    kill, in a second place;
 *  - Choke found no ID icons in the save roll;
 *  - Wild Growth found no partner in the DUA, and then its whole budget is save
 *    results. That one is not *dropped*: `autoResolve` applies it, because a budget
 *    that quietly evaporates is a Fireshadow smiting for 4 with nothing in the log.
 */
function stepTasks(state: GameState, isCounter: boolean, delayed: boolean): GameState {
  const spec = exchangeSpec(state, isCounter)
  const owed = delayed ? undefined : state.turn.combat?.attack?.rerollDue
  if (owed !== undefined) return rollHeldAgain(state, spec, owed)

  const queue = taskQueue(state)
  const head = queue[0]

  if (head === undefined) {
    return withTurn(state, {
      marchStep: nextStepAfterTasks(isCounter, delayed),
    })
  }

  // Hypnotic Glare takes "all units that roll an ID icon" -- a fact of the roll, not a
  // choice -- so it is applied here rather than asked about.
  if (head.kind === 'glare') return applyGlare(state, spec, head)

  if (!taskHasWork(state, spec, head, delayed)) return autoResolve(state, spec, head, delayed)

  // Cantrip's second sentence: "X magic results that only allow you to cast spells
  // marked as `Cantrip'", and the starter adds "these spells are resolved
  // immediately". So the exchange is suspended, a casting window opens on the spot,
  // and `returnTo` brings the march back here to finish draining the queue.
  if (head.kind === 'cantrip') return openCantripWindow(state, spec, head, delayed)

  return { ...state, pending: taskPending(state, spec, head, queue.length, delayed) }
}

/**
 * The second throw of a Bullseye or Double Strike die, once its SAI has resolved.
 *
 * Step 3's "apply these effects one at a time until all re-rolls have been made": the
 * new die joins the roll, a Bullseye or Double Strike on it queues behind the step-3
 * tasks still waiting, anything else it targets joins step 4 at the back, and a Choke
 * or Confuse waits with the delayed ones.
 */
function rollHeldAgain(state: GameState, spec: AttackSpec, unitId: UnitId): GameState {
  const combat = requireCombat(state)
  const attack = requireAttack(state, combat)
  const { dice, rng, tasks } = rerollHeld(state, spec, unitId)

  const queue = attack.targets ?? []
  const stepThree = queue.filter((task) => task.kind === 'enemy' && task.rerollAfter !== undefined)
  const stepFour = queue.filter((task) => !stepThree.includes(task))
  const targets = [...stepThree, ...tasks.stepThree, ...stepFour, ...tasks.stepFour]
  const delayedTasks = [...(attack.delayed ?? []), ...tasks.delayed]

  return withTurn(
    { ...state, rng },
    {
      combat: {
        ...combat,
        attack: {
          dice: [...attack.dice, ...dice],
          ...(targets.length > 0 ? { targets } : {}),
          ...(delayedTasks.length > 0 ? { delayed: delayedTasks } : {}),
        },
      },
    },
  )
}

/**
 * Suspends the exchange and opens a Cantrip casting window.
 *
 * The task is dropped first, so the step this returns to drains what is left of the
 * queue rather than asking the same question again.
 */
function openCantripWindow(
  state: GameState,
  spec: AttackSpec,
  task: Extract<TargetTask, { kind: 'cantrip' }>,
  delayed: boolean,
): GameState {
  const owner = taskOwner(task, spec, delayed)
  const dropped = withLog(dropHeadTask(state), {
    kind: 'cantrip',
    player: owner.player,
    slot: owner.slot,
    points: task.points,
  })

  return withTurn(
    withMagic(dropped, {
      army: owner.slot,
      pool: cantripPool(state, owner.player, owner.slot, task.points),
      // The marching player is not always the one holding the Cantrip die.
      ...(owner.player === state.turn.marching ? {} : { caster: owner.player }),
      returnTo: state.turn.marchStep,
    }),
    { marchStep: 'announce_spells' },
  )
}

const nextStepAfterTasks = (isCounter: boolean, delayed: boolean): MarchStep => {
  if (delayed) return isCounter ? 'resolve_counter_damage' : 'resolve_attack_damage'
  return isCounter ? 'resolve_counter_saves' : 'resolve_attack_saves'
}

/** A task nobody can be asked about, resolved the only way it can be. */
function autoResolve(
  state: GameState,
  spec: AttackSpec,
  task: TargetTask,
  delayed: boolean,
): GameState {
  const dropped = dropHeadTask(state)
  if (task.kind !== 'promote') return dropped

  // Wild Growth with nothing to promote into: the budget is save results, and they
  // only exist if there is a save roll to put them in. On an attack roll they are
  // counted in a type the roll does not count, which is the rules' own arithmetic
  // rather than a loss.
  const owner = taskOwner(task, spec, delayed)
  if (!delayed || owner.player !== spec.defender) return dropped

  const combat = requireCombat(dropped)
  const saves = requireSaves(dropped, combat)
  const logged = withLog(dropped, {
    kind: 'units_promoted',
    player: owner.player,
    sai: task.sai,
    pairs: [],
    saveResults: task.budget,
  })
  return withTurn(logged, {
    combat: withSaves(combat, saves, { bonus: (saves.bonus ?? 0) + task.budget }),
  })
}

function stepTargeting(state: GameState, isCounter: boolean): GameState {
  return stepTasks(state, isCounter, false)
}

function stepDelayed(state: GameState, isCounter: boolean): GameState {
  return stepTasks(state, isCounter, true)
}

/**
 * The defender's dice hit the table, and the exchange pauses again.
 *
 * Step 1 of their roll and nothing more. What waits at the next step is the rulebook's
 * step 2 -- "when rolling for saves against an attack, Delayed Effects are applied
 * now" -- plus the defending army's own Wild Growth and free moves, which are step 4
 * SAIs and are folded into the same pause because nothing between the two can be
 * observed: no save roll in the game has a step-3 reroll to come between them.
 *
 * A roll that earns no save roll at all skips straight to the damage, and its delayed
 * effects go with it: there are no dice for a Choke to look at.
 */
function rollSaves(state: GameState, isCounter: boolean): GameState {
  const combat = requireCombat(state)
  const attack = requireAttack(state, combat)
  const spec = exchangeSpec(state, isCounter)

  if (!attackFacts(state, spec, attack).savesNeeded) {
    return withTurn(state, {
      marchStep: isCounter ? 'resolve_counter_damage' : 'resolve_attack_damage',
    })
  }

  const [saves, rng] = rollSaveFaces(state, spec, state.rng, attack)
  // The queue waits for the Flashfire pause, for `beginExchange`'s reason: a save die
  // thrown again would leave it describing faces that are gone.
  return withTurn(
    { ...state, rng },
    {
      marchStep: isCounter ? 'flashfire_counter_saves' : 'flashfire_attack_saves',
      combat: withSaves(combat, saves, {}),
    },
  )
}

/** Which army threw the dice that are parked right now, and whose they are. */
function flashfireArmy(
  state: GameState,
  isCounter: boolean,
  onSaves: boolean,
): { readonly player: PlayerId; readonly ref: ArmyRef } {
  const spec = exchangeSpec(state, isCounter)
  return onSaves
    ? { player: spec.defender, ref: spec.defenderSlot }
    : { player: spec.attacker, ref: spec.attackerSlot }
}

/**
 * Flashfire's pause: "the target's owner may re-roll any one unit in the target army
 * once, ignoring the previous result."
 *
 * Visited exactly once per roll by construction -- the step is entered, asked and left
 * -- so nothing has to remember whether it has been used. The effect is **not** spent:
 * it lasts until its caster's next turn and reaches every non-maneuver roll in between,
 * which is what "this effect lasts until the beginning of your next turn" means beside
 * a "once" that governs the reroll.
 */
function stepFlashfire(state: GameState, isCounter: boolean, onSaves: boolean): GameState {
  const { player, ref } = flashfireArmy(state, isCounter, onSaves)
  const budget = flashfireBudget(state, player, ref)
  const dice = parkedDice(state, onSaves)

  // No Flashfire on this army, or nothing on the table: nothing to ask.
  if (budget === 0 || dice.length === 0) return afterFlashfire(state, isCounter, onSaves)

  const options = [...new Set(dice.map((die) => die.unitId))]
  return {
    ...state,
    pending: { kind: 'flashfire', player, slot: ref, budget: Math.min(budget, options.length), options },
  }
}

const parkedDice = (state: GameState, onSaves: boolean): readonly RawDie[] => {
  const combat = requireCombat(state)
  return onSaves ? (combat.saves?.dice ?? []) : (combat.attack?.dice ?? [])
}

/**
 * Builds the targeting queue from the faces as they finally stand, and moves on.
 *
 * This is where `beginExchange` and `rollSaves` used to end. It happens after the
 * Flashfire pause instead, so the queue describes the dice that are actually on the
 * table rather than the ones that were thrown first.
 */
function afterFlashfire(state: GameState, isCounter: boolean, onSaves: boolean): GameState {
  const combat = requireCombat(state)
  const spec = exchangeSpec(state, isCounter)
  const attack = requireAttack(state, combat)

  if (!onSaves) {
    // Step 3's SAIs first -- a Bullseye or Double Strike resolves, and only then is its
    // die thrown again -- and step 4's after them.
    const split = splitAttackTasks(state, spec, attack.dice)
    const targets = [...split.stepThree, ...split.stepFour]
    // Choke and Confuse wait for the defender's dice. They are parked with the attack
    // because they are *this* roll's SAIs and exist two steps before there is anything
    // to apply them to.
    const delayed = split.delayed

    return withTurn(state, {
      marchStep: isCounter ? 'sai_target_counter' : 'sai_target_attack',
      combat: {
        ...combat,
        attack: {
          ...attack,
          ...(targets.length > 0 ? { targets } : {}),
          ...(delayed.length > 0 ? { delayed } : {}),
        },
      },
    })
  }

  const saves = requireSaves(state, combat)
  // The attacker's delayed effects first, then the defending army's own -- the
  // rulebook's order, steps 2 then 4, and the one that lets a defender decide their
  // Wild Growth split knowing what Choke has already taken.
  const tasks = [...(attack.delayed ?? []), ...targetTasks(saveEffects(state, spec, saves))]

  return withTurn(state, {
    marchStep: isCounter ? 'sai_delayed_counter' : 'sai_delayed_attack',
    combat: withSaves(combat, saves, { tasks }),
  })
}

/**
 * Throws the named dice again, **replacing** what they showed.
 *
 * `applyConfuse`'s mechanism pointed at the roller's own dice: step 3's ordinary
 * rerolls append and both faces count, so a replacement cannot go through
 * `SaiOutcome.reroll`. The new dice sit where the old ones sat, so the strip still
 * reads in unit order.
 *
 * **House rule:** this does not restart the reroll sweep, so a Rend that comes up on a
 * Flashfire reroll does not roll again (`RULES-V0.md` section 15).
 */
function applyFlashfire(state: GameState, unitIds: readonly UnitId[]): GameState {
  // The dragon roll is the one parked roll outside an exchange, so it answers first
  // and by its own route -- exactly as `applyAssignDamage` branches on it.
  if (state.turn.dragonAttack !== undefined) return applyDragonFlashfire(state, unitIds)

  const step = state.turn.marchStep
  const onSaves = step === 'flashfire_attack_saves' || step === 'flashfire_counter_saves'
  const isCounter = step === 'flashfire_counter' || step === 'flashfire_counter_saves'
  if (!onSaves && step !== 'flashfire_attack' && step !== 'flashfire_counter') {
    throw new IllegalActionError(`no Flashfire is waiting (march step ${step})`)
  }

  const { player, ref } = flashfireArmy(state, isCounter, onSaves)
  const budget = flashfireBudget(state, player, ref)
  if (unitIds.length > budget) {
    throw new IllegalActionError(`Flashfire re-rolls ${budget} dice, not ${unitIds.length}`)
  }

  const combat = requireCombat(state)
  const dice = parkedDice(state, onSaves)
  for (const id of unitIds) {
    if (!dice.some((die) => die.unitId === id)) {
      throw new IllegalActionError(`${id} did not roll, so Flashfire cannot throw it again`)
    }
  }

  if (unitIds.length === 0) return afterFlashfire(state, isCounter, onSaves)

  // Board order, not the order they were named -- `death.ts`'s rule, so two players
  // naming the same dice differently get the same game.
  let rng = state.rng
  const replaced = new Map<UnitId, RawDie>()
  for (const unit of Object.values(state.units)) {
    if (!unitIds.includes(unit.id)) continue
    const [rolled, next] = rollFaces([unit], rng)
    rng = next
    const die = rolled[0]
    if (die !== undefined) replaced.set(unit.id, die)
  }

  const swapped = dice.map((die) => replaced.get(die.unitId) ?? die)
  const rerolled = withLog(
    { ...state, rng },
    { kind: 'flashfire', player, slot: ref, unitIds },
  )

  const next = onSaves
    ? withTurn(rerolled, {
        combat: withSaves(combat, requireSaves(state, combat), { dice: swapped }),
      })
    : withTurn(rerolled, {
        combat: { ...combat, attack: { ...requireAttack(state, combat), dice: swapped } },
      })

  return afterFlashfire(next, isCounter, onSaves)
}

/** Flashfire on the dragon combination roll. */
function applyDragonFlashfire(state: GameState, unitIds: readonly UnitId[]): GameState {
  const attack = dragonAttackOf(state)
  const budget = flashfireBudget(state, attack.defender, attack.slot)
  if (unitIds.length > budget) {
    throw new IllegalActionError(`Flashfire re-rolls ${budget} dice, not ${unitIds.length}`)
  }

  const dice = attack.armyDice ?? []
  for (const id of unitIds) {
    if (!dice.some((die) => die.unitId === id)) {
      throw new IllegalActionError(`${id} did not roll, so Flashfire cannot throw it again`)
    }
  }

  if (unitIds.length === 0) return withDragonAttack(state, { ...attack, step: 'army_roll' })

  let rng = state.rng
  const replaced = new Map<UnitId, RawDie>()
  for (const unit of Object.values(state.units)) {
    if (!unitIds.includes(unit.id)) continue
    const [rolled, next] = rollFaces([unit], rng)
    rng = next
    const die = rolled[0]
    if (die !== undefined) replaced.set(unit.id, die)
  }

  const logged = withLog(
    { ...state, rng },
    { kind: 'flashfire', player: attack.defender, slot: attack.slot, unitIds },
  )
  return withDragonAttack(logged, {
    ...attack,
    step: 'army_roll',
    armyDice: dice.map((die) => replaced.get(die.unitId) ?? die),
  })
}

/**
 * Casts an effect with a duration, and says so in the log.
 *
 * "Until the beginning of your next turn" -- *your* being the roller, which on a
 * counter-attack is the defending player rather than the marching one. `expireEffects`
 * reads that field at the top of each turn, so getting it wrong shortens or doubles
 * the effect rather than failing.
 */
function castEffect(
  state: GameState,
  caster: PlayerId,
  effect: Effect,
  where: {
    /** Omitted for a terrain effect, which belongs to nobody. */
    readonly target?: PlayerId
    readonly slot: ArmyRef
    readonly unitId?: UnitId
  },
): GameState {
  return withLog(
    { ...state, effects: [...state.effects, effect] },
    {
      kind: 'effect_cast',
      player: caster,
      source: effect.source,
      ...(where.target !== undefined ? { target: where.target } : {}),
      slot: where.slot,
      ...(where.unitId !== undefined ? { unitId: where.unitId } : {}),
    },
  )
}

/** Where a spell's `effect_cast` line points, from what the caster named. */
function castSite(target: SpellTarget): {
  readonly target?: PlayerId
  readonly slot: ArmyRef
  readonly unitId?: UnitId
} {
  switch (target.kind) {
    case 'army':
      return { target: target.player, slot: target.army }
    case 'terrain':
      return { slot: target.slot }
    case 'units':
      return { slot: 'reserve', ...(target.unitIds[0] !== undefined ? { unitId: target.unitIds[0] } : {}) }
    case 'none':
      return { slot: 'reserve' }
    case 'dua':
      return { target: target.player, slot: 'reserve' }
  }
}

/** Galeforce's arithmetic: "subtracts four save and four maneuver results from all
 *  rolls". Two modifiers because a `Modifier` carries exactly one result type. */
const GALEFORCE_MODIFIERS: readonly Modifier[] = [
  { kind: 'subtract', resultType: 'save', amount: 4 },
  { kind: 'subtract', resultType: 'maneuver', amount: 4 },
]

/** Galeforce: one opposing army, anywhere, at minus four save and maneuver. */
function applySaiTargetArmy(state: GameState, slot: TerrainSlot): GameState {
  const step = state.turn.marchStep
  if (step !== 'sai_target_attack' && step !== 'sai_target_counter') {
    throw new IllegalActionError(`no SAI is waiting for an army (march step ${step})`)
  }

  const [task] = taskQueue(state)
  if (task === undefined || task.kind !== 'galeforce') {
    throw new IllegalActionError('no SAI is waiting for an army')
  }

  const spec = exchangeSpec(state, step === 'sai_target_counter')
  const enemy = opponentOf(spec.attacker)
  if (!opposingArmies(state, spec.attacker).includes(slot)) {
    throw new IllegalActionError(`${enemy} has no army at ${slot} for ${task.sai} to target`)
  }

  const cast = castEffect(
    state,
    spec.attacker,
    {
      source: task.sai,
      target: { kind: 'army', player: enemy, army: slot },
      modifiers: GALEFORCE_MODIFIERS,
      expiresAtStartOfTurnOf: spec.attacker,
    },
    { target: enemy, slot },
  )

  return dropHeadTask(cast)
}

/**
 * Applies one targeting SAI to the units the roller picked.
 *
 * The selection rule is the opponent-targeting one: the maximum must be taken (full
 * rules p. 32), which is `damageAssignmentProblem` unchanged -- the same maximal
 * subset arithmetic as a damage assignment, with a different player answering.
 */
function applySaiTarget(state: GameState, unitIds: readonly UnitId[]): GameState {
  const step = state.turn.marchStep
  const delayed = step === 'sai_delayed_attack' || step === 'sai_delayed_counter'
  if (!delayed && step !== 'sai_target_attack' && step !== 'sai_target_counter') {
    throw new IllegalActionError(`no SAI is waiting for a target (march step ${step})`)
  }

  const combat = requireCombat(state)
  const [task] = taskQueue(state)
  if (
    task === undefined ||
    task.kind === 'galeforce' ||
    task.kind === 'promote' ||
    task.kind === 'move' ||
    task.kind === 'cantrip' ||
    task.kind === 'glare'
  ) {
    throw new IllegalActionError('no SAI is waiting for unit targets')
  }

  const spec = exchangeSpec(state, step === 'sai_target_counter' || step === 'sai_delayed_counter')
  const army = armyRef(state, spec.defender, spec.defenderSlot)

  // Sleep takes one *die*, not health-worth, so it cannot go through the maximal
  // subset check -- there is nothing to maximise, only a count to get right.
  if (task.kind === 'sleep') {
    const [unitId, ...extra] = unitIds
    if (unitId === undefined || extra.length > 0) {
      throw new IllegalActionError(`${task.sai} targets exactly one unit, not ${unitIds.length}`)
    }
    if (!army.some((unit) => unit.id === unitId)) {
      throw new IllegalActionError(`${unitId} is not in the army ${task.sai} is aimed at`)
    }

    // Sleep applies only to a melee attack (`sai.ts`), which never targets a
    // Reserve Army -- so `defenderSlot` is always a terrain here.
    const slot = requireTerrainTarget(spec.defenderSlot)
    const cast = castEffect(
      state,
      spec.attacker,
      {
        source: task.sai,
        target: { kind: 'unit', unitId },
        modifiers: [],
        asleep: true,
        expiresAtStartOfTurnOf: spec.attacker,
      },
      { target: spec.defender, slot, unitId },
    )
    return dropHeadTask(withTurn(cast, { combat: combat }))
  }

  // Choke picks only from the dice that rolled an ID, so the maximum it is held to is
  // the maximum *within that set* -- the same arithmetic over a smaller army.
  const saves = delayed ? requireSaves(state, combat) : undefined
  const pool =
    task.kind === 'choke' && saves !== undefined
      ? army.filter((unit) => chokeEligible(state, spec, saves).includes(unit.id))
      : army

  if (task.kind === 'enemy' && task.one === true) {
    // Swallow: one die, Sleep's count rule -- and "select the maximum number of
    // targets" means one whenever the army has any, which `taskHasWork` guarantees.
    if (unitIds.length !== 1 || !army.some((unit) => unit.id === unitIds[0])) {
      throw new IllegalActionError(`${task.sai} targets exactly one unit in the army it is aimed at`)
    }
  } else {
    const problem = damageAssignmentProblem(pool, task.health, unitIds)
    if (problem !== null) throw new IllegalActionError(problem)
  }

  // Named before anything happens to the dice, so the log reads as cause then effect
  // rather than as dice dying from nowhere.
  const named = withLog(state, {
    kind: 'sai_resolved',
    player: spec.attacker,
    sai: task.sai,
    slot: spec.defenderSlot,
    unitIds,
  })

  if (task.kind === 'confuse') return applyConfuse(named, task, unitIds)
  if (task.kind === 'choke') return applyChoke(named, spec, task, unitIds)

  // Bullseye, Double Strike, Smother, Firecloud and Seize give their targets a roll;
  // Flame does not. What comes back is the state with the escapes logged and moved,
  // and who is still standing there to be killed.
  const { state: rolled, escaped } =
    task.escape === 'none'
      ? { state: named, escaped: [] as readonly UnitId[] }
      : subRoll(named, spec, task, unitIds)

  const doomed = unitIds.filter((id) => !escaped.includes(id))
  if (doomed.length === 0) return dropHeadTask(rolled)

  // "The targets are killed and buried" is two steps because the rules are two, and a
  // Phoenix rolls Rise from the Ashes at each of them.
  const outcome =
    task.fate === 'bury' ? killAndBury(rolled, doomed) : killUnits(rolled, doomed)
  const buried = doomed.filter((id) => outcome.state.units[id]?.location.kind === 'bua')

  return dropHeadTask(
    withLog(
      outcome.state,
      ...deathEntries(outcome, spec.defender, spec.defenderSlot, doomed),
      ...(buried.length > 0
        ? [{ kind: 'units_buried', player: spec.defender, unitIds: buried } as const]
        : []),
    ),
  )
}

/**
 * Confuse: "re-roll the targeted units, ignoring all previous results".
 *
 * The only reroll in the game that **replaces** a face. Step 3's rerolls append a die
 * and both faces count, which is why `SaiOutcome.reroll` cannot express this: the old
 * face has to leave the list entirely, and it does so before anything has counted it.
 *
 * Board order again, and the new dice sit where the old ones sat, so a save roll reads
 * in unit order however many times it has been confused.
 */
function applyConfuse(
  state: GameState,
  task: Extract<TargetTask, { kind: 'confuse' }>,
  unitIds: readonly UnitId[],
): GameState {
  const combat = requireCombat(state)
  const saves = requireSaves(state, combat)
  const ordered = inBoardOrder(state, unitIds)

  let rng = state.rng
  const replaced = new Map<UnitId, RawDie>()
  for (const id of ordered) {
    const unit = state.units[id]
    if (unit === undefined) continue
    const [rolled, next] = rollFaces([unit], rng)
    rng = next
    const die = rolled[0]
    if (die !== undefined) replaced.set(id, die)
  }

  const dice = saves.dice.map((die) => replaced.get(die.unitId) ?? die)

  // Logged with both faces (Phase 9d). It used to write nothing -- "what they rolled the
  // second time shows up in the save strip" -- and that was the bug report: the only
  // strip left was the replaced one, so a Confuse looked like it had fired on the attack
  // roll that carried its face. Before and after, from the same resolve the totals use.
  const spec = exchangeSpec(state, state.turn.marchStep === 'sai_delayed_counter')
  const shown = (from: readonly RawDie[]) =>
    parkedSaveRoll(state, spec, { ...saves, dice: from }).dice.filter((die) => replaced.has(die.unitId))
  const logged = withLog(
    { ...state, rng },
    {
      kind: 'confused',
      player: spec.attacker,
      target: spec.defender,
      slot: spec.defenderSlot,
      sai: task.sai,
      before: shown(saves.dice),
      after: shown(dice),
    },
  )
  return dropHeadTask(withTurn(logged, { combat: withSaves(combat, saves, { dice }) }))
}

/**
 * Choke: "the targets are killed. None of their results are counted towards the
 * army's save results."
 *
 * Both halves matter and the second is the one that is easy to lose: the die is taken
 * out of the parked save roll as well as out of the army, and because it is taken out
 * *before* anything is counted, there is no subtraction to get wrong.
 */
function applyChoke(
  state: GameState,
  spec: AttackSpec,
  task: Extract<TargetTask, { kind: 'choke' }>,
  unitIds: readonly UnitId[],
): GameState {
  const combat = requireCombat(state)
  const saves = requireSaves(state, combat)

  const outcome = killUnits(state, unitIds)
  const logged = withLog(
    outcome.state,
    ...deathEntries(outcome, spec.defender, spec.defenderSlot, unitIds),
  )

  const dice = saves.dice.filter((die) => !unitIds.includes(die.unitId))
  void task
  return dropHeadTask(withTurn(logged, { combat: withSaves(combat, saves, { dice }) }))
}

/**
 * Hypnotic Glare (v2 Phase 5c): "All units that roll an ID icon are hypnotized and may
 * not be rolled until the beginning of your next turn. None of their results are
 * counted towards the army's save results."
 *
 * Choke's two halves with a status in place of the kill: the dice come out of the
 * parked save roll before anything is counted, and each victim carries an effect
 * anchored to every die that glared (5b), which the glaring die itself carries too, so
 * it sits out its own army's rolls while the glare lasts. Nobody rolled an ID, nothing
 * happens -- not even the glaring status, since there is no glare to keep alive.
 */
function applyGlare(
  state: GameState,
  spec: AttackSpec,
  task: Extract<TargetTask, { kind: 'glare' }>,
): GameState {
  const combat = requireCombat(state)
  const saves = requireSaves(state, combat)
  const victims = chokeEligible(state, spec, saves)
  // A melee attack is made from a terrain, so the glaring dice stand on one.
  const slot = spec.attackerSlot
  const sources = task.sources.filter((id) => {
    const location = state.units[id]?.location
    return location?.kind === 'terrain' && location.slot === slot
  })
  if (victims.length === 0 || sources.length === 0 || slot === 'reserve') return dropHeadTask(state)

  const lasting = (target: UnitId, source: UnitId, status: 'hypnotized' | 'glaring'): Effect => ({
    source: task.sai,
    target: { kind: 'unit', unitId: target },
    modifiers: [],
    [status]: true,
    anchor: { unitId: source, slot, untilRolled: true },
    expiresAtStartOfTurnOf: spec.attacker,
  })
  const effects: Effect[] = [
    ...victims.flatMap((victim) => sources.map((source) => lasting(victim, source, 'hypnotized'))),
    ...sources.map((source) => lasting(source, source, 'glaring')),
  ]

  const logged = withLog(
    { ...state, effects: [...state.effects, ...effects] },
    { kind: 'sai_resolved', player: spec.attacker, sai: task.sai, slot: spec.defenderSlot, unitIds: victims },
  )
  const dice = saves.dice.filter((die) => !victims.includes(die.unitId))
  return dropHeadTask(withTurn(logged, { combat: withSaves(combat, saves, { dice }) }))
}

/**
 * Wild Growth: the budget split between promotions and save results.
 *
 * The **first friendly decision in the game**, and so the first that may legally be
 * answered with nothing: p. 29's "any number ... including none", where every
 * targeting SAI before it was held to p. 32's maximum. Whatever the pairs do not
 * spend becomes save results, which is why the action carries only the pairs -- asking
 * for the split twice would let a player give two different answers to one question.
 */
function applySaiPromote(state: GameState, pairs: readonly PromotionPair[]): GameState {
  const step = state.turn.marchStep
  const delayed = step === 'sai_delayed_attack' || step === 'sai_delayed_counter'
  if (!delayed && step !== 'sai_target_attack' && step !== 'sai_target_counter') {
    throw new IllegalActionError(`no SAI is waiting for promotions (march step ${step})`)
  }

  const [task] = taskQueue(state)
  if (task === undefined || task.kind !== 'promote') {
    throw new IllegalActionError('no SAI is waiting for promotions')
  }

  const spec = exchangeSpec(state, step === 'sai_target_counter' || step === 'sai_delayed_counter')
  const owner = taskOwner(task, spec, delayed)

  const problem = promotionBudgetProblem(state, owner.player, pairs, task.budget)
  if (problem !== null) throw new IllegalActionError(problem)

  // Every pair must be in the army that rolled it: Wild Growth promotes "units in this
  // army", not anything the player owns.
  const army = taskArmy(state, owner)
  for (const pair of pairs) {
    if (!army.some((unit) => unit.id === pair.unitId)) {
      throw new IllegalActionError(`${pair.unitId} is not in the army ${task.sai} was rolled by`)
    }
  }

  const spent = pairs.reduce((sum, pair) => sum + promotionGain(state, pair), 0)
  const saveResults = task.budget - spent
  // The save share only exists if there is a save roll to join. On an attack roll it is
  // generated in a type the roll does not count, which is the rules' arithmetic and not
  // a special case -- and the log must not claim results nothing will count.
  const counted = delayed && owner.player === spec.defender

  const promoted = pairs.length === 0 ? state : exchangeWithDua(state, pairs)
  const logged = withLog(promoted, {
    kind: 'units_promoted',
    player: owner.player,
    sai: task.sai,
    pairs,
    ...(counted && saveResults > 0 ? { saveResults } : {}),
  })

  if (!counted || saveResults === 0) return dropHeadTask(logged)

  const combat = requireCombat(logged)
  const saves = requireSaves(logged, combat)
  return dropHeadTask(
    withTurn(logged, { combat: withSaves(combat, saves, { bonus: (saves.bonus ?? 0) + saveResults }) }),
  )
}

/**
 * Firewalking and Teleport: "this unit may move itself and up to three health-worth of
 * units in its army to any terrain."
 *
 * *May*, so `slot: null` is a real answer and not an empty one -- and declining moves
 * nothing and says nothing, because a log line for every free move nobody took would
 * bury the ones somebody did.
 *
 * The dice that move have already rolled, and their results still stand: "if a die's
 * results are used and it then leaves the army, its results still stand" (p. 27). So a
 * defender can save with a die and walk it out of the army before the damage lands.
 */
function applySaiMove(
  state: GameState,
  slot: TerrainSlot | null,
  unitIds: readonly UnitId[],
): GameState {
  const step = state.turn.marchStep
  const delayed = step === 'sai_delayed_attack' || step === 'sai_delayed_counter'
  if (!delayed && step !== 'sai_target_attack' && step !== 'sai_target_counter') {
    throw new IllegalActionError(`no SAI is waiting for a move (march step ${step})`)
  }

  const [task] = taskQueue(state)
  if (task === undefined || task.kind !== 'move') {
    throw new IllegalActionError('no SAI is waiting for a move')
  }

  if (slot === null) {
    if (unitIds.length > 0) {
      throw new IllegalActionError(`${task.sai} was declined, so it takes nobody with it`)
    }
    return dropHeadTask(state)
  }

  const spec = exchangeSpec(state, step === 'sai_target_counter' || step === 'sai_delayed_counter')
  const owner = taskOwner(task, spec, delayed)
  const mover = state.units[task.unitId]
  if (mover === undefined || mover.location.kind !== 'terrain') {
    throw new IllegalActionError(`${task.sai}: ${task.unitId} is no longer at a terrain`)
  }
  if (slot === mover.location.slot) {
    throw new IllegalActionError(`${task.sai} moves to another terrain, not the one it is on`)
  }

  const army = taskArmy(state, owner)
  const extras = unitIds.filter((id) => id !== task.unitId)
  for (const id of extras) {
    if (!army.some((unit) => unit.id === id)) {
      throw new IllegalActionError(`${id} is not in the army ${task.sai} was rolled by`)
    }
    // Sleep: "cannot be rolled **or leave the terrain they currently occupy**". The
    // mover cannot be asleep -- a sleeping die never rolled the face -- but a
    // passenger can be.
    if (isAsleep(state, id)) {
      throw new IllegalActionError(`${id} is asleep and cannot leave its terrain`)
    }
  }

  // "Up to three health-worth" -- *up to*, so under is legal and none is legal. The
  // opposite of every targeting SAI before Phase 4e.
  const carried = healthsOf(army.filter((unit) => extras.includes(unit.id))).reduce(
    (sum, health) => sum + health,
    0,
  )
  if (carried > task.health) {
    throw new IllegalActionError(
      `${task.sai} carries up to ${task.health} health-worth, and that is ${carried}`,
    )
  }

  const moved = [task.unitId, ...extras]
  const units = { ...state.units }
  for (const id of moved) {
    const unit = units[id]
    if (unit === undefined) continue
    units[id] = { ...unit, location: { kind: 'terrain', slot } }
  }

  const from = mover.location.slot
  return dropHeadTask(
    withLog({ ...state, units }, {
      kind: 'units_moved',
      player: owner.player,
      sai: task.sai,
      unitIds: moved,
      from,
      to: slot,
    }),
  )
}

/**
 * The order targets are rolled in: the board's, not the player's.
 *
 * `Object.values(state.units)` is the order `armyAt` returns and the order every roll
 * in the engine deals dice, and it is what `death.ts` uses for the same reason: two
 * players naming the same dice in a different order must get the same game. Both
 * replay identically either way, since the action is what is recorded -- but only one
 * of the two is canonical.
 */
function inBoardOrder(state: GameState, unitIds: readonly UnitId[]): readonly UnitId[] {
  return Object.values(state.units)
    .filter((unit) => unitIds.includes(unit.id))
    .map((unit) => unit.id)
}

/**
 * The sub-roll: the targets roll for their lives, and the ones that make it get out.
 *
 * Three escapes, from two questions. Bullseye and Double Strike ask for a **save**
 * result, Smother and Firecloud for a **maneuver** one -- a question about a total, so
 * those go through `rollUnits`. Seize asks whether the die shows an **ID icon** -- a
 * question about a face, so it is `rollFaces` and a look at the face, which also keeps
 * an ID roll from tripping the `'full'` refusal on an unbuilt SAI a target happens to
 * show.
 *
 * Two rules the roll type does not decide, both `RULES-V0.md` section 11:
 *
 *  - **A unit that cannot be rolled fails.** A sleeping die generates nothing, so it
 *    generates no save either -- and it draws no randomness on the way.
 *  - **A sub-roll is a save roll against *nothing***, via `defaultContextFor`: a
 *    Counter on a Bullseye target saves the die and sends no damage back. The narrow
 *    reading deliberately, because an effect out of here would have nobody to consume
 *    it -- which is what `expectNoEffects` refuses to let pass quietly.
 */
function subRoll(
  state: GameState,
  spec: AttackSpec,
  task: Extract<TargetTask, { kind: 'enemy' }>,
  unitIds: readonly UnitId[],
): { readonly state: GameState; readonly escaped: readonly UnitId[] } {
  const ordered = inBoardOrder(state, unitIds)
  const inputs = ordered.map((id) => unitRoll(state, id))

  let rng = state.rng
  const dice: DieRoll[] = []
  const escaped: UnitId[] = []

  if (task.escape === 'id') {
    const [raw, next] = rollFaces(
      inputs.filter((input) => input.rollable).map((input) => input.unit),
      rng,
    )
    rng = next
    for (const die of raw) {
      const face = faceOf(die)
      // An ID roll counts nothing, so every die in the strip reads as a blank. That is
      // honest: what this roll produced is a face, and `escaped` is what it was worth.
      dice.push({
        unitId: die.unitId,
        typeId: die.typeId,
        faceIndex: die.faceIndex,
        face,
        results: 0,
      })
      if (face.icon === 'ID') escaped.push(die.unitId)
    }
  } else {
    const type = task.escape === 'save' ? 'save' : 'maneuver'
    // `isSubRoll` is what tells an SAI this is one die rolling for its life rather
    // than an army rolling for the action -- see `RollContext`. Without it a Firewalking
    // face offers a free move nobody can be asked about, and `expectNoEffects` below
    // refuses the roll rather than the effect being quietly dropped.
    const [rolls, next] = rollUnits(
      inputs,
      type,
      { ...defaultContextFor(type), isSubRoll: true },
      rng,
      state.ruleSet,
    )
    rng = next
    for (const sub of rolls) {
      if (sub.roll === null) continue
      expectNoEffects(sub.roll, `${task.sai}'s ${type} roll`)
      dice.push(...sub.roll.dice)
      if (sub.roll.total > 0) escaped.push(sub.unitId)
    }
  }

  const entry: LogEntry = {
    kind: 'sai_sub_roll',
    player: spec.defender,
    source: task.sai,
    slot: spec.defenderSlot,
    test: task.escape === 'id' ? 'id' : task.escape === 'save' ? 'save' : 'maneuver',
    dice,
    escaped,
    // Omitted when the army was already the Reserve Army (a Tower's missile,
    // Phase 5d): Seize's escapees end up exactly where they started, and a log
    // that says "escapes to reserves" about a die that never moved is a claim
    // `moveEscapees` does not back up.
    ...(task.escapeTo === 'reserve' && spec.defenderSlot !== 'reserve'
      ? { toReserve: true as const }
      : {}),
  }

  // A glaring die that was just rolled has ended its glare (Hypnotic Glare, v2 Phase 5b):
  // the one roll it does not sit out is this one, a die rolling for its life.
  const rolled = dice.map((die) => die.unitId)
  const logged = endGlaresOf(withLog({ ...state, rng }, entry), rolled)
  return { state: moveEscapees(logged, task, escaped), escaped }
}

/** Seize: "they are immediately moved to their Reserve Area". An escapee is not
 *  killed, so no death trigger fires on one. */
function moveEscapees(
  state: GameState,
  task: Extract<TargetTask, { kind: 'enemy' }>,
  escaped: readonly UnitId[],
): GameState {
  if (task.escapeTo !== 'reserve' || escaped.length === 0) return state

  const units = { ...state.units }
  for (const id of escaped) {
    const unit = units[id]
    if (unit === undefined) throw new Error(`cannot move unknown unit ${id} to reserves`)
    units[id] = { ...unit, location: { kind: 'reserve' } }
  }
  return { ...state, units }
}

/**
 * The second half: what the attack's faces were worth, the save roll, and the damage.
 *
 * Routes to damage assignment, the counter-attack, or the end of the march. Only
 * melee offers a counter-attack, and only on the first exchange -- "Surprise has no
 * effect during a counter-attack" is the rulebook's way of saying counters do not
 * themselves get countered.
 */
/**
 * Where a magic roll stops being an attack and starts being a spell.
 *
 * `combat` is cleared here by the same field-by-field rebuild `finishExchange` uses,
 * so the parked attack dice are dropped by omission and `validateState`'s
 * `combat.attack` lifetime check still means what it says.
 */
function beginSpellcasting(
  state: GameState,
  army: ArmyRef,
  outcome: AttackOutcome,
): GameState {
  const player = state.turn.marching
  const pool = magicPool(state, player, army, outcome.attackTotal, magicBySpecies(outcome.attackRoll.dice))

  const logged = withLog({ ...state, rng: outcome.rng }, {
    kind: 'magic_rolled',
    player,
    slot: army,
    total: pool.points,
    elements: pool.elements,
    ...(pool.suppliers !== undefined ? { suppliers: pool.suppliers } : {}),
    dice: outcome.attackRoll.dice,
    ...(outcome.attackRoll.math !== undefined ? { math: outcome.attackRoll.math } : {}),
  })

  return withTurn(withMagic(logged, { army, pool }), {
    combat: null,
    marchStep: 'announce_spells',
  })
}

/**
 * Resolves the head of the announced list, one spell per step.
 *
 * "Cast and resolve the spells one at a time in any order you wish" (p. 13) -- the
 * order is the order they were announced in, which is the caster's own list, so the
 * freedom the rule grants is already spent at announcement.
 *
 * A cast whose target has vanished is **dropped**, not retargeted and not thrown on:
 * "if for any reason the announced target of a spell is no longer present, then you
 * may not select a new target". Same shape as damage too small to kill anything.
 */
function resolveNextSpell(state: GameState): GameState {
  const magic = magicOf(state)
  const [head, ...rest] = magic.announced ?? []

  if (head === undefined) {
    // A Cantrip window hands the march back where it came from; a magic action ends
    // it. `returnTo` is the whole of the difference.
    const back = magic.returnTo
    return back === undefined
      ? endMarch(withMagic(state, null))
      : withTurn(withMagic(state, null), { marchStep: back })
  }

  const remaining: MagicState = {
    army: magic.army,
    pool: magic.pool,
    ...(magic.caster !== undefined ? { caster: magic.caster } : {}),
    ...(magic.returnTo !== undefined ? { returnTo: magic.returnTo } : {}),
    ...(rest.length > 0 ? { announced: rest } : {}),
  }
  const next = withMagic(state, remaining)
  const player = magic.caster ?? state.turn.marching
  const s = spell(head.spell)

  // Dispelled before it could resolve. The `dispel_magic` entry already said what
  // stopped it, so this needs no line of its own.
  if (head.negated === true) return next

  if (!spellTargetPresent(state, head.target)) {
    return withLog(next, { kind: 'spell_fizzled', player, spell: head.spell })
  }

  const ctx = {
    caster: player,
    army: magic.army,
    element: head.element,
    count: head.count,
    target: head.target,
  }

  // A declarative spell is a `Modifier` plus a place, so it needs no handler: it goes
  // straight into `state.effects` through the same door Sleep and Galeforce use.
  const outcome =
    s.effect === undefined
      ? castSpell(next, s, ctx)
      : { state: castEffect(next, player, spellEffect(s, ctx), castSite(head.target)) }

  // Resurrect Dead is the one handler that moves units with nothing else to announce
  // it: no damage, no effect, no decision. The `spell_cast` line says which spell,
  // and this says who walked back out of the DUA.
  const raised =
    s.id === 'resurrect_dead' && head.target.kind === 'units'
      ? head.target.unitIds.filter((id) => outcome.state.units[id]?.location.kind !== 'dua')
      : []

  const logged = withLog(
    outcome.state,
    {
      kind: 'spell_cast',
      player,
      spell: head.spell,
      element: head.element,
      count: head.count,
    },
    ...(raised.length > 0
      ? [
          {
            kind: 'units_resurrected',
            player,
            unitIds: raised,
            slot: magic.army,
          } as const,
        ]
      : []),
  )

  // A spell that owes a decision parks it and the machine rests on
  // `resolve_spell_choice`; one that does not falls straight back into the loop and
  // resolves the next announced spell.
  if (outcome.choice === undefined) return logged
  return withTurn(withMagic(logged, { ...remaining, choice: outcome.choice }), {
    marchStep: 'resolve_spell_choice',
  })
}

/**
 * Dispel Magic's queue, drained one die at a time.
 *
 * A queue of its own rather than a third `TargetTask`: its items are unit ids and its
 * answer is a boolean, and forcing that into a union built for "health-worth of an
 * army" would buy nothing and cost a dead field in every golden digest.
 *
 * A head whose spells have all been stopped by an earlier roll is **dropped rather
 * than asked about** -- the same rule that drops a targeting SAI with nothing to take.
 */
function stepDispel(state: GameState): GameState {
  const magic = magicOf(state)
  const queue = magic.dispels ?? []
  const [head, ...rest] = queue

  if (head === undefined) return withTurn(withDispels(state, magic, []), { marchStep: 'resolve_spell' })

  const casts = magic.announced ?? []
  const spells = casts.filter((cast) => dispelNegates(state, cast, head)).map((c) => c.spell)
  if (spells.length === 0) return withDispels(state, magic, rest)

  const owner = state.units[head]?.owner
  if (owner === undefined) return withDispels(state, magic, rest)

  return {
    ...state,
    pending: { kind: 'dispel_magic', player: owner, unitId: head, spells, remaining: queue.length },
  }
}

/** Rewrites the queue, dropping the field entirely once it is empty. */
function withDispels(
  state: GameState,
  magic: MagicState,
  dispels: readonly UnitId[],
): GameState {
  const { dispels: _drained, ...rest } = magic
  return withMagic(state, { ...rest, ...(dispels.length > 0 ? { dispels } : {}) })
}

/**
 * One Dispel Magic roll: "no other icons have any affect during this special roll."
 *
 * So it is a question about a **face**, not a total -- Seize's path, not `rollUnits`'
 * -- which also keeps a die showing some other SAI from being resolved as one.
 */
function applyDispelMagic(state: GameState, roll: boolean): GameState {
  const magic = magicOf(state)
  const queue = magic.dispels ?? []
  const [head, ...rest] = queue
  if (head === undefined) throw new IllegalActionError('nobody is waiting to dispel')

  if (!roll) return withDispels(state, magic, rest)

  const unit = state.units[head]
  if (unit === undefined) return withDispels(state, magic, rest)

  const [rolled, rng] = rollFaces([unit], state.rng)
  const die = rolled[0]
  const face = die === undefined ? undefined : faceOf(die)
  const hit = face !== undefined && face.icon === 'SAI' && face.sai === DISPEL_MAGIC

  const casts = magic.announced ?? []
  const stopped = hit ? casts.filter((cast) => dispelNegates(state, cast, head)) : []
  const negated = casts.map((cast) =>
    stopped.includes(cast) ? { ...cast, negated: true as const } : cast,
  )

  const logged = withLog({ ...state, rng }, {
    kind: 'dispel_magic',
    player: unit.owner,
    unitId: head,
    spells: stopped.map((cast) => cast.spell),
  })

  const after: MagicState = {
    ...magic,
    ...(negated.length > 0 ? { announced: negated } : {}),
  }
  return withDispels(logged, after, rest)
}

/** The pending a parked spell decision raises. */
function spellChoicePending(state: GameState, choice: SpellChoice): Pending {
  const player = state.turn.marching
  switch (choice.kind) {
    // Hailstorm reuses the ordinary damage decision: one army, one number, the
    // maximal-subset rule. The same reuse a dragon attack makes, and for the same
    // reason -- a second pending of that shape is one both clients learn twice.
    case 'damage':
      return {
        kind: 'assign_damage',
        player: choice.player,
        slot: choice.army,
        damage: choice.damage,
      }
    case 'move':
      return {
        kind: 'spell_move',
        player,
        spell: 'Path',
        unitIds: choice.unitIds,
        options: choice.options,
      }
    case 'summon':
      return {
        kind: 'spell_summon',
        player,
        slot: choice.slot,
        options: choice.options,
        remaining: choice.remaining,
      }
    // Flash Flood asks nobody anything: it is intercepted a line earlier and applied.
    // Exhaustive rather than defaulted, so a new `SpellChoice` is a compile error here
    // instead of a silently unasked question.
    case 'flood':
      throw new Error('a flood is applied rather than asked about')
  }
}

/** Puts the magic machine back into its resolution loop, the decision answered. */
function afterSpellChoice(state: GameState, choice: SpellChoice | null): GameState {
  const magic = magicOf(state)
  const next: MagicState = {
    army: magic.army,
    pool: magic.pool,
    ...(magic.caster !== undefined ? { caster: magic.caster } : {}),
    ...(magic.returnTo !== undefined ? { returnTo: magic.returnTo } : {}),
    ...(magic.announced !== undefined ? { announced: magic.announced } : {}),
    ...(choice !== null ? { choice } : {}),
  }
  return withTurn(withMagic(state, next), {
    marchStep: choice === null ? 'resolve_spell' : 'resolve_spell_choice',
  })
}

/**
 * Flash Flood: the terrain goes down a step, once per player turn.
 *
 * `floodedSlots` is what makes "once" true: a second casting at the same terrain still
 * rolls, and still achieves nothing, which is the rule rather than an optimisation.
 */
function applyFlood(state: GameState, slot: TerrainSlot): GameState {
  const moved = moveTerrain(state, slot, 'down')
  return afterSpellChoice(
    withTurn(moved, { floodedSlots: [...(state.turn.floodedSlots ?? []), slot] }),
    null,
  )
}

/** Path: the units it named go where the caster says. */
function applySpellMove(state: GameState, slot: TerrainSlot): GameState {
  const magic = magicOf(state)
  const choice = magic.choice
  if (choice?.kind !== 'move') throw new IllegalActionError('no spell is waiting for a move')
  if (!choice.options.includes(slot)) {
    throw new IllegalActionError(`Path cannot move them to ${slot}`)
  }

  const units = { ...state.units }
  const moved: UnitId[] = []
  let from: TerrainSlot | null = null
  for (const id of choice.unitIds) {
    const unit = units[id]
    if (unit === undefined || unit.location.kind !== 'terrain') continue
    from ??= unit.location.slot
    units[id] = { ...unit, location: { kind: 'terrain', slot } }
    moved.push(id)
  }

  const logged =
    moved.length === 0 || from === null
      ? state
      : withLog(
          { ...state, units },
          {
            kind: 'units_moved',
            player: state.turn.marching,
            sai: 'Path',
            unitIds: moved,
            from,
            to: slot,
          },
        )

  return afterSpellChoice(logged, null)
}

/**
 * Summon Dragon: one dragon per answer, because combined castings summon more than one.
 *
 * The queue drains the way every other repeated decision in the engine does -- ask,
 * answer, decrement -- rather than asking for a set, because each pick narrows what is
 * left for the next.
 */
function applySpellSummon(state: GameState, dragonId: DragonId): GameState {
  const magic = magicOf(state)
  const choice = magic.choice
  if (choice?.kind !== 'summon') throw new IllegalActionError('no spell is summoning a dragon')
  if (!choice.options.includes(dragonId)) {
    throw new IllegalActionError(`${dragonId} cannot be summoned by this spell`)
  }

  const dragon = state.dragons[dragonId]
  if (dragon === undefined) throw new IllegalActionError(`no such dragon ${dragonId}`)

  const summoned = withLog(
    {
      ...state,
      dragons: {
        ...state.dragons,
        [dragonId]: { ...dragon, location: { kind: 'terrain' as const, slot: choice.slot } },
      },
    },
    {
      kind: 'dragon_summoned',
      player: state.turn.marching,
      dragonId,
      dieId: dragon.dieId,
      from: dragon.location.kind === 'terrain' ? dragon.location.slot : 'pool',
      slot: choice.slot,
    },
  )

  const left = choice.options.filter((id) => id !== dragonId)
  const remaining = choice.remaining - 1
  return afterSpellChoice(
    summoned,
    remaining > 0 && left.length > 0
      ? { kind: 'summon', slot: choice.slot, options: left, remaining }
      : null,
  )
}

/** Whether an announced target still exists. */
function spellTargetPresent(state: GameState, target: SpellTarget): boolean {
  switch (target.kind) {
    case 'none':
      return true
    case 'terrain':
      return true
    // An area, like a terrain: it cannot be gone.
    case 'dua':
      return true
    case 'army':
      return armyRef(state, target.player, target.army).length > 0
    case 'units':
      return target.unitIds.some((id: UnitId) => state.units[id] !== undefined)
  }
}

function finishExchange(state: GameState, isCounter: boolean): GameState {
  const combat = requireCombat(state)
  const pending = requireAttack(state, combat)
  const spec = exchangeSpec(state, isCounter)
  const { attacker, defender, attackerSlot, defenderSlot } = spec
  // The save dice were rolled two steps ago and have been through the delayed effects
  // since: a Choke may have taken one out of the list and a Confuse replaced another.
  const outcome = finishSaves(state, spec, pending, combat.saves ?? null, state.rng)

  // A magic action under `magic: 'spells'` inflicts nothing. Its total is a pool of
  // casting points, so the exchange ends here and `turn.magic` takes over. The roll
  // itself was an ordinary attack roll, which is exactly what a magic action is to the
  // SAI reference -- so a Galeforce or a Wild Growth on it has already resolved at the
  // pauses above, with no second copy of that machinery.
  if (combat.action === 'magic' && state.ruleSet.magic === 'spells') {
    return beginSpellcasting(state, spec.attackerSlot, outcome)
  }

  const entries: LogEntry[] = [
    {
      kind: 'combat_resolved',
      attacker,
      defender,
      attackerSlot,
      defenderSlot,
      action: combat.action,
      isCounter,
      attackTotal: outcome.attackTotal,
      saveTotal: outcome.saveTotal,
      damage: outcome.damage,
      // Omitted when zero, never written as 0: every golden digest carries every log
      // entry verbatim, so an always-present field rewrites all twenty-five.
      ...(outcome.unsavable > 0 ? { unsavable: outcome.unsavable } : {}),
      ...(outcome.riposte > 0 ? { riposte: outcome.riposte } : {}),
      ...(outcome.attackRoll.countedAs !== undefined
        ? { flamingShields: outcome.attackRoll.countedAs }
        : {}),
      ...(outcome.attackRoll.math !== undefined ? { attackMath: outcome.attackRoll.math } : {}),
      ...(outcome.saveRoll?.math !== undefined ? { saveMath: outcome.saveRoll.math } : {}),
      attackDice: outcome.attackRoll.dice,
      saveDice: outcome.saveRoll?.dice ?? null,
    },
  ]
  if (outcome.counterSuppressed) {
    entries.push({ kind: 'counter_suppressed', player: defender, slot: defenderSlot })
  }

  // Built field by field rather than spread over the old one: a stale `riposte` or
  // `counterSuppressed` carried from the opening attack into the counter-attack
  // would assign the same damage twice, and no total-checking test would see it.
  //
  // This is also the one place `attack` is dropped. It is dropped by *omission*, so
  // a field added here later has to be written deliberately -- and the four recorded
  // games that end mid-combat would catch it in the digest if one were not.
  const next: CombatState = {
    action: combat.action,
    targetSlot: combat.targetSlot,
    // Damage that cannot kill anything is dropped rather than asked about: a die
    // that takes less damage than its health simply ignores it (RULES-V0.md §6).
    damage: outcome.damage,
    ...(outcome.riposte > 0 ? { riposte: outcome.riposte } : {}),
    ...(outcome.counterSuppressed ? { counterSuppressed: true as const } : {}),
  }

  return afterCombatStep(
    withTurn(withLog({ ...state, rng: outcome.rng }, ...entries), { combat: next }),
    isCounter ? 'resolve_counter_damage' : 'resolve_attack_damage',
  )
}

/**
 * The dice on the table right now, if the game is paused in the middle of a roll.
 *
 * **Roll, then SAIs, then the totals** -- which is the order the rules resolve in and,
 * until this existed, not the order the game showed. Every targeting SAI is chosen
 * between a roll and the arithmetic that consumes it, and both clients rendered the
 * dice only at `combat_resolved`, after the decision was long gone. So a player picked
 * a Flame's victims, or split a Wild Growth, without being shown the roll that offered
 * it.
 *
 * A query rather than a log entry on purpose: a `dice_rolled` entry would appear in
 * every roll of every game, which rewrites all 25 golden digests to show something the
 * state already knows.
 *
 * `null` whenever nothing is parked, which is every step but the two pauses.
 */
export function rollOnTheTable(
  state: GameState,
): {
  readonly dice: readonly DieRoll[]
  readonly kind: 'attack' | 'save' | 'dragon' | 'maneuver'
} | null {
  // Rapid Growth (Phase 8): the counter-maneuvering army's own dice, which are what
  // it is choosing among. Found by the Phase 7e lesson -- a Flashfire sheet that asked
  // which dice to throw away without showing what they came up as.
  const contest = state.turn.contest
  if (contest !== undefined && state.turn.marchStep === 'rapid_growth') {
    return { dice: contestTotals(state, contest.marcher, contest.defender).defender.dice, kind: 'maneuver' }
  }

  // A dragon roll pauses for its allocation, and the player cannot choose sensibly
  // without seeing what landed: how many IDs there are to spend is the whole
  // question, and which dice already gave melee or saves is what decides where they
  // should go. Resolved with an empty allocation purely to render -- `resolveFaces`
  // draws nothing, which is what lets the same faces be read twice.
  const dragon = state.turn.dragonAttack
  if (
    dragon?.armyDice !== undefined &&
    (dragon.step === 'army_roll' || dragon.step === 'army_flashfire')
  ) {
    // A combination roll cannot be resolved at all without an allocation that spends
    // the ID pool exactly -- `allocateIds` refuses, which crashed the sheet that was
    // trying to *show* the roll so the player could allocate it. The pool goes on one
    // kind purely to satisfy that: `perDieResults` counts an ID die's pool once and
    // never asks which type it became, so the strip is identical whichever is picked,
    // and no total from this pass is ever used.
    const { ids } = rollPools(dragon.armyDice, dragonRollSpec(state, dragon), state.ruleSet)
    const spec: RollSpec = {
      ...dragonRollSpec(state, dragon),
      idAllocation: { melee: ids, missile: 0, save: 0 },
    }
    return { dice: resolveFaces(dragon.armyDice, spec, state.ruleSet).dice, kind: 'dragon' }
  }

  const combat = state.turn.combat
  if (combat === null) return null

  const step = state.turn.marchStep
  const isCounter =
    step === 'sai_target_counter' ||
    step === 'sai_delayed_counter' ||
    step === 'flashfire_counter' ||
    step === 'flashfire_counter_saves'
  // Flashfire's pause is about the save dice at the two `_saves` steps and the attack
  // dice at the other two, the same split the targeting and delayed pauses make.
  const delayed =
    step === 'sai_delayed_attack' ||
    step === 'sai_delayed_counter' ||
    step === 'flashfire_attack_saves' ||
    step === 'flashfire_counter_saves'
  const asking =
    delayed ||
    step === 'sai_target_attack' ||
    step === 'sai_target_counter' ||
    step === 'flashfire_attack' ||
    step === 'flashfire_counter'
  if (!asking) return null

  const attack = combat.attack
  if (attack === undefined) return null
  const spec = exchangeSpec(state, isCounter)

  // At the delayed pause the save dice are what the decision is about -- Choke reads
  // them, Confuse replaces them, and a defender splitting Wild Growth is looking at
  // the roll it is being split into.
  if (delayed) {
    const saves = combat.saves
    if (saves === undefined) return null
    return { dice: saveRollDice(state, spec, saves), kind: 'save' }
  }

  return { dice: attackRollDice(state, spec, attack), kind: 'attack' }
}

/**
 * One roll a decision is about, whole: who threw it, what for, the dice, and -- where the
 * roll has one -- its total and `math`.
 */
export interface TableRoll {
  readonly player: PlayerId
  readonly kind: 'attack' | 'save' | 'maneuver' | 'dragon'
  /** The attack's action, for "melee" rather than "attack" on the strip's heading. */
  readonly action?: ActionKind
  readonly roll: {
    readonly dice: readonly DieRoll[]
    readonly total?: number
    readonly math?: RollMath
  }
}

/**
 * **Every** roll a decision in progress is about (Phase 9d) -- `rollOnTheTable`'s plural.
 *
 * `rollOnTheTable` answers "which dice is this decision choosing among", which is one
 * roll. A player deciding needs more than that: at the delayed pause Confuse replaces
 * *save* dice, but the Confuse face is on the *attack* roll, and a player looking at the
 * save strip alone could not tell which roll the SAI came off -- which is exactly how
 * Confuse was reported as firing on the wrong roll. So this returns both rolls there, and
 * both maneuver rolls at Rapid Growth, whose question is "beat this number".
 *
 * Empty when nothing is parked. A decision that follows a roll the machine has already
 * logged (damage assignment, a counter-attack offer) reads the roll from the log instead;
 * that is presentation, and lives in `prompts.ts`.
 */
export function rollsOnTheTable(state: GameState): readonly TableRoll[] {
  const whole = (result: RollResult): TableRoll['roll'] => ({
    dice: result.dice,
    total: result.total,
    ...(result.math !== undefined ? { math: result.math } : {}),
  })

  const contest = state.turn.contest
  if (contest !== undefined && state.turn.marchStep === 'rapid_growth') {
    const { marcher, defender } = contestTotals(state, contest.marcher, contest.defender)
    return [
      { player: state.turn.marching, kind: 'maneuver', roll: whole(marcher) },
      { player: opponentOf(state.turn.marching), kind: 'maneuver', roll: whole(defender) },
    ]
  }

  const one = rollOnTheTable(state)
  if (one?.kind === 'dragon') {
    const attack = state.turn.dragonAttack
    return attack === undefined ? [] : [{ player: attack.defender, kind: 'dragon', roll: { dice: one.dice } }]
  }

  const combat = state.turn.combat
  if (one === null || combat === null || combat.attack === undefined) return []

  const step = state.turn.marchStep
  const isCounter =
    step === 'sai_target_counter' ||
    step === 'sai_delayed_counter' ||
    step === 'flashfire_counter' ||
    step === 'flashfire_counter_saves'
  const spec = exchangeSpec(state, isCounter)
  const attackRoll: TableRoll = {
    player: spec.attacker,
    kind: 'attack',
    action: spec.action,
    roll: whole(parkedAttackRoll(state, spec, combat.attack)),
  }
  if (one.kind !== 'save' || combat.saves === undefined) return [attackRoll]
  return [
    attackRoll,
    { player: spec.defender, kind: 'save', roll: whole(parkedSaveRoll(state, spec, combat.saves)) },
  ]
}

// --- the Eighth Face Phase (Phase 5e) -----------------------------------------
// "At most one terrain fires per phase" -- a player holding two has already won,
// so the phase is a single decision with no queue: look for the one slot with an
// icon, raise its decision if it has one, and let the applier advance the phase.
// A future rule that changes what wins the game is the one thing that would turn
// this into a queue.

/** City's offer at this slot: recruits and one-step promotions, or null when
 *  neither has a legal answer -- the same "nothing to ask" rule as damage too
 *  small to kill. */
function cityPending(state: GameState, player: PlayerId, slot: TerrainSlot): Pending | null {
  const recruits = deadUnits(state, player)
    .filter((unit) => unitType(unit.typeId).health === 1)
    .map((unit) => unit.id)

  const promotions: PromotionPair[] = []
  for (const unit of armyAt(state, player, slot)) {
    for (const partner of promotionPartners(state, unit.id)) {
      promotions.push({ unitId: unit.id, partnerId: partner.id })
    }
  }

  if (recruits.length === 0 && promotions.length === 0) return null
  return { kind: 'eighth_face_city', player, slot, recruits, promotions }
}

/** The one decision the Eighth Face Phase has to raise, if any. */
function eighthFacePending(state: GameState): Pending | null {
  const marching = state.turn.marching

  // Temple's second decision: already committed to forcing, so this phase is not
  // looking for a new terrain -- it is waiting on the answer it already asked for.
  if (state.turn.eighthFaceStep === 'temple_bury') {
    const options = deadUnits(state, opponentOf(marching)).map((unit) => unit.id)
    return { kind: 'temple_bury', player: opponentOf(marching), options }
  }

  for (const slot of TERRAIN_SLOTS) {
    const icon = iconAt(state, marching, slot)
    if (icon === 'city') {
      const pending = cityPending(state, marching, slot)
      if (pending !== null) return pending
    }
    if (icon === 'temple' && deadUnits(state, opponentOf(marching)).length > 0) {
      return { kind: 'eighth_face_temple', player: marching, slot }
    }
  }
  return null
}

/**
 * City: recruit, promote, or do nothing -- one unit either way.
 *
 * Recomputes the offer with `eighthFacePending` rather than trusting
 * `state.pending`: `applyAction` clears `pending` before any applier runs (see the
 * note at the top of this file), so by the time this executes there is nothing
 * left to read there. Every other applier in this file recomputes for the same
 * reason -- `damageTarget`, `taskOwner`, `chokeEligible` and the rest.
 */
function applyEighthFaceCity(
  state: GameState,
  choice: Extract<GameAction, { kind: 'eighth_face_city' }>['choice'],
): GameState {
  const pending = eighthFacePending(state)
  if (pending?.kind !== 'eighth_face_city') {
    throw new IllegalActionError('the Eighth Face Phase is not offering City')
  }
  if (choice === null) return withTurn(state, { phase: 'dragon_attack' })

  if (choice.kind === 'recruit') {
    if (!pending.recruits.includes(choice.unitId)) {
      throw new IllegalActionError(`${choice.unitId} is not a 1-health unit in your DUA`)
    }
    const recruited = recruit(state, [choice.unitId], pending.slot)
    const logged = withLog(recruited, {
      kind: 'units_recruited',
      player: pending.player,
      slot: pending.slot,
      unitIds: [choice.unitId],
    })
    return withTurn(logged, { phase: 'dragon_attack' })
  }

  const { pair } = choice
  if (
    !pending.promotions.some((p) => p.unitId === pair.unitId && p.partnerId === pair.partnerId)
  ) {
    throw new IllegalActionError(`${pair.unitId} -> ${pair.partnerId} is not a legal promotion here`)
  }
  const promoted = promote(state, [pair])
  const logged = withLog(promoted, {
    kind: 'units_promoted',
    player: pending.player,
    sai: 'City',
    pairs: [pair],
    source: 'city',
  })
  return withTurn(logged, { phase: 'dragon_attack' })
}

/** Temple's first decision: force a burial, or let it go. */
function applyEighthFaceTemple(state: GameState, force: boolean): GameState {
  if (eighthFacePending(state)?.kind !== 'eighth_face_temple') {
    throw new IllegalActionError('the Eighth Face Phase is not offering Temple')
  }
  if (!force) return withTurn(state, { phase: 'dragon_attack' })
  return withTurn(state, { eighthFaceStep: 'temple_bury' })
}

/** Temple's second decision: the opponent buries one of their own choosing. */
function applyTempleBury(state: GameState, unitId: UnitId): GameState {
  const pending = eighthFacePending(state)
  if (pending?.kind !== 'temple_bury') {
    throw new IllegalActionError('nobody is being forced to bury a unit')
  }
  if (!pending.options.includes(unitId)) {
    throw new IllegalActionError(`${unitId} is not in ${pending.player}'s DUA`)
  }

  // A Phoenix rolls Rise from the Ashes on the way; if it rises it was never buried,
  // and `buryEntries` says so rather than writing "buried" over a die in Reserves.
  const outcome = buryUnits(state, [unitId])
  const logged = withLog(outcome.state, ...buryEntries(outcome, pending.player, [unitId], 'temple'))

  // Built field by field rather than spread over the old turn, the way
  // `finishExchange` drops `combat.attack`: `eighthFaceStep` is omitted-or-present
  // like every other optional field near the digest, and a spread would carry it
  // forward as a stale "still waiting" marker instead of dropping it.
  const turn = logged.turn
  return {
    ...logged,
    turn: {
      marching: turn.marching,
      phase: 'dragon_attack',
      marchIndex: turn.marchIndex,
      marchStep: turn.marchStep,
      marchingArmy: turn.marchingArmy,
      armiesMarched: turn.armiesMarched,
      combat: turn.combat,
    },
  }
}

// --- the Dragon Attack Phase (Phase 6) ---------------------------------------
//
// The rulebook's nine steps (p. 18) with the four that take no decision folded
// into their neighbours. `turn.dragonAttack` is this phase's `CombatState`: it
// holds the dragons' rolled faces between the throw and the arithmetic, exactly
// as an exchange holds the attacker's, and for the same reason -- a pause has to
// happen between a step that consumes randomness and one that is pure.

/** Sets or clears the phase's working state, field by field, as `finishExchange` does. */
function withDragonAttack(state: GameState, attack: DragonAttackState | null): GameState {
  const turn = state.turn
  const rest = {
    marching: turn.marching,
    phase: turn.phase,
    marchIndex: turn.marchIndex,
    marchStep: turn.marchStep,
    marchingArmy: turn.marchingArmy,
    armiesMarched: turn.armiesMarched,
    combat: turn.combat,
    ...(turn.eighthFaceStep !== undefined ? { eighthFaceStep: turn.eighthFaceStep } : {}),
    ...(turn.magic !== undefined ? { magic: turn.magic } : {}),
  }
  return { ...state, turn: attack === null ? rest : { ...rest, dragonAttack: attack } }
}

/**
 * Sets or clears the magic action's working state -- `withDragonAttack`'s twin, and
 * field by field for the same reason: clearing has to drop the key by **omission**,
 * or `digestState`'s `stableJson(state.turn)` grows a `"magic": null` in all
 * twenty-five recorded games.
 */
function withMagic(state: GameState, magic: MagicState | null): GameState {
  const turn = state.turn
  const rest = {
    marching: turn.marching,
    phase: turn.phase,
    marchIndex: turn.marchIndex,
    marchStep: turn.marchStep,
    marchingArmy: turn.marchingArmy,
    armiesMarched: turn.armiesMarched,
    combat: turn.combat,
    ...(turn.eighthFaceStep !== undefined ? { eighthFaceStep: turn.eighthFaceStep } : {}),
    ...(turn.dragonAttack !== undefined ? { dragonAttack: turn.dragonAttack } : {}),
  }
  return { ...state, turn: magic === null ? rest : { ...rest, magic } }
}

const magicOf = (state: GameState): MagicState => {
  const magic = state.turn.magic
  if (magic === undefined) throw new Error('no magic action is being cast')
  return magic
}

const dragonAttackOf = (state: GameState): DragonAttackState => {
  const attack = state.turn.dragonAttack
  if (attack === undefined) throw new Error('no dragon attack is being resolved')
  return attack
}

/** The rolls belonging to one dragon, first throw and every reroll after it. */
const rollsOf = (attack: DragonAttackState, dragonId: DragonId): readonly DragonRoll[] =>
  attack.rolls.filter((roll) => roll.dragonId === dragonId)

/** The dragons attacking the army, in board order -- breath and treasure order. */
function armyAttackers(state: GameState, attack: DragonAttackState): readonly DragonId[] {
  return dragonsAt(state, attack.slot)
    .filter((dragon) => attack.targets[dragon.id]?.kind === 'army')
    .map((dragon) => dragon.id)
}

/** One entry per breath rolled against the army, in board order. */
function breathsOwed(state: GameState, attack: DragonAttackState): readonly DragonId[] {
  return armyAttackers(state, attack).flatMap((id) =>
    Array.from<DragonId>({ length: dragonTotals(state, rollsOf(attack, id), false).breaths }).fill(
      id,
    ),
  )
}

/** One entry per treasure rolled against the army. */
function treasuresOwed(state: GameState, attack: DragonAttackState): number {
  return armyAttackers(state, attack).reduce(
    (sum, id) => sum + dragonTotals(state, rollsOf(attack, id), false).treasures,
    0,
  )
}

/**
 * Rolls every dragon at a terrain and opens the attack: steps 1 to 3 in one move,
 * since the targets follow from the board and the rolls take no decision.
 */
/**
 * Opens a terrain's dragon attack at the declaration step.
 *
 * Nothing is thrown here. Breath rerolls against a dragon and not against an army, so
 * every target has to be settled before any die is, which is why the rulebook
 * designates targets at step 2 and rolls at step 3.
 */
function beginDragonAttack(state: GameState, slot: TerrainSlot): GameState {
  const marching = state.turn.marching
  const { settled, choices } = dragonTargets(state, slot, marching)

  // Who still has to declare, in player order. Both owners declare before anything is
  // revealed -- and nothing is, because `targets` reaches neither client until the
  // roll is logged.
  const declaring = PLAYERS.filter((player) =>
    [...choices.keys()].some((id) => state.dragons[id]?.owner === player),
  )

  return withDragonAttack(state, {
    slot,
    step: 'declare',
    defender: marching,
    rolls: [],
    targets: Object.fromEntries(settled),
    resolved: 0,
    ...(declaring.length > 0 ? { declaring } : {}),
  })
}

/** The declaration a player still owes at this terrain. */
function dragonTargetPending(state: GameState, attack: DragonAttackState): Pending | null {
  const player = attack.declaring?.[0]
  if (player === undefined) return null

  const { choices } = dragonTargets(state, attack.slot, attack.defender)
  const mine = [...choices.entries()]
    .filter(([id]) => state.dragons[id]?.owner === player)
    .map(([dragonId, options]) => ({ dragonId, options }))

  // A player whose dragons all settled while others were declaring owes nothing.
  if (mine.length === 0) return null
  return { kind: 'dragon_target', player, slot: attack.slot, choices: mine }
}

function applyDragonTarget(
  state: GameState,
  targets: Readonly<Record<DragonId, DragonId>>,
): GameState {
  const attack = dragonAttackOf(state)
  const pending = dragonTargetPending(state, attack)
  if (pending?.kind !== 'dragon_target') {
    throw new IllegalActionError('no dragon is waiting to declare a target')
  }

  const declared: Record<DragonId, DragonTarget> = { ...attack.targets }
  for (const choice of pending.choices) {
    const against = targets[choice.dragonId]
    if (against === undefined || !choice.options.includes(against)) {
      throw new IllegalActionError(`${choice.dragonId} must declare against an eligible dragon`)
    }
    declared[choice.dragonId] = { kind: 'dragon', dragonId: against }
  }

  // Rebuilt field by field rather than spread-with-undefined: `exactOptionalPropertyTypes`
  // is on, and a written `declaring: undefined` is a present key in the golden digest.
  const left = (attack.declaring ?? []).filter((p) => p !== pending.player)
  const { declaring: _dropped, ...rest } = attack
  return withDragonAttack(state, {
    ...rest,
    targets: declared,
    ...(left.length > 0 ? { declaring: left } : {}),
  })
}

/** Step 3: every attacking dragon throws one face, and follows its own rerolls. */
function rollDragonAttack(state: GameState, attack: DragonAttackState): GameState {
  const slot = attack.slot
  const marching = attack.defender
  const targets = new Map(Object.entries(attack.targets))

  let rng = state.rng
  const rolls: DragonRoll[] = []
  for (const dragon of dragonsAt(state, slot)) {
    const target = targets.get(dragon.id)
    if (target === undefined) continue
    const [rolled, next] = rollDragon(dragon.id, dragon.dieId, target.kind === 'dragon', rng)
    rng = next
    rolls.push(...rolled)
  }

  const entries = dragonsAt(state, slot).flatMap((dragon) => {
    const target = targets.get(dragon.id)
    if (target === undefined) return []
    const mine = rolls.filter((roll) => roll.dragonId === dragon.id)
    const victim = target.kind === 'dragon' ? state.dragons[target.dragonId] : undefined
    return [
      {
        dragonId: dragon.id,
        dieId: dragon.dieId,
        target:
          victim === undefined
            ? ({ kind: 'army' } as const)
            : ({ kind: 'dragon', dieId: victim.dieId } as const),
        faces: mine.map((roll) => ({ face: roll.faceIndex, icon: rolledIcon(state, roll) })),
        damage: dragonTotals(state, mine, target.kind === 'dragon').damage,
      },
    ]
  })

  const logged = withLog(
    { ...state, rng },
    { kind: 'dragon_attack', slot, defender: marching, dragons: entries },
  )

  return withDragonAttack(logged, { ...attack, step: 'breath', rolls, resolved: 0 })
}

/**
 * Step 4: one breath, resolved against the army.
 *
 * "Each dragon breath is resolved one at a time, by killing the required
 * health-worth of units. After units have been killed, apply all elemental breath
 * effects" -- so the kill comes first and the element second, which is what makes
 * Fire's "roll the units killed by this breath" answerable at all.
 */
function breathPending(state: GameState, attack: DragonAttackState): Pending | null {
  const owed = breathsOwed(state, attack)
  const dragonId = owed[attack.resolved]
  if (dragonId === undefined) return null

  const army = armyAt(state, attack.defender, attack.slot)
  const health = Math.min(BREATH_KILL_HEALTH, healthsOf(army).reduce((a, b) => a + b, 0))
  if (health === 0) return null

  return { kind: 'dragon_breath', player: attack.defender, slot: attack.slot, dragonId, health }
}

function applyDragonBreath(state: GameState, unitIds: readonly UnitId[]): GameState {
  const attack = dragonAttackOf(state)
  const pending = breathPending(state, attack)
  if (pending?.kind !== 'dragon_breath') {
    throw new IllegalActionError('no dragon breath is waiting for its victims')
  }

  const army = armyAt(state, attack.defender, attack.slot)
  const problem = damageAssignmentProblem(army, pending.health, unitIds)
  if (problem !== null) throw new IllegalActionError(problem)

  const dragon = state.dragons[pending.dragonId]
  if (dragon === undefined) throw new Error(`no such dragon ${pending.dragonId}`)
  const element = elementOf(dragon)

  const outcome = killUnits(state, unitIds)
  // The breath's own line names only who really died: a replanted Treefolk (Phase 8)
  // or a regrown one never did, and "Fire breath kills Oak" beside "Oak takes root in
  // your reserves" is a log contradicting itself. Those get their own lines after it.
  const logged = withLog(
    outcome.state,
    {
      kind: 'dragon_breath',
      player: attack.defender,
      dragonId: pending.dragonId,
      element,
      unitIds: killedIds(outcome, unitIds),
    },
    ...deathEntries(outcome, attack.defender, attack.slot, unitIds).filter(
      (entry) => entry.kind !== 'units_killed',
    ),
  )

  // Fire alone needs the dead to roll again; the other four are a duration effect
  // on the army and take no decision at all.
  if (BREATH_EFFECT[element] === 'bury_killed') {
    return withDragonAttack(logged, { ...attack, step: 'breath_bury', burning: unitIds })
  }

  return withDragonAttack(withBreathEffect(logged, attack, element), {
    ...attack,
    resolved: attack.resolved + 1,
  })
}

/**
 * The four breaths that are a duration effect (p. 20).
 *
 * Each is a `Modifier` on the army where it stands, expiring at the start of that
 * army's own next turn -- which is the marching player's, since the army under
 * attack is theirs. Halving is a `divide`, so pipeline step 7's one-divider-per-type
 * rule makes two different breaths stack and two of a kind not, with no new code.
 */
function withBreathEffect(
  state: GameState,
  attack: DragonAttackState,
  element: DragonElement,
): GameState {
  const effect = BREATH_EFFECT[element]
  if (effect === 'bury_killed') return state

  const modifiers: readonly Modifier[] =
    effect === 'halve_melee'
      ? [{ kind: 'divide', resultType: 'melee', by: 2 }]
      : effect === 'halve_missile'
        ? [{ kind: 'divide', resultType: 'missile', by: 2 }]
        : effect === 'halve_maneuver'
          ? [{ kind: 'divide', resultType: 'maneuver', by: 2 }]
          : ignoreIdsModifiers()

  const added: Effect = {
    source: BREATH_NAME[element],
    target: { kind: 'army', player: attack.defender, army: attack.slot },
    modifiers,
    expiresAtStartOfTurnOf: attack.defender,
  }

  return withLog({ ...state, effects: [...state.effects, added] }, {
    kind: 'dragon_breath_effect',
    player: attack.defender,
    element,
    slot: attack.slot,
  })
}

/**
 * Fire's second half: "roll the units killed by this dragon's breath attack. Those
 * that do not generate a save result are buried."
 *
 * A sub-roll, the seam Seize and Smother already use -- and **not** `killAndBury`,
 * despite that function's doc comment naming Fire breath. The kill above was
 * unconditional; only the burial is escapable, and only per unit.
 */
function resolveBreathBury(state: GameState): GameState {
  const attack = dragonAttackOf(state)
  const burning = attack.burning ?? []

  // Rise from the Ashes may already have taken some of them out of the DUA.
  const inDua = burning.filter((id) => state.units[id]?.location.kind === 'dua')
  const inputs = inDua.map((id) => unitRoll(state, id))
  const [rolls, rng] = rollUnits(inputs, 'save', SAVE_SUB_ROLL, state.rng, state.ruleSet)

  const doomed = rolls.filter((sub) => (sub.roll?.total ?? 0) === 0).map((sub) => sub.unitId)
  const burial = doomed.length > 0 ? buryUnits({ ...state, rng }, doomed) : null
  const buried = burial?.state ?? { ...state, rng }

  // The roll itself, saved dice and failed ones alike. It used to be logged only
  // through its consequence: a failure wrote "buried" with no dice, and a success
  // wrote nothing -- so a Treefolk that saved looked like one that was never rolled,
  // which is the Replanting silence of Phase 8 a second time.
  const rolled = withLog(
    buried,
    ...(inDua.length > 0
      ? [
          {
            kind: 'sai_sub_roll',
            player: attack.defender,
            source: BREATH_NAME.fire,
            slot: attack.slot,
            test: 'save',
            dice: rolls.flatMap((sub) => sub.roll?.dice ?? []),
            escaped: rolls.filter((sub) => (sub.roll?.total ?? 0) > 0).map((sub) => sub.unitId),
            fate: 'bury',
          } as const,
        ]
      : []),
  )

  // A Phoenix that fails the save still rolls Rise from the Ashes on its way to the BUA.
  const logged =
    burial === null ? rolled : withLog(rolled, ...buryEntries(burial, attack.defender, doomed, 'dragon_fire'))

  const withEffect = withBreathEffect(logged, attack, 'fire')
  const next = withDragonAttack(withEffect, { ...attack, step: 'breath', resolved: attack.resolved + 1 })
  // `burning` is dropped by omission, the way `combat.attack` is.
  return next
}

/** A sub-roll looking for a save icon: Fire breath's burial check. */
const SAVE_SUB_ROLL: RollContext = {
  purpose: { kind: 'save', against: null },
  isCounter: false,
  isSubRoll: true,
}

/** Step 5: one treasure, one promotion, and the army may decline it. */
function treasurePending(state: GameState, attack: DragonAttackState): Pending | null {
  if (attack.resolved >= treasuresOwed(state, attack)) return null

  const promotions: PromotionPair[] = []
  for (const unit of armyAt(state, attack.defender, attack.slot)) {
    for (const partner of promotionPartners(state, unit.id)) {
      promotions.push({ unitId: unit.id, partnerId: partner.id })
    }
  }
  if (promotions.length === 0) return null

  return { kind: 'dragon_treasure', player: attack.defender, slot: attack.slot, promotions }
}

function applyDragonTreasure(state: GameState, pair: PromotionPair | null): GameState {
  const attack = dragonAttackOf(state)
  const pending = treasurePending(state, attack)
  if (pending?.kind !== 'dragon_treasure') {
    throw new IllegalActionError('no treasure is offering a promotion')
  }

  const advanced = withDragonAttack(state, { ...attack, resolved: attack.resolved + 1 })
  if (pair === null) return advanced

  if (!pending.promotions.some((p) => p.unitId === pair.unitId && p.partnerId === pair.partnerId)) {
    throw new IllegalActionError(`${pair.unitId} cannot promote into ${pair.partnerId}`)
  }
  const promoted = promote(advanced, [pair])
  return withLog(promoted, {
    kind: 'units_promoted',
    player: attack.defender,
    pairs: [pair],
    source: 'dragon_treasure',
  })
}

/** Step 6: the army's one combination roll, and the allocation it owes. */
function armyRollPending(state: GameState, attack: DragonAttackState): Pending | null {
  const dice = attack.armyDice
  if (dice === undefined) throw new Error('the army has not rolled yet')

  const { ids, flexible, shields } = rollPools(dice, dragonRollSpec(state, attack), state.ruleSet)
  if (ids === 0 && flexible === 0 && shields === 0) return null

  return {
    kind: 'dragon_allocate',
    player: attack.defender,
    slot: attack.slot,
    ids,
    flexible,
    // Flaming Shields (Phase 8): the one roll where converting saves costs something,
    // so the one place it is asked. Omitted when there is nothing to convert.
    ...(shields > 0 ? { shields } : {}),
  }
}

/**
 * The army's combination roll (p. 18): melee, missile and save at once.
 *
 * It is an army roll like any other, so it goes through `armyRoll` for its
 * modifiers -- the eighth face's ID doubling and any breath already applied this
 * very attack, which is why the breaths resolve first.
 */
function dragonRollSpec(
  state: GameState,
  attack: DragonAttackState,
  answer?: Extract<GameAction, { kind: 'dragon_allocate' }>,
): RollSpec {
  const { modifiers } = armyRoll(state, attack.defender, attack.slot, 'melee')

  // `armyRoll` takes one result type and doubles IDs in that one. The eighth face
  // doubles them "when rolling anything there", so a combination roll needs the
  // other two as well -- without this a held terrain would double the melee share
  // and quietly not the missile or save ones.
  const alsoDoubled = doublesIds(state, attack.defender, attack.slot)
    ? DRAGON_ROLL_KINDS.filter((kind) => kind !== 'melee').map(doubleIdsModifier)
    : []

  return {
    kinds: DRAGON_ROLL_KINDS,
    modifiers: [...modifiers, ...alsoDoubled],
    context: { purpose: { kind: 'dragon_attack' }, isCounter: false },
    idAllocation: answer?.ids ?? { melee: 0, missile: 0, save: 0 },
    ...(answer?.flexible !== undefined ? { saiResults: answer.flexible } : {}),
    ...(answer?.savesAsMelee !== undefined && answer.savesAsMelee > 0
      ? { savesAsMelee: answer.savesAsMelee }
      : {}),
  }
}

function applyDragonAllocate(
  state: GameState,
  action: Extract<GameAction, { kind: 'dragon_allocate' }>,
): GameState {
  const attack = dragonAttackOf(state)
  const pending = armyRollPending(state, attack)
  if (pending?.kind !== 'dragon_allocate') {
    throw new IllegalActionError('no dragon roll is waiting to be allocated')
  }

  const spent = (record: Readonly<Partial<Record<ResultType, number>>>) =>
    DRAGON_ROLL_KINDS.reduce((sum, kind) => sum + (record[kind] ?? 0), 0)

  if (spent(action.flexible) !== pending.flexible) {
    throw new IllegalActionError(
      `the split spends ${spent(action.flexible)} of ${pending.flexible} flexible results`,
    )
  }
  // `allocateIds` enforces the ID pool being spent exactly, and says so better.
  const converted = action.savesAsMelee ?? 0
  if (!Number.isInteger(converted) || converted < 0 || converted > (pending.shields ?? 0)) {
    throw new IllegalActionError(
      `Flaming Shields can count ${pending.shields ?? 0} saves as melee here, not ${converted}`,
    )
  }

  return resolveArmyRoll(state, attack, action)
}

/** Steps 6 and 7 meeting: the totals, then the damage both ways. */
function resolveArmyRoll(
  state: GameState,
  attack: DragonAttackState,
  answer?: Extract<GameAction, { kind: 'dragon_allocate' }>,
): GameState {
  const dice = attack.armyDice
  if (dice === undefined) throw new Error('the army has not rolled yet')

  const outcome = resolveFaces(dice, dragonRollSpec(state, attack, answer), state.ruleSet)
  // **This had no guard at all until Phase 7f**, so an effect here was dropped in
  // silence -- which is what a Wild Growth or a Firewalking on a dragon roll had been
  // doing since Phase 6. Nothing generates one now (see `noSideDecision` in `sai.ts`),
  // and if something ever does, this is what says so.
  expectNoEffects(asResult(outcome, 'save'), "the army's dragon roll")

  const totals = {
    melee: outcome.totals.melee ?? 0,
    missile: outcome.totals.missile ?? 0,
    save: outcome.totals.save ?? 0,
  }

  const logged = withLog(state, {
    kind: 'dragon_roll',
    player: attack.defender,
    slot: attack.slot,
    dice: outcome.dice,
    totals,
    ...(outcome.countedAs !== undefined ? { flamingShields: outcome.countedAs } : {}),
    ...(outcome.math !== undefined ? { math: outcome.math } : {}),
  })

  return withDragonAttack(logged, { ...attack, step: 'damage', totals })
}

/** The dragons the army's results could be spent on, and what each needs to die. */
function splitTargets(state: GameState, attack: DragonAttackState): readonly DragonDamageTarget[] {
  return armyAttackers(state, attack).map((dragonId) => ({
    dragonId,
    threshold: killThreshold(dragonTotals(state, rollsOf(attack, dragonId), false).bellyUp),
  }))
}

/**
 * Step 7, outgoing: which dragons the army's melee and missile are spent on.
 *
 * **Only asked when there is a choice.** Against a single dragon there is nothing to
 * decide -- results have no other use, so every one of them goes at the only target
 * there is and whether it dies is arithmetic. Asking anyway would be the same
 * mistake as offering a damage assignment too small to kill anything: a decision
 * with one legal answer is not a decision. `stepDragonAttack` resolves that case
 * itself.
 */
function damageSplitPending(state: GameState, attack: DragonAttackState): Pending | null {
  const totals = attack.totals
  if (totals === undefined) throw new Error('the army roll has not been totalled')
  if (totals.melee === 0 && totals.missile === 0) return null

  const targets = splitTargets(state, attack)
  if (targets.length < 2) return null

  return {
    kind: 'dragon_damage_split',
    player: attack.defender,
    slot: attack.slot,
    melee: totals.melee,
    missile: totals.missile,
    targets,
  }
}

/**
 * The one-dragon case, worked out rather than asked: everything the army rolled
 * goes at the only dragon present, and the two types are still never combined.
 */
function loneDragonAnswer(state: GameState, attack: DragonAttackState): readonly DragonAnswer[] {
  const totals = attack.totals
  const [only] = splitTargets(state, attack)
  if (only === undefined || totals === undefined) return []
  return [answerOf(only, totals.melee, totals.missile)]
}

/** One dragon fighting another, as `dragon_damage` logs it. */
type DragonDuel = NonNullable<Extract<LogEntry, { kind: 'dragon_damage' }>['duels']>[number]

/** "Either melee or missile results -- they may not be combined": each against the
 *  threshold on its own. */
function answerOf(target: DragonDamageTarget, melee: number, missile: number): DragonAnswer {
  return {
    dragonId: target.dragonId,
    melee,
    missile,
    threshold: target.threshold,
    slain: melee >= target.threshold || missile >= target.threshold,
  }
}

function applyDragonDamageSplit(
  state: GameState,
  action: Extract<GameAction, { kind: 'dragon_damage_split' }>,
): GameState {
  const attack = dragonAttackOf(state)
  const pending = damageSplitPending(state, attack)
  if (pending?.kind !== 'dragon_damage_split') {
    throw new IllegalActionError('no dragon damage is waiting to be split')
  }

  const ids = new Set(pending.targets.map((t) => t.dragonId))
  for (const record of [action.melee, action.missile]) {
    for (const [dragonId, amount] of Object.entries(record)) {
      if (!ids.has(dragonId)) {
        throw new IllegalActionError(`${dragonId} is not attacking this army`)
      }
      if (!Number.isInteger(amount) || amount < 0) {
        throw new IllegalActionError(`${dragonId} is given ${amount}, which is not a count`)
      }
    }
  }
  const spent = (record: Readonly<Record<DragonId, number>>) =>
    Object.values(record).reduce((a, b) => a + b, 0)
  if (spent(action.melee) > pending.melee) {
    throw new IllegalActionError(`the split spends ${spent(action.melee)} of ${pending.melee} melee`)
  }
  if (spent(action.missile) > pending.missile) {
    throw new IllegalActionError(
      `the split spends ${spent(action.missile)} of ${pending.missile} missile`,
    )
  }

  // "The damage to slay a dragon must come from either melee or missile results --
  // they may not be combined", so each type is compared to the threshold on its own.
  const answered = pending.targets.map((target) =>
    answerOf(target, action.melee[target.dragonId] ?? 0, action.missile[target.dragonId] ?? 0),
  )

  return finishDragonDamage(state, attack, answered)
}

/**
 * Step 7's other half and steps 8 and 9: dragon-vs-dragon damage, the army's
 * casualties, the promotion a slaying earns, and the wings home.
 *
 * Dragons and armies inflict damage simultaneously, so the dragons killed here
 * still did what they rolled -- their damage is already in `armyDamage` before any
 * of them is sent home.
 */
function finishDragonDamage(
  state: GameState,
  attack: DragonAttackState,
  answered: readonly DragonAnswer[],
): GameState {
  const totals = attack.totals
  const save = totals?.save ?? 0
  const slainByArmy = answered.filter((a) => a.slain).map((a) => a.dragonId)

  // Incoming: every dragon attacking the army, less the army's own saves.
  const attackers = armyAttackers(state, attack)
  const inflicted = attackers.reduce(
    (sum, id) => sum + dragonTotals(state, rollsOf(attack, id), false).damage,
    0,
  )
  const armyDamage = Math.max(0, inflicted - save)

  // Dragon against dragon: each one's damage against the other's threshold.
  const duels: DragonDuel[] = []
  for (const dragon of dragonsAt(state, attack.slot)) {
    const target = attack.targets[dragon.id]
    if (target?.kind !== 'dragon') continue
    const victim = state.dragons[target.dragonId]
    if (victim === undefined) continue
    const damage = dragonTotals(state, rollsOf(attack, dragon.id), true).damage
    const threshold = killThreshold(dragonTotals(state, rollsOf(attack, victim.id), true).bellyUp)
    duels.push({ dragonId: dragon.id, targetId: victim.id, damage, threshold, slain: damage >= threshold })
  }
  const slainByDragon = duels.filter((d) => d.slain).map((d) => d.targetId)

  // The arithmetic, logged before anybody is sent home -- the dragons slain here still
  // did what they rolled, and the line says so in the order it happened.
  const shown =
    attackers.length > 0 || answered.length > 0 || duels.length > 0
      ? withLog(state, {
          kind: 'dragon_damage',
          player: attack.defender,
          slot: attack.slot,
          ...(attackers.length > 0 ? { incoming: { inflicted, saves: save, damage: armyDamage } } : {}),
          ...(answered.length > 0 ? { answered } : {}),
          ...(duels.length > 0 ? { duels } : {}),
        })
      : state

  const slain = [...new Set([...slainByArmy, ...slainByDragon])]
  let next = shown
  for (const dragonId of slain) {
    next = sendDragonHome(next, dragonId, 'slain')
  }

  // Step 8: "if an army kills one or more dragons, it may promote as many units as
  // possible" -- a maximal matching, which is Phase 2's machinery and no decision.
  if (slainByArmy.length > 0) {
    const survivors = armyAt(next, attack.defender, attack.slot).map((unit) => unit.id)
    const pairs = promotionMatching(next, attack.defender, survivors)
    if (pairs.length > 0) {
      next = withLog(promote(next, pairs), {
        kind: 'units_promoted',
        player: attack.defender,
        pairs,
        source: 'dragon_slain',
      })
    }
  }

  // Step 9: any dragon that rolled Wing and is still here flies home.
  for (const dragon of dragonsAt(next, attack.slot)) {
    if (dragonTotals(next, rollsOf(attack, dragon.id), attack.targets[dragon.id]?.kind === 'dragon')
      .flies) {
      next = sendDragonHome(next, dragon.id, 'flew')
    }
  }

  return withDragonAttack(next, { ...attack, step: 'assign', armyDamage })
}

/** A dragon leaves the board the only two ways it can, and the pool is one-way. */
function sendDragonHome(state: GameState, dragonId: DragonId, why: 'slain' | 'flew'): GameState {
  const dragon = state.dragons[dragonId]
  if (dragon === undefined || dragon.location.kind !== 'terrain') return state
  return withLog(
    {
      ...state,
      dragons: { ...state.dragons, [dragonId]: { ...dragon, location: { kind: 'pool' } } },
    },
    { kind: 'dragon_home', dragonId, dieId: dragon.dieId, why },
  )
}

function applyDragonAssign(state: GameState, unitIds: readonly UnitId[]): GameState {
  const attack = dragonAttackOf(state)
  const pending = dragonAssignPending(state, attack)
  if (pending?.kind !== 'assign_damage') {
    throw new IllegalActionError('no dragon damage is waiting to be assigned')
  }

  const army = armyAt(state, attack.defender, attack.slot)
  const problem = damageAssignmentProblem(army, pending.damage, unitIds)
  if (problem !== null) throw new IllegalActionError(problem)

  const outcome = killUnits(state, unitIds)
  const killed = withLog(
    outcome.state,
    ...deathEntries(outcome, attack.defender, attack.slot, unitIds),
  )

  return endDragonAttack(killed, attack)
}

/** Step 7, incoming: the army assigning what the dragons did to it. */
function dragonAssignPending(state: GameState, attack: DragonAttackState): Pending | null {
  const damage = attack.armyDamage ?? 0
  if (damage === 0) return null
  const army = armyAt(state, attack.defender, attack.slot)
  if (maxAbsorbable(healthsOf(army), damage) === 0) return null
  return { kind: 'assign_damage', player: attack.defender, slot: attack.slot, damage }
}

/**
 * One step of the Dragon Attack Phase, or the same state when it needs an answer.
 *
 * Each branch either does something that takes no decision and returns a changed
 * state, or hands back a pending. The loop in `stepGame` keeps calling until one of
 * those is a pending or the phase is over.
 */
function stepDragonAttack(state: GameState): GameState {
  const marching = state.turn.marching
  const attack = state.turn.dragonAttack

  if (attack === undefined) {
    const left = dragonsLeft(state)
    const only = left[0]
    if (only === undefined) return withTurn(state, { phase: 'species_abilities' })
    // "If dragons attack at more than one terrain, the marching player chooses the
    // order" (p. 18). With one terrain there is nothing to choose, so nothing is asked.
    if (left.length > 1) {
      return { ...state, pending: { kind: 'dragon_order', player: marching, options: left } }
    }
    return beginDragonAttack(state, only)
  }

  switch (attack.step) {
    case 'declare': {
      const pending = dragonTargetPending(state, attack)
      if (pending !== null) return { ...state, pending }
      return rollDragonAttack(state, attack)
    }

    case 'breath': {
      const pending = breathPending(state, attack)
      if (pending !== null) return { ...state, pending }
      return withDragonAttack(state, { ...attack, step: 'treasure', resolved: 0 })
    }

    case 'breath_bury':
      return resolveBreathBury(state)

    case 'treasure': {
      const pending = treasurePending(state, attack)
      if (pending !== null) return { ...state, pending }
      return withDragonAttack(state, { ...attack, step: 'army_roll', resolved: 0 })
    }

    case 'army_roll': {
      // "Skip this step if no army is being attacked" (p. 18 step 6). Two dragons
      // that found each other fight alone: the army does not get to join in, and --
      // the half a browser caught -- it must not *roll*, or it burns randomness the
      // rules never spend and hands its melee to a damage split it has no part in.
      if (armyAttackers(state, attack).length === 0) {
        return withDragonAttack(state, {
          ...attack,
          step: 'damage',
          totals: { melee: 0, missile: 0, save: 0 },
        })
      }
      if (attack.armyDice === undefined) {
        const { units } = armyRoll(state, attack.defender, attack.slot, 'melee')
        const [dice, rng] = rollFaces(units, state.rng)
        // Flashfire first: it is a step-3 reroll, and the allocation at step 5 spends
        // the faces it may have changed.
        return withDragonAttack({ ...state, rng }, { ...attack, step: 'army_flashfire', armyDice: dice })
      }
      const pending = armyRollPending(state, attack)
      if (pending !== null) return { ...state, pending }
      // Nothing to allocate: resolve the same faces straight through.
      return resolveArmyRoll(state, attack)
    }

    // The fourth place an army roll rests between landing and being counted, and the
    // only one outside an exchange.
    case 'army_flashfire': {
      const budget = flashfireBudget(state, attack.defender, attack.slot)
      const dice = attack.armyDice ?? []
      if (budget === 0 || dice.length === 0) {
        return withDragonAttack(state, { ...attack, step: 'army_roll' })
      }
      const options = [...new Set(dice.map((die) => die.unitId))]
      return {
        ...state,
        pending: {
          kind: 'flashfire',
          player: attack.defender,
          slot: attack.slot,
          budget: Math.min(budget, options.length),
          options,
        },
      }
    }

    case 'damage': {
      const pending = damageSplitPending(state, attack)
      if (pending !== null) return { ...state, pending }
      return finishDragonDamage(state, attack, loneDragonAnswer(state, attack))
    }

    case 'assign': {
      const pending = dragonAssignPending(state, attack)
      if (pending !== null) return { ...state, pending }
      return endDragonAttack(state, attack)
    }
  }
}

/** This terrain is done: drop the working state and look for the next one. */
/** Terrains whose dragons have not attacked yet this turn, in board order. */
function dragonsLeft(state: GameState): readonly TerrainSlot[] {
  const done = state.turn.dragonsDone ?? []
  return dragonAttackSlots(state, state.turn.marching).filter((slot) => !done.includes(slot))
}

function endDragonAttack(state: GameState, attack: DragonAttackState): GameState {
  // Marked done rather than compared by board index: the marching player picks the
  // order now, so "after this one" is no longer a fact about where the terrain sits.
  const done = withTurn(withDragonAttack(state, null), {
    dragonsDone: [...(state.turn.dragonsDone ?? []), attack.slot],
  })
  // `stepDragonAttack` picks up whatever is left, asking about the order if more than
  // one terrain still qualifies.
  return done
}

function applyDragonOrder(state: GameState, slot: TerrainSlot): GameState {
  if (!dragonsLeft(state).includes(slot)) {
    throw new IllegalActionError(`no dragon attack is waiting at ${slot}`)
  }
  return beginDragonAttack(state, slot)
}

/**
 * One step of the game. Returns the same object when nothing can happen without a
 * decision, which is how the advance loop knows to stop.
 */
export function stepGame(state: GameState): GameState {
  // Accelerated Growth (Phase 9b), **before everything below**. A kill has already
  // moved the dying dice to the DUA, and the answer may bring a partner up in their
  // place: pruning first would end a Stone Skin on an army that is about to have a unit
  // again, and the victory check first could end the game on an army its owner was
  // about to refill. Nothing here rolls or moves before the offer is answered.
  const growth = growthStep(state)
  if (growth !== state) return growth

  // "The effect ends if there are no units remaining in the army. This is checked at
  // the end of each action" (p. 28). `applyAction` never sets `pending`, so this runs
  // after every action. Like `syncCaptures` it must return the same object when there
  // is nothing to drop, or the advance loop never settles.
  //
  // **Before the victory check, and that is not tidiness.** The action that wins the
  // game is still an action, and the army it emptied may have been carrying a
  // Galeforce; with the check first, `stepGame` returned the finished game and the
  // effect outlived the army forever, which `validateState` calls a breach and is
  // right to. Found by the Phase 4e fuzz, in a Satyr mirror -- the first forces that
  // could both cast an effect and be wiped out while it was live.
  const pruned = pruneEffects(state)
  if (pruned !== state) return pruned

  const victory = findVictory(state)
  if (victory !== null) {
    return withLog(
      {
        ...withTurn(state, { phase: 'game_over' }),
        winner: victory.player,
        pending: null,
      },
      { kind: 'victory', player: victory.player, reason: victory.reason },
    )
  }

  const synced = syncCaptures(state)
  if (synced !== state) return synced

  switch (state.turn.phase) {
    // Before the first turn, under `rollOff: 'choice'` (v1 Phase 10e): the winner of the
    // roll-off is choosing, and then perhaps the loser. Answering settles the Frontier,
    // rolls the starting faces and moves the phase on, so this only ever asks.
    case 'setup': {
      const pending = rollOffPending(state)
      if (pending === null) throw new Error('the setup phase has no roll-off choice open')
      return { ...state, pending }
    }

    // No longer a no-op: effects with a duration end "at the beginning of your next
    // turn", which is here. It takes no decision, so it expires and moves on in one
    // step.
    case 'effects_expire':
      return withTurn(expireEffects(state), { phase: 'eighth_face' })

    // City and Temple, since Phase 5e -- the marching player's own held terrains,
    // which is why this asks nothing about the opponent's. Dragons (Phase 6) are
    // still a no-op below.
    case 'eighth_face': {
      const pending = eighthFacePending(state)
      if (pending !== null) return { ...state, pending }
      return withTurn(state, { phase: 'dragon_attack' })
    }
    // Real since Phase 6, and still a no-op when the rules have no dragons -- which
    // is every `V0_RULES` game, so the 25 goldens never enter it.
    case 'dragon_attack':
      if (!state.ruleSet.dragons) return withTurn(state, { phase: 'species_abilities' })
      return stepDragonAttack(state)

    // v1 Phase 8. Ungated, like `effects_expire` was in v0: none of the four abilities
    // in this box acts here -- they fire on a counter-maneuver, a death, the Retreat
    // Step and a melee roll -- so the phase takes no decision and moves straight on.
    // Every game passes through it, the 25 goldens included, and none rests on it.
    case 'species_abilities':
      return withTurn(state, { phase: 'march', marchIndex: 0, marchStep: 'select_army' })

    case 'march':
      return stepMarch(state)

    case 'reserves_reinforce': {
      const player = state.turn.marching
      const inReserve = livingUnits(state, player).filter((u) => u.location.kind === 'reserve')
      if (inReserve.length === 0) return withTurn(state, { phase: 'reserves_retreat' })
      return { ...state, pending: { kind: 'reinforce', player } }
    }

    case 'reserves_retreat': {
      const player = state.turn.marching
      const flights = airFlightOffers(state, player)
      return {
        ...state,
        pending: { kind: 'retreat', player, ...(flights.length > 0 ? { flights } : {}) },
      }
    }

    case 'game_over':
      return state
  }
}

// --- applying decisions ------------------------------------------------------

function moveTerrain(state: GameState, slot: TerrainSlot, direction: Direction): GameState {
  const terrain = state.terrains[slot]
  const from = terrain.face
  const to = (direction === 'up' ? from + 1 : from - 1) as TerrainFace

  if (to < 1 || to > 8) {
    throw new IllegalActionError(`cannot move ${slot} ${direction} from face ${from}`)
  }

  const player = state.turn.marching
  const entries: LogEntry[] = [{ kind: 'terrain_moved', slot, from, to, by: player }]

  // Moving off the eighth face loses the capture; moving onto it takes one.
  if (from === 8 && terrain.capturedBy !== null) {
    entries.push({ kind: 'terrain_lost', slot, from: terrain.capturedBy, reason: 'maneuvered' })
  }
  const capturedBy = to === 8 ? player : null
  if (to === 8) entries.push({ kind: 'terrain_captured', slot, by: player })

  return withLog(
    { ...state, terrains: { ...state.terrains, [slot]: { ...terrain, face: to, capturedBy } } },
    ...entries,
  )
}

function applyMarchArmy(state: GameState, army: ArmyRef | null): GameState {
  const player = state.turn.marching
  const options = marchableArmies(state, player)

  if (army === null) {
    return endMarch(withLog(state, { kind: 'march_skipped', player, index: state.turn.marchIndex }))
  }
  if (!options.includes(army)) {
    throw new IllegalActionError(
      `${player} cannot march ${army}` +
        (state.turn.armiesMarched.includes(army)
          ? ' -- it already marched this turn'
          : ` -- available: ${options.join(', ') || 'none'}`),
    )
  }

  return withTurn(
    withLog(state, { kind: 'march_begin', player, army, index: state.turn.marchIndex }),
    {
      marchingArmy: army,
      armiesMarched: [...state.turn.armiesMarched, army],
      marchStep: 'declare_maneuver',
    },
  )
}

function applyDeclareManeuver(state: GameState, maneuver: boolean): GameState {
  if (!maneuver) return withTurn(state, { marchStep: 'action' })

  const player = state.turn.marching
  const slot = marchingSlot(state)
  const logged = withLog(state, { kind: 'maneuver_declared', player, slot })

  // Only an opposing army at the same terrain can contest.
  const canContest = armyAt(state, opponentOf(player), slot).length > 0
  return withTurn(logged, { marchStep: canContest ? 'contest_maneuver' : 'choose_direction' })
}

function applyContest(state: GameState, contest: boolean): GameState {
  const player = state.turn.marching
  const slot = marchingSlot(state)

  if (!contest) {
    return withTurn(withLog(state, { kind: 'maneuver_allowed', slot }), {
      marchStep: 'choose_direction',
    })
  }

  // Steps 1 and 3 for each army, in the order `rollArmy` drew them before Phase 8 --
  // marcher, then contester -- so a game with no Rapid Growth in it draws die for die
  // what it always did. The goldens are what prove it.
  const marcher = armyRoll(state, player, slot, 'maneuver')
  const contester = armyRoll(state, opponentOf(player), slot, 'maneuver')
  const [marcherFaces, afterMarcher] = rollFaces(marcher.units, state.rng)
  const [marcherDice, afterMarcherSweep] = rerollSweep(
    marcherFaces,
    maneuverSpec(marcher.modifiers, MARCHING_ROLL),
    state.ruleSet,
    afterMarcher,
  )
  const [defenderFaces, afterDefender] = rollFaces(contester.units, afterMarcherSweep)
  const [defenderDice, afterDefenderSweep] = rerollSweep(
    defenderFaces,
    maneuverSpec(contester.modifiers),
    state.ruleSet,
    afterDefender,
  )
  const rolled: GameState = { ...state, rng: afterDefenderSweep }

  // Rapid Growth: worth asking only when there is a die to reroll and the contester
  // is not already winning -- the marcher wins a tie, so a tie is still losing. A
  // reroll cannot improve a roll that has won, and an army that has won has nothing
  // to ask about (house rule, `RULES-V0.md` section 16).
  const totals = contestTotals(rolled, marcherDice, defenderDice)
  if (
    totals.defender.total <= totals.marcher.total &&
    rapidGrowthOptions(rolled, defenderDice).length > 0
  ) {
    return withTurn(rolled, {
      marchStep: 'rapid_growth',
      contest: { marcher: marcherDice, defender: defenderDice },
    })
  }

  return finishContest(rolled, marcherDice, defenderDice)
}

const maneuverSpec = (modifiers: readonly Modifier[], context: RollContext = MANEUVER_ROLL): RollSpec => ({
  kinds: ['maneuver'],
  modifiers,
  context,
})

/**
 * Both sides of a contest, resolved from the dice on the table. Pure: the same dice
 * resolve to the same totals whenever they are asked, which is what lets Rapid Growth
 * read them at the pause and `finishContest` read them again after it.
 */
function contestTotals(
  state: GameState,
  marcherDice: readonly RawDie[],
  defenderDice: readonly RawDie[],
) {
  const player = state.turn.marching
  const slot = marchingSlot(state)
  const marcher = armyRoll(state, player, slot, 'maneuver')
  const contester = armyRoll(state, opponentOf(player), slot, 'maneuver')
  const marcherRoll = asResult(
    resolveFaces(marcherDice, maneuverSpec(marcher.modifiers, MARCHING_ROLL), state.ruleSet),
    'maneuver',
  )
  // Wave, rolled by the marcher: X off the counter-maneuvering army's maneuver results
  // (v2 Phase 5c). Read off the marcher's own faces, so Rapid Growth's pause and the
  // decision after it subtract the same number.
  const wave = waveIn(marcherRoll.effects)
  const contesterModifiers =
    wave > 0 ? [...contester.modifiers, waveModifier('maneuver', wave)] : contester.modifiers
  return {
    marcher: marcherRoll,
    defender: asResult(
      resolveFaces(defenderDice, maneuverSpec(contesterModifiers), state.ruleSet),
      'maneuver',
    ),
  }
}

/**
 * Decides the contest from the dice as they finally stand, logs it, and moves on.
 *
 * Where `applyContest` used to end. Split out so the Rapid Growth pause can come back
 * to exactly the same place, and drops `turn.contest` by omission on the way.
 */
function finishContest(
  state: GameState,
  marcherDice: readonly RawDie[],
  defenderDice: readonly RawDie[],
): GameState {
  const slot = marchingSlot(state)
  const { marcher: marcherRoll, defender: defenderRoll } = contestTotals(
    state,
    marcherDice,
    defenderDice,
  )

  // No SAI that applies to a maneuver roll produces an effect in Phase 1, and a
  // contest has nowhere to put one. Phase 4's Firewalking and Teleport will, so this
  // is what stops them being silently dropped here.
  // Wave is the one effect a marching maneuver may carry, and `contestTotals` has
  // already spent it on the other roll.
  expectNoEffects(
    { ...marcherRoll, effects: marcherRoll.effects.filter((effect) => effect.kind !== 'wave') },
    'the maneuver roll of the marching army',
  )
  expectNoEffects(defenderRoll, 'the roll of the counter-maneuvering army')

  // "The highest total wins (the marching army wins a tie)."
  const marcherWins = marcherRoll.total >= defenderRoll.total

  const logged = withLog(state, {
    kind: 'maneuver_contested',
    slot,
    marcher: marcherRoll.total,
    defender: defenderRoll.total,
    marcherWins,
    marcherDice: marcherRoll.dice,
    defenderDice: defenderRoll.dice,
    ...(marcherRoll.math !== undefined ? { marcherMath: marcherRoll.math } : {}),
    ...(defenderRoll.math !== undefined ? { defenderMath: defenderRoll.math } : {}),
  })

  const { contest: _decided, ...turn } = logged.turn
  return {
    ...logged,
    turn: { ...turn, marchStep: marcherWins ? 'choose_direction' : 'action' },
  }
}

const requireContest = (state: GameState): NonNullable<GameState['turn']['contest']> => {
  const contest = state.turn.contest
  if (contest === undefined) throw new Error('no contested maneuver is parked')
  return contest
}

/**
 * Rapid Growth: "when at a terrain that contains earth, Treefolk units that do not roll
 * an SAI result may be re-rolled once when making a counter-maneuver."
 *
 * Every Treefolk die the contester threw that did not come up an SAI, in board order.
 * Empty unless the terrain contains earth and the ability is in the rules being played.
 * Per die (v2 Phase 1): "Treefolk units ... may be re-rolled", so a mixed army's other
 * dice keep their faces.
 *
 * Only a first throw can qualify. A die with a step-3 reroll after it rolled Rend to
 * get one, and Rend is an SAI, so the chain is out by construction; checking the
 * `reroll` mark as well says so rather than leaving it to the data.
 */
function rapidGrowthOptions(state: GameState, defenderDice: readonly RawDie[]): readonly UnitId[] {
  const slot = marchingSlot(state)
  if (!state.ruleSet.speciesAbilities || !terrainHas(state, slot, 'earth')) return []
  const chained = new Set(defenderDice.filter((die) => die.reroll === true).map((d) => d.unitId))
  const eligible = defenderDice
    .filter((die) => die.reroll !== true && !chained.has(die.unitId))
    .filter((die) => faceOf(die).icon !== 'SAI')
    .filter((die) => {
      const unit = state.units[die.unitId]
      return unit !== undefined && unitHasAbility(state.ruleSet, unit, 'Rapid Growth')
    })
    .map((die) => die.unitId)
  return inBoardOrder(state, eligible)
}

/**
 * Throws the chosen dice again, **replacing** their faces -- "the previous results are
 * ignored" -- and decides the contest.
 *
 * Flashfire's mechanism, not Rend's: a step-3 reroll appends a die and both faces
 * count, this one takes the old face off the table. The dice are "selected and
 * re-rolled together", which is one decision rather than one per die, and they roll in
 * board order whatever order they were named in.
 *
 * **House rule:** this does not restart the reroll sweep, for Flashfire's reason
 * (`RULES-V0.md` section 16). Nothing in a maneuver roll rerolls today, so it is a
 * statement rather than a behaviour.
 */
function applyRapidGrowth(state: GameState, unitIds: readonly UnitId[]): GameState {
  if (state.turn.marchStep !== 'rapid_growth') {
    throw new IllegalActionError(`no Rapid Growth is waiting (march step ${state.turn.marchStep})`)
  }
  const contest = requireContest(state)
  const options = rapidGrowthOptions(state, contest.defender)
  for (const id of unitIds) {
    if (!options.includes(id)) {
      throw new IllegalActionError(
        `${id} cannot be re-rolled by Rapid Growth -- it rolled an SAI, or did not roll at all`,
      )
    }
  }
  if (new Set(unitIds).size !== unitIds.length) {
    throw new IllegalActionError('Rapid Growth re-rolls each die once')
  }

  if (unitIds.length === 0) return finishContest(state, contest.marcher, contest.defender)

  let rng = state.rng
  const replaced = new Map<UnitId, RawDie>()
  for (const id of inBoardOrder(state, unitIds)) {
    const unit = state.units[id]
    if (unit === undefined) continue
    const [rolled, next] = rollFaces([unit], rng)
    rng = next
    const die = rolled[0]
    if (die !== undefined) replaced.set(id, die)
  }

  const defender = contest.defender.map((die) => replaced.get(die.unitId) ?? die)
  const logged = withLog(
    { ...state, rng },
    {
      kind: 'rapid_growth',
      player: opponentOf(state.turn.marching),
      slot: marchingSlot(state),
      unitIds: inBoardOrder(state, unitIds),
    },
  )
  return finishContest(logged, contest.marcher, defender)
}

// --- Accelerated Growth (Phase 9b) -------------------------------------------

/** The offer at the head of the queue, with its partners re-checked: an earlier offer's
 *  answer may have brought one of them up already. */
function liveGrowthPartners(state: GameState, offer: GrowthOffer): readonly UnitId[] {
  return offer.partners.filter((id) => state.units[id]?.location.kind === 'dua')
}

/**
 * Raise the oldest Accelerated Growth offer, or settle it with nobody to ask.
 *
 * Returns `state` itself when there is no offer, so `stepGame` can fall through. An
 * offer whose partners have all been spent by an earlier answer is not a question --
 * the dice simply die -- so it is settled here as an empty answer, which draws nothing.
 */
function growthStep(state: GameState): GameState {
  const offer = state.turn.growthOffers?.[0]
  if (offer === undefined) return state
  if (state.pending !== null) return state

  const partners = liveGrowthPartners(state, offer)
  if (partners.length === 0) return settleGrowth(state, offer, [])

  return {
    ...state,
    pending: {
      kind: 'accelerated_growth',
      player: offer.player,
      dying: offer.dying.map((d) => d.unitId),
      partners,
    },
  }
}

function applyAcceleratedGrowth(state: GameState, pairs: readonly PromotionPair[]): GameState {
  const offer = state.turn.growthOffers?.[0]
  if (offer === undefined) throw new IllegalActionError('no Accelerated Growth is waiting')

  const dying = offer.dying.map((d) => d.unitId)
  const partners = liveGrowthPartners(state, offer)
  const seen = new Set<UnitId>()
  for (const pair of pairs) {
    if (!dying.includes(pair.unitId)) {
      throw new IllegalActionError(`${pair.unitId} is not dying under Accelerated Growth`)
    }
    if (!partners.includes(pair.partnerId)) {
      throw new IllegalActionError(`${pair.partnerId} is not a one-health unit in the DUA`)
    }
    if (seen.has(pair.unitId) || seen.has(pair.partnerId)) {
      throw new IllegalActionError('each dying unit and each partner is exchanged at most once')
    }
    seen.add(pair.unitId)
    seen.add(pair.partnerId)
  }

  return settleGrowth(state, offer, pairs)
}

/**
 * The answer: partners come up where the dead stood, and the rest are killed -- logged
 * now, because until now nobody knew whether they died. Declined units under a Flame
 * are buried as well; exchanged ones were never killed and are not.
 */
function settleGrowth(
  state: GameState,
  offer: GrowthOffer,
  pairs: readonly PromotionPair[],
): GameState {
  const units = { ...state.units }
  for (const pair of pairs) {
    const partner = units[pair.partnerId]
    const from = offer.dying.find((d) => d.unitId === pair.unitId)?.from
    if (partner === undefined || from === undefined) continue
    units[pair.partnerId] = {
      ...partner,
      location: from === 'reserve' ? { kind: 'reserve' } : { kind: 'terrain', slot: from },
    }
  }

  const exchanged = pairs.map((pair) => pair.unitId)
  const declined = offer.dying.filter((d) => !exchanged.includes(d.unitId))

  // One kill line per place, the shape every other kill site writes.
  const bySlot = new Map<ArmyRef, UnitId[]>()
  for (const d of declined) bySlot.set(d.from, [...(bySlot.get(d.from) ?? []), d.unitId])
  const killLines: LogEntry[] = [...bySlot].map(([slot, unitIds]) => ({
    kind: 'units_killed',
    player: offer.player,
    slot,
    unitIds,
  }))

  const rest = (state.turn.growthOffers ?? []).slice(1)
  const { growthOffers: _answered, ...turn } = state.turn

  // Fire breath rolls "the units killed by this dragon's breath" for burial, and an
  // exchanged unit was not killed -- so it leaves that list here, where the question of
  // whether it died is settled.
  const attack = turn.dragonAttack
  const dragonAttack =
    attack?.burning === undefined || exchanged.length === 0
      ? attack
      : { ...attack, burning: attack.burning.filter((id) => !exchanged.includes(id)) }

  const settled: GameState = withLog(
    {
      ...state,
      units,
      turn: {
        ...turn,
        ...(dragonAttack === undefined ? {} : { dragonAttack }),
        ...(rest.length > 0 ? { growthOffers: rest } : {}),
      },
    },
    ...(pairs.length > 0 ? [{ kind: 'units_regrown', player: offer.player, pairs } as const] : []),
    ...killLines,
  )

  const toBury = offer.bury === true ? declined.map((d) => d.unitId) : []
  if (toBury.length === 0) return settled

  const buried = buryUnits(settled, toBury)
  return withLog(buried.state, ...buryEntries(buried, offer.player, toBury))
}

function applyDirection(state: GameState, direction: Direction): GameState {
  const slot = marchingSlot(state)
  const options = legalDirections(state.terrains[slot].face)
  if (!options.includes(direction)) {
    throw new IllegalActionError(
      `cannot maneuver ${direction} from face ${state.terrains[slot].face}`,
    )
  }

  const moved = moveTerrain(state, slot, direction)
  // "Any army that successfully maneuvers that terrain takes six points of damage."
  // *After* the terrain turns, because the maneuver is what triggers it -- and only
  // here, because this is the one place a maneuver is known to have succeeded.
  return withTurn(moved, {
    marchStep: thornsAt(moved, slot) > 0 ? 'thorns_damage' : 'action',
  })
}

/**
 * Wall of Thorns' bite: six damage, less whatever the army's melee roll cuts off it.
 *
 * "The army makes a melee roll **instead of a save roll**", and that sentence settles
 * both halves of the roll separately -- which is exactly the distinction `RollSpec`
 * draws between what a roll *counts* and what it is *for*. It counts **melee**; its
 * purpose is a **save roll against nothing**, because that is the roll it replaces.
 *
 * Getting the purpose wrong is not cosmetic. As an attack roll a Smite here would
 * generate unsavable damage against an army that does not exist; as `save` with
 * `against: null` -- the narrow reading the SAI reference calls "any other save roll"
 * -- Counter and Volley generate their saves and no riposte, and the saves are in a
 * type this roll does not count, so they are simply ignored.
 *
 * `isTrigger` is what stops Wild Growth and the free moves offering a decision the
 * maneuver step has nowhere to put. A house rule, `RULES-V0.md` section 15.
 */
function stepThorns(state: GameState): GameState {
  const player = state.turn.marching
  const slot = marchingSlot(state)
  const owed = thornsAt(state, slot)

  const army = armyRoll(state, player, slot, 'melee')
  const [roll, rng] = rollArmy(
    army.units,
    'melee',
    state.rng,
    state.ruleSet,
    army.modifiers,
    { purpose: { kind: 'save', against: null }, isCounter: false, isTrigger: true },
  )
  // The army is rolling against a hedge, so there is nowhere for a riposte or a
  // targeting SAI to go: refuse rather than drop, as every other roll with no home
  // for an effect does.
  expectNoEffects(roll, "Wall of Thorns' melee roll")

  const damage = Math.max(0, owed - roll.total)
  const logged = withLog({ ...state, rng }, {
    kind: 'thorns',
    player,
    slot,
    damage,
    melee: roll.total,
    dice: roll.dice,
    ...(roll.countedAs !== undefined ? { flamingShields: roll.countedAs } : {}),
    ...(roll.math !== undefined ? { math: roll.math } : {}),
  })

  // Damage too small to kill anything is dropped rather than asked about, exactly as
  // after an exchange.
  const survivors = armyRef(logged, player, slot)
  if (damage === 0 || maxAbsorbable(healthsOf(survivors), damage) === 0) {
    return withTurn(logged, { marchStep: 'action' })
  }

  return withTurn(logged, { marchStep: 'thorns_damage', thorns: { slot, damage } })
}

/** Wall of Thorns' dead, chosen by their owner under the maximal-subset rule. */
function applyThornsDamage(state: GameState, unitIds: readonly UnitId[]): GameState {
  const owed = state.turn.thorns
  if (owed === undefined) throw new IllegalActionError('no thorns damage is waiting')

  const player = state.turn.marching
  const army = armyRef(state, player, owed.slot)
  const problem = damageAssignmentProblem(army, owed.damage, unitIds)
  if (problem !== null) throw new IllegalActionError(problem)

  const outcome = killUnits(state, unitIds)
  const killed = withLog(outcome.state, ...deathEntries(outcome, player, owed.slot, unitIds))

  // Built field by field so `thorns` is dropped by omission, the rule every optional
  // field near the digest follows.
  const turn = killed.turn
  const { thorns: _spent, ...rest } = turn
  return { ...killed, turn: { ...rest, marchStep: 'action' } }
}

function applyChooseAction(state: GameState, action: ActionKind | null): GameState {
  const player = state.turn.marching
  // `marchingRef`, not `marchingSlot`: a Reserve Army may take a magic action, and
  // magic is the one action that names no terrain.
  const slot = marchingRef(state)

  if (action === null) {
    return endMarch(withLog(state, { kind: 'action_skipped', player, slot }))
  }

  const legal = legalActions(state, player, slot)
  if (!legal.includes(action)) {
    // A Reserve Army has one legal action and no terrain to explain itself with.
    if (slot === 'reserve') {
      throw new IllegalActionError('the Reserve Army may only take a magic action')
    }
    const terrain = state.terrains[slot]
    if (terrain.face === 8 && state.ruleSet.eighthFace !== 'captureOnly') {
      throw new IllegalActionError(
        terrain.capturedBy === player
          ? `no ${action} action is available at ${slot} -- there is nothing to attack`
          : `${slot} is held by the opponent, so only a melee action is available`,
      )
    }
    const permitted = terrainAction(state, slot)
    throw new IllegalActionError(
      permitted === null || permitted === action
        ? `no ${action} action is available at ${slot} -- there is nothing to attack`
        : `${slot} is on a ${permitted} face, so ${action} is not available`,
    )
  }

  // Missile is the only action that picks its target; melee and magic hit the
  // opposing army at the marching army's own terrain. So missile's log entry waits
  // for `applyMissileTarget`, where both ends are finally known.
  if (action === 'missile') {
    return withTurn(state, {
      marchStep: 'choose_target',
      combat: { action, targetSlot: slot, damage: 0 },
    })
  }

  const logged = withLog(state, {
    kind: 'action_chosen',
    player,
    fromSlot: slot,
    toSlot: slot,
    action,
  })
  return withTurn(logged, {
    marchStep: 'resolve_attack',
    combat: { action, targetSlot: slot, damage: 0 },
  })
}

function applyMissileTarget(state: GameState, slot: ArmyRef): GameState {
  const player = state.turn.marching
  const options = missileTargets(state, player, marchingSlot(state))
  if (!options.includes(slot)) {
    throw new IllegalActionError(
      `${slot} is not a legal missile target -- available: ${options.join(', ') || 'none'}`,
    )
  }
  const combat = requireCombat(state)
  const logged = withLog(state, {
    kind: 'action_chosen',
    player,
    fromSlot: marchingSlot(state),
    toSlot: slot,
    action: combat.action,
  })
  return withTurn(logged, {
    marchStep: 'resolve_attack',
    combat: { ...combat, targetSlot: slot },
  })
}

/** Every counter-maneuver and the order-of-play roll-off share this. */
const MANEUVER_ROLL: RollContext = { purpose: { kind: 'maneuver' }, isCounter: false }

/** The marching army's roll in a contested maneuver: the one Wave reads (v2 Phase 5c). */
const MARCHING_ROLL: RollContext = { purpose: { kind: 'maneuver', marching: true }, isCounter: false }

function applyCounterAttack(state: GameState, counter: boolean): GameState {
  const defender = opponentOf(state.turn.marching)
  if (!counter) {
    return endMarch(withLog(state, { kind: 'counter_declined', player: defender }))
  }
  return withTurn(state, { marchStep: 'resolve_counter' })
}

function applyAssignDamage(state: GameState, unitIds: readonly UnitId[]): GameState {
  // A dragon attack assigns damage too, and it is the same decision in every
  // respect -- one army, one number, the maximal-subset rule -- so it reuses this
  // pending rather than growing a second one that both clients would have to learn.
  // What differs is only where the state goes next, which is why the branch is here
  // and not in the `Pending`.
  if (state.turn.dragonAttack !== undefined) return applyDragonAssign(state, unitIds)
  // And so does Hailstorm, for the same reason: the decision is identical and only
  // where the state goes next differs.
  if (state.turn.magic?.choice?.kind === 'damage') return applySpellDamage(state, unitIds)
  // And so does Wall of Thorns, which is a spell's damage arriving on somebody else's
  // turn -- there is no `turn.magic` to hang it on, so it has a field of its own.
  if (state.turn.thorns !== undefined) return applyThornsDamage(state, unitIds)

  const step = state.turn.marchStep
  if (!isAssignStep(step)) {
    throw new IllegalActionError(`no damage is waiting to be assigned (march step ${step})`)
  }

  const { player: victim, slot } = damageTarget(state, step)
  const army = armyRef(state, victim, slot)
  const problem = damageAssignmentProblem(army, damageAt(state, step), unitIds)
  if (problem !== null) throw new IllegalActionError(problem)

  // Not `applyDamage`: a death is a moment a rule can intervene in. Under
  // `dua: 'inert'` this is `applyDamage` and consumes no randomness, which is what
  // keeps the golden corpus byte-identical.
  // The three-way split -- really dead, risen, or exchanged by an Accelerated Growth --
  // is `deathEntries`' business. Every optional entry is omitted when empty, because
  // every golden digest carries every log entry verbatim.
  const outcome = killUnits(state, unitIds)
  const killed = withLog(outcome.state, ...deathEntries(outcome, victim, slot, unitIds))

  return afterCombatStep(killed, step)

}

/** Hailstorm's dead, chosen by their owner under the ordinary maximal-subset rule. */
function applySpellDamage(state: GameState, unitIds: readonly UnitId[]): GameState {
  const choice = magicOf(state).choice
  if (choice?.kind !== 'damage') throw new IllegalActionError('no spell damage is waiting')

  const army = armyRef(state, choice.player, choice.army)
  const problem = damageAssignmentProblem(army, choice.damage, unitIds)
  if (problem !== null) throw new IllegalActionError(problem)

  const outcome = killUnits(state, unitIds)
  const killed = withLog(
    outcome.state,
    ...deathEntries(outcome, choice.player, choice.army, unitIds),
  )

  return afterSpellChoice(killed, null)
}

function applyReinforce(
  state: GameState,
  moves: readonly { readonly unitId: UnitId; readonly slot: TerrainSlot }[],
): GameState {
  const player = state.turn.marching
  const units = { ...state.units }

  for (const move of moves) {
    const unit = units[move.unitId]
    if (unit === undefined) throw new IllegalActionError(`no such unit ${move.unitId}`)
    if (unit.owner !== player) throw new IllegalActionError(`${move.unitId} is not yours to move`)
    if (unit.location.kind !== 'reserve') {
      throw new IllegalActionError(`${move.unitId} is not in the Reserve Area`)
    }
    if (!TERRAIN_SLOTS.includes(move.slot)) {
      throw new IllegalActionError(`no such terrain ${move.slot}`)
    }
    units[move.unitId] = { ...unit, location: { kind: 'terrain', slot: move.slot } }
  }

  const moved = moves.length === 0 ? state : { ...state, units }
  const logged = moves.length === 0 ? moved : withLog(moved, { kind: 'reinforced', player, moves })
  return withTurn(logged, { phase: 'reserves_retreat' })
}

/**
 * Announces every spell and every target at once.
 *
 * Validated **as a whole**, which is not fussiness: the casts spend one pool jointly --
 * per species, for a mixed force (v2 Phase 1) -- so "can I afford this" is a question
 * about the list rather than about any one cast. (Lightning Strike's "a unit may not be targeted by more
 * than one Lightning Strike per magic action" is the same shape, and arrives in 7d.)
 *
 * An empty list is legal and common -- "any number of spells can be cast up to the
 * number of magic results generated", and unused results are simply lost.
 */
function applyAnnounceSpells(state: GameState, casts: readonly AnnouncedSpell[]): GameState {
  const magic = magicOf(state)
  const player = magic.caster ?? state.turn.marching
  const castable = castableSpells(state, player, magic.pool, state.ruleSet)

  for (const cast of casts) {
    const offer = castable.find((c) => c.spell.id === cast.spell)
    if (offer === undefined) {
      throw new IllegalActionError(`${cast.spell} is not castable by this army right now`)
    }
    if (!Number.isInteger(cast.count) || cast.count < 1) {
      throw new IllegalActionError(`${cast.spell}: count must be a positive integer`)
    }
    if (cast.count > 1 && !offer.spell.cumulative) {
      throw new IllegalActionError(`${cast.spell} is not cumulative and cannot be combined`)
    }
    if (!offer.elements.includes(cast.element)) {
      throw new IllegalActionError(`${cast.spell} cannot be cast with ${cast.element} magic`)
    }
    // Checked against exactly what was offered rather than re-derived: one list, so
    // the client cannot be shown a target the engine will then refuse.
    const aim = offer.targets.find((t) => sameSpellTarget(t.target, cast.target))
    if (aim === undefined) {
      throw new IllegalActionError(`${cast.spell} cannot be aimed there`)
    }
    if (cast.count < aim.minCount) {
      throw new IllegalActionError(
        `${cast.spell} needs ${aim.minCount} castings to reach that target, not ${cast.count}`,
      )
    }
    // The rules a list of targets cannot express, because they depend on how many
    // castings were combined: Resurrect Dead's health budget today, Lightning
    // Strike's once-per-unit in 7d.
    const problem = spellTargetProblem(state, cast)
    if (problem !== null) throw new IllegalActionError(problem)
  }

  // The rules between casts rather than about one -- Lightning Strike's once-per-unit
  // -- and paying for the lot: the total within the roll, and (v2 Phase 1) a split of
  // the pool that pays every spell in its element and, for a species spell, its species.
  const across = announcementProblem(magic.pool, casts)
  if (across !== null) throw new IllegalActionError(across)

  // "Once you have decided which spells to cast, announce all of the spells ... Once
  // all spells and their targets are announced, cast and resolve the spells one at a
  // time." Dispel Magic lives in the gap, and this is where it opens.
  const dispels = dispelCandidates(state, casts)

  const announced: MagicState = {
    army: magic.army,
    pool: magic.pool,
    ...(magic.caster !== undefined ? { caster: magic.caster } : {}),
    ...(magic.returnTo !== undefined ? { returnTo: magic.returnTo } : {}),
    ...(casts.length > 0 ? { announced: casts } : {}),
    ...(dispels.length > 0 ? { dispels } : {}),
  }
  return withTurn(withMagic(state, announced), {
    marchStep: dispels.length > 0 ? 'dispel_magic' : 'resolve_spell',
  })
}

/**
 * Air Flight: "during the Retreat Step of the Reserves Phase, Firewalker units may move
 * from any terrain that contains air to any other terrain that contains air and where
 * you have at least one Firewalker unit."
 *
 * **Judged once, against the board as the step begins** -- a house rule, `RULES-V0.md`
 * section 16. The moves are one decision, so they are simultaneous: a terrain that
 * empties because everybody flew out of it still counted as holding a Firewalker for
 * the units flying *in*, and two armies may swap places.
 *
 * **Per die** (v2 Phase 1): only a Firewalker flies, and a destination qualifies only
 * if a Firewalker of yours stands there -- in a mixed force a terrain holding nothing
 * but your Treefolk is not one. v1 read "a Firewalker unit" as "any unit of yours",
 * which was the same thing while a force was one species.
 *
 * A sleeping unit "cannot ... leave the terrain", so it is not offered -- and it still
 * counts as a Firewalker standing at its terrain, which it is.
 */
function airFlightOffers(state: GameState, player: PlayerId): readonly AirFlightOffer[] {
  const flyers = (slot: TerrainSlot) =>
    armyAt(state, player, slot).filter((unit) => unitHasAbility(state.ruleSet, unit, 'Air Flight'))
  const airy = TERRAIN_SLOTS.filter((slot) => terrainHas(state, slot, 'air') && flyers(slot).length > 0)
  if (airy.length < 2) return []

  const offers: AirFlightOffer[] = []
  for (const slot of airy) {
    const options = airy.filter((other) => other !== slot)
    for (const unit of flyers(slot)) {
      if (isAsleep(state, unit.id)) continue
      offers.push({ unitId: unit.id, options })
    }
  }
  return offers
}

function applyRetreat(
  state: GameState,
  unitIds: readonly UnitId[],
  flights: readonly { readonly unitId: UnitId; readonly slot: TerrainSlot }[] = [],
): GameState {
  const player = state.turn.marching
  const units = { ...state.units }

  // Air Flight first, against the board as it stood: validated before anything moves,
  // because the offers are a fact about the start of the step.
  const offers = airFlightOffers(state, player)
  const flown: { unitId: UnitId; from: TerrainSlot; to: TerrainSlot }[] = []
  for (const flight of flights) {
    const offer = offers.find((o) => o.unitId === flight.unitId)
    if (offer === undefined) {
      throw new IllegalActionError(
        `${flight.unitId} cannot fly -- Air Flight takes Firewalkers from one terrain containing ` +
          'air to another where you already have a unit',
      )
    }
    if (!offer.options.includes(flight.slot)) {
      throw new IllegalActionError(`${flight.unitId} cannot fly to ${flight.slot}`)
    }
    if (unitIds.includes(flight.unitId)) {
      throw new IllegalActionError(`${flight.unitId} cannot both retreat and fly`)
    }
    if (flown.some((f) => f.unitId === flight.unitId)) {
      throw new IllegalActionError(`${flight.unitId} flies once`)
    }
    const unit = units[flight.unitId]
    if (unit === undefined || unit.location.kind !== 'terrain') {
      throw new Error(`${flight.unitId} was offered a flight but is not at a terrain`)
    }
    flown.push({ unitId: flight.unitId, from: unit.location.slot, to: flight.slot })
    units[flight.unitId] = { ...unit, location: { kind: 'terrain', slot: flight.slot } }
  }

  for (const id of unitIds) {
    const unit = units[id]
    if (unit === undefined) throw new IllegalActionError(`no such unit ${id}`)
    if (unit.owner !== player) throw new IllegalActionError(`${id} is not yours to move`)
    if (unit.location.kind !== 'terrain') {
      throw new IllegalActionError(`${id} is not at a terrain`)
    }
    // Sleep: "cannot be rolled or leave the terrain they currently occupy". Retreat is
    // the only mover in scope -- reinforce brings units *out* of Reserves, and a march
    // turns the terrain die rather than moving anybody.
    if (isAsleep(state, id)) {
      throw new IllegalActionError(`${id} is asleep and cannot leave its terrain`)
    }
    units[id] = { ...unit, location: { kind: 'reserve' } }
  }

  const moved = unitIds.length === 0 && flown.length === 0 ? state : { ...state, units }
  const retreated =
    unitIds.length === 0 ? moved : withLog(moved, { kind: 'retreated', player, unitIds })
  const logged =
    flown.length === 0 ? retreated : withLog(retreated, { kind: 'air_flight', player, moves: flown })
  return endTurn(logged)
}

/**
 * Folds one decision into the state. Always clears `pending` and never sets one --
 * see the note at the top of this file.
 */
export function applyAction(state: GameState, action: GameAction): GameState {
  const cleared: GameState = { ...state, pending: null }

  switch (action.kind) {
    case 'roll_off_choice':
      return applyRollOffChoice(
        cleared,
        action.take,
        action.take === 'frontier' ? action.proposer : undefined,
      )
    case 'choose_frontier':
      return applyChooseFrontier(cleared, action.proposer)
    case 'choose_march_army':
      return applyMarchArmy(cleared, action.army)
    case 'choose_maneuver':
      return applyDeclareManeuver(cleared, action.maneuver)
    case 'contest_maneuver':
      return applyContest(cleared, action.contest)
    case 'choose_direction':
      return applyDirection(cleared, action.direction)
    case 'choose_action':
      return applyChooseAction(cleared, action.action)
    case 'choose_missile_target':
      return applyMissileTarget(cleared, action.slot)
    case 'choose_counter_attack':
      return applyCounterAttack(cleared, action.counter)
    case 'assign_damage':
      return applyAssignDamage(cleared, action.unitIds)
    case 'sai_target':
      return applySaiTarget(cleared, action.unitIds)
    case 'sai_target_army':
      return applySaiTargetArmy(cleared, action.slot)
    case 'sai_promote':
      return applySaiPromote(cleared, action.pairs)
    case 'sai_move':
      return applySaiMove(cleared, action.slot, action.unitIds)
    case 'reinforce':
      return applyReinforce(cleared, action.moves)
    case 'retreat':
      return applyRetreat(cleared, action.unitIds, action.flights ?? [])
    case 'eighth_face_city':
      return applyEighthFaceCity(cleared, action.choice)
    case 'eighth_face_temple':
      return applyEighthFaceTemple(cleared, action.force)
    case 'temple_bury':
      return applyTempleBury(cleared, action.unitId)
    case 'dragon_breath':
      return applyDragonBreath(cleared, action.unitIds)
    case 'dragon_treasure':
      return applyDragonTreasure(cleared, action.pair)
    case 'dragon_allocate':
      return applyDragonAllocate(cleared, action)
    case 'dragon_damage_split':
      return applyDragonDamageSplit(cleared, action)
    case 'announce_spells':
      return applyAnnounceSpells(cleared, action.casts)
    case 'dragon_order':
      return applyDragonOrder(cleared, action.slot)
    case 'dragon_target':
      return applyDragonTarget(cleared, action.targets)
    case 'flashfire':
      return applyFlashfire(cleared, action.unitIds)
    case 'rapid_growth':
      return applyRapidGrowth(cleared, action.unitIds)
    case 'accelerated_growth':
      return applyAcceleratedGrowth(cleared, action.pairs)
    case 'dispel_magic':
      return applyDispelMagic(cleared, action.roll)
    case 'spell_move':
      return applySpellMove(cleared, action.slot)
    case 'spell_summon':
      return applySpellSummon(cleared, action.dragonId)
    case 'concede': {
      // `reduce` only lets this through with a pending open, and the pending names
      // who is conceding.
      const conceding = state.pending?.player
      if (conceding === undefined) throw new IllegalActionError('nobody is being asked, so nobody can concede')
      return applyConcede(cleared, conceding)
    }
  }
}

/**
 * The game ends here, won by the other player (v2 Phase 3e).
 *
 * The winner is set in the action rather than left to `findVictory`, because nothing
 * about the board has changed for it to find. That keeps the victory check itself
 * untouched, and `applyAction` still sets no pending: with a winner set, `advance`
 * stops before `stepGame` runs at all. The phase goes to `game_over` because
 * `validateState` holds a winner and that phase to each other.
 */
function applyConcede(state: GameState, conceding: PlayerId): GameState {
  const winner = opponentOf(conceding)
  return withLog(
    { ...withTurn(state, { phase: 'game_over' }), winner, pending: null },
    { kind: 'victory', player: winner, reason: 'concession' },
  )
}
