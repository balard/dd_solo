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
  attackEffects,
  attackFacts,
  finishSaves,
  legalActions,
  missileTargets,
  rollAttack,
  rollSaveFaces,
  saveEffects,
  terrainAction,
  type AttackSpec,
} from './combat'
import { damageAssignmentProblem, damageOptions, healthsOf } from './damage'
import {
  exchangeWithDua,
  growthPartners,
  promotionBudgetProblem,
  promotionGain,
} from './dua'
import { killAndBury, killUnits } from './death'
import { armyRoll, expireEffects, isAsleep, pruneEffects, unitRoll, type Effect } from './effects'

import {
  defaultContextFor,
  expectNoEffects,
  faceOf,
  rollArmy,
  rollFaces,
  rollUnits,
  type DieRoll,
  type RawDie,
} from './roll'
import type { Modifier } from './pipeline'
import type { RollContext } from './sai'
import { delayedTasks, targetTasks, type TargetTask } from './targeting'
import {
  IllegalActionError,
  TERRAIN_SLOTS,
  armyAt,
  capturedCount,
  livingUnits,
  opponentOf,
  type ActionKind,
  type ArmyRef,
  type CombatState,
  type Direction,
  type GameAction,
  type GameState,
  type LogEntry,
  type MarchStep,
  type Pending,
  type PendingAttack,
  type PendingSaves,
  type PromotionPair,
  type PlayerId,
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
  const army = state.turn.marchingArmy
  if (army === null) throw new Error('no army is marching')
  if (army === 'reserve') throw new Error('the Reserve Army cannot march in v0')
  return army
}

/**
 * Armies this player could march: terrains where they have units, minus any army
 * already marched this turn. The Reserve Army is excluded -- it cannot maneuver and
 * has no legal action in v0, so offering it would be offering nothing.
 */
export function marchableArmies(state: GameState, player: PlayerId): readonly ArmyRef[] {
  return TERRAIN_SLOTS.filter(
    (slot) => armyAt(state, player, slot).length > 0 && !state.turn.armiesMarched.includes(slot),
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

function endTurn(state: GameState): GameState {
  const next = opponentOf(state.turn.marching)
  return withLog(
    withTurn(state, {
      marching: next,
      phase: 'effects_expire',
      marchIndex: 0,
      marchStep: 'select_army',
      marchingArmy: null,
      armiesMarched: [],
      combat: null,
    }),
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
      const slot = marchingSlot(state)
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
      if (armyAt(state, defender, combat.targetSlot).length === 0) return endMarch(state)
      if (armyAt(state, player, marchingSlot(state)).length === 0) return endMarch(state)
      return {
        ...state,
        pending: { kind: 'choose_counter_attack', player: defender, slot: combat.targetSlot },
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
  'sai_target_attack',
  'resolve_attack_saves',
  'sai_delayed_attack',
  'resolve_attack_damage',
  'assign_attack_damage',
  'assign_attack_riposte',
  'offer_counter',
  'resolve_counter',
  'sai_target_counter',
  'resolve_counter_saves',
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
  'sai_target_attack',
  'resolve_attack_saves',
  'sai_delayed_attack',
  'resolve_attack_damage',
  'resolve_counter',
  'sai_target_counter',
  'resolve_counter_saves',
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
): { readonly player: PlayerId; readonly slot: TerrainSlot } {
  const combat = requireCombat(state)
  const marcher = state.turn.marching
  const atTarget = { player: opponentOf(marcher), slot: combat.targetSlot } as const
  const atMarch = { player: marcher, slot: marchingSlot(state) } as const

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
    const army = armyAt(state, target.player, target.slot)
    // Damage too small to kill anything is dropped rather than asked about.
    return damageOptions(army, damageAt(state, step)).required > 0
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
  const marchSlot = marchingSlot(state)

  return {
    action: combat.action,
    attacker: isCounter ? enemy : marcher,
    attackerSlot: isCounter ? combat.targetSlot : marchSlot,
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

  // Reading the faces costs nothing and draws nothing -- `resolveFaces` is pure -- so
  // the targeting queue is worked out here and the same faces are resolved again for
  // real once the queue has drained. That is the whole point of the 4a seam.
  const effects = attackEffects(state, spec, attack)
  const targets = targetTasks(effects)
  // Choke and Confuse wait for the defender's dice. They are parked here rather than
  // with the save roll because they are *this* roll's SAIs and exist two steps before
  // there is anything to apply them to.
  const delayed = delayedTasks(effects)

  // A spread, unlike the rebuild below, and safe for the opposite reason: this is
  // the *same* exchange one step later, not the next one. Nothing between here and
  // `finishExchange` reads `damage` or `riposte`, and `finishExchange` rebuilds the
  // object from the outcome rather than from this.
  return withTurn(
    { ...state, rng },
    {
      marchStep: isCounter ? 'sai_target_counter' : 'sai_target_attack',
      combat: {
        ...combat,
        attack: {
          ...attack,
          ...(targets.length > 0 ? { targets } : {}),
          ...(delayed.length > 0 ? { delayed } : {}),
        },
      },
    },
  )
}

/** The attack roll, with the tasks it still owes stripped back to what is left. */
function withTargets(
  combat: CombatState,
  attack: PendingAttack,
  targets: readonly TargetTask[],
): CombatState {
  return {
    ...combat,
    attack: {
      dice: attack.dice,
      ...(targets.length > 0 ? { targets } : {}),
      ...(attack.delayed !== undefined ? { delayed: attack.delayed } : {}),
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
    return withTurn(state, { combat: withTargets(combat, requireAttack(state, combat), rest) })
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
  readonly slot: TerrainSlot
}

function taskOwner(task: TargetTask, spec: AttackSpec, delayed: boolean): TaskOwner {
  const friendly = task.kind === 'promote' || task.kind === 'move'
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
  const army = armyAt(state, spec.defender, spec.defenderSlot)
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
  return armyAt(state, owner.army, owner.slot)
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
        slot: owner.slot,
        // Only the defender's own save roll counts save results. An attack roll
        // generates them in a type it does not count.
        saveResultsCount: delayed && owner.player === spec.defender,
      }
    case 'move':
      return {
        kind: 'sai_move',
        ...common,
        unitId: task.unitId,
        slot: owner.slot,
        health: task.health,
        // "To any terrain" -- but not the one it is already standing on, which is an
        // answer that moves nobody and reads as a mistake.
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
  const queue = taskQueue(state)
  const head = queue[0]

  if (head === undefined) {
    return withTurn(state, {
      marchStep: nextStepAfterTasks(isCounter, delayed),
    })
  }

  if (!taskHasWork(state, spec, head, delayed)) return autoResolve(state, spec, head, delayed)

  return { ...state, pending: taskPending(state, spec, head, queue.length, delayed) }
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

  const [saves, rng] = rollSaveFaces(state, spec, state.rng)
  // The attacker's delayed effects first, then the defending army's own -- the
  // rulebook's order, steps 2 then 4, and the one that lets a defender decide their
  // Wild Growth split knowing what Choke has already taken.
  const tasks = [...(attack.delayed ?? []), ...targetTasks(saveEffects(state, spec, saves))]

  return withTurn(
    { ...state, rng },
    {
      marchStep: isCounter ? 'sai_delayed_counter' : 'sai_delayed_attack',
      combat: withSaves(combat, saves, { tasks }),
    },
  )
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
  where: { readonly target: PlayerId; readonly slot: TerrainSlot; readonly unitId?: UnitId },
): GameState {
  return withLog(
    { ...state, effects: [...state.effects, effect] },
    {
      kind: 'effect_cast',
      player: caster,
      source: effect.source,
      target: where.target,
      slot: where.slot,
      ...(where.unitId !== undefined ? { unitId: where.unitId } : {}),
    },
  )
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
  if (task === undefined || task.kind === 'galeforce' || task.kind === 'promote' || task.kind === 'move') {
    throw new IllegalActionError('no SAI is waiting for unit targets')
  }

  const spec = exchangeSpec(state, step === 'sai_target_counter' || step === 'sai_delayed_counter')
  const army = armyAt(state, spec.defender, spec.defenderSlot)

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
      { target: spec.defender, slot: spec.defenderSlot, unitId },
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

  const budget = task.kind === 'enemy' ? task.health : task.health
  const problem = damageAssignmentProblem(pool, budget, unitIds)
  if (problem !== null) throw new IllegalActionError(problem)

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
  const { state: dead, risen } =
    task.fate === 'bury' ? killAndBury(rolled, doomed) : killUnits(rolled, doomed)
  const buried = doomed.filter((id) => dead.units[id]?.location.kind === 'bua')

  return dropHeadTask(
    withLog(
      dead,
      { kind: 'units_killed', player: spec.defender, slot: spec.defenderSlot, unitIds: doomed },
      ...(risen.length > 0
        ? [{ kind: 'units_risen', player: spec.defender, unitIds: risen } as const]
        : []),
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

  // No log entry of its own: `sai_resolved` has already named the dice, and what they
  // rolled the second time shows up in the save strip at the end of the exchange --
  // which is the only roll there is, because the first one is gone.
  void task
  return dropHeadTask(
    withTurn({ ...state, rng }, { combat: withSaves(combat, saves, { dice }) }),
  )
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

  const { state: dead, risen } = killUnits(state, unitIds)
  const logged = withLog(
    dead,
    { kind: 'units_killed', player: spec.defender, slot: spec.defenderSlot, unitIds },
    ...(risen.length > 0
      ? [{ kind: 'units_risen', player: spec.defender, unitIds: risen } as const]
      : []),
  )

  const dice = saves.dice.filter((die) => !unitIds.includes(die.unitId))
  void task
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
    sai: task.sai,
    slot: spec.defenderSlot,
    test: task.escape === 'id' ? 'id' : task.escape === 'save' ? 'save' : 'maneuver',
    dice,
    escaped,
    ...(task.escapeTo === 'reserve' ? { toReserve: true as const } : {}),
  }

  const logged = withLog({ ...state, rng }, entry)
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
function finishExchange(state: GameState, isCounter: boolean): GameState {
  const combat = requireCombat(state)
  const pending = requireAttack(state, combat)
  const spec = exchangeSpec(state, isCounter)
  const { attacker, defender, attackerSlot, defenderSlot } = spec
  // The save dice were rolled two steps ago and have been through the delayed effects
  // since: a Choke may have taken one out of the list and a Confuse replaced another.
  const outcome = finishSaves(state, spec, pending, combat.saves ?? null, state.rng)

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
 * One step of the game. Returns the same object when nothing can happen without a
 * decision, which is how the advance loop knows to stop.
 */
export function stepGame(state: GameState): GameState {
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
    // No longer a no-op: effects with a duration end "at the beginning of your next
    // turn", which is here. It takes no decision, so it expires and moves on in one
    // step.
    case 'effects_expire':
      return withTurn(expireEffects(state), { phase: 'eighth_face' })

    // The two remaining no-op phases. Real phases rather than omissions, because they
    // are where eighth-face powers and dragons land in v1.
    case 'eighth_face':
      return withTurn(state, { phase: 'dragon_attack' })
    case 'dragon_attack':
      return withTurn(state, { phase: 'march', marchIndex: 0, marchStep: 'select_army' })

    case 'march':
      return stepMarch(state)

    case 'reserves_reinforce': {
      const player = state.turn.marching
      const inReserve = livingUnits(state, player).filter((u) => u.location.kind === 'reserve')
      if (inReserve.length === 0) return withTurn(state, { phase: 'reserves_retreat' })
      return { ...state, pending: { kind: 'reinforce', player } }
    }

    case 'reserves_retreat':
      return { ...state, pending: { kind: 'retreat', player: state.turn.marching } }

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

  const marcher = armyRoll(state, player, slot, 'maneuver')
  const [marcherRoll, afterMarcher] = rollArmy(
    marcher.units,
    'maneuver',
    state.rng,
    state.ruleSet,
    marcher.modifiers,
    MANEUVER_ROLL,
  )
  const contester = armyRoll(state, opponentOf(player), slot, 'maneuver')
  const [defenderRoll, afterDefender] = rollArmy(
    contester.units,
    'maneuver',
    afterMarcher,
    state.ruleSet,
    contester.modifiers,
    MANEUVER_ROLL,
  )

  // No SAI that applies to a maneuver roll produces an effect in Phase 1, and a
  // contest has nowhere to put one. Phase 4's Firewalking and Teleport will, so this
  // is what stops them being silently dropped here.
  expectNoEffects(marcherRoll, 'the maneuver roll of the marching army')
  expectNoEffects(defenderRoll, 'the roll of the counter-maneuvering army')

  // "The highest total wins (the marching army wins a tie)."
  const marcherWins = marcherRoll.total >= defenderRoll.total

  const rolled = withLog({ ...state, rng: afterDefender }, {
    kind: 'maneuver_contested',
    slot,
    marcher: marcherRoll.total,
    defender: defenderRoll.total,
    marcherWins,
    marcherDice: marcherRoll.dice,
    defenderDice: defenderRoll.dice,
  })

  return withTurn(rolled, { marchStep: marcherWins ? 'choose_direction' : 'action' })
}

function applyDirection(state: GameState, direction: Direction): GameState {
  const slot = marchingSlot(state)
  const options = legalDirections(state.terrains[slot].face)
  if (!options.includes(direction)) {
    throw new IllegalActionError(
      `cannot maneuver ${direction} from face ${state.terrains[slot].face}`,
    )
  }
  return withTurn(moveTerrain(state, slot, direction), { marchStep: 'action' })
}

function applyChooseAction(state: GameState, action: ActionKind | null): GameState {
  const player = state.turn.marching
  const slot = marchingSlot(state)

  if (action === null) {
    return endMarch(withLog(state, { kind: 'action_skipped', player, slot }))
  }

  const legal = legalActions(state, player, slot)
  if (!legal.includes(action)) {
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

function applyMissileTarget(state: GameState, slot: TerrainSlot): GameState {
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

/** Every contested maneuver and the order-of-play roll-off share this. */
const MANEUVER_ROLL: RollContext = { purpose: { kind: 'maneuver' }, isCounter: false }

function applyCounterAttack(state: GameState, counter: boolean): GameState {
  const defender = opponentOf(state.turn.marching)
  if (!counter) {
    return endMarch(withLog(state, { kind: 'counter_declined', player: defender }))
  }
  return withTurn(state, { marchStep: 'resolve_counter' })
}

function applyAssignDamage(state: GameState, unitIds: readonly UnitId[]): GameState {
  const step = state.turn.marchStep
  if (!isAssignStep(step)) {
    throw new IllegalActionError(`no damage is waiting to be assigned (march step ${step})`)
  }

  const { player: victim, slot } = damageTarget(state, step)
  const army = armyAt(state, victim, slot)
  const problem = damageAssignmentProblem(army, damageAt(state, step), unitIds)
  if (problem !== null) throw new IllegalActionError(problem)

  // Not `applyDamage`: a death is a moment a rule can intervene in. Under
  // `dua: 'inert'` this is `applyDamage` and consumes no randomness, which is what
  // keeps the golden corpus byte-identical.
  const { state: dead, risen } = killUnits(state, unitIds)

  const killed = withLog(
    dead,
    { kind: 'units_killed', player: victim, slot, unitIds },
    // A subset of the line above, and a second entry rather than a field on it: the
    // unit really was killed, and then moved. Omitted entirely when nothing rose,
    // because every golden digest carries every log entry verbatim.
    ...(risen.length > 0
      ? [{ kind: 'units_risen', player: victim, unitIds: risen } as const]
      : []),
  )

  return afterCombatStep(killed, step)

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

function applyRetreat(state: GameState, unitIds: readonly UnitId[]): GameState {
  const player = state.turn.marching
  const units = { ...state.units }

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

  const moved = unitIds.length === 0 ? state : { ...state, units }
  const logged =
    unitIds.length === 0 ? moved : withLog(moved, { kind: 'retreated', player, unitIds })
  return endTurn(logged)
}

/**
 * Folds one decision into the state. Always clears `pending` and never sets one --
 * see the note at the top of this file.
 */
export function applyAction(state: GameState, action: GameAction): GameState {
  const cleared: GameState = { ...state, pending: null }

  switch (action.kind) {
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
      return applyRetreat(cleared, action.unitIds)
  }
}
