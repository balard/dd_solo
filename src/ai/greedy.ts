/**
 * The v1 opponent: heuristic scoring over each pending's options (v1 Phase 10).
 *
 * Rung two of `OVERVIEW.md` section 4's ladder. Every number it compares comes out of
 * `estimate.ts`, so no two decisions disagree about what one army is worth.
 *
 * **Active over optimal** is the rule every answer below follows: it marches every
 * turn, maneuvers whenever a better face is in reach, attacks whenever it has anything
 * legal, takes every promotion it is offered and brings its reserves back out. An
 * opponent that does something is a better test of the rules than one that does the
 * best thing rarely -- and `PassiveAI` turning down eighteen spells and every friendly
 * SAI had stopped being passive and become handicapped.
 *
 * **Deterministic, and it never draws from the rng it is handed.** Ties go to the first
 * option in the order the pending lists them. A run is still reproducible from
 * `{ seed, aiSeed }`, and trivially so: this player never touches the second one.
 *
 * Where it holds no better opinion yet it answers as `PassiveAI` would, by calling
 * `decideAction` rather than copying it. The spell decisions land in 10c.
 */
import { speciesElements, terrainDie, terrainFaceAction, terrainType, unitType } from '../data/load'
import type { ResultType, TerrainFaceNumber } from '../data/types'
import { legalActions, missileTargets } from '../engine/combat'
import { growthPartners } from '../engine/dua'
import { cannotRoll, isAsleep, thornsAt } from '../engine/effects'
import type { RngState } from '../engine/rng'
import { legalDirections, rollOnTheTable, rollsOnTheTable } from '../engine/turn'
import {
  TERRAIN_SLOTS,
  army,
  opponentOf,
  reserveArmy,
  unitsOf,
  type ActionKind,
  type ArmyRef,
  type Direction,
  type GameAction,
  type GameState,
  type Pending,
  type PlayerId,
  type PromotionPair,
  type TerrainFace,
  type TerrainSlot,
  type UnitId,
  type UnitInstance,
} from '../engine/types'

import {
  contestOdds,
  expectedArmy,
  expectedAttack,
  expectedDie,
  foulStenchBench,
  killValue,
  leastValuableMaximal,
  mostValuableMaximal,
  unitValue,
} from './estimate'
import { decideAction as passiveAnswer } from './passive'
import { announcementValue, chooseAnnouncement } from './spells'
import type { AiPlayer } from './types'

export const greedyAi: AiPlayer = {
  name: 'greedy',

  decide(state: GameState, pending: Pending, rng: RngState) {
    return [decide(state, pending), rng] as const
  },
}

// --- scoring -----------------------------------------------------------------------

/** What holding the eighth face is worth against ordinary terrain progress. Two
 *  captures win the game, so one is worth a great deal more than a kill or two. */
const CAPTURE = 8

const valueOf = (state: GameState, unit: UnitInstance): number => unitValue(unit.typeId, state.ruleSet)
const healthOf = (unit: UnitInstance): number => unitType(unit.typeId).health
const healthIn = (units: readonly UnitInstance[]): number => units.reduce((t, u) => t + healthOf(u), 0)

/** The first option with the best score. Ties keep the pending's own order. */
function best<T>(options: readonly T[], score: (option: T) => number): T | undefined {
  let chosen: T | undefined
  let top = -Infinity
  for (const option of options) {
    const value = score(option)
    if (value > top) {
      top = value
      chosen = option
    }
  }
  return chosen
}

/**
 * How far along the terrain track a face is, from `player`'s side.
 *
 * A point and a half a face, so a step toward the eighth outbids a small die killed --
 * and the eighth itself is worth twice the whole track to its holder and a debt of the
 * whole track to the other side. Two captures win the game, which is why a march that
 * walks an unopposed terrain home has to outscore a skirmish, and why knocking an
 * enemy off their eighth face is the best march on the board.
 */
function progress(player: PlayerId, face: TerrainFace, capturedBy: PlayerId | null): number {
  if (face === 8) return capturedBy === player ? CAPTURE * 2 : -CAPTURE
  return face * 1.5
}

/**
 * The actions an army would have at `slot` if the terrain showed `face`.
 *
 * `legalActions` restated for a face the terrain is not on yet: the maneuver decision
 * has to ask what the army could do *after* moving, and the engine only answers for
 * the board as it stands. The same three filters -- melee needs someone to hit, missile
 * needs a target, and real magic needs nothing.
 */
function actionsAtFace(
  state: GameState,
  player: PlayerId,
  slot: TerrainSlot,
  face: TerrainFace,
  capturedBy: PlayerId | null,
): readonly ActionKind[] {
  let offered: readonly ActionKind[]
  if (face === 8) {
    if (state.ruleSet.eighthFace === 'captureOnly') return []
    offered = capturedBy === player ? ['melee', 'missile', 'magic'] : ['melee']
  } else {
    const die = state.terrains[slot].dieId
    offered = [terrainFaceAction(die, face as TerrainFaceNumber).toLowerCase() as ActionKind]
  }
  const enemyHere = army(state, opponentOf(player), slot).length > 0
  return offered.filter((action) => {
    if (action === 'missile') return missileTargets(state, player, slot).length > 0
    if (action === 'magic' && state.ruleSet.magic === 'spells') return true
    return enemyHere
  })
}

/**
 * Magic's worth: what it actually does under the rules being played.
 *
 * Under v0's house rule that is `floor(M / 2)` damage at the army opposite, with no
 * save. Under real spells it is the announcement the army's expected pool would buy
 * (`spells.ts`). Before 10c that half read zero, because greedy announced nothing --
 * and valuing magic by its dice instead made greedy cast into the void every march
 * while a terrain it could have walked home sat untouched.
 */
function magicValue(state: GameState, player: PlayerId, ref: ArmyRef): number {
  if (state.ruleSet.magic === 'spells') return announcementValue(state, player, ref)
  if (ref === 'reserve') return 0
  const enemy = army(state, opponentOf(player), ref)
  return killValue(enemy, expectedArmy(state, player, ref, 'magic').total / 2)
}

/** What a missile from `from` at `target` is expected to kill. */
function missileValue(state: GameState, player: PlayerId, from: ArmyRef, target: ArmyRef): number {
  const { damage } = expectedAttack(state, player, from, 'missile', target)
  return killValue(army(state, opponentOf(player), target), damage)
}

/**
 * One action's expected worth to the army at `ref`: health it kills, less half the
 * health the defender's Counters are expected to send back.
 */
function actionValue(state: GameState, player: PlayerId, ref: ArmyRef, action: ActionKind): number {
  if (action === 'magic') return magicValue(state, player, ref)
  if (ref === 'reserve') return 0

  if (action === 'missile') {
    const values = missileTargets(state, player, ref).map((target) =>
      missileValue(state, player, ref, target),
    )
    return Math.max(0, ...values)
  }

  const enemy = army(state, opponentOf(player), ref)
  if (enemy.length === 0) return 0
  const outcome = expectedAttack(state, player, ref, 'melee', ref)
  return killValue(enemy, outcome.damage) - killValue(army(state, player, ref), outcome.riposte) / 2
}

const bestAction = (
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  actions: readonly ActionKind[],
): number => Math.max(0, ...actions.map((action) => actionValue(state, player, ref, action)))

/** What one march at a terrain could achieve, and whether it should maneuver first. */
interface MarchPlan {
  /** Gain over standing still with nothing done. */
  readonly value: number
  readonly maneuver: boolean
  /** The direction a maneuver should take, when it is taken. */
  readonly direction: Direction
}

/**
 * Stay and act, or move the terrain first and then act.
 *
 * A failed maneuver still leaves the army its action at the face it never left, so
 * trying costs nothing but the Wall of Thorns a success walks into -- which is why a
 * contest the army is expected to lose halves the gain rather than ruling it out.
 * That is the "maneuver even with the odds slightly against it" of the plan.
 */
function marchPlan(state: GameState, player: PlayerId, slot: TerrainSlot): MarchPlan {
  const terrain = state.terrains[slot]
  const here = progress(player, terrain.face, terrain.capturedBy)
  const stay = bestAction(state, player, slot, legalActions(state, player, slot))

  const enemyHere = army(state, opponentOf(player), slot).length > 0
  const odds = enemyHere ? (contestOdds(state, player, slot).margin >= 0 ? 1 : 0.5) : 1
  const thorns = thornsAt(state, slot) > 0 ? killValue(army(state, player, slot), thornsAt(state, slot)) : 0

  let plan: MarchPlan = { value: stay, maneuver: false, direction: 'up' }
  for (const direction of legalDirections(terrain.face)) {
    const face = (direction === 'up' ? terrain.face + 1 : terrain.face - 1) as TerrainFace
    const holder = face === 8 ? player : null
    const moved =
      progress(player, face, holder) - here +
      bestAction(state, player, slot, actionsAtFace(state, player, slot, face, holder))
    const expected = stay + odds * (moved - stay) - thorns
    if (expected > plan.value) plan = { value: expected, maneuver: true, direction }
  }
  return plan
}

/** Which way to turn a terrain once a maneuver has succeeded: the better face, up on a
 *  tie. Nothing to weigh against standing still any more -- the move is happening. */
function bestDirection(
  state: GameState,
  player: PlayerId,
  slot: TerrainSlot,
  options: readonly Direction[],
): Direction {
  const terrain = state.terrains[slot]
  const score = (direction: Direction): number => {
    const face = (direction === 'up' ? terrain.face + 1 : terrain.face - 1) as TerrainFace
    const holder = face === 8 ? player : null
    return (
      progress(player, face, holder) +
      bestAction(state, player, slot, actionsAtFace(state, player, slot, face, holder))
    )
  }
  const ordered = [...options].sort((a, b) => (a === 'up' ? -1 : b === 'up' ? 1 : 0))
  return best(ordered, score) ?? options[0] ?? 'up'
}

/**
 * How much a terrain wants another die of ours.
 *
 * Outnumbered is the loudest voice: the health gap. After it, an eighth face the enemy
 * holds (take it back), a terrain one step from capture with nobody opposing (walk it
 * home), and an empty terrain (a presence is the start of a capture).
 */
function frontScore(state: GameState, player: PlayerId, slot: TerrainSlot, extra = 0): number {
  const mine = healthIn(army(state, player, slot)) + extra
  const theirs = healthIn(army(state, opponentOf(player), slot))
  const terrain = state.terrains[slot]

  let score = theirs - mine
  if (terrain.face === 8 && terrain.capturedBy === opponentOf(player)) score += CAPTURE / 2
  if (terrain.face >= 6 && terrain.face < 8 && theirs === 0) score += 2
  if (mine === 0 && theirs === 0) score += 1
  return score
}

/** The expected results one die gives on the roll that is on the table, so a reroll
 *  can be judged against what the die usually does. */
function expectedOnTable(state: GameState, typeId: string, kind: 'attack' | 'save' | 'maneuver' | 'dragon'): number | null {
  let type: ResultType
  if (kind === 'save') type = 'save'
  else if (kind === 'maneuver') type = 'maneuver'
  else if (kind === 'attack' && state.turn.combat !== null) type = state.turn.combat.action
  else return null
  const { share } = expectedDie(typeId, type, { purpose: purposeFor(type), isCounter: false }, state.ruleSet)
  return share.id + share.normal + share.sai
}

function purposeFor(type: ResultType) {
  if (type === 'save') return { kind: 'save', against: null } as const
  if (type === 'maneuver') return { kind: 'maneuver' } as const
  return { kind: 'attack', action: type as ActionKind } as const
}

/** The dice on the table that came in under their own expectation, worst first. */
function belowExpectation(state: GameState, eligible: readonly UnitId[]): readonly UnitId[] {
  const table = rollOnTheTable(state)
  if (table === null) return []
  const shortfalls: { unitId: UnitId; gap: number }[] = []
  for (const die of table.dice) {
    if (!eligible.includes(die.unitId)) continue
    const expected = expectedOnTable(state, die.typeId, table.kind)
    if (expected === null) continue
    const gap = die.results - expected
    if (gap < 0) shortfalls.push({ unitId: die.unitId, gap })
  }
  return shortfalls.sort((a, b) => a.gap - b.gap).map((s) => s.unitId)
}

/** Wild Growth: spend the budget on the promotions worth most, one at a time. */
function growthPairs(state: GameState, player: PlayerId, ref: ArmyRef, budget: number): readonly PromotionPair[] {
  const pairs: PromotionPair[] = []
  const used = new Set<UnitId>()
  let left = budget

  for (;;) {
    let choice: { pair: PromotionPair; gain: number; cost: number } | null = null
    for (const unit of army(state, player, ref)) {
      if (used.has(unit.id)) continue
      for (const partner of growthPartners(state, unit.id, left)) {
        if (used.has(partner.id)) continue
        const gain = valueOf(state, partner) - valueOf(state, unit)
        if (choice === null || gain > choice.gain) {
          choice = {
            pair: { unitId: unit.id, partnerId: partner.id },
            gain,
            cost: healthOf(partner) - healthOf(unit),
          }
        }
      }
    }
    if (choice === null) return pairs
    pairs.push(choice.pair)
    used.add(choice.pair.unitId)
    used.add(choice.pair.partnerId)
    left -= choice.cost
  }
}

/** The promotion worth most, by what the army gains in value. */
function bestPromotion(state: GameState, promotions: readonly PromotionPair[]): { pair: PromotionPair; gain: number } | null {
  const pair = best(promotions, (p) => promotionValue(state, p))
  return pair === undefined ? null : { pair, gain: promotionValue(state, pair) }
}

function promotionValue(state: GameState, pair: PromotionPair): number {
  const unit = state.units[pair.unitId]
  const partner = state.units[pair.partnerId]
  if (unit === undefined || partner === undefined) return 0
  return valueOf(state, partner) - valueOf(state, unit)
}

/** Whether any die in the player's DUA carries a Rise from the Ashes face. */
function duaCanRise(state: GameState, player: PlayerId): boolean {
  return Object.values(state.units).some(
    (unit) =>
      unit.owner === player &&
      unit.location.kind === 'dua' &&
      unitType(unit.typeId).faces.some((face) => face.icon === 'SAI' && face.sai === 'Rise from the Ashes'),
  )
}

/**
 * How much a proposed Frontier favours `player`: the elements it shares with their
 * dice, less the ones it shares with the enemy's.
 *
 * Per die since v2 Phase 1: the elements each die's species shares with the terrain,
 * averaged over the force by health. For a one-species force that is exactly the
 * number it always was -- every die shares the same count -- and a mixed force is
 * weighed by how much of it the terrain would favour.
 *
 * Elements are what the terrain's action and every species ability in this box key
 * on -- Replanting and Rapid Growth at water and earth, Air Flight and Flaming Shields
 * at air and fire, and a spell's colour through Standing Stones -- so a Frontier of your
 * own colours is one where your side's rules work and theirs do not.
 */
export function frontierScore(state: GameState, player: PlayerId, dieId: string): number {
  const elements = terrainType(terrainDie(dieId).type).elements
  const shared = (who: PlayerId): number => {
    let weighted = 0
    let health = 0
    for (const unit of unitsOf(state, who)) {
      const type = unitType(unit.typeId)
      weighted += type.health * speciesElements(type.species).filter((e) => elements.includes(e)).length
      health += type.health
    }
    return health === 0 ? 0 : weighted / health
  }
  return shared(player) - shared(opponentOf(player))
}

/** What the first march of the game is worth against the pick of the Frontier: about
 *  one shared element. The Frontier is taken only when the proposals differ by more. */
const FIRST_TURN = 1.5

// --- the decisions -------------------------------------------------------------------

function decide(state: GameState, pending: Pending): GameAction {
  const player = pending.player

  switch (pending.kind) {
    // The roll-off (v1 Phase 10e). Taking the first turn hands the loser the pick, and
    // the loser will pick the proposal worst for us -- so the Frontier is worth taking
    // only when the best proposal beats that one by more than a first march is worth.
    case 'roll_off_choice': {
      const proposers = ['p1', 'p2'] as const
      const score = (proposer: PlayerId): number => frontierScore(state, player, pending.proposals[proposer])
      const mine = best(proposers, score) ?? 'p1'
      const theirs = best(proposers, (proposer) => -score(proposer)) ?? 'p1'
      return score(mine) - score(theirs) > FIRST_TURN
        ? { kind: 'roll_off_choice', take: 'frontier', proposer: mine }
        : { kind: 'roll_off_choice', take: 'first_turn' }
    }

    case 'choose_frontier':
      return {
        kind: 'choose_frontier',
        proposer: best(['p1', 'p2'] as const, (proposer) => frontierScore(state, player, pending.proposals[proposer])) ?? pending.player,
      }

    // Always marches. Every army scores what its march could achieve, the Reserve Army
    // its magic; standing still is never among the answers while an army can go.
    case 'choose_march_army': {
      const score = (ref: ArmyRef): number =>
        ref === 'reserve' ? magicValue(state, player, ref) : marchPlan(state, player, ref).value
      return { kind: 'choose_march_army', army: best(pending.options, score) ?? null }
    }

    case 'choose_maneuver':
      return { kind: 'choose_maneuver', maneuver: marchPlan(state, player, pending.slot).maneuver }

    case 'choose_direction':
      return { kind: 'choose_direction', direction: bestDirection(state, player, pending.slot, pending.options) }

    // Both free, as they are for passive: a contest costs a roll with no other use, and
    // a counter-attack is damage the defender would otherwise leave on the table.
    case 'contest_maneuver':
      return { kind: 'contest_maneuver', contest: true }
    case 'choose_counter_attack':
      return { kind: 'choose_counter_attack', counter: true }

    // Never a pass while anything is legal, even at zero expected value -- an action
    // that kills nothing still rolls, and a roll is where the SAIs live.
    case 'choose_action':
      return {
        kind: 'choose_action',
        action: best(pending.legal, (action) => actionValue(state, player, pending.slot, action)) ?? null,
      }

    case 'choose_missile_target': {
      const from = state.turn.marchingArmy ?? 'reserve'
      const target = best(pending.options, (to) => missileValue(state, player, from, to))
      return { kind: 'choose_missile_target', slot: target ?? pending.options[0] ?? 'frontier' }
    }

    // Its own losses: the cheapest maximal set, which is the same health whichever set
    // dies, and very different in what survives.
    case 'assign_damage':
      return {
        kind: 'assign_damage',
        unitIds: leastValuableMaximal(army(state, player, pending.slot), pending.damage, state.ruleSet),
      }
    case 'dragon_breath':
      return {
        kind: 'dragon_breath',
        unitIds: leastValuableMaximal(army(state, player, pending.slot), pending.health, state.ruleSet),
      }
    case 'temple_bury': {
      const unitId = best(pending.options, (id) => {
        const unit = state.units[id]
        return unit === undefined ? 0 : -valueOf(state, unit)
      })
      return { kind: 'temple_bury', unitId: unitId ?? pending.options[0] ?? '' }
    }

    // The enemy's losses: the dearest maximal set. Sleep takes one die, so the most
    // valuable one still awake -- a second Sleep on a sleeper buys nothing.
    case 'sai_target': {
      const targets = army(state, pending.target, pending.slot).filter(
        (unit) => pending.eligible === undefined || pending.eligible.includes(unit.id),
      )
      if (pending.limit.kind === 'one' && pending.bash !== undefined) {
        // Bash (v2 Phase 6d): the die that put in the most melee gives the most saves
        // and takes the most damage back, so both halves want it; ties to the dearest.
        const melee = pending.bash
        const pick = best(targets, (unit) => (melee[unit.id] ?? 0) * 100 + valueOf(state, unit))
        return { kind: 'sai_target', unitIds: pick === undefined ? [] : [pick.id] }
      }
      if (pending.limit.kind === 'one') {
        // Sleep wants a die that can still roll -- sleeping one twice buys nothing.
        // Swallow wants the opposite: a die that cannot roll cannot roll its ID, so it
        // is a certain kill and burial.
        const awake = targets.filter((unit) => !cannotRoll(state, unit.id))
        const stuck = targets.filter((unit) => cannotRoll(state, unit.id))
        const preferred = pending.sai === 'Sleep' ? awake : stuck
        const pick = best(preferred.length > 0 ? preferred : targets, (unit) => valueOf(state, unit))
        return { kind: 'sai_target', unitIds: pick === undefined ? [] : [pick.id] }
      }
      return {
        kind: 'sai_target',
        unitIds: mostValuableMaximal(targets, pending.limit.budget, state.ruleSet),
      }
    }

    // Galeforce: the army about to save against us if it is on offer, else the biggest.
    case 'sai_target_army': {
      const facing = state.turn.combat?.targetSlot
      const slot =
        facing !== undefined && facing !== 'reserve' && pending.options.includes(facing)
          ? facing
          : best(pending.options, (s) => healthIn(army(state, opponentOf(player), s)))
      return { kind: 'sai_target_army', slot: slot ?? pending.options[0] ?? 'frontier' }
    }

    // Every friendly offer is taken: a promotion is health that never has to be won
    // back, and "maybe later" is not a thing an SAI offers.
    case 'sai_promote':
      return { kind: 'sai_promote', pairs: growthPairs(state, player, pending.slot, pending.budget) }

    // Regenerate (v2 Phase 7d): dice back are health kept for good, saves are one roll's
    // worth -- so the dearest dead that fit, and the saves only when nothing does.
    case 'sai_regenerate': {
      const dead = pending.eligible
        .map((id) => state.units[id])
        .filter((unit): unit is UnitInstance => unit !== undefined)
      const unitIds = mostValuableMaximal(dead, pending.budget, state.ruleSet)
      if (unitIds.length === 0 && pending.saveResultsCount) {
        return { kind: 'sai_regenerate', choice: { kind: 'saves' } }
      }
      return { kind: 'sai_regenerate', choice: { kind: 'units', unitIds } }
    }

    // Foul Stench (v2 Phase 7d): bench the dice that would add least to the counter.
    case 'foul_stench':
      return { kind: 'foul_stench', unitIds: foulStenchBench(state, player, pending.slot, pending.count) }

    case 'eighth_face_city': {
      const promotion = bestPromotion(state, pending.promotions)
      const recruitId = best(pending.recruits, (id) => {
        const unit = state.units[id]
        return unit === undefined ? 0 : valueOf(state, unit)
      })
      const recruitValue =
        recruitId === undefined ? -Infinity : valueOf(state, state.units[recruitId] as UnitInstance)
      if (promotion !== null && promotion.gain >= recruitValue) {
        return { kind: 'eighth_face_city', choice: { kind: 'promote', pair: promotion.pair } }
      }
      if (recruitId !== undefined) {
        return { kind: 'eighth_face_city', choice: { kind: 'recruit', unitId: recruitId } }
      }
      return { kind: 'eighth_face_city', choice: null }
    }

    case 'dragon_treasure':
      return { kind: 'dragon_treasure', pair: bestPromotion(state, pending.promotions)?.pair ?? null }

    // Passive already takes every exchange it can, heaviest dying die first; greedy
    // has no better opinion, since the dying die lands in the DUA either way.
    case 'accelerated_growth':
      return passiveAnswer(state, pending)

    // A free move: go where a die is needed most, if that is worth leaving for.
    case 'sai_move': {
      const origin = pending.slot
      const leaving =
        origin === 'reserve'
          ? -Infinity
          : army(state, opponentOf(player), origin).length > 0 ||
              (state.terrains[origin].face === 8 && state.terrains[origin].capturedBy === player)
            ? Infinity
            : frontScore(state, player, origin)
      const destination = best(pending.options, (slot) => frontScore(state, player, slot))
      if (destination === undefined || frontScore(state, player, destination) <= leaving + 1) {
        return { kind: 'sai_move', slot: null, unitIds: [] }
      }

      // Passengers, dearest first, within the health budget -- always leaving one die
      // behind on a terrain, so the move never abandons it.
      const others = army(state, player, origin)
        .filter((unit) => unit.id !== pending.unitId && !isAsleep(state, unit.id))
        .sort((a, b) => valueOf(state, b) - valueOf(state, a))
      const keep = origin === 'reserve' ? 0 : 1
      const unitIds: UnitId[] = []
      let carried = 0
      for (const unit of others) {
        if (others.length - unitIds.length <= keep) break
        if (carried + healthOf(unit) > pending.health) continue
        carried += healthOf(unit)
        unitIds.push(unit.id)
      }
      return { kind: 'sai_move', slot: destination, unitIds }
    }

    /**
     * Everything comes out of Reserves, each die to the terrain that wants it most
     * once the dice already sent are counted. The exception is a caster, and only
     * while the Reserve Army's magic is actually worth a march: a Reserve Army marches
     * every turn and casts the spells marked `R`. Keeping casters back on the strength
     * of their class alone parked a lone Ashbringer in Reserves for a whole game, a
     * march every turn casting nothing, while there was nobody on the board to win it.
     */
    case 'reinforce': {
      const reserveMagic = magicValue(state, player, 'reserve') > 0
      const stayBack = (unit: UnitInstance): boolean =>
        reserveMagic && unitType(unit.typeId).unitClass === 'magic'
      const leaving = reserveArmy(state, player)
        .filter((unit) => !stayBack(unit))
        .sort((a, b) => valueOf(state, b) - valueOf(state, a))

      const sent: Record<TerrainSlot, number> = { p1_home: 0, frontier: 0, p2_home: 0 }
      const moves = leaving.map((unit) => {
        const slot = best(TERRAIN_SLOTS, (s) => frontScore(state, player, s, sent[s])) ?? 'frontier'
        sent[slot] += healthOf(unit)
        return { unitId: unit.id, slot }
      })
      return { kind: 'reinforce', moves }
    }

    /**
     * Retreating is how a die changes terrain -- to Reserves now, out again at the next
     * Reinforce Step -- so it is how a second capture gets started.
     *
     * The first self-play games stalled exactly here: greedy held one eighth face with
     * its whole force piled on it, the Frontier sat empty one step from capture, and
     * nothing could ever reach it. So surplus dice leave a held, unopposed eighth face
     * whenever some terrain has none of ours. Half the health stays as the guard: any
     * one die keeps the capture, but an army that arrives next turn has to be met.
     *
     * Air Flight is the other way off a terrain, taken when a die is needed much more
     * elsewhere and its army keeps someone behind.
     */
    case 'retreat': {
      const unitIds: UnitId[] = []
      const somewhereEmpty = TERRAIN_SLOTS.some((s) => army(state, player, s).length === 0)
      /*
       * The endgame case: one army left on the board, sitting on the eighth face it
       * holds, and nothing in Reserves. It can never make a second capture from there,
       * so the capture is worth nothing but a stalemate. Greedy-against-greedy games
       * ended exactly like that, one lone die on each side's eighth face, marching
       * every turn to cast nothing. It leaves and goes hunting instead: the Reinforce
       * Step sends it wherever the enemy is.
       */
      const hunting =
        somewhereEmpty &&
        reserveArmy(state, player).length === 0 &&
        TERRAIN_SLOTS.filter((s) => army(state, player, s).length > 0).length === 1

      for (const slot of TERRAIN_SLOTS) {
        const terrain = state.terrains[slot]
        if (!somewhereEmpty || terrain.face !== 8 || terrain.capturedBy !== player) continue
        if (army(state, opponentOf(player), slot).length > 0) continue

        const here = army(state, player, slot)
        const guard = Math.ceil(healthIn(here) / 2)
        let kept = 0
        const surplus: UnitId[] = []
        for (const unit of [...here].sort((a, b) => valueOf(state, b) - valueOf(state, a))) {
          if (kept < guard || isAsleep(state, unit.id)) kept += healthOf(unit)
          else surplus.push(unit.id)
        }
        // An army that can split sends its surplus and keeps the capture; only one
        // that cannot -- the guard is the whole of it -- leaves to hunt.
        if (surplus.length === 0 && hunting) {
          unitIds.push(...here.filter((unit) => !isAsleep(state, unit.id)).map((unit) => unit.id))
        } else {
          unitIds.push(...surplus)
        }
      }

      const flights: { unitId: UnitId; slot: TerrainSlot }[] = []
      const leftBehind = new Map<TerrainSlot, number>()
      for (const offer of pending.flights ?? []) {
        if (unitIds.includes(offer.unitId)) continue
        const unit = state.units[offer.unitId]
        if (unit === undefined || unit.location.kind !== 'terrain') continue
        const origin = unit.location.slot
        const remaining =
          leftBehind.get(origin) ??
          army(state, player, origin).filter((u) => !unitIds.includes(u.id)).length
        if (remaining <= 1) continue
        const destination = best(offer.options, (slot) => frontScore(state, player, slot))
        if (destination === undefined) continue
        if (frontScore(state, player, destination) < frontScore(state, player, origin) + 2) continue
        flights.push({ unitId: offer.unitId, slot: destination })
        leftBehind.set(origin, remaining - 1)
      }
      return { kind: 'retreat', unitIds, ...(flights.length > 0 ? { flights } : {}) }
    }

    // Throw again only what came in under what the die usually gives.
    case 'rapid_growth':
      return { kind: 'rapid_growth', unitIds: belowExpectation(state, pending.options) }
    case 'flashfire':
      return {
        kind: 'flashfire',
        unitIds: belowExpectation(state, pending.options).slice(0, pending.budget),
      }

    // Forces the burial, unless the opponent's dead include a Phoenix: forcing it hands
    // them a Rise from the Ashes roll they would not otherwise get.
    case 'eighth_face_temple':
      return { kind: 'eighth_face_temple', force: !duaCanRise(state, opponentOf(player)) }

    case 'announce_spells':
      return {
        kind: 'announce_spells',
        casts: chooseAnnouncement(state, player, pending.slot, pending.castable, pending.pool).casts,
      }

    // Dispel Magic negates whatever reaches the unit, its army or its terrain, whoever
    // cast it -- so it rolls against the opponent's announcement and never its own.
    case 'dispel_magic': {
      const caster = state.turn.magic?.caster ?? state.turn.marching
      return { kind: 'dispel_magic', roll: caster !== player }
    }

    // Path: to the terrain that wants a die most.
    case 'spell_move':
      return {
        kind: 'spell_move',
        slot: best(pending.options, (slot) => frontScore(state, player, slot)) ?? pending.options[0] ?? 'frontier',
      }

    // Summon Dragon: a dragon from a Summoning Pool before one already standing on a
    // terrain, where it may be attacking the enemy already.
    case 'spell_summon': {
      const fromPool = pending.options.find((id) => state.dragons[id]?.location.kind === 'pool')
      return { kind: 'spell_summon', dragonId: fromPool ?? pending.options[0] ?? '' }
    }

    // Dragons: passive's answers. Its damage split already kills what it can, and a
    // better allocation needs per-kind totals the pending does not carry.
    case 'dragon_order':
    case 'dragon_target':
    case 'dragon_allocate':
    case 'dragon_damage_split':
      return passiveAnswer(state, pending)

    case 'charge_allocate':
      return chargeAllocation(state, pending)
  }
}

/**
 * Charge (v2 Phase 6e): enough saves to cover the attack, and everything past that as
 * melee, which goes straight back at the charger. Read off the two rolls on the table --
 * the save roll as drawn has every ID on save, so what the dice give without them is
 * that total less the pool. Saves past the attack buy nothing, so Flaming Shields
 * converts exactly those.
 */
function chargeAllocation(
  state: GameState,
  pending: Extract<Pending, { kind: 'charge_allocate' }>,
): GameAction {
  const rolls = rollsOnTheTable(state)
  const attack = rolls.find((roll) => roll.kind === 'attack')?.roll.total ?? 0
  const saves = rolls.find((roll) => roll.kind === 'save')?.roll.total ?? 0
  const without = Math.max(0, saves - pending.ids - pending.flexible)

  const idSaves = Math.min(pending.ids, Math.max(0, attack - without))
  const flexSaves = Math.min(pending.flexible, Math.max(0, attack - without - idSaves))
  const spare = Math.max(0, without + idSaves + flexSaves - attack)
  const converted = Math.min(pending.shields ?? 0, spare)
  const split = (total: number, toSave: number) => ({
    ...(toSave > 0 ? { save: toSave } : {}),
    ...(total - toSave > 0 ? { melee: total - toSave } : {}),
  })
  return {
    kind: 'charge_allocate',
    ids: split(pending.ids, idSaves),
    flexible: split(pending.flexible, flexSaves),
    ...(converted > 0 ? { savesAsMelee: converted } : {}),
  }
}
