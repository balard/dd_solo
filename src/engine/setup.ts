/**
 * Builds the opening position, following RULES-V0.md section 7.
 *
 * The Horde roll-off for order of play is included now that `rollArmy` exists. The
 * *other* setup choice -- which proposed terrain becomes the Frontier -- resolves
 * itself, because both starter forces propose Highland; `setupGame` throws rather
 * than guessing if a future pair of presets disagrees.
 */
import { terrainDie } from '../data/load'
import { preset, PRESET_ARMY_NAMES, type Preset, type PresetArmyName } from '../data/presets'

import { nextInt, rngFrom, type RngState } from './rng'
import { rollArmy } from './roll'
import {
  V0_RULES,
  type GameState,
  type LogEntry,
  type PlayerId,
  type RuleSet,
  type TerrainFace,
  type TerrainInPlay,
  type TerrainSlot,
  type UnitInstance,
} from './types'

export interface SetupOptions {
  readonly seed: number
  /** Preset id for each player, e.g. `treefolk_starter`. */
  readonly forces: Readonly<Record<PlayerId, string>>
  /**
   * Who takes the first march. Omit to decide it by the Horde roll-off, which is
   * what the rules actually call for.
   */
  readonly firstPlayer?: PlayerId
  readonly ruleSet?: RuleSet
}

/**
 * Where each preset army starts: your Home Army at your own terrain, your Campaign
 * Army at the Frontier, your Horde Army at the opponent's terrain.
 */
function startingSlot(armyName: PresetArmyName, player: PlayerId): TerrainSlot {
  const own: TerrainSlot = player === 'p1' ? 'p1_home' : 'p2_home'
  const enemy: TerrainSlot = player === 'p1' ? 'p2_home' : 'p1_home'
  switch (armyName) {
    case 'home':
      return own
    case 'campaign':
      return 'frontier'
    case 'horde':
      return enemy
  }
}

/**
 * Rolls a terrain's opening face: re-roll 8s, turn 7s down to 6, so every terrain
 * starts somewhere in 1-6 (RULES-V0.md section 7 step 5).
 */
export function rollStartingFace(rng: RngState): readonly [TerrainFace, RngState] {
  let state = rng
  for (;;) {
    const [index, next] = nextInt(state, 8)
    state = next
    const face = index + 1
    if (face === 8) continue // re-roll: nobody starts on a captured terrain
    return [(face === 7 ? 6 : face) as TerrainFace, state] as const
  }
}

type ArmyGroups = Readonly<Record<PresetArmyName, readonly UnitInstance[]>>

function buildUnits(player: PlayerId, force: Preset): { all: UnitInstance[]; byArmy: ArmyGroups } {
  const all: UnitInstance[] = []
  const byArmy = {} as Record<PresetArmyName, UnitInstance[]>
  let ordinal = 0

  for (const armyName of PRESET_ARMY_NAMES) {
    const slot = startingSlot(armyName, player)
    byArmy[armyName] = []

    for (const typeId of force.armies[armyName]) {
      const shortName = typeId.split('.')[1] ?? typeId
      const unit: UnitInstance = {
        id: `${player}:${shortName}#${ordinal}`,
        typeId,
        owner: player,
        location: { kind: 'terrain', slot },
      }
      all.push(unit)
      byArmy[armyName].push(unit)
      ordinal += 1
    }
  }

  return { all, byArmy }
}

/** Ties are rerolled; after this many we stop and flip a coin rather than loop. */
const MAX_TIE_REROLLS = 50

/**
 * RULES-V0.md section 7 step 4: both players roll their Horde Army for maneuver, and
 * the winner chooses to go first or to pick the Frontier. With both starter forces
 * proposing the same Frontier there is nothing to pick, so the winner simply marches
 * first and no decision has to be asked.
 *
 * The rules do not say what happens on a tie. Rerolling is the natural reading.
 */
function rollForFirstPlayer(
  hordes: Readonly<Record<PlayerId, readonly UnitInstance[]>>,
  rng: RngState,
  ruleSet: RuleSet,
): readonly [PlayerId, { p1: number; p2: number }, RngState] {
  let state = rng

  for (let attempt = 0; attempt < MAX_TIE_REROLLS; attempt++) {
    const [p1Roll, afterP1] = rollArmy(hordes.p1, 'maneuver', state, ruleSet)
    const [p2Roll, afterP2] = rollArmy(hordes.p2, 'maneuver', afterP1, ruleSet)
    state = afterP2

    if (p1Roll.total !== p2Roll.total) {
      const winner: PlayerId = p1Roll.total > p2Roll.total ? 'p1' : 'p2'
      return [winner, { p1: p1Roll.total, p2: p2Roll.total }, state] as const
    }
  }

  // Persistent ties mean very small armies; break it rather than spin forever.
  const [coin, next] = nextInt(state, 2)
  return [coin === 0 ? 'p1' : 'p2', { p1: 0, p2: 0 }, next] as const
}

export function setupGame(options: SetupOptions): GameState {
  const p1Force = preset(options.forces.p1)
  const p2Force = preset(options.forces.p2)
  const ruleSet = options.ruleSet ?? V0_RULES

  const p1Units = buildUnits('p1', p1Force)
  const p2Units = buildUnits('p2', p2Force)

  const units: Record<string, UnitInstance> = {}
  for (const unit of [...p1Units.all, ...p2Units.all]) {
    if (units[unit.id] !== undefined) {
      throw new Error(`duplicate unit id generated: ${unit.id}`)
    }
    units[unit.id] = unit
  }

  if (p1Force.proposedFrontier !== p2Force.proposedFrontier) {
    throw new Error(
      `the two forces propose different Frontier terrains ` +
        `(${p1Force.proposedFrontier} vs ${p2Force.proposedFrontier}); ` +
        `choosing between them is a setup decision that does not exist yet`,
    )
  }

  const log: LogEntry[] = []
  let rng = rngFrom(options.seed)

  // Step 4: order of play, before the terrains are rolled.
  let firstPlayer: PlayerId
  if (options.firstPlayer === undefined) {
    const [winner, rolls, next] = rollForFirstPlayer(
      { p1: p1Units.byArmy.horde, p2: p2Units.byArmy.horde },
      rng,
      ruleSet,
    )
    firstPlayer = winner
    rng = next
    log.push({ kind: 'order_of_play', rolls, firstPlayer })
  } else {
    firstPlayer = options.firstPlayer
  }

  log.unshift({ kind: 'game_start', seed: options.seed, firstPlayer })

  // Step 5: opening terrain faces.
  const dice: Readonly<Record<TerrainSlot, string>> = {
    p1_home: p1Force.homeTerrain,
    frontier: p1Force.proposedFrontier,
    p2_home: p2Force.homeTerrain,
  }
  const terrains = {} as Record<TerrainSlot, TerrainInPlay>

  for (const slot of ['p1_home', 'frontier', 'p2_home'] as const) {
    const dieId = dice[slot]
    terrainDie(dieId) // throws if the die is not in the data
    const [face, next] = rollStartingFace(rng)
    rng = next
    terrains[slot] = { slot, dieId, face, capturedBy: null }
    log.push({ kind: 'terrain_placed', slot, dieId, face })
  }

  return {
    ruleSet,
    rng,
    units,
    terrains,
    turn: {
      marching: firstPlayer,
      phase: 'effects_expire',
      marchIndex: 0,
      marchStep: 'select_army',
      marchingArmy: null,
      armiesMarched: [],
      combat: null,
    },
    // Phase 4 adds the advance loop that turns this into the first real decision.
    pending: null,
    log,
    winner: null,
  }
}
