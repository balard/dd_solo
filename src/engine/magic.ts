/**
 * The magic pool: what a caster has to spend, and what they may spend it on.
 *
 * **One number, not a per-element tally**, and that is the load-bearing
 * simplification of the whole spell system. The rules say each unit's magic results
 * "may be divided between that unit's elements" (full rules p. 13), and
 * `validateState` enforces that every unit of a player shares one species -- so the
 * whole army's magic is a single total the caster splits freely between its species'
 * two elements. The starter book says it outright: "Each result rolled by the army
 * counts as one point of magic of EITHER of the species' elements."
 *
 * Two things follow. `resolveFaces` stays pure and `GameState`-free, because nothing
 * needs to know which die produced which element. And validating a whole announcement
 * is a sum rather than a knapsack: every point is interchangeable.
 *
 * It collapses the day two units in one army carry different elements -- a species
 * ability, or a mixed force. Nothing else in the spell system depends on it, and this
 * comment is where a future reader should start when it does.
 */
import { speciesElements, terrainDie, terrainType, unitType } from '../data/load'
import {
  spell,
  spellAcceptsElement,
  spellAllowsSpecies,
  SPELLS,
  type Spell,
} from '../data/spells'
import type { Element } from '../data/types'

import { iconAt } from './effects'
import { resolvesSpell, summonable } from './spells'
import {
  army as armyOf,
  deadUnits,
  livingUnits,
  opponentOf,
  speciesOf,
  TERRAIN_SLOTS,
  type AnnouncedSpell,
  type ArmyRef,
  type GameState,
  type PlayerId,
  type RuleSet,
  type SpellTarget,
} from './types'

/**
 * Magic results a caster may spend, and the two permissions that narrow what they buy.
 *
 * Both restrictions are `?: true` and omitted rather than `false`: this lands on
 * `turn.magic.pool` and therefore inside `digestState`'s `stableJson(state.turn)`.
 */
export interface MagicPool {
  readonly points: number
  /** Which elements these points may be spent as: the caster's species' elements,
   *  widened by a Standing Stones the casting army holds. */
  readonly elements: readonly Element[]
  /** Cantrip's second sentence: these points buy only `C`-marked spells. */
  readonly cantripOnly?: true
  /** Cast from the Reserve Area: only `R`-marked spells. */
  readonly fromReserves?: true
}

/**
 * The elements an army's magic may be spent as.
 *
 * Standing Stones -- "all units in your controlling army may convert any or all of
 * their magic results to an element this terrain contains" -- is the only thing that
 * widens it, and it comes live for free: `iconAt` returns null unless
 * `eighthFace: 'full'`, and `resolvesIcon` already gates the icon itself on
 * `magic: 'spells'`.
 */
export function castingElements(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
): readonly Element[] {
  const own = speciesElements(speciesOf(state, player))
  if (ref === 'reserve') return own
  if (iconAt(state, player, ref) !== 'standing_stones') return own

  const here = terrainType(terrainDie(state.terrains[ref].dieId).type).elements
  return [...own, ...here.filter((e) => !own.includes(e))]
}

/** The ordinary pool for a magic action. */
export function magicPool(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  points: number,
): MagicPool {
  return {
    points,
    elements: castingElements(state, player, ref),
    ...(ref === 'reserve' ? { fromReserves: true as const } : {}),
  }
}

/** Cantrip's restricted pool, from a non-magic non-maneuver roll. */
export function cantripPool(
  state: GameState,
  player: PlayerId,
  ref: ArmyRef,
  points: number,
): MagicPool {
  return { ...magicPool(state, player, ref, points), cantripOnly: true }
}

/** One spell this pool could buy, and how. */
export interface Castable {
  readonly spell: Spell
  /** The pool's elements this spell accepts: its own, or all of them if Elemental. */
  readonly elements: readonly Element[]
  /** How many combined castings the pool could afford. 1 for a non-cumulative spell,
   *  which gains nothing from a second casting on the same target. */
  readonly maxCount: number
  /** Every legal target, so the client offers a list rather than computing one and
   *  the engine validates against exactly what it offered. */
  readonly targets: readonly SpellTargetOffer[]
}

/**
 * One target, and the fewest castings that can reach it.
 *
 * `minCount` exists because Resurrect Dead's cost is a property of what it is aimed
 * at: "target one health-worth of units in your DUA", multiplied by the castings, so a
 * 2-health unit needs two castings and six magic. Carrying it on the offer is what
 * keeps the rule in one place -- a client that shows a target the engine will then
 * refuse is the bug this whole shape exists to prevent, and the fuzz found it within
 * a hundred games.
 *
 * 1 for every other spell, where a target is a target and the count is free.
 */
export interface SpellTargetOffer {
  readonly target: SpellTarget
  readonly minCount: number
}

/**
 * Every target this spell could legally be aimed at right now.
 *
 * "The target of a spell, or the conditions for a spell's effect to occur, must exist
 * at the time the target is selected" (p. 13) -- so an empty army is not a target, and
 * a spell with no target at all is not offered.
 *
 * A Reserve Army is an army: "target any army" names it, and Wind Walk on a Reserve
 * Army is legal and useless, which is the player's business rather than the engine's.
 */
export function spellTargets(
  state: GameState,
  caster: PlayerId,
  s: Spell,
): readonly SpellTargetOffer[] {
  const once = (target: SpellTarget): SpellTargetOffer => ({ target, minCount: 1 })

  const armies = (player: PlayerId): SpellTargetOffer[] =>
    ([...TERRAIN_SLOTS, 'reserve'] as readonly ArmyRef[])
      .filter((ref) => armyOf(state, player, ref).length > 0)
      .map((ref) => once({ kind: 'army', player, army: ref }))

  switch (s.target) {
    case 'army':
      return [...armies(caster), ...armies(opponentOf(caster))]
    case 'opposing_army':
      return armies(opponentOf(caster))
    case 'terrain':
      return TERRAIN_SLOTS.map((slot) => once({ kind: 'terrain', slot }))

    // Path. One unit per target rather than a set: the rules let a cumulative spell be
    // "cast multiple separate times, with a different target each time", which is how
    // a caster moves two units, and a set would need a budgeted selection at
    // announcement for no gain.
    case 'own_unit':
      return TERRAIN_SLOTS.flatMap((slot) =>
        armyOf(state, caster, slot).map((unit) => once({ kind: 'units', unitIds: [unit.id] })),
      )

    // Resurrect Dead. A unit's health *is* the number of castings it needs, so the
    // offer carries it and neither client has to know the rule.
    case 'own_dua':
      return deadUnits(state, caster).map((unit) => ({
        target: { kind: 'units', unitIds: [unit.id] } as const,
        minCount: unitType(unit.typeId).health,
      }))

    // Lightning Strike: "target any opposing unit". Reserves included -- the rules
    // shield a Reserve Army from missile fire and from dragons, and say nothing about
    // magic.
    case 'opposing_unit':
      return livingUnits(state, opponentOf(caster)).map((unit) =>
        once({ kind: 'units', unitIds: [unit.id] }),
      )

    // Mirage: "up to five health-worth of units **at any terrain**" -- so not
    // Reserves, and either player's. One unit per casting; see RULES-V0.md section 15.
    case 'units':
      return TERRAIN_SLOTS.flatMap((slot) =>
        [caster, opponentOf(caster)].flatMap((player) =>
          armyOf(state, player, slot).map((unit) => once({ kind: 'units', unitIds: [unit.id] })),
        ),
      )
  }
}

/**
 * Why this whole announcement is illegal, or null.
 *
 * Separate from `spellTargetProblem` because it is a rule *between* casts rather than
 * about any one of them -- and it is the rule that proves an announcement has to be
 * validated as a whole rather than cast by cast.
 */
export function announcementProblem(casts: readonly AnnouncedSpell[]): string | null {
  // "A unit may not be targeted by more than one Lightning Strike per magic action."
  const struck = new Set<string>()
  for (const cast of casts) {
    if (cast.spell !== 'lightning_strike' || cast.target.kind !== 'units') continue
    for (const id of cast.target.unitIds) {
      if (struck.has(id)) return 'a unit may not be targeted by more than one Lightning Strike'
      struck.add(id)
    }
  }
  return null
}

/**
 * Why this announced cast is illegal, or null.
 *
 * The per-spell rules that a list of targets cannot express, because they depend on
 * the number of castings or on the rest of the announcement. Separate from
 * `spellTargets` for that reason: one answers "what may I aim at", this answers "may I
 * aim *this* at it, for *this* much".
 */
export function spellTargetProblem(state: GameState, cast: AnnouncedSpell): string | null {
  const s = spell(cast.spell)

  if (s.id === 'resurrect_dead' && cast.target.kind === 'units') {
    // "...units in your DUA that contains the element of magic used to cast this
    // spell." The health budget is on the offer as `minCount`; this is the half that
    // depends on which element paid, and it bites only when a Standing Stones has lent
    // the pool an element the caster's species does not carry.
    for (const id of cast.target.unitIds) {
      const unit = state.units[id]
      if (unit === undefined) continue
      const elements = speciesElements(unitType(unit.typeId).species)
      if (!elements.includes(cast.element)) {
        return `${unitType(unit.typeId).name} does not contain ${cast.element}`
      }
    }
  }

  return null
}

/**
 * Every spell this pool could cast, for the announcement prompt.
 *
 * Pure -- no `GameState` -- so it is testable from a pool literal the way
 * `saiEffects` is testable from a face literal. The board question (which elements,
 * how many points) is answered by `magicPool` before this is called.
 *
 * It filters on `resolvesSpell`, which is what makes a half-built rung *playable*: a
 * spell the rules being played cannot resolve is never offered, so the throw behind
 * it guards only against a spell added to `data/` with no code behind it.
 */
export function castableSpells(
  state: GameState,
  caster: PlayerId,
  pool: MagicPool,
  ruleSet: RuleSet,
): readonly Castable[] {
  const speciesId = speciesOf(state, caster)
  const out: Castable[] = []

  for (const s of SPELLS) {
    if (!resolvesSpell(s.id, ruleSet)) continue
    if (!spellAllowsSpecies(s, speciesId)) continue
    if (pool.cantripOnly === true && !s.cantrip) continue
    if (pool.fromReserves === true && !s.reserves) continue
    if (s.cost > pool.points) continue

    let elements = pool.elements.filter((e) => spellAcceptsElement(s, e))
    // "...units in your DUA that contains the element of magic used to cast this
    // spell." Your dead are all your own species, so this is a fact about the *spell*
    // rather than about any one target -- and it bites only when a Standing Stones has
    // lent the pool an element your species does not carry.
    if (s.id === 'resurrect_dead') {
      const own = speciesElements(speciesId)
      elements = elements.filter((e) => own.includes(e))
    }
    if (elements.length === 0) continue

    // A spell with nowhere to land is dropped rather than offered -- the same rule
    // that drops a targeting SAI whose army holds nothing small enough to take.
    // "The target of a spell, **or the conditions for a spell's effect to occur**, must
    // exist at the time the target is selected" (p. 13). Summon Dragon is the first
    // spell with a condition beyond its target: a terrain is only a target if some
    // dragon of a colour this pool can pay for could actually be summoned to it.
    if (s.id === 'summon_dragon') {
      elements = elements.filter((e) =>
        TERRAIN_SLOTS.some((slot) => summonable(state, e, slot).length > 0),
      )
      if (elements.length === 0) continue
    }

    let targets = spellTargets(state, caster, s).filter(
      (t) => t.minCount * s.cost <= pool.points,
    )
    if (s.id === 'summon_dragon') {
      targets = targets.filter(
        (t) =>
          t.target.kind === 'terrain' &&
          elements.some((e) => summonable(state, e, t.target.kind === 'terrain' ? t.target.slot : 'frontier').length > 0),
      )
    }
    if (targets.length === 0) continue

    out.push({
      spell: s,
      elements,
      maxCount: s.cumulative ? Math.floor(pool.points / s.cost) : 1,
      // A target needing more castings than the pool can buy is not a target.
      targets: targets.filter((t) => t.minCount * s.cost <= pool.points),
    })
  }

  return out
}

/**
 * "7 magic (water or earth)" -- the sentence every magic prompt and every magic log
 * line opens with.
 *
 * Here rather than in either client, for `saiPhrase`'s reason: the first draft of a
 * shared sentence gets written twice, and that is how the browser and the terminal
 * start describing one roll differently. Element names are the element ids -- there
 * is no display table to consult, and `ELEMENT_NAME` in `Elements.tsx` is an identity
 * map that exists as a place to hang one later.
 */
export function magicRolled(pool: MagicPool): string {
  const [last, ...front] = [...pool.elements].reverse()
  const which =
    last === undefined
      ? 'no element'
      : front.length === 0
        ? last
        : `${front.reverse().join(', ')} or ${last}`

  const limit =
    pool.cantripOnly === true
      ? ', cantrip spells only'
      : pool.fromReserves === true
        ? ', reserve spells only'
        : ''

  return `${pool.points} magic (${which}${limit})`
}

/**
 * Two announced targets naming the same thing.
 *
 * One copy, in the engine, because three things ask it: the applier validating an
 * announcement, and both clients' drafts merging a repeat casting into a combined
 * one. Three copies of "are these the same army" is how two of them end up
 * disagreeing about a Reserve Army.
 */
export function sameSpellTarget(a: SpellTarget, b: SpellTarget): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'none':
      return true
    case 'army':
      return b.kind === 'army' && a.player === b.player && a.army === b.army
    case 'terrain':
      return b.kind === 'terrain' && a.slot === b.slot
    case 'units':
      return (
        b.kind === 'units' &&
        a.unitIds.length === b.unitIds.length &&
        a.unitIds.every((id) => b.unitIds.includes(id))
      )
  }
}

/**
 * What a client is part-way through announcing: a spell, and the element paying for it
 * once that is settled.
 *
 * Both clients hold one of these between taps. It is here rather than in either of
 * them for `spellPlan`'s reason -- the terminal and the browser ask the same three
 * questions in the same order, and two copies of "which half of the answer do I have"
 * is how they stop agreeing.
 */
export interface SpellAim {
  readonly spell: string
  readonly element?: Element
}

/** One staged cast in a client's announcement draft. */
export interface SpellDraftCast {
  readonly spell: string
  readonly element: Element
  readonly count: number
  readonly target: SpellTarget
}

/** A spell the picker can offer, with its price against what is left unspent. */
export interface SpellOffer {
  readonly castable: Castable
  /** How many more castings the remaining budget could buy. 0 means "greyed out". */
  readonly affordable: number
}

export interface SpellPlan {
  readonly spent: number
  readonly remaining: number
  /** Every castable spell, affordable or not -- a picker that hides what you cannot
   *  afford cannot tell you what you were short of. */
  readonly offers: readonly SpellOffer[]
  /** The answer, once the player is done. */
  readonly casts: readonly SpellDraftCast[]
}

/**
 * The spell picker, as a pure function over a staged draft.
 *
 * The Reinforce Step's pattern (`reinforcePlan`): the sheet stages casts and **one**
 * action reaches the engine, rather than a component holding wizard state or
 * dispatching per spell. The rules announce every spell at once and choose the
 * resolution order afterwards, so a per-spell dispatch would answer a question nobody
 * asked.
 *
 * In the engine rather than in `prompts.ts` because the terminal needs it too, and
 * `src/cli` has never depended on `src/ui`. Same reason `saiPhrase` sits in `roll.ts`.
 *
 * Staged casts are filtered against the live offer rather than trusted: a draft
 * outlives nothing, and it costs one line to make that true instead of assumed.
 */
export function spellPlan(
  castable: readonly Castable[],
  pool: MagicPool,
  staged: readonly SpellDraftCast[],
): SpellPlan {
  const offered = new Map(castable.map((c) => [c.spell.id, c]))

  const casts = staged.filter((cast) => {
    const offer = offered.get(cast.spell)
    return (
      offer !== undefined &&
      cast.count >= 1 &&
      offer.elements.includes(cast.element) &&
      offer.targets.some((t) => sameSpellTarget(t.target, cast.target) && cast.count >= t.minCount)
    )
  })

  const spent = casts.reduce(
    (sum, cast) => sum + (offered.get(cast.spell)?.spell.cost ?? 0) * cast.count,
    0,
  )
  const remaining = pool.points - spent

  return {
    spent,
    remaining,
    offers: castable.map((c) => ({
      castable: c,
      affordable: c.spell.cumulative
        ? Math.floor(remaining / c.spell.cost)
        : Math.min(1, Math.floor(remaining / c.spell.cost)),
    })),
    casts,
  }
}

/**
 * "your army at the Frontier" -- what a target reads as on a button.
 *
 * `name` is passed in because the two clients name a terrain differently: the browser
 * says "Your home" from the human's point of view, the terminal has its own table.
 * The *join* is here, so they cannot drift into describing one target two ways.
 */
export function spellTargetLabel(
  target: SpellTarget,
  human: PlayerId,
  name: (ref: ArmyRef) => string,
  unitName: (id: string) => string,
): string {
  switch (target.kind) {
    case 'none':
      return 'no target'
    case 'terrain':
      return name(target.slot)
    case 'army':
      return `${target.player === human ? 'your' : "the enemy's"} army at ${name(target.army)}`
    case 'units':
      return target.unitIds.map(unitName).join(', ')
  }
}
