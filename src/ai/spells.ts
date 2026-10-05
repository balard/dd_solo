/**
 * What a magic pool is worth, and what to announce with it (v1 Phase 10c).
 *
 * **Spells are scored from the data's shape wherever the shape says enough.** Seven of
 * the eighteen are an `effect` block -- modifiers, a scope, a duration -- and those are
 * valued by what their modifiers do to the armies they reach, so a new spell of that
 * shape needs no code here at all. The rest name a handler, and a handler is a
 * function the data cannot describe; each gets one line in `HANDLER_VALUE`. A test
 * fails for a spell with neither, which is `resolvesSpell`'s guard mirrored: a spell
 * the AI cannot score is a spell it silently never casts.
 *
 * Values are in the currency `estimate.ts` uses for everything else -- roughly health
 * killed or kept -- so a Hailstorm, a melee attack and a step toward the eighth face
 * are comparable, and `magicValue` in `greedy.ts` can price a magic action against
 * the other two actions a terrain might offer.
 */
import { unitType } from '../data/load'
import type { Element, ResultType } from '../data/types'
import { spellResultTypes, type Spell } from '../data/spells'
import { missileTargets } from '../engine/combat'
import { defaultContextFor } from '../engine/roll'
import {
  announcementProblem,
  elementsFor,
  castableSpells,
  magicPool,
  sameSpellTarget,
  spellPlan,
  stageCast,
  type Castable,
  type MagicPool,
  type SpellDraftCast,
} from '../engine/magic'
import { summonable } from '../engine/spells'
import {
  TERRAIN_SLOTS,
  army,
  opponentOf,
  type AnnouncedSpell,
  type ArmyRef,
  type GameState,
  type PlayerId,
  type SpellTarget,
  type UnitInstance,
} from '../engine/types'

import { expectedArmy, expectedDie, expectedFace, expectedMagicBySpecies, killValue, unitValue } from './estimate'

/** Below this a casting is noise, and a player told to be active still should not
 *  spend a turn's magic on it. */
const WORTH_CASTING = 0.2

const healthIn = (units: readonly UnitInstance[]): number =>
  units.reduce((total, unit) => total + unitType(unit.typeId).health, 0)

const armyHere = (state: GameState, player: PlayerId, ref: ArmyRef): readonly UnitInstance[] =>
  army(state, player, ref)

const enemyAt = (state: GameState, caster: PlayerId, ref: ArmyRef): boolean =>
  ref !== 'reserve' && army(state, opponentOf(caster), ref).length > 0

/**
 * The chance a unit rolls no save at all -- what Lightning Strike and Mirage ask.
 *
 * A unit roll, so no army modifier reaches it (p. 28), and a save roll against nothing.
 * A face that rerolls is counted as neither a pass nor a fail and dropped from both
 * sides, which is the same closed form `expectedDie` uses for the mean.
 */
function failsSave(state: GameState, typeId: string): number {
  let fails = 0
  let counted = 0
  for (const face of unitType(typeId).faces) {
    const worth = expectedFace(face, 'save', { purpose: { kind: 'save', against: null }, isCounter: false, isSubRoll: true }, state.ruleSet)
    if (worth.reroll) continue
    counted += 1
    if (worth.share.id + worth.share.normal + worth.share.sai === 0) fails += 1
  }
  return counted === 0 ? 0 : fails / counted
}

/**
 * The chance a die dies to `damage` after its own save roll (Firebolt, v2 Phase 6g):
 * the faces whose saves leave the damage at or above its health. Zero below its health,
 * whatever it rolls.
 */
function diesTo(state: GameState, typeId: string, damage: number): number {
  const health = unitType(typeId).health
  if (damage < health) return 0
  let dies = 0
  let counted = 0
  for (const face of unitType(typeId).faces) {
    const worth = expectedFace(face, 'save', { purpose: { kind: 'save', against: null }, isCounter: false, isSubRoll: true }, state.ruleSet)
    if (worth.reroll) continue
    counted += 1
    if (damage - (worth.share.id + worth.share.normal + worth.share.sai) >= health) dies += 1
  }
  return counted === 0 ? 0 : dies / counted
}

/**
 * How much one result of `type` is worth on this army, from `caster`'s side.
 *
 * The same modifier is worth very different amounts depending on whether anything is
 * there to use it on: a save bonus matters to an army something can attack, a melee
 * bonus to an army with someone to hit -- and to one that has not marched yet this turn
 * far more than to one whose only remaining use for it is a counter-attack.
 */
function weight(state: GameState, caster: PlayerId, owner: PlayerId, ref: ArmyRef, type: ResultType): number {
  const mine = owner === caster
  const facing = ref !== 'reserve' && army(state, opponentOf(owner), ref).length > 0
  switch (type) {
    // Insurance, not a result: a save bonus is worth something only if the enemy
    // actually attacks before it expires, which a player cannot count on. Priced at
    // half an offensive result, it stopped outbidding a step up the terrain track --
    // which, re-cast every turn against an opponent that never attacked, it had.
    case 'save':
      return facing ? 0.3 : 0.05
    case 'melee':
    case 'missile': {
      // Taking results off the enemy's attack is insurance too, for the same reason as a
      // save bonus: it pays only if they attack before it expires (v2 Phase 8e). At 0.5 a
      // Palsy re-cast every turn outbid walking a terrain home, and greedy capped the
      // magic monsters' mirrors against an opponent that never attacked.
      if (!mine) return facing ? 0.3 : 0.05
      if (!facing && (ref === 'reserve' || missileTargets(state, owner, ref).length === 0)) return 0
      const fresh = !state.turn.armiesMarched.includes(ref) && state.turn.marchingArmy !== ref
      return fresh ? 0.6 : 0.3
    }
    case 'maneuver': {
      if (ref === 'reserve') return 0
      const terrain = state.terrains[ref]
      if (mine) return terrain.face === 8 && terrain.capturedBy === owner ? 0 : 0.2
      return terrain.face >= 5 ? 0.4 : 0.1
    }
    case 'magic':
      return 0.2
  }
}

/** What one modifier on one army is worth to the caster. A subtraction cannot take
 *  more than the army is expected to roll; an addition is worth all of itself. */
function modifierOn(
  state: GameState,
  caster: PlayerId,
  owner: PlayerId,
  ref: ArmyRef,
  type: ResultType,
  kind: 'add' | 'subtract',
  amount: number,
): number {
  if (armyHere(state, owner, ref).length === 0) return 0
  const size = kind === 'add' ? amount : Math.min(amount, expectedArmy(state, owner, ref, type).total)
  const helpsOwner = kind === 'add' ? 1 : -1
  const toCaster = owner === caster ? helpsOwner : -helpsOwner
  return toCaster * size * weight(state, caster, owner, ref, type)
}

/** A declarative spell: the sum of its modifiers over every army it reaches. */
function effectValue(state: GameState, caster: PlayerId, s: Spell, target: SpellTarget, count: number): number {
  const effect = s.effect
  if (effect === undefined) return 0
  let value = 0

  // Necromantic Wave (v2 Phase 8f): rows of one `from` type are one choice -- the army
  // uses whichever its next roll counts -- so they are worth the best of them, never the sum.
  const converts = new Map<ResultType, number>()

  for (const m of effect.modifiers) {
    if (m.kind === 'counts_as' && m.from !== undefined && effect.scope === 'army' && target.kind === 'army') {
      const worth = conversionOn(state, caster, target.player, target.army, m.from, m.resultType as ResultType)
      converts.set(m.from, Math.max(converts.get(m.from) ?? -Infinity, worth))
      continue
    }
    if (m.kind !== 'add' && m.kind !== 'subtract') continue
    const amount = (m.amount ?? 0) * count
    const types = spellResultTypes(m.resultType)

    for (const type of types) {
      if (effect.scope === 'army' && target.kind === 'army') {
        value += modifierOn(state, caster, target.player, target.army, type, m.kind, amount)
      } else if (effect.scope === 'all_armies' && target.kind === 'terrain') {
        for (const owner of [caster, opponentOf(caster)]) {
          value += modifierOn(state, caster, owner, target.slot, type, m.kind, amount)
        }
      } else if (effect.scope === 'attackers' && target.kind === 'terrain') {
        // Wall of Fog: it shields whoever stands at the terrain from missiles. Worth
        // the enemy's strongest missile army against it, if ours is there to shield.
        if (armyHere(state, caster, target.slot).length === 0) continue
        const enemy = opponentOf(caster)
        const threat = Math.max(
          0,
          ...TERRAIN_SLOTS.filter((slot) => missileTargets(state, enemy, slot).includes(target.slot)).map(
            (slot) => expectedArmy(state, enemy, slot, 'missile').total,
          ),
        )
        value += Math.min(amount, threat) * 0.25 * (m.kind === 'subtract' ? 1 : -1)
      }
    }
  }
  for (const worth of converts.values()) value += worth
  return value
}

/**
 * A "counts as" on one army (v2 Phase 8f): the `from` results its dice are expected to
 * roll in a `to` roll -- magic faces in a melee attack, which count nothing until the
 * spell moves them -- priced as that many `to` results. The army's expected magic, moved
 * into the type it will roll next.
 */
function conversionOn(
  state: GameState,
  caster: PlayerId,
  owner: PlayerId,
  ref: ArmyRef,
  from: ResultType,
  to: ResultType,
): number {
  const rolled = armyHere(state, owner, ref).reduce(
    (sum, unit) => sum + expectedDie(unit.typeId, to, defaultContextFor(to), state.ruleSet).rolled[from],
    0,
  )
  return (owner === caster ? 1 : -1) * rolled * weight(state, caster, owner, ref, to)
}

type HandlerScore = (state: GameState, caster: PlayerId, casterRef: ArmyRef, target: SpellTarget, count: number) => number

const unitsOf = (state: GameState, target: SpellTarget): readonly UnitInstance[] =>
  target.kind === 'units'
    ? target.unitIds.flatMap((id) => (state.units[id] === undefined ? [] : [state.units[id] as UnitInstance]))
    : []

/**
 * One line per handler. `null` would mean "not scored", which the coverage test
 * refuses; a handler greedy deliberately never casts says `() => 0` and says why.
 */
const HANDLER_VALUE: Readonly<Record<string, HandlerScore>> = {
  // One damage a casting, after the target's save roll against nothing.
  hailstorm: (state, _caster, _ref, target, count) => {
    if (target.kind !== 'army') return 0
    const saves = expectedArmy(state, target.player, target.army, 'save').total
    return killValue(armyHere(state, target.player, target.army), count - saves)
  },

  // N damage on one unit: it dies when its saves leave N reaching its health (v2 6g).
  firebolt: (state, caster, _ref, target, count) =>
    unitsOf(state, target)
      .filter((unit) => unit.owner !== caster)
      .reduce((total, unit) => total + unitValue(unit.typeId, state.ruleSet) * diesTo(state, unit.typeId, count), 0),

  // Fearful Flames (v2 Phase 8f): Firebolt's kill, and a die that survives it flees on a
  // blank second save -- a displacement, half a kill, as Scent of Fear prices one.
  fearful_flames: (state, caster, _ref, target, count) =>
    unitsOf(state, target)
      .filter((unit) => unit.owner !== caster)
      .reduce((total, unit) => {
        const dies = diesTo(state, unit.typeId, count)
        const flees = unit.location.kind === 'terrain' ? (1 - dies) * failsSave(state, unit.typeId) : 0
        return total + unitValue(unit.typeId, state.ruleSet) * (dies + flees / 2)
      }, 0),

  // Finger of Death (v2 Phase 7e): no save, so certain -- once the castings reach the
  // die's health, which the offer's `minCount` already guarantees.
  finger_of_death: (state, caster, _ref, target, count) =>
    unitsOf(state, target)
      .filter((unit) => unit.owner !== caster && count >= unitType(unit.typeId).health)
      .reduce((total, unit) => total + unitValue(unit.typeId, state.ruleSet), 0),

  // Scent of Fear (v2 Phase 7e): Mirage with no save to escape it -- a sure
  // displacement, still worth half a kill: the die comes back next Reserves Phase.
  scent_of_fear: (state, caster, _ref, target) =>
    unitsOf(state, target)
      .filter((unit) => unit.owner !== caster)
      .reduce((total, unit) => total + unitValue(unit.typeId, state.ruleSet) / 2, 0),

  // Soiled Ground (v2 Phase 7e): buries what dies at a terrain this turn, either side's.
  // Worth something only where the enemy outnumbers nothing of ours to lose there -- a
  // terrain where our army stands is one where our own dead roll too.
  soiled_ground: (state, caster, _ref, target) => {
    if (target.kind !== 'terrain') return 0
    const theirs = army(state, opponentOf(caster), target.slot)
    if (theirs.length === 0 || army(state, caster, target.slot).length > 0) return 0
    return 0.15 * healthIn(theirs)
  },

  // Kills the unit unless it rolls a save.
  lightning_strike: (state, caster, _ref, target) =>
    unitsOf(state, target)
      .filter((unit) => unit.owner !== caster)
      .reduce((total, unit) => total + unitValue(unit.typeId, state.ruleSet) * failsSave(state, unit.typeId), 0),

  // Sends an enemy to its Reserves unless it saves: a displacement, worth half a kill.
  mirage: (state, caster, _ref, target) =>
    unitsOf(state, target)
      .filter((unit) => unit.owner !== caster)
      .reduce(
        (total, unit) => total + (unitValue(unit.typeId, state.ruleSet) * failsSave(state, unit.typeId)) / 2,
        0,
      ),

  // A reroll per casting in the army's next rolls: worth something only where the army
  // is about to roll against someone.
  flashfire: (state, caster, _ref, target, count) =>
    target.kind === 'army' && target.player === caster && enemyAt(state, caster, target.army) ? 0.4 * count : 0,

  // Worth casting when a big Treefolk is facing the enemy and a small one waits in the DUA.
  accelerated_growth: (state, caster) => {
    const smallDead = Object.values(state.units).some(
      (u) => u.owner === caster && u.location.kind === 'dua' && unitType(u.typeId).health === 1,
    )
    const bigAtRisk = TERRAIN_SLOTS.some(
      (slot) =>
        enemyAt(state, caster, slot) && army(state, caster, slot).some((u) => unitType(u.typeId).health >= 2),
    )
    return smallDead && bigAtRisk ? 1.5 : 0
  },

  // Turns a terrain down a step unless the army opposing the caster there beats six
  // maneuver a casting. Worth a great deal against an enemy's eighth face, a little
  // against one closing on it, and never cast where it would set the caster back.
  flash_flood: (state, caster, _ref, target, count) => {
    if (target.kind !== 'terrain') return 0
    const terrain = state.terrains[target.slot]
    const enemy = opponentOf(caster)
    const theirs = army(state, enemy, target.slot)
    if (theirs.length === 0 || army(state, caster, target.slot).length > 0) return 0
    const base = terrain.face === 8 && terrain.capturedBy === enemy ? 8 : terrain.face >= 6 ? 2 : 0
    const resists = expectedArmy(state, enemy, target.slot, 'maneuver').total >= 6 * count
    return base * (resists ? 0.3 : 0.8)
  },

  // Deliberately never cast: moving one die between two terrains the caster already
  // holds is a Reinforce Step's job, and scoring it well needs a plan greedy lacks.
  path: () => 0,

  // Six damage, less the maneuvering army's melee, to whoever walks the terrain -- so
  // only where the enemy stands alone and is likely to maneuver.
  wall_of_thorns: (state, caster, _ref, target, count) => {
    if (target.kind !== 'terrain') return 0
    const enemy = opponentOf(caster)
    const theirs = army(state, enemy, target.slot)
    if (theirs.length === 0 || army(state, caster, target.slot).length > 0) return 0
    const melee = expectedArmy(state, enemy, target.slot, 'melee').total
    return killValue(theirs, 6 * count - melee) * 0.4
  },

  // A unit back from the DUA into the casting army.
  resurrect_dead: (state, _caster, _ref, target) =>
    unitsOf(state, target).reduce((total, unit) => total + unitValue(unit.typeId, state.ruleSet), 0),

  // A dragon attacks the marching player's army at its terrain, so summon it onto an
  // enemy army standing where none of ours does -- never onto our own. It stays and
  // attacks that army every turn it marches there, not once, which is why it is priced
  // at the army's health up to eight rather than at one breath's five: at 0.8 x 5 the
  // fuzz summoned no dragon in 200 games.
  summon_dragon: (state, caster, _ref, target) => {
    if (target.kind !== 'terrain') return 0
    if (army(state, caster, target.slot).length > 0) return 0
    return Math.min(8, healthIn(army(state, opponentOf(caster), target.slot)))
  },
}

/** Every handler this file scores, for the coverage test. */
export const SCORED_HANDLERS: readonly string[] = Object.keys(HANDLER_VALUE)

/** What `count` castings of `s` at `target` are worth to `caster`. */
export function spellValue(
  state: GameState,
  caster: PlayerId,
  casterRef: ArmyRef,
  s: Spell,
  target: SpellTarget,
  count: number,
): number {
  if (count <= 0) return 0
  if (s.handler !== undefined) {
    const score = HANDLER_VALUE[s.handler]
    if (score === undefined) throw new Error(`GreedyAI cannot score spell handler ${s.handler}`)
    return score(state, caster, casterRef, target, count)
  }
  return effectValue(state, caster, s, target, count)
}

export interface Announcement {
  readonly casts: readonly AnnouncedSpell[]
  readonly value: number
}

const NOTHING: Announcement = { casts: [], value: 0 }

/**
 * The announcement: castings bought greedily by value per point.
 *
 * Each round prices one more step at every target on offer -- a first casting at its
 * `minCount`, or one more casting where the spell's count scales -- and buys the best
 * ratio that is worth having. Repeats merge through `stageCast`, exactly as both
 * clients merge them, so a staged draft can only ever be an announcement a client
 * could have built. It is checked against `spellPlan` and `announcementProblem` before
 * it leaves; anything that fails either is answered with nothing rather than sent.
 */
export function chooseAnnouncement(
  state: GameState,
  caster: PlayerId,
  casterRef: ArmyRef,
  castable: readonly Castable[],
  pool: MagicPool,
): Announcement {
  let staged: readonly SpellDraftCast[] = []
  let value = 0
  let remaining = pool.points

  for (;;) {
    let pick: { cast: SpellDraftCast; gain: number; cost: number } | null = null
    for (const offer of castable) {
      const s = offer.spell
      for (const aim of offer.targets) {
        const already = staged.find((c) => c.spell === s.id && sameSpellTarget(c.target, aim.target))?.count ?? 0
        if (already > 0 && (!s.cumulative || !s.countScales)) continue
        const next = already === 0 ? Math.max(1, aim.minCount) : already + 1
        const cost = s.cost * (next - already)
        if (cost > remaining || next > offer.maxCount) continue

        const element = payableElement(state, castable, pool, staged, offer, aim.target, next - already)
        if (element === null) continue

        const gain =
          spellValue(state, caster, casterRef, s, aim.target, next) -
          spellValue(state, caster, casterRef, s, aim.target, already)
        if (gain < WORTH_CASTING) continue
        if (pick === null || gain / cost > pick.gain / pick.cost) {
          pick = { cast: { spell: s.id, element, count: next - already, target: aim.target }, gain, cost }
        }
      }
    }
    if (pick === null) break
    staged = stageCast(castable, staged, pick.cast)
    value += pick.gain
    remaining -= pick.cost
  }

  const plan = spellPlan(castable, pool, staged)
  const casts: AnnouncedSpell[] = plan.casts.map((c) => ({
    spell: c.spell,
    element: c.element,
    count: c.count,
    target: c.target,
  }))
  if (plan.casts.length !== staged.length || plan.remaining < 0 || announcementProblem(pool, casts) !== null) {
    return NOTHING
  }
  return { casts, value }
}

/**
 * The element this many more castings at this target are paid in, or null if the pool
 * cannot pay for them in any.
 *
 * `elementFor`'s choice first, and for a single-species pool nothing else: its one
 * supplier pays every element on offer, and `remaining` has already bounded the cost.
 * A mixed pool (v2 Phase 1) may be able to pay only in another element, or not at all
 * once the right species' points are spent, so each is tried against the announcement
 * validator -- the same question a client asks through `spellPlan`.
 */
function payableElement(
  state: GameState,
  castable: readonly Castable[],
  pool: MagicPool,
  staged: readonly SpellDraftCast[],
  offer: Castable,
  target: SpellTarget,
  count: number,
): Element | null {
  const first = elementFor(state, offer, target)
  if (pool.suppliers === undefined) return first
  const candidates = first === null ? [] : [first, ...elementsFor(offer, target).filter((e) => e !== first)]
  for (const element of candidates) {
    if (offer.spell.id === 'summon_dragon' && target.kind === 'terrain' && summonable(state, element, target.slot).length === 0) {
      continue
    }
    const trial = stageCast(castable, staged, { spell: offer.spell.id, element, count, target })
    if (announcementProblem(pool, trial) === null) return element
  }
  return null
}

/** The element a casting at this target is paid in: the first the target accepts,
 *  except Summon Dragon, whose colour decides which dragons can come. */
function elementFor(state: GameState, offer: Castable, target: SpellTarget) {
  if (offer.spell.id === 'summon_dragon') {
    if (target.kind !== 'terrain') return null
    return offer.elements.find((e) => summonable(state, e, target.slot).length > 0) ?? null
  }
  return elementsFor(offer, target)[0] ?? null
}

/**
 * What a magic action by this army is expected to be worth: the announcement its
 * expected pool would buy. What `greedy.ts` prices magic at against melee and missile.
 */
export function announcementValue(state: GameState, player: PlayerId, ref: ArmyRef): number {
  const points = Math.floor(expectedArmy(state, player, ref, 'magic').total)
  if (points <= 0) return 0
  const pool = magicPool(state, player, ref, points, expectedMagicBySpecies(state, player, ref, points))
  return chooseAnnouncement(state, player, ref, castableSpells(state, player, pool, state.ruleSet), pool).value
}
