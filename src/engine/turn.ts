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
import { applyDamage, damageAssignmentProblem, damageOptions } from './damage'
import { rollArmy } from './roll'
import {
  IllegalActionError,
  TERRAIN_SLOTS,
  armyAt,
  capturedCount,
  livingUnits,
  opponentOf,
  type ActionKind,
  type ArmyRef,
  type Direction,
  type GameAction,
  type GameState,
  type LogEntry,
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
    case 'assign_counter_damage': {
      const combat = requireCombat(state)
      const victim =
        state.turn.marchStep === 'assign_attack_damage' ? opponentOf(player) : player
      const slot =
        state.turn.marchStep === 'assign_attack_damage' ? combat.targetSlot : marchingSlot(state)
      return {
        ...state,
        pending: { kind: 'assign_damage', player: victim, slot, damage: combat.damage },
      }
    }

    case 'offer_counter': {
      const combat = requireCombat(state)
      const defender = opponentOf(player)
      // "A defending army reduced to zero units does not counter-attack."
      if (armyAt(state, defender, combat.targetSlot).length === 0) return endMarch(state)
      return {
        ...state,
        pending: { kind: 'choose_counter_attack', player: defender, slot: combat.targetSlot },
      }
    }
  }
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
  })

  const logged = withLog({ ...state, rng: outcome.rng }, {
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
    attackDice: outcome.attackRoll.dice,
    saveDice: outcome.saveRoll?.dice ?? null,
  })

  // Damage that cannot kill anything is dropped rather than asked about: a die that
  // takes less damage than its health simply ignores it (RULES-V0.md section 6).
  const required = damageOptions(armyAt(state, defender, defenderSlot), outcome.damage).required
  const withCombat = withTurn(logged, { combat: { ...combat, damage: outcome.damage } })

  if (required > 0) {
    return withTurn(withCombat, {
      marchStep: isCounter ? 'assign_counter_damage' : 'assign_attack_damage',
    })
  }
  if (isCounter) return endMarch(withCombat)
  return combat.action === 'melee'
    ? withTurn(withCombat, { marchStep: 'offer_counter' })
    : endMarch(withCombat)
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
  )
  const [defenderRoll, afterDefender] = rollArmy(
    armyAt(state, opponentOf(player), slot),
    'maneuver',
    afterMarcher,
    state.ruleSet,
    doublesIds(state, opponentOf(player), slot),
  )

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

function applyCounterAttack(state: GameState, counter: boolean): GameState {
  const defender = opponentOf(state.turn.marching)
  if (!counter) {
    return endMarch(withLog(state, { kind: 'counter_declined', player: defender }))
  }
  return withTurn(state, { marchStep: 'resolve_counter' })
}

function applyAssignDamage(state: GameState, unitIds: readonly UnitId[]): GameState {
  const combat = requireCombat(state)
  const isCounterDamage = state.turn.marchStep === 'assign_counter_damage'
  const marcher = state.turn.marching
  const victim = isCounterDamage ? marcher : opponentOf(marcher)
  const slot = isCounterDamage ? marchingSlot(state) : combat.targetSlot

  const army = armyAt(state, victim, slot)
  const problem = damageAssignmentProblem(army, combat.damage, unitIds)
  if (problem !== null) throw new IllegalActionError(problem)

  const killed = withLog(applyDamage(state, unitIds), {
    kind: 'units_killed',
    player: victim,
    slot,
    unitIds,
  })

  if (isCounterDamage) return endMarch(killed)
  return combat.action === 'melee'
    ? withTurn(killed, { marchStep: 'offer_counter' })
    : endMarch(killed)
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
