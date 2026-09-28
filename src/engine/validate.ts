/**
 * Invariant checker for `GameState`.
 *
 * Returns a list of problems rather than throwing, so tests can assert on the exact
 * complaint and the self-play fuzz harness in Phase 6 can report every violation at
 * once instead of only the first.
 *
 * Note what is *not* checked: "every unit is in exactly one place" is structurally
 * guaranteed, because a unit's location is a field on the unit and there is no
 * parallel list of armies or dead units to drift out of sync. That was the point of
 * deriving armies by query, and adding the BUA did not weaken it -- `PLAN-V1.md`
 * asked Phase 2 for that check, and it would still be a check that cannot fail.
 *
 * There was a check here that every unit of a player shares one species, standing in
 * for "an exchange with the DUA stays within a species": a cross-species promotion was
 * the only thing that could give a force a second species. v2 Phase 1 removed it,
 * because a mixed force is legal now and a state cannot say how it came to be mixed.
 * The rule it guarded -- p. 30, "a unit ... of the same species" -- is enforced where
 * it can be, in `exchangeWithDua`, the one door every promotion goes through.
 */
import { UNIT_TYPES, dragonDie, terrainDie } from '../data/load'

import { pruneEffects } from './effects'
import { MID_EXCHANGE_STEPS } from './turn'
import {
  TERRAIN_SLOTS,
  capturedCount,
  livingUnits,
  type GameState,
  type PlayerId,
} from './types'

const LOCATION_KINDS: readonly string[] = ['terrain', 'reserve', 'dua', 'bua']
const DRAGON_LOCATION_KINDS: readonly string[] = ['terrain', 'pool']


const PLAYERS: readonly PlayerId[] = ['p1', 'p2']

export function validateState(state: GameState): string[] {
  const problems: string[] = []
  const knownTypes = new Set(UNIT_TYPES.map((u) => u.id))

  for (const [key, unit] of Object.entries(state.units)) {
    if (unit.id !== key) {
      problems.push(`unit ${key}: keyed as ${key} but its id is ${unit.id}`)
    }
    if (!knownTypes.has(unit.typeId)) {
      problems.push(`unit ${unit.id}: unknown unit type ${unit.typeId}`)
    }
    if (unit.owner !== 'p1' && unit.owner !== 'p2') {
      problems.push(`unit ${unit.id}: unknown owner ${String(unit.owner)}`)
    }
    if (!LOCATION_KINDS.includes(unit.location.kind)) {
      problems.push(`unit ${unit.id}: unknown location ${String(unit.location.kind)}`)
    }
    if (unit.location.kind === 'terrain' && !TERRAIN_SLOTS.includes(unit.location.slot)) {
      problems.push(`unit ${unit.id}: unknown terrain slot ${String(unit.location.slot)}`)
    }
  }


  for (const slot of TERRAIN_SLOTS) {
    const terrain = state.terrains[slot] as GameState['terrains'][typeof slot] | undefined
    if (terrain === undefined) {
      problems.push(`terrain ${slot}: missing`)
      continue
    }
    if (terrain.slot !== slot) {
      problems.push(`terrain ${slot}: keyed as ${slot} but its slot is ${terrain.slot}`)
    }
    if (!Number.isInteger(terrain.face) || terrain.face < 1 || terrain.face > 8) {
      problems.push(`terrain ${slot}: face ${terrain.face} is outside 1-8`)
    }
    try {
      terrainDie(terrain.dieId)
    } catch {
      problems.push(`terrain ${slot}: unknown terrain die ${terrain.dieId}`)
    }

    // A terrain is captured exactly when it is on its eighth face. Letting these
    // drift apart would silently break both the win check and the revert-to-7 rule.
    if (terrain.face === 8 && terrain.capturedBy === null) {
      problems.push(`terrain ${slot}: on face 8 but nobody has captured it`)
    }
    if (terrain.face !== 8 && terrain.capturedBy !== null) {
      problems.push(`terrain ${slot}: captured by ${terrain.capturedBy} but on face ${terrain.face}`)
    }
  }

  // Dragons. A pool that never empties is legal (a 2-dragon force keeps its spare
  // all game, and nothing summons before Phase 7), and so is a pool that is empty
  // from setup on (a 1-dragon force sends its only dragon to the Frontier). Neither
  // is worth checking; what is, is a dragon that is nowhere real.
  for (const [key, dragon] of Object.entries(state.dragons)) {
    if (dragon.id !== key) {
      problems.push(`dragon ${key}: keyed as ${key} but its id is ${dragon.id}`)
    }
    try {
      dragonDie(dragon.dieId)
    } catch {
      problems.push(`dragon ${dragon.id}: unknown dragon die ${dragon.dieId}`)
    }
    if (dragon.owner !== 'p1' && dragon.owner !== 'p2') {
      problems.push(`dragon ${dragon.id}: unknown owner ${String(dragon.owner)}`)
    }
    if (!DRAGON_LOCATION_KINDS.includes(dragon.location.kind)) {
      problems.push(`dragon ${dragon.id}: unknown location ${String(dragon.location.kind)}`)
    }
    if (dragon.location.kind === 'terrain' && !TERRAIN_SLOTS.includes(dragon.location.slot)) {
      problems.push(`dragon ${dragon.id}: unknown terrain slot ${String(dragon.location.slot)}`)
    }
  }

  // Nothing creates a dragon unless the rules being played have them, so one here
  // under `dragons: false` means a state was assembled by hand and would play a
  // game its own ruleset says is impossible.
  if (!state.ruleSet.dragons && Object.keys(state.dragons).length > 0) {
    problems.push(`dragons: ${Object.keys(state.dragons).length} in play under dragons: false`)
  }

  for (const player of PLAYERS) {
    const captured = capturedCount(state, player)
    if (captured >= 2 && state.winner !== player) {
      problems.push(`${player}: holds ${captured} terrains but is not recorded as the winner`)
    }
    if (livingUnits(state, player).length === 0 && state.winner === player) {
      problems.push(`${player}: recorded as the winner with no units in play`)
    }
  }

  if (state.winner !== null && state.turn.phase !== 'game_over') {
    problems.push(`winner is ${state.winner} but the phase is ${state.turn.phase}`)
  }

  if (state.rng.counter < 0 || !Number.isInteger(state.rng.counter)) {
    problems.push(`rng counter ${state.rng.counter} is not a non-negative integer`)
  }

  // A stashed attack roll exists only between the two halves of an exchange. It is
  // dropped by omission when the second half rebuilds `combat`, which is a claim
  // about one function -- so it is checked here rather than trusted. If it ever
  // survived, `digestState` would carry a list of raw dice into the four recorded
  // games that end mid-combat, and a golden would go red for the right reason but
  // with a useless message.
  // A Cantrip window (Phase 7f) suspends an exchange to cast a spell, so the parked
  // roll legitimately outlives the steps that own it -- `returnTo` is precisely the
  // claim "this exchange is coming back", and nothing else sets it.
  const suspended = state.turn.magic?.returnTo !== undefined
  if (
    state.turn.combat?.attack !== undefined &&
    !suspended &&
    !MID_EXCHANGE_STEPS.includes(state.turn.marchStep)
  ) {
    problems.push(
      `combat: an attack roll is still stashed at march step ${state.turn.marchStep}, ` +
        `which is not inside an exchange`,
    )
  }

  // An effect whose army has emptied or whose unit has left play should have been
  // dropped at the end of the last action. Asking `pruneEffects` rather than repeating
  // its conditions means the check cannot drift away from the rule it is checking.
  //
  // **Not while an Accelerated Growth offer is open** (Phase 9b). `stepGame` raises the
  // offer *before* pruning on purpose: the answer may put a unit back into the army the
  // kill emptied, and its Stone Skin must still be there when it does. Found by the
  // spell fuzz once the Double Strike fix moved the dice onto a path that reached it.
  if (state.turn.growthOffers === undefined && pruneEffects(state) !== state) {
    problems.push(
      `effects: ${state.effects.length - pruneEffects(state).effects.length} outlived their ` +
        `target and were not pruned`,
    )
  }
  for (const effect of state.effects) {
    if (effect.target.kind === 'unit' && state.units[effect.target.unitId] === undefined) {
      problems.push(`effect ${effect.source}: names unit ${effect.target.unitId}, which does not exist`)
    }
    if (effect.expiresAtStartOfTurnOf !== 'p1' && effect.expiresAtStartOfTurnOf !== 'p2') {
      problems.push(
        `effect ${effect.source}: expires at the start of ` +
          `${String(effect.expiresAtStartOfTurnOf)}'s turn, who is not a player`,
      )
    }
  }

  // Rapid Growth's parked contest (Phase 8) lives exactly as long as its question.
  // Dropped by omission in `finishContest`; checked here rather than trusted, for the
  // reason `combat.attack` is.
  if ((state.turn.contest !== undefined) !== (state.turn.marchStep === 'rapid_growth' && state.turn.phase === 'march')) {
    problems.push(
      `turn.contest is ${state.turn.contest === undefined ? 'missing' : 'present'} at march ` +
        `step ${state.turn.marchStep}, but exists exactly while Rapid Growth is being asked`,
    )
  }

  // Accelerated Growth's offers (Phase 9b): the dying dice are in the DUA until the
  // answer, which is what makes "killed unless exchanged" the state as it stands. An
  // empty list is omitted, never stored, near the digest.
  const offers = state.turn.growthOffers
  if (offers !== undefined && offers.length === 0) {
    problems.push('turn.growthOffers is present but empty; it is omitted when there is none')
  }
  for (const offer of offers ?? []) {
    for (const { unitId } of offer.dying) {
      const where = state.units[unitId]?.location.kind
      if (where !== 'dua') {
        problems.push(`${unitId} is offered to Accelerated Growth from the ${where ?? 'void'}, not the DUA`)
      }
    }
  }
  if (state.pending?.kind === 'accelerated_growth' && offers === undefined) {
    problems.push('an Accelerated Growth question is pending with no offer behind it')
  }

  const marched = state.turn.armiesMarched
  if (new Set(marched).size !== marched.length) {
    problems.push(`armiesMarched has a repeat: ${marched.join(', ')} -- each march needs a different army`)
  }

  // The roll-off choice (v1 Phase 10e): open exactly while the phase is `'setup'`, and
  // while it is open the terrains are the placeholder and nothing else -- every face 1,
  // nobody holding anything, p1's proposal at the Frontier. A placeholder that drifted
  // would be a board with faces nobody rolled.
  if ((state.rollOff !== undefined) !== (state.turn.phase === 'setup')) {
    problems.push(
      state.rollOff !== undefined
        ? `a roll-off choice is open outside the setup phase (${state.turn.phase})`
        : 'the setup phase has no roll-off choice open',
    )
  }
  if (state.rollOff !== undefined) {
    for (const slot of TERRAIN_SLOTS) {
      const terrain = state.terrains[slot]
      if (terrain.face !== 1 || terrain.capturedBy !== null) {
        problems.push(`terrain ${slot}: shows face ${terrain.face} before the roll-off choice has rolled any`)
      }
    }
    if (state.terrains.frontier.dieId !== state.rollOff.proposals.p1) {
      problems.push("the Frontier placeholder is not p1's proposal")
    }
  }

  return problems
}

/** Throws if the state is invalid. For use at the top of tests and in the fuzzer. */
export function assertValidState(state: GameState, context = 'state'): void {
  const problems = validateState(state)
  if (problems.length > 0) {
    throw new Error(`${context} is invalid:\n  ${problems.join('\n  ')}`)
  }
}
