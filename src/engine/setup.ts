/**
 * Builds the opening position, following RULES-V0.md section 7.
 *
 * Both setup choices are made here now. Order of play comes from the Horde roll-off,
 * and the *Frontier* comes from the loser of that roll-off, who places the second
 * terrain their species brings. The rules give the winner the choice of one prize or
 * the other; splitting them one each costs nothing while the opponent is `PassiveAI`,
 * which could hold no opinion about which terrain it would rather fight on, and it
 * means no decision has to be raised. `GreedyAI` (Phase 9) gets the real rule.
 *
 * A force is either named -- a preset, for tests and the golden corpus -- or rolled
 * from the seed. **The named path must consume no generation draws at all**, or a
 * named game lands on a different board than v0 gave it and every golden quietly
 * changes meaning.
 */
import { terrainDie, unitType } from '../data/load'
import {
  preset,
  speciesProfile,
  PRESET_ARMY_NAMES,
  type PresetArmyName,
} from '../data/presets'

import { generateForces, type GeneratedForce } from './force'
import { nextInt, rngFrom, type RngState } from './rng'
import { expectNoEffects, rollArmy, type DieRoll } from './roll'
import type { RollContext } from './sai'
import {
  V0_RULES,
  opponentOf,
  type GameState,
  type LogEntry,
  type PlayerId,
  type RuleSet,
  type TerrainFace,
  type TerrainInPlay,
  type TerrainSlot,
  type UnitInstance,
} from './types'

/**
 * Where the two forces come from.
 *
 * Randomisation is how a game is set up; naming forces is how the engine is tested.
 * A test that wants a Gorgon on the board has to be able to say so, the golden
 * corpus needs forces that never change, and `V0_RULES` needs a fixed configuration
 * to stay a regression baseline.
 */
export type ForceSpec =
  | { readonly kind: 'named'; readonly forces: Readonly<Record<PlayerId, string>> }
  | { readonly kind: 'random' }

/** The two hand-authored 30-health forces. Most tests want exactly this. */
export const STARTER_FORCES: ForceSpec = {
  kind: 'named',
  forces: { p1: 'treefolk_starter', p2: 'firewalkers_starter' },
}

/**
 * One of every monster and every large die, 35 health a side.
 *
 * Every SAI in the game appears on this board -- all 25, against the starter lists'
 * 10 -- because the fifteen the starters never reach live almost entirely on the
 * monster dice, and each starter fields exactly one monster. A rolled force turns
 * them up eventually; this turns all of them up at once, which is what makes it
 * worth having as a named force rather than another seed.
 */
export const BESTIARY_FORCES: ForceSpec = {
  kind: 'named',
  forces: { p1: 'treefolk_bestiary', p2: 'firewalkers_bestiary' },
}

/**
 * The hand-authored pairings, by the name a front end takes for them.
 *
 * One registry rather than one per client: the terminal's `--forces` and the app's
 * `?forces=` name the same things, and a pairing that only half the project can
 * reach is a pairing nobody remembers exists.
 */
export const FORCE_SETS: Readonly<Record<string, ForceSpec>> = {
  starter: STARTER_FORCES,
  bestiary: BESTIARY_FORCES,
}

/** The named pairing, or null -- so a caller can say what it wants done about a
 *  name nobody recognises, rather than being handed a silent fallback. */
export function namedForces(name: string): ForceSpec | null {
  return FORCE_SETS[name] ?? null
}

export interface SetupOptions {
  readonly seed: number
  readonly forces: ForceSpec
  /**
   * Who takes the first march. Omit to decide it by the Horde roll-off, which is
   * what the rules actually call for. Naming one skips the roll-off, and the other
   * player is then the loser who sets the Frontier.
   */
  readonly firstPlayer?: PlayerId
  /**
   * Pins a terrain die to a slot, overriding what the species would bring. Setup
   * needs no such thing; tests do -- this is how a test says "a Tower, here" -- and
   * it is what lets the golden corpus keep replaying the board it was recorded on.
   */
  readonly terrains?: Readonly<Partial<Record<TerrainSlot, string>>>
  readonly ruleSet?: RuleSet
}

/** A force once it is resolved, whichever way it was obtained. */
interface ResolvedForce {
  readonly species: string
  readonly armies: Readonly<Record<PresetArmyName, readonly string[]>>
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

function buildUnits(
  player: PlayerId,
  force: ResolvedForce,
): { all: UnitInstance[]; byArmy: ArmyGroups } {
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
/** The roll-off is a maneuver roll like any other. */
const MANEUVER_ROLL: RollContext = { purpose: { kind: 'maneuver' }, isCounter: false }

function rollForFirstPlayer(
  hordes: Readonly<Record<PlayerId, readonly UnitInstance[]>>,
  rng: RngState,
  ruleSet: RuleSet,
): readonly [
  PlayerId,
  { p1: number; p2: number },
  Record<PlayerId, readonly DieRoll[]>,
  RngState,
] {
  let state = rng

  for (let attempt = 0; attempt < MAX_TIE_REROLLS; attempt++) {
    // No modifiers, and not `armyRoll`: no terrain is captured and no effect can exist
    // before the game has started, and the units are not at their slots yet either.
    const [p1Roll, afterP1] = rollArmy(hordes.p1, 'maneuver', state, ruleSet, [], MANEUVER_ROLL)
    const [p2Roll, afterP2] = rollArmy(hordes.p2, 'maneuver', afterP1, ruleSet, [], MANEUVER_ROLL)
    state = afterP2

    // The roll-off is a maneuver roll, so Fly, Hoof, Trample and the rest count --
    // but setup has nowhere to put an effect, and Phase 4 gives Firewalking and
    // Teleport one. Refuse rather than drop it.
    expectNoEffects(p1Roll, 'the p1 order-of-play roll')
    expectNoEffects(p2Roll, 'the p2 order-of-play roll')

    if (p1Roll.total !== p2Roll.total) {
      const winner: PlayerId = p1Roll.total > p2Roll.total ? 'p1' : 'p2'
      // The deciding attempt's dice, not every tied one: the log shows the roll that
      // settled it, the same way a combat shows the exchange that landed.
      return [
        winner,
        { p1: p1Roll.total, p2: p2Roll.total },
        { p1: p1Roll.dice, p2: p2Roll.dice },
        state,
      ] as const
    }
  }

  // Persistent ties mean very small armies; break it rather than spin forever. No
  // dice to show for a coin flip, so the log falls back to its one-line form.
  const [coin, next] = nextInt(state, 2)
  return [coin === 0 ? 'p1' : 'p2', { p1: 0, p2: 0 }, { p1: [], p2: [] }, next] as const
}

const countDice = (force: GeneratedForce): number =>
  PRESET_ARMY_NAMES.reduce((sum, name) => sum + force.armies[name].length, 0)

const forceHealth = (force: ResolvedForce): number =>
  PRESET_ARMY_NAMES.reduce(
    (sum, name) => sum + force.armies[name].reduce((n, id) => n + unitType(id).health, 0),
    0,
  )

export function setupGame(options: SetupOptions): GameState {
  const ruleSet = options.ruleSet ?? V0_RULES
  const log: LogEntry[] = []
  let rng = rngFrom(options.seed)

  // Steps 1 to 3: the forces. Named forces take no draws, so a named game opens on
  // the board it always opened on.
  let forces: Readonly<Record<PlayerId, ResolvedForce>>
  if (options.forces.kind === 'named') {
    forces = { p1: preset(options.forces.forces.p1), p2: preset(options.forces.forces.p2) }
  } else {
    const [rolled, next] = generateForces(rng)
    rng = next
    forces = rolled
    log.push({
      kind: 'forces_drawn',
      health: forceHealth(rolled.p1),
      species: { p1: rolled.p1.species, p2: rolled.p2.species },
      dice: { p1: countDice(rolled.p1), p2: countDice(rolled.p2) },
    })
  }

  if (forceHealth(forces.p1) !== forceHealth(forces.p2)) {
    throw new Error(
      `the two forces are ${forceHealth(forces.p1)} and ${forceHealth(forces.p2)} health; ` +
        `both sides bring the same, or the game is unfair before it starts`,
    )
  }

  const p1Units = buildUnits('p1', forces.p1)
  const p2Units = buildUnits('p2', forces.p2)

  const units: Record<string, UnitInstance> = {}
  for (const unit of [...p1Units.all, ...p2Units.all]) {
    if (units[unit.id] !== undefined) {
      throw new Error(`duplicate unit id generated: ${unit.id}`)
    }
    units[unit.id] = unit
  }

  // Step 4: order of play, before the terrains are rolled.
  let firstPlayer: PlayerId
  if (options.firstPlayer === undefined) {
    const [winner, rolls, rollOffDice, next] = rollForFirstPlayer(
      { p1: p1Units.byArmy.horde, p2: p2Units.byArmy.horde },
      rng,
      ruleSet,
    )
    firstPlayer = winner
    rng = next
    log.push({ kind: 'order_of_play', rolls, firstPlayer, dice: rollOffDice })
  } else {
    firstPlayer = options.firstPlayer
  }

  log.unshift({ kind: 'game_start', seed: options.seed, firstPlayer })

  // The roll-off's other prize: the loser places the Frontier, from the second
  // terrain their species brings. It reads the result rather than rolling, so it
  // consumes nothing and cannot disturb the stream below.
  const frontierSetter = opponentOf(firstPlayer)

  // Step 5: opening terrain faces.
  const dice: Readonly<Record<TerrainSlot, string>> = {
    p1_home: options.terrains?.p1_home ?? speciesProfile(forces.p1.species).homeTerrain,
    frontier:
      options.terrains?.frontier ?? speciesProfile(forces[frontierSetter].species).secondTerrain,
    p2_home: options.terrains?.p2_home ?? speciesProfile(forces.p2.species).homeTerrain,
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
    effects: [],
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
