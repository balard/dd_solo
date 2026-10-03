/**
 * What happens to a unit at the moment it is killed or buried.
 *
 * v0 had no such moment: `applyDamage` moved units to the DUA and that was the end
 * of them. Under `dua: 'active'` a death is a place where a rule can intervene, and
 * Rise from the Ashes was the first one to. Accelerated Growth (Phase 7e) and the
 * Treefolk's Replanting (Phase 8) are the other two, and all three plug in here.
 *
 * > "Whenever a unit with this SAI is killed or buried, roll the unit. If **Rise
 * > from the Ashes** is rolled, the unit is moved to your Reserve Area. If an effect
 * > both kills and buries this unit, it may roll once when killed and again when
 * > buried. If the first roll is successful, the unit is not buried."
 *
 * Three things in that paragraph are easy to get wrong, and each is a test:
 *
 *  - The success condition is **rolling a Rise from the Ashes face**, not rolling an
 *    ID. On the Phoenix -- the only die in the box carrying it -- that is 2 faces in
 *    10, not 1.
 *  - It fires on **burial as well as death**, which is why `buryUnits` exists here
 *    rather than `bury` in `dua.ts` being the whole story.
 *  - An effect that both kills and buries gives **two** rolls, and a success on the
 *    first means the second never happens.
 *
 * Under `dua: 'inert'` none of this runs and **no die is rolled at all**. That is
 * not a detail: the 25 golden games are recorded under `V0_RULES`, and a single
 * extra draw here would shift `rng.counter` and every die after it in all of them.
 */
import { unitType } from '../data/load'
import { spell } from '../data/spells'

import { applyDamage } from './damage'
import { bury } from './dua'
import { cannotRoll, deathMagicImmune, isStunned, regrows } from './effects'
import { faceOf, rollFaces, type DieRoll } from './roll'
import { rollDie } from './rng'
import { terrainHas, unitHasAbility } from './species'
import {
  deadUnits,
  type ArmyRef,
  type BurialCheck,
  type GameState,
  type GrowthOffer,
  type LogEntry,
  type PlayerId,
  type UnitId,
  type UnitInstance,
} from './types'

/**
 * The SAI whose whole point is this file.
 *
 * Spelled out here rather than imported because `sai.ts` holds its handlers in an
 * object literal keyed by name; `death.test.ts` asserts this string is one of those
 * keys, so the two cannot drift apart silently.
 */
export const RISE_FROM_THE_ASHES = 'Rise from the Ashes'

export interface DeathOutcome {
  readonly state: GameState
  /** Units that rolled their way into Reserves instead. Always a subset of what was
   *  passed in, and empty under `dua: 'inert'`. */
  readonly risen: readonly UnitId[]
  /**
   * Accelerated Growth: dying units whose owner will be **asked** whether to exchange
   * them (v1 Phase 9b; Phase 7e exchanged them on the spot). They are in the DUA now,
   * and on `state.turn.growthOffers`.
   *
   * **Not yet killed, as far as the log goes**: whether they died is the answer's to
   * say. So the caller leaves them out of its `units_killed` entry -- which is what
   * `killedIds` is for -- and the answer writes the kill line for the ones declined.
   */
  readonly offered: readonly UnitId[]
  /**
   * Replanting: Treefolk that rolled an ID on their way to the DUA and went to Reserves
   * instead (Phase 8).
   *
   * **Never killed**, unlike `risen`: "any units that roll an ID icon
   * are not killed". So they are left out of `units_killed` too, and no other death
   * trigger ever sees them.
   */
  readonly replanted: readonly UnitId[]
  /**
   * Every Replanting roll, the misses as well as the `replanted` hits, so the log can
   * show a Treefolk that tried and failed. Empty whenever nothing qualified.
   */
  readonly replantDice: readonly DieRoll[]
  /**
   * Every Rise from the Ashes roll, the misses as well as the `risen` hits -- the same
   * rule `replantDice` follows, for the same reason: a Phoenix that rolled and failed
   * used to leave no trace, which is indistinguishable from one that never rolled.
   * On a kill-and-bury it holds both rolls, the kill's and the burial's.
   */
  readonly riseDice: readonly DieRoll[]
}

/** What a caller should actually report as killed, given what it asked for. */
export function killedIds(
  outcome: DeathOutcome,
  requested: readonly UnitId[],
): readonly UnitId[] {
  if (outcome.offered.length === 0 && outcome.replanted.length === 0) return requested
  const spared = new Set([...outcome.offered, ...outcome.replanted])
  return requested.filter((id) => !spared.has(id))
}

/**
 * The log one death produces: who really died, who rose, and who was exchanged.
 *
 * Entries are *built* here rather than written -- this file still logs nothing and
 * still knows nothing about phases. They are built here because the three-way split is
 * a fact about what `killUnits` just did, and eight call sites each deriving it from
 * `risen` and `replanted` is eight chances to report a unit as killed that never died.
 */
export function deathEntries(
  outcome: DeathOutcome,
  player: PlayerId,
  slot: ArmyRef,
  requested: readonly UnitId[],
): readonly LogEntry[] {
  const killed = killedIds(outcome, requested)
  return [
    // First, because the roll comes *before* the DUA: the dice that rolled an ID never
    // got there, and the ones that missed are named again in the kill line after it.
    ...(outcome.replantDice.length > 0
      ? [
          {
            kind: 'replanting',
            player,
            slot,
            dice: outcome.replantDice,
            rooted: outcome.replanted,
          } as const,
        ]
      : []),
    ...(killed.length > 0
      ? [{ kind: 'units_killed', player, slot, unitIds: killed } as const]
      : []),
    // The Rise from the Ashes rolls, hits and misses: the risen are a subset of the line
    // above -- really killed, and then moved -- and the rest stay dead.
    ...riseEntries(outcome, player),
    // Accelerated Growth's offers are logged by the answer, not here: nobody knows yet
    // whether they died.
  ]
}

const hasRiseFace = (unit: UnitInstance): boolean =>
  unitType(unit.typeId).faces.some(
    (face) => face.icon === 'SAI' && face.sai === RISE_FROM_THE_ASHES,
  )

/**
 * Rolls every unit in `unitIds` that carries the SAI and moves the successes to
 * Reserves. Units without it consume no randomness whatsoever.
 *
 * The roll order is the order units sit in `state.units`, which is the order
 * `armyAt` returns them and therefore the order `rollArmy` deals dice -- *not* the
 * order the player happened to type into `assign_damage`. Both replay identically,
 * since the action is recorded either way; the canonical one is chosen so that two
 * players naming the same units in different orders get the same game.
 *
 * **A sleeping or hypnotized Phoenix still rolls** (v2 Phase 7a, `RULES-V0.md` section
 * 16), unlike a Treefolk at Replanting: "whenever a unit with this SAI is killed or
 * buried, roll the unit" rolls a die that is already dead, and those statuses are about
 * a die in play. So this asks no `cannotRoll`, deliberately.
 */
function riseFromTheAshes(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  const candidates = Object.values(state.units).filter(
    (unit) => unitIds.includes(unit.id) && hasRiseFace(unit),
  )
  if (candidates.length === 0) {
    return { state, risen: [], offered: [], replanted: [], replantDice: [], riseDice: [] }
  }

  const units = { ...state.units }
  const risen: UnitId[] = []
  const riseDice: DieRoll[] = []
  let rng = state.rng

  for (const unit of candidates) {
    const type = unitType(unit.typeId)
    const [faceIndex, next] = rollDie(rng, type.faces.length)
    rng = next

    const face = type.faces[faceIndex]
    if (face === undefined) {
      throw new Error(`${unit.typeId}: rolled face ${faceIndex} of ${type.faces.length}`)
    }
    const rose = face.icon === 'SAI' && face.sai === RISE_FROM_THE_ASHES
    // Drawn like Replanting's strip: the die that rose lights up, the rest grey out.
    riseDice.push({ unitId: unit.id, typeId: unit.typeId, faceIndex, face, results: rose ? face.count : 0 })
    if (!rose) continue

    units[unit.id] = { ...unit, location: { kind: 'reserve' } }
    risen.push(unit.id)
  }

  return { state: { ...state, units, rng }, risen, offered: [], replanted: [], replantDice: [], riseDice }
}

/** The `units_risen` line for an outcome: every roll, and who rose. Nothing when no
 *  Phoenix rolled at all. */
export function riseEntries(outcome: DeathOutcome, player: PlayerId): readonly LogEntry[] {
  return outcome.riseDice.length === 0
    ? []
    : [{ kind: 'units_risen', player, unitIds: outcome.risen, dice: outcome.riseDice }]
}

/**
 * The log a burial writes: the Rise from the Ashes rolls it caused, and a
 * `units_buried` line naming only who really went to the BUA.
 *
 * Three burials -- the Temple, Dragon Fire and a declined Accelerated Growth under a
 * Flame -- each wrote `units_buried` for every unit they were *asked* to bury. A
 * Phoenix that rose on the way was in Reserves while its line said "buried".
 */
export function buryEntries(
  outcome: DeathOutcome,
  player: PlayerId,
  requested: readonly UnitId[],
  source?: Extract<LogEntry, { kind: 'units_buried' }>['source'],
): readonly LogEntry[] {
  const buried = requested.filter((id) => !outcome.risen.includes(id))
  return [
    ...riseEntries(outcome, player),
    ...(buried.length > 0
      ? [{ kind: 'units_buried', player, unitIds: buried, ...(source === undefined ? {} : { source }) } as const]
      : []),
  ]
}

/**
 * Replanting: "when at a terrain that contains water, Treefolk units that are killed
 * should be rolled before being moved to the DUA. Any units that roll an ID icon are
 * not killed and are instead moved to your Reserve Area."
 *
 *  - **Before the DUA**, so before Accelerated Growth as well: a replanted unit never
 *    reaches the point where an exchange could be offered. The rules do not order two
 *    things that both say "instead", and since Phase 9b this order is no house rule:
 *    the owner is asked about the exchange *after* seeing this roll, and a unit it
 *    misses is still offered -- every option either order would have given.
 *  - **"Should be rolled"**, not "may": no decision, which is what lets it live inside
 *    `killUnits` at all.
 *  - **A face, not a total**: "roll an ID icon" is Seize's question, so it is
 *    `rollFaces` and a look at the icon, never a resolved roll.
 *  - **Where the unit is standing**: a unit killed in the Reserve Area -- a Tower's
 *    missile -- is at no terrain, which contains no water.
 *  - **A die that cannot be rolled does not replant** (v2 Phase 7a): asleep, netted or
 *    hypnotized, it is still on the terrain under its status when this roll is made, so
 *    it fails and draws nothing -- section 11's sub-roll rule, `RULES-V0.md` section 16.
 *    A glaring die still rolls, as it does in any unit roll. A **stunned** die does not
 *    (v2 Phase 7b): Stun lets through only a roll an individual-targeting effect forces,
 *    and Replanting is not one -- the one reader of the status `cannotRoll` does not
 *    bring along. Rise from the Ashes is the other way on purpose: it rolls a die that is
 *    already dead.
 *
 * Board order, like `riseFromTheAshes`, and a unit that does not qualify draws nothing.
 * Gated on `speciesAbilities` alone (via `unitHasAbility`), not on `dua`: it moves a unit
 * to Reserves and touches the DUA not at all.
 */
function replanting(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  const none: DeathOutcome = { state, risen: [], offered: [], replanted: [], replantDice: [], riseDice: [] }
  if (!state.ruleSet.speciesAbilities) return none

  const candidates = Object.values(state.units).filter(
    (unit) =>
      unitIds.includes(unit.id) &&
      unit.location.kind === 'terrain' &&
      unitHasAbility(state.ruleSet, unit, 'Replanting') &&
      terrainHas(state, unit.location.slot, 'water') &&
      !cannotRoll(state, unit.id) &&
      !isStunned(state, unit.id),
  )
  if (candidates.length === 0) return none

  const units = { ...state.units }
  const replanted: UnitId[] = []
  const replantDice: DieRoll[] = []
  let rng = state.rng

  for (const unit of candidates) {
    const [rolled, next] = rollFaces([unit], rng)
    rng = next
    const die = rolled[0]
    if (die === undefined) continue

    // Drawn like any roll strip: the die that rolled an ID counts its ID, the rest
    // count nothing and grey out -- which reads as "this one made it" at a glance.
    const face = faceOf(die)
    const rooted = face.icon === 'ID'
    replantDice.push({ ...die, face, results: rooted ? face.count : 0 })
    if (!rooted) continue

    units[unit.id] = { ...unit, location: { kind: 'reserve' } }
    replanted.push(unit.id)
  }

  return { state: { ...state, units, rng }, risen: [], offered: [], replanted, replantDice, riseDice: [] }
}

/**
 * Kills units: to the DUA, then the death trigger.
 *
 * Under `dua: 'inert'` this is exactly `applyDamage` and nothing else -- same state,
 * same `rng.counter`. Like `applyDamage`, it does not check for victory: the caller
 * does, because the win check runs after every state change.
 *
 * `bury` is `killAndBury` saying so, and only matters to an Accelerated Growth offer:
 * what the owner declines is buried when they answer.
 */
export function killUnits(
  state: GameState,
  unitIds: readonly UnitId[],
  options: { readonly bury?: true } = {},
): DeathOutcome {
  // Replanting rolls first -- "before being moved to the DUA" -- and a unit it saves is
  // not killed at all, so nothing below ever sees it.
  const planted = replanting(state, unitIds)
  const { replanted, replantDice } = planted
  const remaining = unitIds.filter((id) => !replanted.includes(id))

  // Accelerated Growth is *offered*, not taken (Phase 9b): every eligible dying unit
  // goes to the DUA like the rest, and the offer waits on the turn for `stepGame` to
  // raise. Its partners are measured here, before the kill.
  const offers = growthOffers(planted.state, remaining, options.bury)
  const offered = offers.flatMap((offer) => offer.dying.map((d) => d.unitId))
  const dying = remaining.filter((id) => !offered.includes(id))

  const killed = applyDamage(planted.state, remaining)
  const recorded: GameState =
    offers.length === 0
      ? killed
      : {
          ...killed,
          turn: { ...killed.turn, growthOffers: [...(killed.turn.growthOffers ?? []), ...offers] },
        }

  if (state.ruleSet.dua !== 'active') {
    return { state: recorded, risen: [], offered, replanted, replantDice, riseDice: [] }
  }
  const risen = riseFromTheAshes(recorded, dying)
  // Soiled Ground (v2 Phase 7e), last: it asks about the dice that "go into the DUA", so
  // it is owed after Replanting and Rise from the Ashes, and rolled a step later, after
  // any growth offer (`burialStep`). A kill-and-bury buries anyway.
  const owed = options.bury === true ? risen.state : oweSoiled(risen.state, planted.state, remaining)
  return { ...risen, state: owed, offered, replanted, replantDice }
}

/**
 * Soiled Ground's burial checks (v2 Phase 7e), owed on the turn: "any unit killed at that
 * terrain that goes into the DUA must make a save roll. Those that do not generate a save
 * result are buried." Either player's dice -- "any unit" -- the caster's own included.
 *
 * Asked of where each die stood *before* the kill, since it is no longer at a terrain
 * after it. The Temple's holder is spared at its own Temple when the spell is the
 * opponent's, "cannot be affected by any opponent's death magic". `burialStep` rolls
 * only what is still in the DUA by then: a risen Phoenix and an exchanged Treefolk are
 * not.
 */
function oweSoiled(after: GameState, before: GameState, unitIds: readonly UnitId[]): GameState {
  const checks: BurialCheck[] = []
  for (const unit of Object.values(before.units)) {
    if (!unitIds.includes(unit.id) || unit.location.kind !== 'terrain') continue
    const slot = unit.location.slot
    const soiled = before.effects.find(
      (effect) =>
        effect.trigger === 'soiled_ground' && effect.target.kind === 'terrain' && effect.target.slot === slot,
    )
    if (soiled === undefined) continue
    if (soiled.expiresAtStartOfTurnOf !== unit.owner && deathMagicImmune(before, unit.owner, slot)) continue
    const check = checks.find((c) => c.player === unit.owner && c.slot === slot)
    if (check === undefined) checks.push({ source: 'Soiled Ground', player: unit.owner, slot, unitIds: [unit.id] })
    else checks[checks.indexOf(check)] = { ...check, unitIds: [...check.unitIds, unit.id] }
  }
  if (checks.length === 0) return after
  return { ...after, turn: { ...after.turn, burialDue: [...(after.turn.burialDue ?? []), ...checks] } }
}

/**
 * Accelerated Growth: "when a two (or greater) health Treefolk unit is killed, you
 * **may** instead exchange it with a one health Treefolk unit from your DUA."
 *
 * An offer per player, not a decision: `killUnits` is a pure transform called from
 * eight places and none of them can stop to ask. Phase 7e took the exchange
 * automatically for that reason, which made the "may" a house rule; Phase 9b defers it
 * instead, and `stepGame` raises it before anything else moves.
 *
 * A dying unit is offered only if it is of the spell's own species -- "a two (or greater)
 * health **Treefolk** unit", read off the data rather than the name -- and its owner had a
 * one-health unit of that species in the DUA *before* this kill. The species check is v2
 * Phase 1's: while a force was one species, only a Treefolk force could cast the spell
 * and every die in its DUA was Treefolk, so a Firewalker beside them never came up. How many are actually exchanged -- one partner each, each
 * partner once -- is the answer's to say.
 */
function growthOffers(
  state: GameState,
  unitIds: readonly UnitId[],
  bury: true | undefined,
): readonly GrowthOffer[] {
  if (state.ruleSet.dua !== 'active') return []

  const offers = new Map<
    PlayerId,
    { readonly dying: { unitId: UnitId; from: ArmyRef }[]; readonly partners: readonly UnitId[] }
  >()

  for (const unit of Object.values(state.units)) {
    if (!unitIds.includes(unit.id)) continue
    if (unit.location.kind !== 'terrain' && unit.location.kind !== 'reserve') continue
    if (!regrows(state, unit.owner)) continue

    const type = unitType(unit.typeId)
    if (type.health < 2) continue
    if (type.species !== spell('accelerated_growth').species) continue

    const partners = deadUnits(state, unit.owner)
      .filter(
        (dead) =>
          unitType(dead.typeId).species === type.species && unitType(dead.typeId).health === 1,
      )
      .map((dead) => dead.id)
    if (partners.length === 0) continue

    const from: ArmyRef = unit.location.kind === 'terrain' ? unit.location.slot : 'reserve'
    const offer = offers.get(unit.owner) ?? { dying: [], partners }
    offer.dying.push({ unitId: unit.id, from })
    offers.set(unit.owner, offer)
  }

  return [...offers].map(([player, offer]) => ({
    player,
    dying: offer.dying,
    partners: offer.partners,
    ...(bury === true ? { bury } : {}),
  }))
}

/**
 * Buries units that are already in the DUA, then the death trigger.
 *
 * `bury` refuses a unit that is still in play, so an effect that kills *and* buries
 * must go through `killAndBury` below rather than calling this directly.
 */
export function buryUnits(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  const buried = bury(state, unitIds)
  if (state.ruleSet.dua !== 'active') {
    return { state: buried, risen: [], offered: [], replanted: [], replantDice: [], riseDice: [] }
  }
  // No Replanting here: it is a rule about being *killed*, and a unit being buried out
  // of the DUA was killed some time ago.
  return { ...riseFromTheAshes(buried, unitIds), offered: [], replanted: [], replantDice: [] }
}

/**
 * An effect that kills *and* buries -- Flame, Fire breath, the Temple.
 *
 * Two steps, because the rules are two steps: a live unit passes through the DUA on
 * its way to the BUA. That is bookkeeping for every other die in the game and it is
 * not bookkeeping for a Phoenix, which "may roll once when killed and again when
 * buried" -- so collapsing this into one move would silently halve its chances, and
 * the only evidence would be a probability nobody measures.
 *
 * "If the first roll is successful, the unit is not buried", which is why the second
 * step is passed only what the first did not rescue.
 *
 * Its first caller is Phase 4's Flame. It ships now so that Flame is one line then,
 * and so that the rule is written down while the paragraph it comes from is in front
 * of us rather than reconstructed later from a comment.
 */
export function killAndBury(state: GameState, unitIds: readonly UnitId[]): DeathOutcome {
  const killed = killUnits(state, unitIds, { bury: true })
  // Only what actually reached the DUA can be buried. A risen unit and a replanted one
  // are both in Reserves, and `bury` throws on a unit that is still in play -- which is
  // what a Flame on a Treefolk at a water terrain would have done the day Replanting
  // landed, had this subtracted only the Phoenix's rescues.
  //
  // An offered unit *is* in the DUA, and is held back all the same: whether it was
  // killed at all is its owner's answer, and an exchanged unit was not -- so, like a
  // Phoenix that rose, it is not buried. The offer carries `bury` for the rest.
  const survivors = unitIds.filter(
    (id) =>
      !killed.risen.includes(id) && !killed.replanted.includes(id) && !killed.offered.includes(id),
  )
  const buried = buryUnits(killed.state, survivors)

  return {
    state: buried.state,
    risen: [...killed.risen, ...buried.risen],
    offered: killed.offered,
    replanted: killed.replanted,
    replantDice: killed.replantDice,
    riseDice: [...killed.riseDice, ...buried.riseDice],
  }
}

