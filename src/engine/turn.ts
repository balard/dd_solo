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
import { doublesIds, legalActions, missileTargets, resolveAttack, terrainAction } from './combat'
import { damageAssignmentProblem, damageOptions } from './damage'
import { killUnits } from './death'

import { expectNoEffects, rollArmy } from './roll'
import type { RollContext } from './sai'
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
  type PlayerId,
  type TerrainFace,
  type TerrainSlot,
  type TurnState,
  type UnitId,
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
      return resolveExchange(state, false)
    case 'resolve_counter':
      return resolveExchange(state, true)

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
  'assign_attack_damage',
  'assign_attack_riposte',
  'offer_counter',
  'resolve_counter',
  'assign_counter_damage',
  'assign_counter_riposte',
] as const satisfies readonly MarchStep[]

type CombatStep = (typeof COMBAT_SEQUENCE)[number]

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
 * The two `resolve_*` steps answer false: both are entered deliberately -- by
 * choosing an action, and by accepting the counter-attack offer -- and never by the
 * walk.
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
 * Rolls one exchange and routes to damage assignment, the counter-attack, or the
 * end of the march.
 *
 * Only melee offers a counter-attack, and only on the first exchange -- "Surprise
 * has no effect during a counter-attack" is the rulebook's way of saying counters
 * do not themselves get countered.
 */
function resolveExchange(state: GameState, isCounter: boolean): GameState {
  const combat = requireCombat(state)
  const marcher = state.turn.marching
  const enemy = opponentOf(marcher)
  const marchSlot = marchingSlot(state)

  const attacker = isCounter ? enemy : marcher
  const defender = isCounter ? marcher : enemy
  const attackerSlot = isCounter ? combat.targetSlot : marchSlot
  const defenderSlot = isCounter ? marchSlot : combat.targetSlot

  const outcome = resolveAttack(state, {
    action: combat.action,
    attacker,
    attackerSlot,
    defender,
    defenderSlot,
    isCounter,
  })

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
    isCounter ? 'resolve_counter' : 'resolve_attack',
  )
}

/**
 * One step of the game. Returns the same object when nothing can happen without a
 * decision, which is how the advance loop knows to stop.
 */
export function stepGame(state: GameState): GameState {
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
    // The three no-op phases. Real phases rather than omissions, because they are
    // where spell expiry, eighth-face powers and dragons land in v1.
    case 'effects_expire':
      return withTurn(state, { phase: 'eighth_face' })
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

  const [marcherRoll, afterMarcher] = rollArmy(
    armyAt(state, player, slot),
    'maneuver',
    state.rng,
    state.ruleSet,
    doublesIds(state, player, slot),
    MANEUVER_ROLL,
  )
  const [defenderRoll, afterDefender] = rollArmy(
    armyAt(state, opponentOf(player), slot),
    'maneuver',
    afterMarcher,
    state.ruleSet,
    doublesIds(state, opponentOf(player), slot),
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
    case 'reinforce':
      return applyReinforce(cleared, action.moves)
    case 'retreat':
      return applyRetreat(cleared, action.unitIds)
  }
}
