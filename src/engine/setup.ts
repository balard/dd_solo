/**
 * Builds the opening position, following RULES-V0.md section 7.
 *
 * Order of play comes from the Horde roll-off. Under `rollOff: 'split'` the loser
 * draws the Frontier (the Phase 5b house rule); under `'choice'` (v1 Phase 10e) both
 * players propose one and the winner chooses the first turn or the pick -- see
 * `rollOffPending` at the bottom of this file.
 *
 * The terrain dice are drawn, not chosen (a house rule, `RULES-V0.md` section 7): each
 * Home Terrain is a random die of the species' own type -- Swampland for Treefolk,
 * Wasteland for Firewalkers, `homeTerrainType` -- and a Frontier proposal is any die
 * sharing at least one element with its proposer's species, uniformly. See
 * `drawHomeDie` / `drawFrontierDie`.
 *
 * A force is either named -- a preset, for tests and the golden corpus -- or rolled
 * from the seed. **The named path must consume no generation draws at all**, or a
 * named game lands on a different board than v0 gave it and every golden quietly
 * changes meaning. The same is true of a pinned terrain slot (`SetupOptions.terrains`):
 * it consumes no draw either, not "the same draw" -- so the goldens' three pins leave
 * the whole terrain-draw stream skipped.
 */
import {
  DRAGON_DICE,
  homeTerrainType,
  speciesElements,
  TERRAIN_DICE,
  terrainDie,
  terrainType,
  unitType,
} from '../data/load'
import type { Element } from '../data/types'
import { preset, PRESET_ARMY_NAMES, PRESETS, type PresetArmyName } from '../data/presets'

import { generateForces, type GeneratedForce } from './force'
import { nextInt, rngFrom, type RngState } from './rng'
import { expectNoEffects, rollArmy, type DieRoll } from './roll'
import type { RollContext } from './sai'
import {
  IllegalActionError,
  TERRAIN_SLOTS,
  V0_RULES,
  opponentOf,
  type DragonInPlay,
  type GameState,
  type LogEntry,
  type Pending,
  type PlayerId,
  type RollOffState,
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
 * The ten monster fixtures, each as a **mirror** -- six copies of one monster die
 * against six of the same.
 *
 * They have existed since Phase 1 and until now only a test could reach one, which is
 * why a Phase 7 bug report about Flashfire could not be reproduced in a browser:
 * Flashfire is Firewalkers-only, the human plays p1, and `bestiary` puts Treefolk
 * there. A mirror sidesteps that entirely -- whatever the die does, both sides can do
 * it -- and a mirror is the most useful board of the lot anyway, being one die read
 * against itself.
 *
 * Derived from `PRESETS` rather than listed, so a monster added to
 * `data/presets.json` becomes playable in the same edit that gives it a fixture.
 */
const MONSTER_MIRRORS: Readonly<Record<string, ForceSpec>> = Object.fromEntries(
  PRESETS.map((p) => p.id)
    .filter((id) => !id.endsWith('_starter') && !id.endsWith('_bestiary'))
    .map((id) => [id, { kind: 'named', forces: { p1: id, p2: id } } as ForceSpec]),
)

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
  ...MONSTER_MIRRORS,
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
   * Pins a terrain die to a slot, overriding the draw. Setup needs no such thing;
   * tests do -- this is how a test says "a Tower, here" -- and it is what lets the
   * golden corpus keep replaying the board it was recorded on.
   */
  readonly terrains?: Readonly<Partial<Record<TerrainSlot, string>>>
  readonly ruleSet?: RuleSet
}

/**
 * A force once it is resolved, whichever way it was obtained: its dice, and nothing
 * else. The species follow from the dice (v2 Phase 1) -- a `species` field beside them
 * was a second copy of a fact that could drift, and a false one for a mixed force.
 */
interface ResolvedForce {
  readonly armies: Readonly<Record<PresetArmyName, readonly string[]>>
}

/** The species a force's dice belong to, each once, sorted. */
function speciesOfForce(force: ResolvedForce): readonly string[] {
  const ids = PRESET_ARMY_NAMES.flatMap((name) => force.armies[name])
  return [...new Set(ids.map((id) => unitType(id).species))].sort()
}

/**
 * Every element a force's species carry, each once -- in the species' own order for a
 * one-species force, which is what every draw below consumed before v2 Phase 1 and so
 * what keeps a single-species game on the board it always had.
 */
function forceElements(force: ResolvedForce): readonly Element[] {
  const out: Element[] = []
  for (const species of speciesOfForce(force)) {
    for (const element of speciesElements(species)) if (!out.includes(element)) out.push(element)
  }
  return out
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
 * All 24 terrain dice, sorted by id. Reordering the raw file must not reseat a
 * game, so both this and the Frontier's filtered list below draw from a sorted list
 * rather than `TERRAIN_DICE`'s raw-file order.
 */
const SORTED_TERRAIN_DICE: readonly string[] = [...TERRAIN_DICE].map((d) => d.id).sort()

/**
 * Draws a Home Terrain die: uniformly among the four dice of the species' own type, so
 * the one thing the draw decides is the eighth-face icon.
 *
 * It was uniform over all 24 from Phase 5b, which put a Treefolk force at home on a
 * Wasteland -- a terrain carrying neither of its elements, where Replanting and Rapid
 * Growth never fire and its spells need a Standing Stones to be cast at all.
 */
function drawHomeDie(force: ResolvedForce, rng: RngState): readonly [string, RngState] {
  // A mixed force has no one "own type" to draw from. Built forces (v2 Phase 2) name
  // their Home die; until then a mixed force has to pin it, and says so rather than
  // quietly drawing from the first species' type.
  const species = speciesOfForce(force)
  const [only] = species
  if (only === undefined || species.length > 1) {
    throw new Error(
      `a force of ${species.join(' and ') || 'no dice'} has no one home terrain type to draw ` +
        `from; pin its Home Terrain with SetupOptions.terrains`,
    )
  }
  const own = homeTerrainType(only).id
  const eligible = SORTED_TERRAIN_DICE.filter((dieId) => terrainDie(dieId).type === own)
  const [index, next] = nextInt(rng, eligible.length)
  const dieId = eligible[index]
  if (dieId === undefined) throw new Error(`drew home terrain ${index} of ${eligible.length}`)
  return [dieId, next] as const
}

/**
 * Draws a Frontier die: uniformly among every die sharing at least one element with the
 * force's species -- 20 of the 24 for either species in this box, everything but the
 * other side's own type. One draw.
 *
 * Phase 5b drew an element first and then a die carrying it, which made the species'
 * own type twice as likely as any other. Every eligible die is equally likely now.
 */
function drawFrontierDie(force: ResolvedForce, rng: RngState): readonly [string, RngState] {
  const elements = forceElements(force)
  const eligible = SORTED_TERRAIN_DICE.filter((dieId) =>
    terrainType(terrainDie(dieId).type).elements.some((e) => elements.includes(e)),
  )
  const [index, next] = nextInt(rng, eligible.length)
  const dieId = eligible[index]
  if (dieId === undefined) throw new Error(`drew frontier die ${index} of ${eligible.length}`)
  return [dieId, next] as const
}

/**
 * How many dragons a force brings: one per 24 points, or part thereof (full rules
 * p. 12). One at 24 health, two at 30 or 36.
 */
export function dragonCount(health: number): number {
  return Math.max(1, Math.ceil(health / 24))
}

/**
 * The dragon dice a player brings, by element (Phase 6 house rule).
 *
 * The rules let a player bring any types at all. Drawing from the player's own two
 * species elements instead makes this a draw rather than a decision, which is what a
 * solo game needs -- and it is why no game of Treefolk against Firewalkers ever
 * fields the Death dragon.
 *
 * Distinct elements first and **with no draw at all** when the count uses up the
 * pair: a 2-dragon force gets one of each, which is a forced choice, and a forced
 * choice consumes no randomness (the same rule as a pinned terrain). Only a 1-dragon
 * force draws, and only a force needing more than two draws twice.
 *
 * The form -- drake or wyrm -- is drawn per dragon. It is the one thing about a
 * dragon nothing else fixes: the two forms differ by a third tail and a treasure
 * chest against two wings.
 */
function drawDragonDice(
  force: ResolvedForce,
  count: number,
  rng: RngState,
): readonly [readonly string[], RngState] {
  const elements = [...forceElements(force)].sort()
  let state = rng
  const drawn: string[] = []

  for (let i = 0; i < count; i++) {
    let element: Element | undefined
    if (count >= elements.length && i < elements.length) {
      element = elements[i] // one of each, forced, no draw
    } else {
      const [index, next] = nextInt(state, elements.length)
      state = next
      element = elements[index]
    }
    if (element === undefined) {
      throw new Error(`${speciesOfForce(force).join(' and ')} has no elements to draw a dragon from`)
    }

    const [formIndex, afterForm] = nextInt(state, 2)
    state = afterForm
    const form = formIndex === 0 ? 'drake' : 'wyrm'

    const dieId = `${element}_${form}`
    if (!DRAGON_DICE.some((d) => d.id === dieId)) {
      throw new Error(`no dragon die ${dieId} in the data`)
    }
    drawn.push(dieId)
  }

  return [drawn, state] as const
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
      species: { p1: speciesOfForce(rolled.p1), p2: speciesOfForce(rolled.p2) },
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

  /*
   * The roll-off as the rules have it (v1 Phase 10e): the winner chooses the first turn
   * *or* the Frontier. Only when there is a roll-off to win and a Frontier to choose --
   * naming the first player skips the roll-off, and pinning the Frontier leaves the
   * winner one prize, the first turn, which is the `split` rung's answer anyway. So a
   * test that pins either plays exactly the board it always did.
   */
  const choosing =
    ruleSet.rollOff === 'choice' &&
    options.firstPlayer === undefined &&
    options.terrains?.frontier === undefined

  // Step 4: order of play, before the terrains are rolled.
  let firstPlayer: PlayerId
  let rollOffRecord: Omit<Extract<LogEntry, { kind: 'roll_off' }>, 'kind' | 'proposals'> | null = null
  if (options.firstPlayer === undefined) {
    const [winner, rolls, rollOffDice, next] = rollForFirstPlayer(
      { p1: p1Units.byArmy.horde, p2: p2Units.byArmy.horde },
      rng,
      ruleSet,
    )
    firstPlayer = winner
    rng = next
    // Under the choice the winner has not chosen yet, so this is not an order of play:
    // it is logged as `roll_off` once the proposals it chooses between are drawn.
    if (choosing) rollOffRecord = { rolls, winner, dice: rollOffDice }
    else log.push({ kind: 'order_of_play', rolls, firstPlayer, dice: rollOffDice })
  } else {
    firstPlayer = options.firstPlayer
  }

  log.unshift(
    choosing
      ? { kind: 'game_start', seed: options.seed }
      : { kind: 'game_start', seed: options.seed, firstPlayer },
  )

  // The roll-off's other prize: the loser draws the Frontier, from a terrain sharing
  // an element with their species.
  const frontierSetter = opponentOf(firstPlayer)

  // Step 5: the three terrain dice, drawn in this order -- p1_home, then the
  // Frontier (one proposal, or two under the choice), then p2_home -- and only for the slots
  // `options.terrains` does not pin. A pinned slot consumes no draw at all, the
  // named-force rule again: not "the same draws", none, or a partly pinned game
  // would land on a different board than the same seed gives a fully pinned one.
  let p1HomeDie: string
  if (options.terrains?.p1_home !== undefined) {
    p1HomeDie = options.terrains.p1_home
  } else {
    const [dieId, next] = drawHomeDie(forces.p1, rng)
    p1HomeDie = dieId
    rng = next
  }

  // Under the choice both players propose, in player order -- each from a terrain
  // sharing an element with their own species, the same draw the `split` rung gives
  // the loser alone. Pinning the Frontier never reaches here (see `choosing`).
  let frontierDie: string
  let proposals: Readonly<Record<PlayerId, string>> | null = null
  if (options.terrains?.frontier !== undefined) {
    frontierDie = options.terrains.frontier
  } else if (choosing) {
    const [p1Proposal, afterP1] = drawFrontierDie(forces.p1, rng)
    const [p2Proposal, afterP2] = drawFrontierDie(forces.p2, afterP1)
    rng = afterP2
    proposals = { p1: p1Proposal, p2: p2Proposal }
    frontierDie = p1Proposal
  } else {
    const [dieId, next] = drawFrontierDie(forces[frontierSetter], rng)
    frontierDie = dieId
    rng = next
  }

  let p2HomeDie: string
  if (options.terrains?.p2_home !== undefined) {
    p2HomeDie = options.terrains.p2_home
  } else {
    const [dieId, next] = drawHomeDie(forces.p2, rng)
    p2HomeDie = dieId
    rng = next
  }

  // Step 6: opening terrain faces.
  const dice: Readonly<Record<TerrainSlot, string>> = {
    p1_home: p1HomeDie,
    frontier: frontierDie,
    p2_home: p2HomeDie,
  }
  let terrains = {} as Record<TerrainSlot, TerrainInPlay>

  if (proposals !== null && rollOffRecord !== null) {
    // Step 6 waits for the choice: "the player that selected the Frontier Terrain rolls
    // that die" -- after selecting it. Until then the terrains are the placeholder
    // `GameState.rollOff` describes, and nothing is rolled.
    for (const dieId of [dice.p1_home, proposals.p1, proposals.p2, dice.p2_home]) terrainDie(dieId)
    terrains = placeholderTerrains(dice.p1_home, proposals.p1, dice.p2_home)
    log.push({ kind: 'roll_off', ...rollOffRecord, proposals })
  } else {
    for (const slot of ['p1_home', 'frontier', 'p2_home'] as const) {
      const dieId = dice[slot]
      terrainDie(dieId) // throws if the die is not in the data
      const [face, next] = rollStartingFace(rng)
      rng = next
      terrains[slot] = { slot, dieId, face, capturedBy: null }
      log.push({ kind: 'terrain_placed', slot, dieId, face })
    }
  }

  // Step 7: the dragons, last of all and **only under `dragons: true`**, so every
  // game recorded without them draws exactly what it always drew and the goldens
  // replay byte-identical. Each player's pool first, then the Frontier seeds.
  const dragons: Record<string, DragonInPlay> = {}
  if (ruleSet.dragons) {
    const pools = {} as Record<PlayerId, readonly DragonInPlay[]>

    for (const player of ['p1', 'p2'] as const) {
      const count = dragonCount(forceHealth(forces[player]))
      const [dieIds, next] = drawDragonDice(forces[player], count, rng)
      rng = next
      pools[player] = dieIds.map((dieId, ordinal) => ({
        id: `${player}:${dieId}#${ordinal}`,
        dieId,
        owner: player,
        location: { kind: 'pool' } as const,
      }))
    }

    // Phase 6's house rule: one dragon each starts at the Frontier, drawn from that
    // player's own pool. Without it nothing could leave a pool at all and the whole
    // Dragon Attack Phase would be unreachable by any legal sequence of actions.
    //
    // **It retires under `magic: 'spells'`** (Phase 7c), because `Summon Dragon` is
    // the route the base rules intend and it now exists. So the seed is gated on the
    // absence of the thing that replaces it rather than removed: `DRAGON_RULES` is
    // still a playable configuration and still needs it.
    //
    // A pool of one is a forced choice and draws nothing, the same rule that governs
    // a pinned terrain and a named force.
    const seedFrontier = ruleSet.magic !== 'spells'

    for (const player of ['p1', 'p2'] as const) {
      const pool = pools[player]
      let index = 0
      if (seedFrontier && pool.length > 1) {
        const [drawn, next] = nextInt(rng, pool.length)
        rng = next
        index = drawn
      }

      for (const [i, dragon] of pool.entries()) {
        dragons[dragon.id] =
          seedFrontier && i === index
            ? { ...dragon, location: { kind: 'terrain', slot: 'frontier' } }
            : dragon
      }

      const seeded = pool[index]
      if (seeded === undefined) throw new Error(`${player} drew no dragons at all`)
      log.push({
        kind: 'dragons_drawn',
        player,
        pool: pool.map((d) => d.dieId),
        ...(seedFrontier ? { frontier: seeded.dieId } : {}),
      })
    }
  }

  const rollOff: RollOffState | null =
    proposals !== null && rollOffRecord !== null ? { winner: rollOffRecord.winner, proposals } : null

  return {
    ruleSet,
    rng,
    units,
    terrains,
    effects: [],
    dragons,
    ...(rollOff !== null ? { rollOff } : {}),
    turn: {
      // While the choice is open the winner is "marching" only in the sense that the
      // turn machine needs a name there; `settleRollOff` writes the real one.
      marching: firstPlayer,
      phase: rollOff !== null ? 'setup' : 'effects_expire',
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

// --- the roll-off choice (v1 Phase 10e) ---------------------------------------------

/** The placeholder terrains of an open roll-off choice: every face 1, nobody holding
 *  anything, p1's proposal in the Frontier slot. See `GameState.rollOff`. */
export function placeholderTerrains(
  p1Home: string,
  p1Proposal: string,
  p2Home: string,
): Record<TerrainSlot, TerrainInPlay> {
  return {
    p1_home: { slot: 'p1_home', dieId: p1Home, face: 1, capturedBy: null },
    frontier: { slot: 'frontier', dieId: p1Proposal, face: 1, capturedBy: null },
    p2_home: { slot: 'p2_home', dieId: p2Home, face: 1, capturedBy: null },
  }
}

/** The decision an open roll-off is waiting on, or null when there is none. */
export function rollOffPending(state: GameState): Pending | null {
  const open = state.rollOff
  if (open === undefined) return null
  return open.firstTurnTaken === true
    ? { kind: 'choose_frontier', player: opponentOf(open.winner), proposals: open.proposals }
    : { kind: 'roll_off_choice', player: open.winner, proposals: open.proposals }
}

function openRollOff(state: GameState, expecting: 'winner' | 'loser'): RollOffState {
  const open = state.rollOff
  if (open === undefined) throw new IllegalActionError('there is no roll-off choice open')
  if ((open.firstTurnTaken === true) !== (expecting === 'loser')) {
    throw new IllegalActionError(
      expecting === 'winner'
        ? 'the roll-off winner has already chosen; the loser is picking the Frontier'
        : 'the roll-off winner has not taken the first turn, so there is no Frontier to pick',
    )
  }
  return open
}

function checkProposer(proposer: PlayerId): void {
  if (proposer !== 'p1' && proposer !== 'p2') {
    throw new IllegalActionError(`${String(proposer)} is not a player, so it proposed no Frontier`)
  }
}

/** The winner's answer: the first turn, or a Frontier -- which gives the loser the
 *  first turn. */
export function applyRollOffChoice(
  state: GameState,
  take: 'first_turn' | 'frontier',
  proposer: PlayerId | undefined,
): GameState {
  const open = openRollOff(state, 'winner')
  if (take === 'first_turn') return { ...state, rollOff: { ...open, firstTurnTaken: true } }
  if (proposer === undefined) throw new IllegalActionError('choosing the Frontier names a proposal')
  checkProposer(proposer)
  return settleRollOff(state, open, 'frontier', proposer, opponentOf(open.winner))
}

/** The loser's answer, once the winner has taken the first turn. */
export function applyChooseFrontier(state: GameState, proposer: PlayerId): GameState {
  const open = openRollOff(state, 'loser')
  checkProposer(proposer)
  return settleRollOff(state, open, 'first_turn', proposer, open.winner)
}

/**
 * The choice made: the Frontier is placed, all three starting faces are rolled in slot
 * order -- setup step 5, which the rules put after step 4 -- and the first turn opens.
 *
 * Built field by field rather than spread, so `rollOff` is dropped by omission: the same
 * rule every optional field near the digest follows.
 */
function settleRollOff(
  state: GameState,
  open: RollOffState,
  took: 'first_turn' | 'frontier',
  proposer: PlayerId,
  firstPlayer: PlayerId,
): GameState {
  const dice: Readonly<Record<TerrainSlot, string>> = {
    p1_home: state.terrains.p1_home.dieId,
    frontier: open.proposals[proposer],
    p2_home: state.terrains.p2_home.dieId,
  }

  let rng = state.rng
  const terrains = {} as Record<TerrainSlot, TerrainInPlay>
  const placed: LogEntry[] = []
  for (const slot of TERRAIN_SLOTS) {
    const [face, next] = rollStartingFace(rng)
    rng = next
    terrains[slot] = { slot, dieId: dice[slot], face, capturedBy: null }
    placed.push({ kind: 'terrain_placed', slot, dieId: dice[slot], face })
  }

  return {
    ruleSet: state.ruleSet,
    rng,
    units: state.units,
    terrains,
    effects: state.effects,
    dragons: state.dragons,
    turn: { ...state.turn, marching: firstPlayer, phase: 'effects_expire' },
    pending: null,
    log: [
      ...state.log,
      {
        kind: 'roll_off_decided',
        winner: open.winner,
        took,
        proposer,
        frontier: dice.frontier,
        firstPlayer,
      },
      ...placed,
    ],
    winner: state.winner,
  }
}
