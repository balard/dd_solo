/**
 * Builds the opening position.
 *
 * Follows RULES-V0.md section 7, with one deliberate gap: the Horde roll-off that
 * decides who goes first needs `rollArmy`, which arrives in Phase 2. Until then
 * `firstPlayer` is passed in. The preset forces both propose Highland as the
 * Frontier, so the *other* setup choice -- which proposed terrain is used --
 * resolves itself and never needs asking.
 */
import { terrainDie } from '../data/load'
import { preset, PRESET_ARMY_NAMES, type Preset, type PresetArmyName } from '../data/presets'

import { nextInt, rngFrom, type RngState } from './rng'
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
  readonly firstPlayer: PlayerId
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

function buildUnits(player: PlayerId, force: Preset): UnitInstance[] {
  const units: UnitInstance[] = []
  let ordinal = 0

  for (const armyName of PRESET_ARMY_NAMES) {
    const slot = startingSlot(armyName, player)
    for (const typeId of force.armies[armyName]) {
      const shortName = typeId.split('.')[1] ?? typeId
      units.push({
        id: `${player}:${shortName}#${ordinal}`,
        typeId,
        owner: player,
        location: { kind: 'terrain', slot },
      })
      ordinal += 1
    }
  }

  return units
}

export function setupGame(options: SetupOptions): GameState {
  const p1Force = preset(options.forces.p1)
  const p2Force = preset(options.forces.p2)

  const units: Record<string, UnitInstance> = {}
  for (const unit of [...buildUnits('p1', p1Force), ...buildUnits('p2', p2Force)]) {
    if (units[unit.id] !== undefined) {
      throw new Error(`duplicate unit id generated: ${unit.id}`)
    }
    units[unit.id] = unit
  }

  // Both forces propose the same Frontier in the starter presets; assert it rather
  // than silently preferring one, because a future preset could differ.
  if (p1Force.proposedFrontier !== p2Force.proposedFrontier) {
    throw new Error(
      `the two forces propose different Frontier terrains ` +
        `(${p1Force.proposedFrontier} vs ${p2Force.proposedFrontier}); ` +
        `choosing between them is a setup decision that does not exist yet`,
    )
  }

  const dice: Readonly<Record<TerrainSlot, string>> = {
    p1_home: p1Force.homeTerrain,
    frontier: p1Force.proposedFrontier,
    p2_home: p2Force.homeTerrain,
  }

  const log: LogEntry[] = [
    { kind: 'game_start', seed: options.seed, firstPlayer: options.firstPlayer },
  ]

  let rng = rngFrom(options.seed)
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
    ruleSet: options.ruleSet ?? V0_RULES,
    rng,
    units,
    terrains,
    turn: {
      marching: options.firstPlayer,
      phase: 'effects_expire',
      marchIndex: 0,
      marchStep: 'select_army',
      marchingArmy: null,
      armiesMarched: [],
    },
    // Phase 4 adds the advance loop that turns this into the first real decision.
    pending: null,
    log,
    winner: null,
  }
}
